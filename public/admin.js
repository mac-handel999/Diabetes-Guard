'use strict';

// Admin API location and in-memory state for the current administrator.
const ADMIN_API = (
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
) ? 'http://localhost:3000/api/v1' : `${location.origin}/api/v1`;
let adminSession = null;
let dashboardData = null;
let assessments = [];
let adminAlerts = [];
let adminAlertsError = '';

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = value => value ? new Date(value).toLocaleDateString() : '—';
const formatDateTime = value => value ? new Date(value).toLocaleString() : '—';

// Shared status and network helpers keep error handling consistent across admin sections.
function showMessage(element, message, isError = true) {
  element.textContent = message;
  element.style.color = isError ? 'var(--danger)' : 'var(--green)';
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (adminSession?.access_token) headers.Authorization = `Bearer ${adminSession.access_token}`;
  if (adminSession?.session_ticket) headers['X-Session-Ticket'] = adminSession.session_ticket;
  const response = await fetch(`${ADMIN_API}${path}`, { ...options, headers });
  const responseText = await response.text();
  let data;
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = null; }
  if (!data) throw new Error(`The server returned an invalid response for ${path}.`);
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}) at ${path}`);
  return data;
}

function showApp() {
  $('adminLogin').hidden = true;
  $('adminApp').hidden = false;
  $('adminIdentity').textContent = adminSession?.username || 'Research team';
}

// Admin authentication uses the same Supabase session as the participant app.
async function login(event) {
  event.preventDefault();
  const message = $('adminLoginMessage');
  showMessage(message, 'Signing in…', false);
  try {
    const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('adminEmail').value.trim(), password: $('adminPassword').value }) });
    adminSession = data.session;
    localStorage.setItem('dg_admin_session', JSON.stringify(adminSession));
    showApp();
    await loadDashboard();
  } catch (error) {
    showMessage(message, error.message);
  }
}

function logout() {
  localStorage.removeItem('dg_admin_session');
  adminSession = null;
  location.reload();
}

// Load the cohort summary first; outcomes are loaded separately when needed.
async function loadDashboard() {
  showMessage($('adminStatus'), 'Loading dashboard…', false);
  try {
    dashboardData = await request('/admin/overview');
    if (!dashboardData?.overview || !Array.isArray(dashboardData.participants)) {
      throw new Error('The admin overview response is incomplete. Restart or redeploy the Node backend, then try again.');
    }
    try {
      adminAlerts = await request('/admin/alerts');
      adminAlertsError = '';
    } catch (error) {
      adminAlerts = [];
      adminAlertsError = error.message;
    }
    assessments = [];
    renderAll();
    showMessage($('adminStatus'), adminAlertsError
      ? `Dashboard updated; alerts unavailable: ${adminAlertsError}`
      : `Updated ${new Date().toLocaleTimeString()}`, Boolean(adminAlertsError));
  } catch (error) {
    if (error.message.includes('Administrator access') || error.message.includes('Admin access is not configured')) {
      localStorage.removeItem('dg_admin_session');
      adminSession = null;
      $('adminLogin').hidden = false;
      $('adminApp').hidden = true;
      showMessage($('adminLoginMessage'), error.message);
      return;
    }
    showMessage($('adminStatus'), error.message);
  }
}

function renderAll() {
  renderOverview(); renderParticipants(); renderWeeks(); renderChallenges(); renderEngagement(); renderOutcomes(); renderAlerts(); populateParticipantSelect();
}

// Reusable metric-card and table renderers for the dashboard sections.
function cards(items) {
  return items.map(item => `<div class="metric-card"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join('');
}

function renderOverview() {
  const overview = dashboardData.overview;
  $('overviewCards').innerHTML = cards([
    { label: 'Participants enrolled', value: overview.participants }, { label: 'Active users (<14 days)', value: overview.activeUsers },
    { label: 'Retention rate', value: `${overview.retentionRate}%` }, { label: 'Program completers', value: overview.modulesCompleted },
    { label: 'Quizzes completed', value: overview.quizzesCompleted }, { label: 'Alerts requiring review', value: adminAlerts.filter(alert => alert.status === 'new').length },
  ]);
  $('overviewWeeks').innerHTML = weekTable(dashboardData.weeks);
  $('overviewAlerts').innerHTML = adminAlertsError
    ? `<p class="panel-note">${escapeHtml(adminAlertsError)}</p>`
    : renderAdminAlertCards(adminAlerts.slice(0, 3));
  bindAlertActions($('overviewAlerts'));
}

