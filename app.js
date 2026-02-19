/* ============================================================
   RESULT ANALYZER v2.1 — app.js
   ============================================================ */

const API_BASE = 'https://result-analyzer-aljx.onrender.com/api';

// ─── State ───────────────────────────────────────────────────
let currentFile = null;
let analysisData = null;
let activeClass = null;
let missingPCodes = [];
let allCredits = []; // For Credits Manager

// ─── DOM ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Nav
const navItems = {
  analyzer: $('nav-analyzer'),
  credits: $('nav-credits')
};
const pages = {
  analyzer: $('page-analyzer'),
  credits: $('page-credits')
};

// Analyzer Elements
const dropZone = $('drop-zone');
const fileInput = $('file-input');
const fileInfo = $('file-info');
const fileNameDisplay = $('file-name-display');
const fileSizeDisplay = $('file-size-display');
const btnClear = $('btn-clear');
const btnAnalyze = $('btn-analyze');
const btnExport = $('btn-export');
const errorBanner = $('error-banner');
const errorMessage = $('error-message');
const errorClose = $('error-close');
const loadingOverlay = $('loading-overlay');
const resultsSection = $('results-section');
const btnTemplate = $('btn-template');

// Modal Elements
const creditsModal = $('credits-modal');
const modalBody = $('credits-modal-body');
const modalSave = $('modal-save');
const modalCancel = $('modal-cancel');

// Credits Manager Elements
const creditsTableBody = $('credits-tbody');
const creditsSearch = $('credits-search');
const btnAddCredit = $('btn-add-credit');
const btnBulkCredit = $('btn-bulk-credit');
const addCreditForm = $('add-credit-form');
const bulkCreditForm = $('bulk-credit-form');
const bulkInput = $('bulk-input');
const btnBulkSave = $('btn-bulk-save');
const btnBulkCancel = $('btn-bulk-cancel');
const acfPCode = $('acf-pcode');
const acfCredits = $('acf-credits');
const acfSave = $('acf-save');
const acfCancel = $('acf-cancel');

// Status
const badgeDot = $('badge-dot');
const apiStatusText = $('api-status-text');

// ─── Routing ──────────────────────────────────────────────────
function showPage(pageId) {
  Object.keys(pages).forEach(id => {
    pages[id].classList.toggle('hidden', id !== pageId);
    navItems[id].classList.toggle('active', id === pageId);
  });
  if (pageId === 'credits') {
    loadCredits();
  }
}
window.showPage = showPage;

// ─── API Health ───────────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (res.ok) {
      badgeDot.className = 'badge-dot ' + (data.mongo === 'connected' ? 'online' : 'offline');
      apiStatusText.textContent = data.mongo === 'connected' ? 'API Online' : 'DB Disconnected';
    } else throw new Error();
  } catch {
    badgeDot.className = 'badge-dot offline';
    apiStatusText.textContent = 'API Offline';
  }
}
checkHealth();
setInterval(checkHealth, 15000);

// ─── Utilities ───────────────────────────────────────────────
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function gpaColor(gpa) {
  if (gpa >= 8.5) return 'var(--purple)';
  if (gpa >= 7.5) return 'var(--green)';
  if (gpa >= 5.0) return 'var(--orange)';
  return 'var(--red)';
}

function gpaBadge(val, forcePercentage = false) {
  const isCgpa = analysisData && analysisData.calc_type === 'cgpa' && !forcePercentage;
  const displayVal = isCgpa ? val.toFixed(2) : val.toFixed(1) + '%';
  const color = isCgpa ? gpaColor(val) : (val >= 75 ? 'var(--green)' : val >= 50 ? 'var(--orange)' : 'var(--red)');
  return `<span class="badge" style="background:${color}22; color:${color}; border:1px solid ${color}33; font-weight:800">${displayVal}</span>`;
}

function resultBadge(r) {
  const isPass = r === 'PASS';
  return `<span class="badge ${isPass ? 'badge-pass' : 'badge-fail'}">${isPass ? '✓' : '✗'} ${r}</span>`;
}

