from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pymongo import MongoClient, ASCENDING
from dotenv import load_dotenv
import pandas as pd
import numpy as np
import io
import os
import traceback
from datetime import datetime
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

load_dotenv()

app = Flask(__name__)
CORS(app)

# ─── Routes ──────────────────────────────────────────────────
@app.route('/api/')
def home():
    return "Hello from result analyzer background"

# ─── MongoDB ─────────────────────────────────────────────────
MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017')
MONGO_DB  = os.getenv('MONGO_DB',  'result_analyzer')

client = MongoClient(MONGO_URI)
db     = client[MONGO_DB]
credits_col = db['paper_credits']   # { p_code, credits, updated_at }

# Ensure index
credits_col.create_index([('p_code', ASCENDING)], unique=True)

# ─── Constants ───────────────────────────────────────────────
REQUIRED_COLUMNS = ['reg_no', 'p_code', 'total', 'total_max', 'result']
PASS_VARIANTS    = {'PASS', 'P', 'PASSED', 'PA'}

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def normalize_columns(df):
    df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]
    return df

def validate_columns(df):
    return [c for c in REQUIRED_COLUMNS if c not in df.columns]

def get_class_prefix(reg_no, suffix_len=3):
    s = str(reg_no).strip()
    return s[:-suffix_len] if len(s) > suffix_len else s

def get_year_prefix(reg_no):
    s = str(reg_no).strip()
    return s[:3] if len(s) >= 3 else s

def is_pass(r):
    return str(r).strip().upper() in PASS_VARIANTS

def grade_point_from_mark(mark, max_mark):
    """Grade point = (mark / max_mark) * 10, rounded to 2 dp."""
    if max_mark <= 0:
        return 0.0
    return round((mark / max_mark) * 10, 2)

def clean_val(v):
    """Convert NaNs to None for JSON safety."""
    if pd.isna(v):
        return None
    if isinstance(v, (np.float64, np.float32, float)):
        if np.isnan(v) or np.isinf(v):
            return None
    return v

def clean_nan(obj):
    """Recursively convert NaNs to None in lists/dicts."""
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_nan(x) for x in obj]
    elif pd.isna(obj):
        return None
    else:
        return obj

# ─────────────────────────────────────────────────────────────
# CREDIT DB HELPERS
# ─────────────────────────────────────────────────────────────

def get_credits_from_db(p_codes):
    """Return dict {p_code: credits} for given p_codes that exist in DB."""
    docs = credits_col.find({'p_code': {'$in': list(p_codes)}})
    return {d['p_code']: d['credits'] for d in docs}

def save_credits_to_db(credits_dict):
    """Upsert credits. credits_dict = {p_code: credits_value}"""
    for p_code, credits in credits_dict.items():
        credits_col.update_one(
            {'p_code': p_code},
            {'$set': {'p_code': p_code, 'credits': float(credits), 'updated_at': datetime.utcnow()}},
            upsert=True
        )

def get_all_credits():
    """Return all credits as list of dicts."""
    return list(credits_col.find({}, {'_id': 0}).sort('p_code', ASCENDING))

# ─────────────────────────────────────────────────────────────
# CORE COMPUTATION
# ─────────────────────────────────────────────────────────────

