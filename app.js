/* ============================================================
   RESULT ANALYZER v2.1 — app.js
   ============================================================ */

const API_BASE = 'http://localhost:5000/api';

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

function gpaBadge(gpa) {
  const color = gpaColor(gpa);
  return `<span class="badge" style="background:${color}22; color:${color}; border:1px solid ${color}33; font-weight:800">${gpa.toFixed(2)}</span>`;
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
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
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

  const fd = new FormData();
  fd.append('file', currentFile);

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

  $('sm-name').textContent = s.name || 'Student';
  $('sm-reg').textContent = s.reg_no;
  $('sm-gpa-badge').innerHTML = gpaBadge(s.gpa);
  $('sm-class').textContent = s.class_prefix;
  $('sm-degree').textContent = s.degree || '—';
  $('sm-year').textContent = s.year || '—';
  $('sm-status').innerHTML = resultBadge(s.overall_result);

  $('sm-subjects-body').innerHTML = s.subjects.map(subj => `
        <tr>
            <td><code>${subj.p_code}</code></td>
            <td>${subj.p_name || '—'}</td>
            <td><strong>${subj.total}</strong></td>
            <td>${subj.total_max}</td>
            <td>${subj.grade_point.toFixed(2)}</td>
            <td>${subj.credits || '—'}</td>
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
  renderOverallTable(data.student_summary);
  renderSubjectTable(data.subject_summary);
  renderToppers(data.paper_toppers, data.class_toppers);
}

function renderOverallStats(stats, numClasses, numSubjects) {
  $('stat-total').textContent = stats.total_students;
  $('stat-passed').textContent = stats.passed_students;
  $('stat-failed').textContent = stats.failed_students;
  $('stat-pass-pct').textContent = stats.overall_pass_percentage + '%';
  $('stat-avg-gpa').textContent = (stats.avg_gpa || 0).toFixed(2);
  $('stat-classes').textContent = numClasses;
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
              <div class="coc-row"><span>Avg GPA</span><strong>${(cs.avg_gpa || 0).toFixed(2)}</strong></div>
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
                <div style="margin-top:5px">${gpaBadge(s.gpa)}</div>
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
                <div class="cps-item">👥 <strong>${stats.total_students}</strong></div>
                <div class="cps-item">📈 <strong>${stats.pass_percentage}%</strong> Pass</div>
                <div class="cps-item">🎯 <strong>GPA ${(stats.avg_gpa || 0).toFixed(2)}</strong></div>
            </div>
        </div>
        <div class="class-top3">
            ${top3.map((s, i) => `
                <div class="top-card" onclick="showStudentDetails('${s.reg_no}')" style="cursor:pointer">
                    <div class="rank-badge rank-${i + 1}">${i + 1}</div>
                    <div class="top-card-info">
                        <strong>${s.reg_no}</strong>
                        <div style="font-size:11px">${s.name || ''}</div>
                        ${gpaBadge(s.gpa)}
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="table-wrapper">
            <table class="data-table">
                <thead><tr>
                    <th>Rank</th><th>Reg No</th><th>Name</th><th>GPA</th><th>Result</th>
                </tr></thead>
                <tbody>
                    ${students.map(s => `
                        <tr onclick="showStudentDetails('${s.reg_no}')">
                            <td>${rankCell(s.class_rank)}</td>
                            <td><strong>${s.reg_no}</strong></td>
                            <td>${s.name || '—'}</td>
                            <td>${gpaBadge(s.gpa)}</td>
                            <td>${resultBadge(s.overall_result)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderOverallTable(students) {
  const tbody = $('overall-tbody');
  const thead = $('overall-thead');
  thead.innerHTML = `<tr><th>Rank</th><th>Reg No</th><th>Name</th><th>Class</th><th>GPA</th><th>Avg %</th><th>Result</th></tr>`;
  tbody.innerHTML = students.map(s => `
        <tr onclick="showStudentDetails('${s.reg_no}')">
            <td>${rankCell(s.overall_rank)}</td>
            <td><strong>${s.reg_no}</strong></td>
            <td>${s.name || '—'}</td>
            <td><code>${s.class_prefix}</code></td>
            <td>${gpaBadge(s.gpa)}</td>
            <td>${s.avg_percentage}%</td>
            <td>${resultBadge(s.overall_result)}</td>
        </tr>
    `).join('');
  $('overall-count-lbl').textContent = `Total ${students.length} students ranked by GPA`;
}

function renderSubjectTable(subjects) {
  $('subject-tbody').innerHTML = subjects.map(sub => `
        <tr>
            <td><strong>${sub.p_code}</strong></td>
            <td><span class="gpa-badge">${sub.credits || '—'}</span></td>
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
  $('toppers-overall-tbody').innerHTML = overall.map(t => `
        <tr onclick="showStudentDetails('${t.reg_no}')">
            <td><strong>${t.p_code}</strong></td>
            <td>${t.reg_no}</td>
            <td>${t.name}</td>
            <td><code>${t.class_prefix}</code></td>
            <td><strong>${t.mark}</strong></td>
            <td>${t.total_max}</td>
            <td>${resultBadge(t.result)}</td>
            <td>${gpaBadge(t.gpa)}</td>
        </tr>
    `).join('');

  const container = $('classwise-toppers-container');
  container.innerHTML = Object.entries(classToppers).map(([cls, list]) => `
        <div class="cw-topper-section">
            <div class="cw-topper-title">${cls}</div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead><tr><th>Paper Code</th><th>Reg No</th><th>Name</th><th>Mark</th><th>GPA</th></tr></thead>
                    <tbody>
                        ${list.map(t => `
                            <tr onclick="showStudentDetails('${t.reg_no}')">
                                <td><strong>${t.p_code}</strong></td>
                                <td>${t.reg_no}</td>
                                <td>${t.name}</td>
                                <td><strong>${t.mark}</strong></td>
                                <td>${gpaBadge(t.gpa)}</td>
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
  const fd = new FormData();
  fd.append('file', currentFile);
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