function rankCell(rank) {
  if (!rank && rank !== 0) return `<span class="rank-cell rn">—</span>`;
  const cls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : 'rn';
  return `<span class="rank-cell ${cls}">${rank}</span>`;
}

function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> ${msg}`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── File Handling ────────────────────────────────────────────
function setFile(file) {
  currentFile = file;
  fileNameDisplay.textContent = file.name;
  fileSizeDisplay.textContent = fmtBytes(file.size);
  fileInfo.classList.remove('hidden');
  dropZone.classList.add('hidden');
  btnAnalyze.disabled = false;
  hideError();
}

function clearFile() {
  currentFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  btnAnalyze.disabled = true;
  btnExport.disabled = true;
  resultsSection.classList.add('hidden');
  analysisData = null;
  // Clear all searches
  $('overall-search').value = '';
  $('class-wise-search').value = '';
  $('subjects-search').value = '';
  $('toppers-search').value = '';
  $('year-pills').innerHTML = '';
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
btnTemplate.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = `${API_BASE}/template`;
});

btnClear.addEventListener('click', clearFile);

// ─── Error ───────────────────────────────────────────────────
function showError(msg) { errorMessage.textContent = msg; errorBanner.classList.remove('hidden'); }
function hideError() { errorBanner.classList.add('hidden'); }
errorClose.addEventListener('click', hideError);

// ─── Loading ─────────────────────────────────────────────────
function showLoading(txt = 'Analyzing results...') { $('loading-text').textContent = txt; loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }

// ─── Analyze ─────────────────────────────────────────────────
async function performAnalysis() {
  if (!currentFile) return;
  hideError();
  showLoading();

  const calcType = document.querySelector('input[name="calc_type"]:checked').value;
  const fd = new FormData();
  fd.append('file', currentFile);
  fd.append('calc_type', calcType);

  try {
    const res = await fetch(`${API_BASE}/analyze`, { method: 'POST', body: fd });
    const data = await res.json();

    if (res.status === 202 && data.credits_missing) {
      handleMissingCredits(data.missing_p_codes);
      return;
    }

    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    analysisData = data;
    renderAll(data);
    btnExport.disabled = false;
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoading();
  }
}

btnAnalyze.addEventListener('click', performAnalysis);

// ─── Missing Credits Modal ────────────────────────────────────
function handleMissingCredits(pCodes) {
  missingPCodes = pCodes;
  modalBody.innerHTML = pCodes.map(code => `
        <div class="credit-input-row">
            <span class="p-code-label">${code}</span>
            <input type="number" step="0.5" min="0" class="credit-input" data-code="${code}" placeholder="0.0" />
            <span class="credit-unit">Credits</span>
        </div>
    `).join('');
  hideLoading();
  creditsModal.classList.remove('hidden');
}

modalCancel.onclick = () => creditsModal.classList.add('hidden');

modalSave.onclick = async () => {
  const inputs = modalBody.querySelectorAll('.credit-input');
  const creditsToSave = [];
  let allFilled = true;

  inputs.forEach(input => {
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) {
      input.style.borderColor = 'var(--red)';
      allFilled = false;
    } else {
      input.style.borderColor = 'var(--border)';
      creditsToSave.push({ p_code: input.dataset.code, credits: val });
    }
  });

  if (!allFilled) return;

  try {
    modalSave.disabled = true;
    const res = await fetch(`${API_BASE}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits: creditsToSave })
    });
    if (!res.ok) throw new Error('Failed to save credits');

    creditsModal.classList.add('hidden');
    performAnalysis(); // Retry analysis
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    modalSave.disabled = false;
  }
};

// ─── Credits Manager Logic ────────────────────────────────────
async function loadCredits() {
  try {
    const res = await fetch(`${API_BASE}/credits`);
    const data = await res.json();
    allCredits = data.credits || [];
    renderCreditsTable(allCredits);
  } catch (err) {
    showToast('Failed to load credits', 'error');
  }
}