def compute_student_summary(df, credits_map, calc_type='cgpa'):
    """
    For each student compute:
    - total_obtained, total_max, num_subjects, arrear_count, overall_result
    - avg_percentage (simple)
    - calc_type: 'cgpa' uses Σ(GP * Credits) / Σ(Credits). 'average' uses avg_pct / 10.
    Rank by gpa (or average point) desc.
    """
    df = df.copy()
    df['result'] = df['result'].astype(str).str.strip().str.upper()

    rows = []
    for reg_no, group in df.groupby('reg_no', sort=False):
        total_obtained = float(group['total'].sum())
        total_max      = float(group['total_max'].sum())
        num_subjects   = len(group)
        arrear_count   = int((~group['result'].isin(PASS_VARIANTS)).sum())
        overall_result = 'PASS' if arrear_count == 0 else 'FAIL'
        avg_pct        = round((total_obtained / total_max * 100), 2) if total_max > 0 else 0.0

        # GPA calculation
        weighted_sum  = 0.0
        total_credits = 0.0
        has_credits   = True

        for _, subj_row in group.iterrows():
            p_code   = subj_row['p_code']
            mark     = float(subj_row['total'])
            max_mark = float(subj_row['total_max'])
            gp       = grade_point_from_mark(mark, max_mark)
            credit   = credits_map.get(p_code)
            if credit is None:
                has_credits = False
                break
            weighted_sum  += gp * float(credit)
            total_credits += float(credit)

        if calc_type == 'cgpa':
            if has_credits and total_credits > 0:
                gpa = round(weighted_sum / total_credits, 2)
            else:
                gpa = round(avg_pct / 10, 2)
        else:
            # Average marks mode: use avg_pct / 10
            gpa = round(avg_pct / 10, 2)
            has_credits = True  # Ignore credit availability in this mode

        subjects = []
        for _, subj_row in group.iterrows():
            p_code = subj_row['p_code']
            mark = float(subj_row['total'])
            max_mark = float(subj_row['total_max'])
            subj_data = {
                'p_code': p_code,
                'total': mark,
                'total_max': max_mark,
                'result': subj_row['result'],
                'credits': credits_map.get(p_code),
                'grade_point': grade_point_from_mark(mark, max_mark)
            }
            # Optional extra marks
            for col in ['int_mark', 'int_max', 'ext_mark', 'ext_max', 'p_name']:
                if col in group.columns:
                    subj_data[col] = clean_val(subj_row[col])
            subjects.append(subj_data)

        row = {
            'reg_no':         reg_no,
            'class_prefix':   get_class_prefix(reg_no),
            'year_prefix':    get_year_prefix(reg_no),
            'total_obtained': total_obtained,
            'total_max':      total_max,
            'num_subjects':   num_subjects,
            'arrear_count':   arrear_count,
            'avg_percentage': avg_pct,
            'gpa':            gpa,
            'has_credits':    has_credits,
            'overall_result': overall_result,
            'subjects':       subjects
        }
        first = group.iloc[0]
        for col in ['name', 'degree', 'colcode', 'year']:
            if col in df.columns:
                row[col] = clean_val(first[col])
        rows.append(row)

    summary = pd.DataFrame(rows)
    # Sort by GPA desc
    summary = summary.sort_values(['year_prefix', 'gpa'], ascending=[True, False]).reset_index(drop=True)

    # Global Overall rank (PASS only)
    # Actually, let's keep it global if needed, but the user wants it split.
    # Let's add 'year_rank' instead.
    for y_prefix, y_group in summary.groupby('year_prefix'):
        sorted_indices = y_group.sort_values('gpa', ascending=False).index
        counter = 1
        for idx in sorted_indices:
            if summary.loc[idx, 'overall_result'] == 'PASS':
                summary.loc[idx, 'overall_rank'] = counter
                counter += 1
            else:
                summary.loc[idx, 'overall_rank'] = None

    return summary


def compute_class_summaries(student_summary):
    classes = {}
    for prefix, grp in student_summary.groupby('class_prefix', sort=True):
        grp = grp.sort_values('gpa', ascending=False).reset_index(drop=True)
        ranks, counter = [], 1
        for _, r in grp.iterrows():
            if r['overall_result'] == 'PASS':
                ranks.append(counter); counter += 1
            else:
                ranks.append(None)
        grp['class_rank'] = ranks
        classes[prefix] = grp
    return classes