// Weekly intervention delivery, learning, challenge, and engagement views.
function weekTable(weeks) {
  return `<table><thead><tr><th>Week</th><th>Assigned</th><th>Opened</th><th>Completed</th><th>Rate</th><th>Quiz</th><th>Activities</th><th>Challenge</th></tr></thead><tbody>${weeks.map(week => `<tr><td>Week ${week.week}</td><td>${week.assigned}</td><td>${week.opened}</td><td>${week.completed}</td><td>${week.completionRate}%</td><td>${week.quizCompleted}</td><td>${week.dailyActivitiesCompleted}</td><td>${week.weeklyChallengeCompleted}</td></tr>`).join('')}</tbody></table>`;
}

function renderParticipants() {
  $('participantsTable').innerHTML = dashboardData.participants.map(row => `<tr><td><strong>${escapeHtml(row.participant)}</strong>${renderParticipantBadges(row.badges)}<br><small>${escapeHtml(row.username)}</small></td><td>Week ${row.moduleAssigned}</td><td>${row.moduleOpened}</td><td>${row.moduleCompleted}</td><td>${row.quizCompleted} (${row.quizScore}%)</td><td>${row.challengesCompleted}</td><td>${formatDateTime(row.lastActivity)}</td><td><span class="status-pill ${row.status}">${row.status}</span></td><td><button class="table-action" data-view-user="${escapeHtml(row.id)}">View</button>${row.status === 'inactive' ? ` <button class="table-action danger-action" data-delete-user="${escapeHtml(row.id)}">Delete</button>` : ''}</td></tr>`).join('');
  document.querySelectorAll('[data-view-user]').forEach(button => button.addEventListener('click', () => viewParticipant(button.dataset.viewUser)));
  document.querySelectorAll('[data-delete-user]').forEach(button => button.addEventListener('click', () => deleteParticipant(button.dataset.deleteUser)));
}

// Display badges as small, readable icons beside anonymous participant aliases.
function renderParticipantBadges(badges = []) {
  if (!badges.length) return '';
  const badgeIcons = { first_log: '🌱', hydration: '💧', active: '🏃', streak3: '🔥', streak7: '⚡', quiz_ace: '🧠', challenge: '🎖️', week1: '🛡️', complete: '🎓' };
  return `<span class="admin-participant-badges">${badges.map(badge => {
    const label = String(badge).replace(/_/g, ' ');
    const icon = badgeIcons[badge] || (String(badge).startsWith('daily_') ? '🎯' : String(badge).startsWith('weekly_') ? '🏆' : '🏅');
    return `<span class="admin-participant-badge" title="${escapeHtml(label)}">${icon}</span>`;
  }).join('')}</span>`;
}