function renderCreditsTable(list) {
  creditsTableBody.innerHTML = list.length === 0
    ? '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted)">No paper credits found.</td></tr>'
    : list.map((c, i) => `
            <tr id="credit-row-${c.p_code.replace(/[^a-zA-Z0-9]/g, '-')}">
                <td>${i + 1}</td>
                <td><code style="font-size:13px">${c.p_code}</code></td>
                <td class="credit-val-cell">${c.credits}</td>
                <td style="font-size:12px; color:var(--text-muted)">${new Date(c.updated_at).toLocaleDateString()}</td>
                <td>
                    <div class="action-btns">
                        <button class="action-btn edit" onclick="editCredit('${c.p_code}', ${c.credits})">Edit</button>
                        <button class="action-btn del" onclick="deleteCredit('${c.p_code}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
  $('credits-count-lbl').textContent = `Total ${list.length} papers`;
}

creditsSearch.oninput = () => {
  const q = creditsSearch.value.trim().toLowerCase();
  const filtered = allCredits.filter(c => c.p_code.toLowerCase().includes(q));
  renderCreditsTable(filtered);
};

btnAddCredit.onclick = () => {
  addCreditForm.classList.toggle('hidden');
  bulkCreditForm.classList.add('hidden');
  acfPCode.focus();
};

btnBulkCredit.onclick = () => {
  bulkCreditForm.classList.toggle('hidden');
  addCreditForm.classList.add('hidden');
  bulkInput.focus();
};

acfCancel.onclick = () => addCreditForm.classList.add('hidden');
btnBulkCancel.onclick = () => bulkCreditForm.classList.add('hidden');

acfSave.onclick = async () => {
  const p_code = acfPCode.value.trim();
  const credits = parseFloat(acfCredits.value);

  if (!p_code || isNaN(credits)) {
    showToast('Please fill all fields', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits: [{ p_code, credits }] })
    });
    if (!res.ok) throw new Error('Failed to save');
    showToast('Saved successfully');
    acfPCode.value = ''; acfCredits.value = '';
    addCreditForm.classList.add('hidden');
    loadCredits();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

btnBulkSave.onclick = async () => {
  const text = bulkInput.value.trim();
  if (!text) {
    showToast('Please enter some data', 'error');
    return;
  }

  // Parse logic: separate by newlines, then by comma or colon
  const lines = text.split(/\r?\n/);
  const creditsToSave = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    // Match things like "CODE1, 4" or "CODE2:3.5"
    const parts = line.split(/[,,;:]/);
    if (parts.length >= 2) {
      const p_code = parts[0].trim();
      const credits = parseFloat(parts[1].trim());
      if (p_code && !isNaN(credits)) {
        creditsToSave.push({ p_code, credits });
      }
    }
  }

  if (creditsToSave.length === 0) {
    showToast('No valid data found in input', 'error');
    return;
  }

  try {
    btnBulkSave.disabled = true;
    const res = await fetch(`${API_BASE}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits: creditsToSave })
    });
    if (!res.ok) throw new Error('Bulk update failed');

    showToast(`Successfully updated ${creditsToSave.length} papers`);
    bulkInput.value = '';
    bulkCreditForm.classList.add('hidden');
    loadCredits();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btnBulkSave.disabled = false;
  }
};

window.editCredit = (p_code, currentCredits) => {
  const safeId = p_code.replace(/[^a-zA-Z0-9]/g, '-');
  const row = document.getElementById(`credit-row-${safeId}`);
  const valCell = row.querySelector('.credit-val-cell');
  const actionCell = row.cells[4];

  valCell.innerHTML = `<input type="number" class="inline-edit-input" value="${currentCredits}" step="0.5" min="0" />`;
  actionCell.innerHTML = `
        <button class="action-btn save" onclick="saveInlineEdit('${p_code}')">Save</button>
        <button class="action-btn" onclick="loadCredits()">Cancel</button>
    `;
};