def compute_subject_summary(df, credits_map):
    df = df.copy()
    df['result'] = df['result'].astype(str).str.strip().str.upper()
    rows = []
    for p_code, grp in df.groupby('p_code', sort=True):
        total   = len(grp)
        passed  = int(grp['result'].isin(PASS_VARIANTS).sum())
        failed  = total - passed
        avg_mk  = round(grp['total'].mean(), 2)
        pass_pct = round((passed / total * 100), 2) if total > 0 else 0
        credit  = credits_map.get(p_code)
        rows.append({
            'p_code':          p_code,
            'credits':         credit,
            'total_students':  total,
            'passed':          passed,
            'failed':          failed,
            'pass_percentage': pass_pct,
            'avg_mark':        avg_mk,
        })
    return pd.DataFrame(rows)


def compute_paper_toppers(df, student_summary):
    df = df.copy()
    df['result'] = df['result'].astype(str).str.strip().str.upper()
    gpa_map  = student_summary.set_index('reg_no')['gpa'].to_dict()
    name_map = student_summary.set_index('reg_no')['name'].to_dict() if 'name' in student_summary.columns else {}
    df['gpa'] = df['reg_no'].map(gpa_map).fillna(0)

    toppers = []
    for p_code, grp in df.groupby('p_code', sort=True):
        grp = grp.sort_values(['total', 'gpa'], ascending=[False, False])
        top = grp.iloc[0]
        reg_no = top['reg_no']
        toppers.append({
            'p_code':       p_code,
            'reg_no':       reg_no,
            'name':         name_map.get(reg_no, top.get('name', '—')),
            'class_prefix': get_class_prefix(reg_no),
            'mark':         float(top['total']),
            'total_max':    float(top['total_max']),
            'result':       top['result'],
            'gpa':          float(gpa_map.get(reg_no, 0)),
        })
    return toppers


def compute_class_subject_toppers(df, student_summary):
    df = df.copy()
    df['result'] = df['result'].astype(str).str.strip().str.upper()
    df['class_prefix'] = df['reg_no'].apply(get_class_prefix)
    gpa_map  = student_summary.set_index('reg_no')['gpa'].to_dict()
    name_map = student_summary.set_index('reg_no')['name'].to_dict() if 'name' in student_summary.columns else {}
    df['gpa'] = df['reg_no'].map(gpa_map).fillna(0)

    result = {}
    for (cls, p_code), grp in df.groupby(['class_prefix', 'p_code'], sort=True):
        grp = grp.sort_values(['total', 'gpa'], ascending=[False, False])
        top = grp.iloc[0]
        reg_no = top['reg_no']
        result.setdefault(cls, []).append({
            'p_code':    p_code,
            'reg_no':    reg_no,
            'name':      name_map.get(reg_no, top.get('name', '—')),
            'mark':      float(top['total']),
            'total_max': float(top['total_max']),
            'result':    top['result'],
            'gpa':       float(gpa_map.get(reg_no, 0)),
        })
    return result


def compute_overall_stats(student_summary):
    total    = len(student_summary)
    passed   = int((student_summary['overall_result'] == 'PASS').sum())
    failed   = total - passed
    pass_pct = round((passed / total * 100), 2) if total > 0 else 0
    avg_pct  = round(student_summary['avg_percentage'].mean(), 2) if total > 0 else 0.0
    avg_gpa  = round(student_summary['gpa'].mean(), 2) if total > 0 else 0.0
    
    # Handle NaNs
    if np.isnan(avg_pct): avg_pct = 0.0
    if np.isnan(avg_gpa): avg_gpa = 0.0

    return {
        'total_students':          total,
        'passed_students':         passed,
        'failed_students':         failed,
        'overall_pass_percentage': pass_pct,
        'avg_class_percentage':    avg_pct,
        'avg_gpa':                 avg_gpa,
    }


def compute_class_stats(class_summaries):
    stats = {}
    for prefix, df in class_summaries.items():
        total  = len(df)
        passed = int((df['overall_result'] == 'PASS').sum())
        failed = total - passed
        
        avg_pct = round(df['avg_percentage'].mean(), 2) if total > 0 else 0.0
        avg_gpa = round(df['gpa'].mean(), 2) if total > 0 else 0.0
        
        if np.isnan(avg_pct): avg_pct = 0.0
        if np.isnan(avg_gpa): avg_gpa = 0.0

        stats[prefix] = {
            'class_prefix':    prefix,
            'total_students':  total,
            'passed_students': passed,
            'failed_students': failed,
            'pass_percentage': round((passed / total * 100), 2) if total > 0 else 0,
            'avg_percentage':  avg_pct,
            'avg_gpa':         avg_gpa,
        }
    return stats