// Open a participant's private research record in the detail modal.
async function viewParticipant(participantId) {
  const content = $('participantDetailContent');
  $('participantDetailModal').hidden = false;
  content.innerHTML = '<p class="panel-note">Loading participant details…</p>';
  try {
    const detail = await request(`/admin/participants/${encodeURIComponent(participantId)}`);
    const profile = detail.profile || {};
    const progress = detail.progress || {};
    const points = detail.points || {};
    $('participantDetailTitle').textContent = profile.anon_handle || profile.username || 'Participant details';
    const whatsapp = profile.whatsapp_number || '';
    const whatsappDigits = whatsapp.replace(/\D/g, '');
    content.innerHTML = `
      <div class="detail-summary">${cards([
        { label: 'Username', value: profile.username || '—' },
        { label: 'Enrolled', value: formatDate(profile.enrolled_at) },
        { label: 'Current week', value: progress.current_week || 1 },
        { label: 'Modules completed', value: progress.modules_complete || 0 },
        { label: 'Total points', value: points.total_points || 0 },
        { label: 'Streak', value: points.streak || 0 },
      ])}</div>
      <p class="panel-note">WhatsApp follow-up: ${whatsappDigits
        ? `<a href="https://wa.me/${encodeURIComponent(whatsappDigits)}" target="_blank" rel="noopener noreferrer">${escapeHtml(whatsapp)}</a>`
        : 'No WhatsApp number recorded.'}</p>
      <h3>Earned badges</h3><div class="detail-badge-list">${renderParticipantBadges(progress.badges || []) || 'No badges earned.'}</div>
      <h3>Research assessments</h3>${renderDetailAssessments(detail.assessments || [])}
      <h3>Activity history</h3>${renderDetailLogs(detail.logs || [])}`;
  } catch (error) {
    content.innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`;
  }
}

// Render detailed research outcomes and event history for one participant.
function renderDetailAssessments(records) {
  if (!records.length) return '<p class="panel-note">No baseline or endline assessment recorded.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Phase</th><th>Measured</th><th>Weight</th><th>BMI</th><th>Glucose</th><th>Knowledge</th><th>Perception</th></tr></thead><tbody>${records.map(record => { const data = record.data || {}; return `<tr><td>${escapeHtml(record.phase)}</td><td>${formatDate(record.measured_at)}</td><td>${escapeHtml(data.weight)}</td><td>${escapeHtml(data.bmi)}</td><td>${escapeHtml(data.blood_glucose)}</td><td>${escapeHtml(data.knowledge_score)}</td><td>${escapeHtml(data.perception_score)}</td></tr>`; }).join('')}</tbody></table></div>`;
}

function renderDetailLogs(logs) {
  if (!logs.length) return '<p class="panel-note">No activity recorded.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Event</th><th>Date</th><th>Details</th></tr></thead><tbody>${logs.slice(0, 100).map(log => `<tr><td>${escapeHtml(log.metric_type)}</td><td>${formatDateTime(log.logged_at)}</td><td>${escapeHtml(JSON.stringify(log.metadata || {}))}</td></tr>`).join('')}</tbody></table></div>`;
}

async function deleteParticipant(participantId) {
  const participant = dashboardData.participants.find(row => row.id === participantId);
  if (!participant || !confirm(`Delete inactive participant ${participant.participant}? This permanently removes their profile, logs, progress, points, and assessments.`)) return;
  try {
    await request(`/admin/participants/${encodeURIComponent(participantId)}`, { method: 'DELETE' });
    $('participantDetailModal').hidden = true;
    await loadDashboard();
  } catch (error) {
    showMessage($('adminStatus'), error.message);
  }
}

// Render the remaining dashboard tabs and the baseline/endline form.
function renderWeeks() {
  $('deliveryTable').innerHTML = weekTable(dashboardData.weeks);
  $('learningTable').innerHTML = `<table><thead><tr><th>Week</th><th>Quiz completed</th><th>Average quiz score</th><th>Participants assigned</th></tr></thead><tbody>${dashboardData.weeks.map(week => `<tr><td>Week ${week.week}</td><td>${week.quizCompleted}</td><td>${week.averageQuizScore}%</td><td>${week.assigned}</td></tr>`).join('')}</tbody></table>`;
}

function renderChallenges() {
  $('challengeTable').innerHTML = dashboardData.challenges.length ? `<table><thead><tr><th>Challenge</th><th>Assigned</th><th>Attempted</th><th>Completed</th><th>Completion</th></tr></thead><tbody>${dashboardData.challenges.map(challenge => `<tr><td>${escapeHtml(challenge.name)}</td><td>${challenge.assigned}</td><td>${challenge.attempted}</td><td>${challenge.completed}</td><td>${challenge.completionRate}%</td></tr>`).join('')}</tbody></table>` : '<p class="panel-note">Challenge events will appear here as participants complete them.</p>';
}

function renderEngagement() {
  const rows = dashboardData.participants;
  $('engagementCards').innerHTML = cards([{ label: 'Active users', value: dashboardData.overview.activeUsers }, { label: 'Inactive ≥14 days', value: rows.filter(row => row.daysInactive >= 14).length }, { label: 'Average quiz score', value: `${Math.round(rows.reduce((sum, row) => sum + row.quizScore, 0) / Math.max(rows.length, 1))}%` }, { label: 'SMART goals', value: 'Requires goal events' }]);
  $('engagementTable').innerHTML = `<table><thead><tr><th>Participant</th><th>Last login</th><th>Last activity</th><th>Days inactive</th><th>Modules</th><th>Quizzes</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.participant)}</td><td>${formatDateTime(row.lastLogin)}</td><td>${formatDateTime(row.lastActivity)}</td><td>${row.daysInactive ?? '—'}</td><td>${row.moduleCompleted}</td><td>${row.quizCompleted}</td></tr>`).join('')}</tbody></table>`;
}

const ALERT_PRESENTATION = {
  inactive: { icon: 'fa-calendar-xmark', color: '#DC2626' },
  missed_modules: { icon: 'fa-book-open', color: '#BE185D' },
  declining: { icon: 'fa-chart-line', color: '#B45309' },
  completed: { icon: 'fa-calendar-check', color: '#047857' },
  smart_goal: { icon: 'fa-bullseye', color: '#6D28D9' },
};

function renderAdminAlertCards(alerts) {
  if (!alerts.length) {
    return '<p class="panel-note">No automated alerts currently require review. Self-monitoring tracker answers are excluded from inactivity alerts.</p>';
  }
  return alerts.map(alert => {
    const presentation = ALERT_PRESENTATION[alert.type] || ALERT_PRESENTATION.declining;
    const resolved = alert.status === 'resolved';
    const reviewed = alert.status === 'reviewed';
    return `<article class="admin-alert-card alert-type-${escapeHtml(alert.type)}" style="--alert-color:${presentation.color}">
      <div class="admin-alert-heading"><span class="admin-alert-icon" aria-hidden="true"><i class="fas ${presentation.icon}"></i></span><h3>${escapeHtml(alert.title)}</h3></div>
      <p class="admin-alert-participant"><strong>Participant</strong> ${escapeHtml(alert.participant)}</p>
      <p class="admin-alert-message">${escapeHtml(alert.message)}</p>
      <p class="admin-alert-time"><strong>Timestamp</strong> ${escapeHtml(formatDateTime(alert.timestamp))}</p>
      <span class="admin-alert-status ${resolved ? 'is-resolved' : reviewed ? 'is-reviewed' : ''}">${escapeHtml(alert.statusLabel)}</span>
      <div class="admin-alert-actions">
        <button class="table-action" type="button" data-alert-view="${escapeHtml(alert.participantId)}">View Details</button>
        ${!reviewed && !resolved ? `<button class="table-action" type="button" data-alert-status="reviewed" data-alert-key="${escapeHtml(alert.key)}">Mark as Reviewed</button>` : ''}
        ${!resolved ? `<button class="table-action danger-action" type="button" data-alert-status="resolved" data-alert-key="${escapeHtml(alert.key)}">Resolve</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function bindAlertActions(container) {
  if (!container || container.dataset.alertActionsBound) return;
  container.dataset.alertActionsBound = 'true';
  container.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-alert-view]');
    if (viewButton) {
      viewParticipant(viewButton.dataset.alertView);
      return;
    }
    const statusButton = event.target.closest('[data-alert-status]');
    if (statusButton) updateAlertStatus(statusButton.dataset.alertKey, statusButton.dataset.alertStatus, statusButton);
  });
}

async function updateAlertStatus(alertKey, status, button) {
  button.disabled = true;
  try {
    await request(`/admin/alerts/${encodeURIComponent(alertKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    await loadDashboard();
  } catch (error) {
    showMessage($('adminStatus'), error.message);
    button.disabled = false;
  }
}

function renderAlerts() {
  const panel = $('adminAlertsPanel');
  panel.innerHTML = adminAlertsError
    ? `<p class="form-message">${escapeHtml(adminAlertsError)} Apply <code>supabase/activity-tracker-alerts.sql</code> to enable alert statuses.</p>`
    : renderAdminAlertCards(adminAlerts);
  bindAlertActions(panel);
}

function populateParticipantSelect() {
  $('assessmentParticipant').innerHTML = dashboardData.participants.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.participant)}</option>`).join('');
}

function fieldValue(id) { return $(id).value.trim(); }

async function saveAssessment(event) {
  event.preventDefault();
  const message = $('assessmentMessage');
  const date = fieldValue('measuredDate');
  const time = fieldValue('measuredTime');
  const data = { weight: fieldValue('weight'), height: fieldValue('height'), bmi: fieldValue('bmi'), blood_glucose: fieldValue('glucose'), fasting_random_status: fieldValue('glucoseStatus'), measured_date: date, measured_time: time, knowledge_score: fieldValue('knowledgeScore'), knowledge_domains: fieldValue('knowledgeDomains'), perception_score: fieldValue('perceptionScore'), perception_subscales: fieldValue('perceptionSubscales'), family_history: fieldValue('familyHistory'), physical_activity: fieldValue('physicalActivity'), dietary_practices: fieldValue('dietaryPractices'), smoking: fieldValue('smoking'), alcohol: fieldValue('alcohol') };
  try {
    await request('/admin/assessments', { method: 'POST', body: JSON.stringify({ participant_id: $('assessmentParticipant').value, phase: $('assessmentPhase').value, data, measured_at: `${date}T${time || '00:00'}:00` }) });
    showMessage(message, 'Assessment saved.', false);
    assessments = await request('/admin/assessments');
    renderOutcomes();
  } catch (error) { showMessage(message, error.message); }
}

// Research outcomes are optional until the assessment table migration is installed.
async function loadAssessments() {
  try {
    assessments = await request('/admin/assessments');
    renderOutcomes();
  } catch (error) {
    assessments = [];
    renderOutcomes();
    showMessage($('adminStatus'), `Research assessments unavailable: ${error.message}`);
  }
}

function renderOutcomes() {
  const byParticipant = {};
  assessments.forEach(item => { if (!byParticipant[item.participant_id]) byParticipant[item.participant_id] = {}; byParticipant[item.participant_id][item.phase] = item; });
  const names = new Map(dashboardData.participants.map(row => [row.id, row.participant]));
  $('outcomesTable').innerHTML = assessments.length ? `<table><thead><tr><th>Participant</th><th>Phase</th><th>Measured</th><th>Weight</th><th>BMI</th><th>Glucose</th><th>Knowledge</th><th>Perception</th><th>Change</th></tr></thead><tbody>${assessments.map(item => { const data = item.data || {}; const other = byParticipant[item.participant_id]?.[item.phase === 'baseline' ? 'endline' : 'baseline']?.data || {}; const change = item.phase === 'endline' ? `BMI ${changeValue(other.bmi, data.bmi)} · Glucose ${changeValue(other.blood_glucose, data.blood_glucose)}` : '—'; return `<tr><td>${escapeHtml(names.get(item.participant_id) || item.participant_id)}</td><td>${item.phase}</td><td>${formatDate(item.measured_at)}</td><td>${escapeHtml(data.weight)}</td><td>${escapeHtml(data.bmi)}</td><td>${escapeHtml(data.blood_glucose)}</td><td>${escapeHtml(data.knowledge_score)}</td><td>${escapeHtml(data.perception_score)}</td><td>${escapeHtml(change)}</td></tr>`; }).join('')}</tbody></table>` : '<p class="panel-note">No assessments recorded yet.</p>';
}

function changeValue(baseline, endline) { const start = Number(baseline); const finish = Number(endline); return Number.isFinite(start) && Number.isFinite(finish) ? `${(finish - start).toFixed(1)}` : '—'; }

function exportCsv() {
  const rows = dashboardData.participants; const headers = ['participant', 'moduleAssigned', 'moduleOpened', 'moduleCompleted', 'quizCompleted', 'quizScore', 'quizAttempts', 'challengesCompleted', 'lastLogin', 'daysInactive'];
  const csv = [headers.join(','), ...rows.map(row => headers.map(key => JSON.stringify(row[key] ?? '')).join(','))].join('\n');
  download('dia-shield-participants.csv', csv, 'text/csv');
}

function download(filename, content, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }

function exportOutcomes() { download('dia-shield-research-outcomes.json', JSON.stringify(assessments, null, 2), 'application/json'); }

// Wire controls and restore a previously authenticated admin session on page load.
document.addEventListener('DOMContentLoaded', async () => {
  $('adminLoginForm').addEventListener('submit', login); $('adminLogout').addEventListener('click', logout); $('refreshDashboard').addEventListener('click', loadDashboard); $('refreshAlerts').addEventListener('click', loadDashboard); $('assessmentForm').addEventListener('submit', saveAssessment); $('exportParticipants').addEventListener('click', exportCsv); $('exportOutcomes').addEventListener('click', exportOutcomes);
  $('closeParticipantDetail').addEventListener('click', () => { $('participantDetailModal').hidden = true; });
  $('participantDetailModal').addEventListener('click', event => { if (event.target.id === 'participantDetailModal') $('participantDetailModal').hidden = true; });
  ['weight', 'height'].forEach(id => $(id).addEventListener('input', () => { const weight = Number($('weight').value); const height = Number($('height').value) / 100; $('bmi').value = weight > 0 && height > 0 ? (weight / (height * height)).toFixed(1) : ''; }));
  document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.nav-button').forEach(item => item.classList.remove('active')); document.querySelectorAll('.admin-section').forEach(item => item.classList.remove('active')); button.classList.add('active'); $(`section-${button.dataset.section}`).classList.add('active'); if (button.dataset.section === 'outcomes') loadAssessments(); }));
  const stored = localStorage.getItem('dg_admin_session');
  if (!stored) return;
  try { adminSession = JSON.parse(stored); showApp(); await loadDashboard(); } catch { logout(); }
});