window.saveInlineEdit = async (p_code) => {
  const safeId = p_code.replace(/[^a-zA-Z0-9]/g, '-');
  const row = document.getElementById(`credit-row-${safeId}`);
  const input = row.querySelector('.inline-edit-input');
  const credits = parseFloat(input.value);

  try {
    const res = await fetch(`${API_BASE}/credits/${p_code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits })
    });
    if (!res.ok) throw new Error('Update failed');
    showToast('Updated successfully');
    loadCredits();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteCredit = async (p_code) => {
  if (!confirm(`Delete credit info for ${p_code}?`)) return;
  try {
    const res = await fetch(`${API_BASE}/credits/${p_code}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Deleted');
    loadCredits();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ─── Student Detail Modal ─────────────────────────────────────
window.showStudentDetails = (regNo) => {
  if (!analysisData) return;
  const s = analysisData.student_summary.find(x => x.reg_no == regNo);
  if (!s) return;

  const isCgpa = analysisData.calc_type === 'cgpa';
  $('sm-name').textContent = s.name || 'Student';
  $('sm-reg').textContent = s.reg_no;
  $('sm-gpa-badge').innerHTML = gpaBadge(isCgpa ? s.gpa : s.avg_percentage);
  $('sm-class').textContent = s.class_prefix;
  $('sm-degree').textContent = s.degree || '—';
  $('sm-year').textContent = s.year || '—';
  $('sm-status').innerHTML = resultBadge(s.overall_result);

  // Toggle column visibility in modal
  const modalCreditTh = document.querySelector('#student-modal th:nth-child(6)');
  if (modalCreditTh) modalCreditTh.style.display = isCgpa ? '' : 'none';

  $('sm-subjects-body').innerHTML = s.subjects.map(subj => `
        <tr>
            <td><code>${subj.p_code}</code></td>
            <td>${subj.p_name || '—'}</td>
            <td><strong>${subj.total}</strong></td>
            <td>${subj.total_max}</td>
            <td>${subj.grade_point.toFixed(2)}</td>
            ${isCgpa ? `<td>${subj.credits || '—'}</td>` : ''}
            <td>${resultBadge(subj.result)}</td>
        </tr>
    `).join('');

  $('student-modal').classList.remove('hidden');
};

$('student-modal-close').onclick = () => $('student-modal').classList.add('hidden');

// ─── MAIN RENDER ─────────────────────────────────────────────
function renderAll(data) {
  renderOverallStats(data.overall_stats, data.classes.length, data.total_subjects);
  renderClassOverview(data.class_stats);
  renderTop3(data.top3_overall, 'top-cards-overall');
  renderClassWiseTab(data);
  renderYearPills(data);
  filterOverall();
  renderSubjectTable(data.subject_summary);
  renderToppers(data.paper_toppers, data.class_toppers);
}

function renderOverallStats(stats, numClasses, numSubjects) {
  $('stat-total').textContent = stats.total_students;
  $('stat-passed').textContent = stats.passed_students;
  $('stat-failed').textContent = stats.failed_students;
  $('stat-pass-pct').textContent = stats.overall_pass_percentage + '%';
  $('stat-avg-gpa').textContent = analysisData.calc_type === 'cgpa' ? (stats.avg_gpa || 0).toFixed(2) : (stats.avg_class_percentage || 0).toFixed(1) + '%';
  $('stat-classes').textContent = numClasses;
  document.querySelector('.stat-card[data-color="orange"] .stat-lbl').textContent = analysisData.calc_type === 'cgpa' ? 'Class Avg GPA' : 'Class Avg %';
}

function renderClassOverview(classStats) {
  const grid = $('class-overview-grid');
  grid.innerHTML = classStats.map(cs => {
    const color = cs.pass_percentage >= 75 ? 'var(--green)' : cs.pass_percentage >= 50 ? 'var(--orange)' : 'var(--red)';
    return `
            <div class="class-overview-card">
              <div class="coc-prefix">${cs.class_prefix}</div>
              <div class="coc-row"><span>Students</span><strong>${cs.total_students}</strong></div>
              <div class="coc-row"><span>Pass %</span><strong style="color:${color}">${cs.pass_percentage}%</strong></div>
              <div class="coc-row"><span>${analysisData.calc_type === 'cgpa' ? 'Avg GPA' : 'Avg %'}</span><strong>${analysisData.calc_type === 'cgpa' ? (cs.avg_gpa || 0).toFixed(2) : (cs.avg_percentage || 0).toFixed(1) + '%'}</strong></div>
              <div class="coc-pass-bar">
                <div class="coc-pass-fill" style="width:${cs.pass_percentage}%;background:${color}"></div>
              </div>
            </div>`;
  }).join('');
}

function renderTop3(students, containerId) {
  const container = $(containerId);
  container.innerHTML = students.length === 0 ? '<p class="empty-state">No data available.</p>' : '';
  const medals = ['🥇', '🥈', '🥉'];
  const rCls = ['rank-1', 'rank-2', 'rank-3'];
  students.forEach((s, i) => {
    container.innerHTML += `
            <div class="top-card" onclick="showStudentDetails('${s.reg_no}')" style="cursor:pointer">
              <div class="rank-badge ${rCls[i]}">${medals[i]}</div>
              <div class="top-card-info">
                <div class="top-card-reg">${s.reg_no}</div>
                <div class="top-card-name">${s.name || 'Student'}</div>
                <div class="top-card-cls">${s.class_prefix}</div>
                <div style="margin-top:5px">${gpaBadge(analysisData.calc_type === 'cgpa' ? s.gpa : s.avg_percentage)}</div>
              </div>
            </div>`;
  });
}

// Reuse logic from previous v2 tabs
function renderClassWiseTab(data) {
  const pillsContainer = $('class-pills');
  const panelContainer = $('class-panel-container');
  pillsContainer.innerHTML = '';
  panelContainer.innerHTML = '';

  const classes = data.classes;
  classes.forEach((cls, idx) => {
    const pill = document.createElement('button');
    pill.className = 'class-pill' + (idx === 0 ? ' active' : '');
    pill.textContent = cls;
    pill.onclick = () => {
      document.querySelectorAll('.class-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      document.querySelectorAll('.class-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`class-panel-${cls}`).classList.add('active');
      // Clear search when switching classes
      $('class-wise-search').value = '';
    };
    pillsContainer.appendChild(pill);

    const panel = document.createElement('div');
    panel.className = 'class-panel' + (idx === 0 ? ' active' : '');
    panel.id = `class-panel-${cls}`;
    panel.innerHTML = buildClassPanel(cls, data);
    panelContainer.appendChild(panel);
  });
}

function buildClassPanel(cls, data) {
  const students = data.class_students[cls] || [];
  const stats = data.class_stats.find(s => s.class_prefix === cls) || {};
  const top3 = data.class_top3[cls] || [];

  return `
        <div class="class-panel-header">
            <div class="class-panel-title">Class: <span style="color:var(--blue)">${cls}</span></div>
            <div class="class-panel-stats">
                <div class="cps-item" title="Total Students">👥 <strong>${stats.total_students}</strong></div>
                <div class="cps-item" title="Passed Students" style="color:var(--green)">✅ <strong>${stats.passed_students}</strong></div>
                <div class="cps-item" title="Failed Students" style="color:var(--red)">❌ <strong>${stats.failed_students}</strong></div>
                <div class="cps-item" title="Pass Percentage">📈 <strong>${stats.pass_percentage}%</strong> Pass</div>
                <div class="cps-item" title="Average Score">🎯 <strong>${analysisData.calc_type === 'cgpa' ? (stats.avg_gpa || 0).toFixed(2) : (stats.avg_percentage || 0).toFixed(1) + '%'}</strong></div>
            </div>
        </div>
        <div class="class-top3">
            ${top3.map((s, i) => `
                <div class="top-card" onclick="showStudentDetails('${s.reg_no}')" style="cursor:pointer">
                    <div class="rank-badge rank-${i + 1}">${i + 1}</div>
                    <div class="top-card-info">
                        <strong>${s.reg_no}</strong>
                        <div style="font-size:11px">${s.name || ''}</div>
                        ${gpaBadge(s.avg_percentage, true)}
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="table-wrapper">
            <table class="data-table">
                <thead><tr>
                    <th>Rank</th><th>Reg No</th><th>Name</th><th>${data.calc_type === 'cgpa' ? 'GPA' : 'Score'}</th><th>Result</th>
                </tr></thead>
                <tbody class="class-panel-tbody">
                    ${students.map(s => `
                        <tr onclick="showStudentDetails('${s.reg_no}')">
                            <td>${rankCell(s.class_rank)}</td>
                            <td><strong>${s.reg_no}</strong></td>
                            <td>${s.name || '—'}</td>
                            <td>${gpaBadge(data.calc_type === 'cgpa' ? s.gpa : s.avg_percentage)}</td>
                            <td>${resultBadge(s.overall_result)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderYearPills(data) {
  const container = $('year-pills');
  container.innerHTML = '';
  if (!data.years || data.years.length === 0) return;

  data.years.forEach((year, idx) => {
    const pill = document.createElement('button');
    pill.className = 'class-pill' + (idx === 0 ? ' active' : '');
    pill.textContent = year + ' Overall Ranking';
    pill.dataset.year = year;
    pill.onclick = () => {
      document.querySelectorAll('#year-pills .class-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      filterOverall();
    };
    container.appendChild(pill);
  });
}

function renderOverallTable(students) {
  const tbody = $('overall-tbody');
  const thead = $('overall-thead');
  const isCgpa = analysisData.calc_type === 'cgpa';
  const scoreHeader = isCgpa ? 'GPA' : 'Score (%)';
  thead.innerHTML = `<tr><th>Rank</th><th>Reg No</th><th>Name</th><th>Class</th><th>${scoreHeader}</th><th>Avg %</th><th>Result</th></tr>`;
  tbody.innerHTML = students.map(s => `
        <tr onclick="showStudentDetails('${s.reg_no}')">
            <td>${rankCell(s.overall_rank)}</td>
            <td><strong>${s.reg_no}</strong></td>
            <td>${s.name || '—'}</td>
            <td><code>${s.class_prefix}</code></td>
            <td>${gpaBadge(isCgpa ? s.gpa : s.avg_percentage)}</td>
            <td>${s.avg_percentage}%</td>
            <td>${resultBadge(s.overall_result)}</td>
        </tr>
    `).join('');
  $('overall-count-lbl').textContent = `Showing ${students.length} students ranked in this selection`;
}

function renderSubjectTable(subjects) {
  const isCgpa = analysisData.calc_type === 'cgpa';
  $('th-credits').classList.toggle('hidden', !isCgpa);
  $('subject-tbody').innerHTML = subjects.map(sub => `
        <tr>
            <td><strong>${sub.p_code}</strong></td>
            ${isCgpa ? `<td><span class="gpa-badge">${sub.credits || '—'}</span></td>` : ''}
            <td>${sub.total_students}</td>
            <td>${sub.passed}</td>
            <td>${sub.failed}</td>
            <td><strong>${sub.pass_percentage}%</strong></td>
            <td>${sub.avg_mark}</td>
            <td>${sub.pass_percentage >= 50 ? resultBadge('PASS') : resultBadge('FAIL')}</td>
        </tr>
    `).join('');
}

function renderToppers(overall, classToppers) {
  const isCgpa = analysisData.calc_type === 'cgpa';
  $('toppers-overall-tbody').innerHTML = overall.map(t => `
        <tr onclick="showStudentDetails('${t.reg_no}')">
            <td><strong>${t.p_code}</strong></td>
            <td>${t.reg_no}</td>
            <td>${t.name}</td>
            <td><code>${t.class_prefix}</code></td>
            <td><strong>${t.mark}</strong></td>
            <td>${t.total_max}</td>
            <td>${resultBadge(t.result)}</td>
            <td>${gpaBadge(isCgpa ? t.gpa : (t.mark / t.total_max * 100))}</td>
        </tr>
    `).join('');

  const container = $('classwise-toppers-container');
  container.innerHTML = Object.entries(classToppers).map(([cls, list]) => `
        <div class="cw-topper-section">
            <div class="cw-topper-title">${cls}</div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead><tr><th>Paper Code</th><th>Reg No</th><th>Name</th><th>Mark</th><th>${isCgpa ? 'GPA' : 'Score'}</th></tr></thead>
                    <tbody>
                        ${list.map(t => `
                            <tr onclick="showStudentDetails('${t.reg_no}')">
                                <td><strong>${t.p_code}</strong></td>
                                <td>${t.reg_no}</td>
                                <td>${t.name}</td>
                                <td><strong>${t.mark}</strong></td>
                                <td>${gpaBadge(isCgpa ? t.gpa : (t.mark / t.total_max * 100))}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `).join('');
}

// Export handled via existing listeners, but updated to use API_BASE/export
btnExport.addEventListener('click', async () => {
  if (!currentFile) return;
  showLoading('Exporting...');
  const calcType = document.querySelector('input[name="calc_type"]:checked').value;
  const fd = new FormData();
  fd.append('file', currentFile);
  fd.append('calc_type', calcType);
  try {
    const res = await fetch(`${API_BASE}/export`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'result_analysis.xlsx';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoading();
  }
});

// Final Tab Wireup
document.querySelectorAll('#main-tabs-header .tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#main-tabs-header .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    $(`tab-content-${btn.dataset.tab}`).classList.add('active');
  };
});

document.querySelectorAll('.sub-tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
    $(`sub-tab-content-${btn.dataset.subtab}`).classList.add('active');
  };
});

// ─── SEARCH HANDLERS ───────────────────────────────────────────

$('overall-search').oninput = filterOverall;
$('overall-filter').onchange = filterOverall;

function filterOverall() {
  if (!analysisData) return;
  const q = $('overall-search').value.toLowerCase();
  const res = $('overall-filter').value;

  const activeYearPill = document.querySelector('#year-pills .class-pill.active');
  const activeYear = activeYearPill ? activeYearPill.dataset.year : null;

  const filtered = analysisData.student_summary.filter(s => {
    const matchQ = s.reg_no.toLowerCase().includes(q) || (s.name && s.name.toLowerCase().includes(q));
    const matchRes = res === 'all' || s.overall_result === res;
    const matchYear = !activeYear || s.year_prefix === activeYear;
    return matchQ && matchRes && matchYear;
  });
  renderOverallTable(filtered);
}

$('class-wise-search').oninput = () => {
  if (!analysisData) return;
  const q = $('class-wise-search').value.toLowerCase();
  const activePill = document.querySelector('.class-pill.active');
  if (!activePill) return;
  const cls = activePill.textContent;
  const panel = $(`class-panel-${cls}`);
  const rows = panel.querySelectorAll('.class-panel-tbody tr');

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(q) ? '' : 'none';
  });
};

$('subjects-search').oninput = () => {
  if (!analysisData) return;
  const q = $('subjects-search').value.toLowerCase();
  const filtered = analysisData.subject_summary.filter(s => s.p_code.toLowerCase().includes(q));
  renderSubjectTable(filtered);
};

$('toppers-search').oninput = () => {
  if (!analysisData) return;
  const q = $('toppers-search').value.toLowerCase();

  const filteredOverall = analysisData.paper_toppers.filter(t =>
    t.p_code.toLowerCase().includes(q) || t.reg_no.toLowerCase().includes(q) || (t.name && t.name.toLowerCase().includes(q))
  );
  renderToppersTableOnly(filteredOverall);

  // For class-wise toppers, we'll filter sections
  const container = $('classwise-toppers-container');
  const sections = container.querySelectorAll('.cw-topper-section');
  sections.forEach(sec => {
    const rows = sec.querySelectorAll('tbody tr');
    let anyVisible = false;
    rows.forEach(row => {
      const match = row.textContent.toLowerCase().includes(q);
      row.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    sec.style.display = anyVisible ? '' : 'none';
  });
};

function renderToppersTableOnly(overall) {
  const isCgpa = analysisData.calc_type === 'cgpa';
  $('toppers-overall-tbody').innerHTML = overall.map(t => `
          <tr onclick="showStudentDetails('${t.reg_no}')">
              <td><strong>${t.p_code}</strong></td>
              <td>${t.reg_no}</td>
              <td>${t.name}</td>
              <td><code>${t.class_prefix}</code></td>
              <td><strong>${t.mark}</strong></td>
              <td>${t.total_max}</td>
              <td>${resultBadge(t.result)}</td>
              <td>${gpaBadge(isCgpa ? t.gpa : (t.mark / t.total_max * 100))}</td>
          </tr>
      `).join('');
}