# ─────────────────────────────────────────────────────────────
# FILE READING
# ─────────────────────────────────────────────────────────────

def read_and_prepare(file):
    filename = file.filename.lower()
    if not (filename.endswith('.xlsx') or filename.endswith('.xls') or filename.endswith('.csv')):
        raise ValueError('Invalid file type. Please upload .xlsx, .xls, or .csv')
    df = pd.read_csv(file) if filename.endswith('.csv') else pd.read_excel(file)
    df = normalize_columns(df)
    missing = validate_columns(df)
    if missing:
        raise ValueError(f'Missing required columns: {", ".join(missing)}')
    for col in ['total', 'total_max', 'int_mark', 'int_max', 'ext_mark', 'ext_max']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
    df['reg_no'] = df['reg_no'].astype(str).str.strip()
    df['p_code'] = df['p_code'].astype(str).str.strip()
    return df

# ─────────────────────────────────────────────────────────────
# EXCEL STYLING
# ─────────────────────────────────────────────────────────────

HEADER_FILL = PatternFill(start_color='1E3A5F', end_color='1E3A5F', fill_type='solid')
HEADER_FONT = Font(color='FFFFFF', bold=True, size=11)
ALT_FILL    = PatternFill(start_color='EBF3FB', end_color='EBF3FB', fill_type='solid')
PASS_FONT   = Font(color='1A7F37', bold=True)
FAIL_FONT   = Font(color='CF222E', bold=True)
GOLD_FONT   = Font(color='9A6700', bold=True, size=12)
SILVER_FONT = Font(color='57606A', bold=True)
BRONZE_FONT = Font(color='953800', bold=True)
THIN_BORDER = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'),  bottom=Side(style='thin')
)
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)


def style_sheet(ws):
    for cell in ws[1]:
        cell.fill = HEADER_FILL; cell.font = HEADER_FONT
        cell.alignment = CENTER; cell.border = THIN_BORDER
    for row_idx, row in enumerate(ws.iter_rows(min_row=2), 2):
        for cell in row:
            cell.border = THIN_BORDER; cell.alignment = CENTER
            if row_idx % 2 == 0: cell.fill = ALT_FILL
    for col_idx, col in enumerate(ws.columns, 1):
        max_len = 0
        col_letter = get_column_letter(col_idx)
        for cell in col:
            try:
                if cell.value: max_len = max(max_len, len(str(cell.value)))
            except: pass
        ws.column_dimensions[col_letter].width = min(max_len + 4, 35)


def apply_rank_result_colors(ws, rank_col_idx, result_col_idx):
    for row in ws.iter_rows(min_row=2):
        rc = row[rank_col_idx - 1]; vc = row[result_col_idx - 1]
        if vc.value == 'PASS': vc.font = PASS_FONT
        elif vc.value == 'FAIL': vc.font = FAIL_FONT
        try:
            rank = int(rc.value)
            if rank == 1: rc.font = GOLD_FONT
            elif rank == 2: rc.font = SILVER_FONT
            elif rank == 3: rc.font = BRONZE_FONT
        except: pass


def write_student_sheet(writer, df, sheet_name, rank_col='class_rank', calc_type='cgpa'):
    export = df.copy()
    col_order = [rank_col, 'reg_no']
    for opt in ['name', 'degree', 'colcode', 'year']:
        if opt in export.columns: col_order.append(opt)
    
    if calc_type == 'cgpa':
        col_order += ['num_subjects', 'total_obtained', 'total_max', 'avg_percentage', 'gpa', 'arrear_count', 'overall_result']
    else:
        col_order += ['num_subjects', 'total_obtained', 'total_max', 'avg_percentage', 'arrear_count', 'overall_result']
    
    col_order = [c for c in col_order if c in export.columns]
    export = export[col_order]
    
    rename = {
        rank_col: 'Rank', 'reg_no': 'Reg No', 'name': 'Name',
        'degree': 'Degree', 'colcode': 'College Code', 'year': 'Year',
        'num_subjects': 'Subjects', 'total_obtained': 'Marks Obtained',
        'total_max': 'Max Marks', 'avg_percentage': 'Percentage (%)' if calc_type == 'average' else 'Avg %',
        'gpa': 'GPA', 'arrear_count': 'Arrears', 'overall_result': 'Result',
    }
    export.rename(columns=rename, inplace=True)
    export['Rank'] = export['Rank'].apply(lambda x: int(x) if pd.notna(x) and x is not None else '—')
    export.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    ws = writer.sheets[sheet_name[:31]]
    style_sheet(ws)
    headers = list(export.columns)
    apply_rank_result_colors(ws, headers.index('Rank') + 1, headers.index('Result') + 1)


def write_subject_sheet(writer, df, sheet_name='Subject Analysis', calc_type='cgpa'):
    rename = {
        'p_code': 'Paper Code', 'credits': 'Credits',
        'total_students': 'Total Students', 'passed': 'Passed',
        'failed': 'Failed', 'pass_percentage': 'Pass %', 'avg_mark': 'Avg Mark',
    }
    if calc_type == 'average':
        if 'credits' in df.columns:
            df = df.drop(columns=['credits'])
        if 'Credits' in rename:
            del rename['credits']
    export = df.rename(columns=rename)
    export.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    ws = writer.sheets[sheet_name[:31]]
    style_sheet(ws)
    headers = list(export.columns)
    if 'Pass %' in headers:
        pct_idx = headers.index('Pass %') + 1
        for row in ws.iter_rows(min_row=2):
            cell = row[pct_idx - 1]
            try:
                val = float(cell.value)
                if val >= 75: cell.font = PASS_FONT
                elif val < 50: cell.font = FAIL_FONT
            except: pass


def write_toppers_sheet(writer, toppers, sheet_name, calc_type='cgpa'):
    if not toppers: return
    df = pd.DataFrame(toppers)
    rename = {
        'p_code': 'Paper Code', 'reg_no': 'Reg No', 'name': 'Name',
        'class_prefix': 'Class', 'mark': 'Mark', 'total_max': 'Max',
        'result': 'Result', 'gpa': 'Student GPA' if calc_type == 'cgpa' else 'Percentage %',
    }
    if calc_type == 'average':
        if 'gpa' in df.columns:
            # Show actual percentage for toppers
             pass # mapping already changed in rename
    col_order = [c for c in rename if c in df.columns]
    export = df[col_order].rename(columns=rename)
    export.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    ws = writer.sheets[sheet_name[:31]]
    style_sheet(ws)
    headers = list(export.columns)
    if 'Result' in headers:
        ri = headers.index('Result') + 1
        for row in ws.iter_rows(min_row=2):
            c = row[ri - 1]
            if c.value == 'PASS': c.font = PASS_FONT
            elif c.value == 'FAIL': c.font = FAIL_FONT


def write_class_toppers_sheet(writer, class_toppers, sheet_name, calc_type='cgpa'):
    rows = []
    for cls, toppers in sorted(class_toppers.items()):
        for t in toppers:
            rows.append({
                'Class': cls, 'Paper Code': t['p_code'],
                'Reg No': t['reg_no'], 'Name': t.get('name', '—'),
                'Mark': t['mark'], 'Max': t['total_max'],
                'Result': t['result'], 'Final Score': t.get('gpa', '—') if calc_type == 'cgpa' else t.get('avg_percentage', '—'),
            })
    if not rows: return
    df = pd.DataFrame(rows)
    df.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    ws = writer.sheets[sheet_name[:31]]
    style_sheet(ws)
    headers = list(df.columns)
    if 'Result' in headers:
        ri = headers.index('Result') + 1
        for row in ws.iter_rows(min_row=2):
            c = row[ri - 1]
            if c.value == 'PASS': c.font = PASS_FONT
            elif c.value == 'FAIL': c.font = FAIL_FONT

# ─────────────────────────────────────────────────────────────
# ROUTES — CREDITS MANAGEMENT
# ─────────────────────────────────────────────────────────────

@app.route('/api/credits', methods=['GET'])
def get_credits():
    """Get all paper credits from DB."""
    try:
        all_credits = get_all_credits()
        return jsonify({'credits': all_credits})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/credits', methods=['POST'])
def save_credits():
    """Save/update credits. Body: { credits: [{p_code, credits}, ...] }"""
    try:
        data = request.get_json()
        if not data or 'credits' not in data:
            return jsonify({'error': 'No credits data provided'}), 400
        credits_dict = {item['p_code']: item['credits'] for item in data['credits']}
        save_credits_to_db(credits_dict)
        return jsonify({'success': True, 'saved': len(credits_dict)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/credits/<p_code>', methods=['PUT'])
def update_credit(p_code):
    """Update a single paper's credit."""
    try:
        data = request.get_json()
        if 'credits' not in data:
            return jsonify({'error': 'credits field required'}), 400
        save_credits_to_db({p_code: data['credits']})
        return jsonify({'success': True, 'p_code': p_code, 'credits': data['credits']})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/credits/<p_code>', methods=['DELETE'])
def delete_credit(p_code):
    """Delete a paper's credit entry."""
    try:
        credits_col.delete_one({'p_code': p_code})
        return jsonify({'success': True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/credits/check', methods=['POST'])
def check_credits():
    """
    Given a list of p_codes, return which ones are missing from DB.
    Body: { p_codes: [...] }
    """
    try:
        data    = request.get_json()
        p_codes = list(set(data.get('p_codes', [])))
        found   = get_credits_from_db(p_codes)
        missing = [p for p in p_codes if p not in found]
        return jsonify({
            'found':   [{'p_code': k, 'credits': v} for k, v in found.items()],
            'missing': missing,
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ─────────────────────────────────────────────────────────────
# ROUTES — ANALYZE & EXPORT
# ─────────────────────────────────────────────────────────────

@app.route('/api/analyze', methods=['POST'])
def analyze():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        calc_type   = request.form.get('calc_type', 'cgpa')

        df = read_and_prepare(file)
        p_codes     = list(df['p_code'].unique())
        credits_map = get_credits_from_db(p_codes) if calc_type == 'cgpa' else {}
        missing     = [p for p in p_codes if p not in credits_map] if calc_type == 'cgpa' else []

        # If credits missing and in cgpa mode, return partial response
        if calc_type == 'cgpa' and missing:
            return jsonify({
                'credits_missing': True,
                'missing_p_codes': missing,
                'found_credits':   [{'p_code': k, 'credits': v} for k, v in credits_map.items()],
                'all_p_codes':     p_codes,
            }), 202  # 202 = needs more info

        # All info available — full analysis
        student_summary  = compute_student_summary(df, credits_map, calc_type=calc_type)
        class_summaries  = compute_class_summaries(student_summary)
        subject_summary  = compute_subject_summary(df, credits_map)
        paper_toppers    = compute_paper_toppers(df, student_summary)
        class_toppers    = compute_class_subject_toppers(df, student_summary)
        overall_stats    = compute_overall_stats(student_summary)
        class_stats      = compute_class_stats(class_summaries)

        top3 = student_summary[student_summary['overall_result'] == 'PASS'].head(3)

        class_top3 = {}
        for prefix, cls_df in class_summaries.items():
            top = cls_df[cls_df['overall_result'] == 'PASS'].head(3)
            # Use where(pd.notnull(), None) instead of replace for safer handling of objects
            class_top3[prefix] = top.where(pd.notnull(top), None).to_dict(orient='records')

        class_students = {}
        for prefix, cls_df in class_summaries.items():
            class_students[prefix] = cls_df.to_dict(orient='records')

        response_data = {
            'credits_missing':  False,
            'overall_stats':    overall_stats,
            'class_stats':      list(class_stats.values()),
            'student_summary':  student_summary.to_dict(orient='records'),
            'class_students':   class_students,
            'subject_summary':  subject_summary.to_dict(orient='records'),
            'paper_toppers':    paper_toppers,
            'class_toppers':    class_toppers,
            'top3_overall':     top3.to_dict(orient='records'),
            'class_top3':       class_top3,
            'classes':          sorted(class_summaries.keys()),
            'years':            sorted(student_summary['year_prefix'].unique().tolist()),
            'columns_found':    list(df.columns),
            'total_subjects':   len(subject_summary),
            'credits_used':     credits_map,
            'calc_type':        calc_type,
        }
        
        # FINAL PASS: Remove all NaNs recursively
        return jsonify(clean_nan(response_data))

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/export', methods=['POST'])
def export():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']

    try:
        calc_type   = request.form.get('calc_type', 'cgpa')

        df = read_and_prepare(file)
        p_codes     = list(df['p_code'].unique())
        credits_map = get_credits_from_db(p_codes) if calc_type == 'cgpa' else {}
        missing     = [p for p in p_codes if p not in credits_map] if calc_type == 'cgpa' else []
        if calc_type == 'cgpa' and missing:
            return jsonify({'error': f'Credits missing for: {", ".join(missing)}. Please set credits or use Average Mark mode.'}), 400

        student_summary = compute_student_summary(df, credits_map, calc_type=calc_type)
        class_summaries = compute_class_summaries(student_summary)
        subject_summary = compute_subject_summary(df, credits_map)
        paper_toppers   = compute_paper_toppers(df, student_summary)
        class_toppers   = compute_class_subject_toppers(df, student_summary)

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            write_student_sheet(writer, student_summary, 'Overall Rankings', rank_col='overall_rank', calc_type=calc_type)
            for prefix, cls_df in sorted(class_summaries.items()):
                write_student_sheet(writer, cls_df, f'Class {prefix}'[:31], rank_col='class_rank', calc_type=calc_type)
            write_subject_sheet(writer, subject_summary, 'Subject Analysis', calc_type=calc_type)
            write_toppers_sheet(writer, paper_toppers, 'Paper Toppers (Overall)', calc_type=calc_type)
            write_class_toppers_sheet(writer, class_toppers, 'Paper Toppers (Class-wise)', calc_type=calc_type)
            df.to_excel(writer, sheet_name='Raw Data', index=False)
            style_sheet(writer.sheets['Raw Data'])

        output.seek(0)
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name='result_analysis.xlsx'
        )

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/template', methods=['GET'])
def get_template():
    """Generate and return a sample Excel template."""
    try:
        # Create a sample dataframe with necessary columns
        data = {
            'reg_no': [],
            'name': [],
            'p_code': [],
            'total': [],
            'total_max': [],
            'result': [],
            'degree': [],
            'year': []
        }
        df = pd.DataFrame(data)
        
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Template')
            ws = writer.sheets['Template']
            
            # Style header
            for cell in ws[1]:
                cell.fill = HEADER_FILL
                cell.font = HEADER_FONT
                cell.alignment = CENTER
                cell.border = THIN_BORDER
            
            # Adjust column widths
            for col in ws.columns:
                max_length = 0
                column = col[0].column_letter
                for cell in col:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except: pass
                adjusted_width = (max_length + 2)
                ws.column_dimensions[column].width = adjusted_width

        output.seek(0)
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name='result_template.xlsx'
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health():
    try:
        client.admin.command('ping')
        mongo_status = 'connected'
    except Exception:
        mongo_status = 'disconnected'
    return jsonify({'status': 'ok', 'mongo': mongo_status})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
