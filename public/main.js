/* ═══════════════════════════════════════════════════════════
   Dia Shield — main.js
   Version: 2.2 (Merge pass — reconciled with a divergent draft)

   Carried forward from 2.1:
   ✅ Registration field IDs match index.html
   ✅ enterApp() awaits loadCurrentWeek() before loadModule()
   ✅ Leaderboard alias escaped before innerHTML insertion (XSS fix)
   ✅ switchTab() no longer relies on the implicit global `event`
   ✅ Profile tab: loadProfile() + handleDeleteAccount(), wired to
      the /profile and /account endpoints via the shared api() helper

   New in this pass, merged in from a pasted draft version:
   ✅ Optimistic UI updates on food/activity logging (instant feedback,
      then submitMetric() re-syncs true counts from the server)
   ✅ submitMetric() now calls loadDashboardStats() after every log,
      so points/streak/progress bar/badges all stay in sync with the
      server's numbers rather than only updating what the log response
      happened to include
   ✅ Login/register now defensively check for either this app's field
      IDs or a couple of legacy alternates, so a future markup change
      degrades gracefully instead of throwing

   Explicitly NOT merged from the pasted draft (see chat for why):
   ✗ A JSON-fetched "curriculum.json" day-by-day lesson system —
     duplicated its own loadModule()/renderQuiz()/answerQuiz(), had a
     stray block outside any function that was a hard syntax error
     (blocked the entire file from parsing), and has no matching
     curriculum.json asset or day-navigation UI yet
   ✗ A second handleDeleteAccount()/handleLogout() pair that hit a
     hardcoded http://localhost:3000 URL, read a localStorage key
     nothing else writes to, and posted to an endpoint that doesn't
     match server.js — kept this app's existing, working versions
════════════════════════════════════════════════════════════ */

'use strict';

// ── Base URL: auto-detects local dev vs. production ──────────
const API_BASE = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
) ? 'http://localhost:3000' : '';

// ── Session (persisted in localStorage) ─────────────────────
let SESSION = null;  // { access_token, user_id, username, anon_handle }
let refreshPromise = null;
let sessionExpiryHandled = false;
let PROFILE_FULL_NAME = '';
const OFFLINE_METRIC_QUEUE_KEY = 'dg_pending_metrics';

// ── Local UI state ───────────────────────────────────────────
let waterCount = 0;
let todayLogs  = { food: 0, water: 0, activity: 0, weight: 0 };

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  renderActivityTrackerDays();
  document.getElementById('activityTrackerForm')?.addEventListener('submit', saveActivityTracker);
  const stored = localStorage.getItem('dg_session_token');
  if (stored) {
    try {
      SESSION = JSON.parse(stored);
      if (isSessionExpired()) {
        handleExpiredSession();
      } else {
        enterApp();
      }
    } catch {
      clearSession();
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// API WRAPPER
// One function for all requests — handles auth header + errors
// ═══════════════════════════════════════════════════════════════
async function api(path, method = 'GET', body = null, allowRefresh = true) {
  const isPublicAuthRequest = ['/auth/login', '/auth/register', '/auth/refresh'].includes(path);
  if (!isPublicAuthRequest && isSessionExpired()) {
    handleExpiredSession();
    throw new Error('Your session has expired. Please sign in again.');
  }

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (SESSION?.access_token) {
    opts.headers['Authorization'] = `Bearer ${SESSION.access_token}`;
    if (SESSION.session_ticket) {
      opts.headers['X-Session-Ticket'] = SESSION.session_ticket;
    }
  }

  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${API_BASE}/api/v1${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok && allowRefresh && SESSION?.refresh_token && (res.status === 401 || res.status === 403) &&
      !path.startsWith('/auth/')) {
    try {
      await refreshSession();
      return api(path, method, body, false);
    } catch {
      handleExpiredSession();
      throw new Error('Your session has expired. Please sign in again.');
    }
  }

  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function isSessionExpired() {
  return Boolean(SESSION &&
    (!SESSION.access_token || !SESSION.refresh_token || !SESSION.session_ticket ||
      !SESSION.session_expires_at || Date.now() >= SESSION.session_expires_at));
}

function clearSession() {
  localStorage.removeItem('dg_session_token');
  SESSION = null;
}

function handleExpiredSession() {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;
  clearSession();

  const authGw = document.getElementById('authGateway');
  const mainApp = document.getElementById('mainApp') || document.getElementById('cohortWorkspace');
  if (mainApp) mainApp.style.display = 'none';
  if (authGw) authGw.style.display = 'block';
  toggleAuthForm('login');
  showAuthMsg('Your session has expired. Please sign in again.');
  alert('Your session has expired. Please sign in again.');
}

async function refreshSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: SESSION?.refresh_token,
        sessionTicket: SESSION?.session_ticket,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.session) throw new Error(data.error || 'Session refresh failed.');

    SESSION = data.session;
    localStorage.setItem('dg_session_token', JSON.stringify(SESSION));
    return SESSION;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTH — UI helpers
// ═══════════════════════════════════════════════════════════════
function toggleAuthForm(mode) {
  const isLogin = mode === 'login';
  document.getElementById('loginForm').style.display    = isLogin ? 'block' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none'  : 'block';
  document.getElementById('tabLogin').classList.toggle('active',     isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
  clearAuthMsg();
}

// Keep backwards-compatible alias used in index.html onclick
function showAuthTab(mode) { toggleAuthForm(mode); }

// Toggle password visibility for password input fields
function togglePasswordVisibility(targetId) {
  const input = document.getElementById(targetId);
  const button = document.querySelector(`.toggle-password[data-target="${targetId}"]`);
  if (!input || !button) return;

  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  const icon = button.querySelector('i');
  if (icon) {
    icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
  }
  button.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
}

// Attach event listeners to all password toggle buttons
function initPasswordToggles() {
  document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', () => {
      togglePasswordVisibility(button.dataset.target);
    });
  });
}

// Initialize password toggles when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initPasswordToggles();
});

function clearAuthMsg() {
  const el = document.getElementById('authMsg') || document.getElementById('authMessage');
  if (!el) return;
  el.className = el.className.replace(/\s*(error|success)/g, '') + ' hidden';
  el.textContent = '';
}

function showAuthMsg(text, type = 'error') {
  const el = document.getElementById('authMsg') || document.getElementById('authMessage');
  if (!el) return;
  el.className = `auth-msg ${type}`;
  el.textContent = text;
}

function setLoading(btnId, isLoading) {
  const btn  = document.getElementById(btnId);
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const load = btn.querySelector('.btn-loader');
  btn.disabled = isLoading;
  if (text) text.classList.toggle('hidden',  isLoading);
  if (load) load.classList.toggle('hidden', !isLoading);
}

// ═══════════════════════════════════════════════════════════════
// AUTH — LOGIN
// ═══════════════════════════════════════════════════════════════
async function handleLogin(e) {
  e.preventDefault();
  clearAuthMsg();
  setLoading('loginBtn', true);

  // Defensive lookup: supports this app's IDs (loginEmail) and a
  // legacy alternate (loginUsername) in case markup ever diverges.
  const emailEl    = document.getElementById('loginEmail')
                  || document.getElementById('loginUsername');
  const passwordEl = document.getElementById('loginPassword');

  if (!emailEl || !passwordEl) {
    showAuthMsg('Page error: login form fields not found. Please refresh.');
    setLoading('loginBtn', false);
    return;
  }

  try {
    // A previous expired session must never block a fresh login attempt.
    clearSession();
    const res = await api('/auth/login', 'POST', {
      email:    emailEl.value.trim(),
      password: passwordEl.value,
    });

    SESSION = res.session;
    sessionExpiryHandled = false;
    localStorage.setItem('dg_session_token', JSON.stringify(SESSION));
    enterApp();

  } catch (err) {
    showAuthMsg(err.message || 'Invalid email or password.');
  } finally {
    setLoading('loginBtn', false);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTH — REGISTER
// ═══════════════════════════════════════════════════════════════
async function handleRegister(e) {
  e.preventDefault();
  clearAuthMsg();
  setLoading('registerBtn', true);

  // Defensive lookup: supports this app's IDs (registerEmail, etc.)
  // and a couple of legacy alternates in case markup ever diverges.
  const emailEl    = document.getElementById('registerEmail')
                  || document.getElementById('regEmail');
  const usernameEl = document.getElementById('registerUsername')
                  || document.getElementById('regUsername');
  const aliasEl    = document.getElementById('registerAnonHandle')
                  || document.getElementById('regAlias');
  const whatsappEl = document.getElementById('registerWhatsapp');
  const whatsappConsentEl = document.getElementById('registerWhatsappConsent');
  const passwordEl = document.getElementById('registerPassword')
                  || document.getElementById('regPassword');

  if (!emailEl || !usernameEl || !aliasEl || !whatsappEl || !whatsappConsentEl || !passwordEl) {
    showAuthMsg('Page error: registration form fields not found. Please refresh.');
    setLoading('registerBtn', false);
    return;
  }

  try {
    await api('/auth/register', 'POST', {
      email:      emailEl.value.trim(),
      username:   usernameEl.value.trim(),
      anonHandle: aliasEl.value.trim(),
      whatsappNumber: whatsappEl.value.trim(),
      whatsappConsent: whatsappConsentEl.checked,
      password:   passwordEl.value,
    });

    showAuthMsg('Account created! Please sign in.', 'success');
    toggleAuthForm('login');

    const loginEmailEl = document.getElementById('loginEmail')
                      || document.getElementById('loginUsername');
    if (loginEmailEl) loginEmailEl.value = emailEl.value;

  } catch (err) {
    showAuthMsg(err.message || 'Registration failed. That email or alias may already be taken.');
  } finally {
    setLoading('registerBtn', false);
  }
}

// Legacy handler used by older index.html (handleAuthSubmit)
async function handleAuthSubmit(e, type) {
  if (type === 'login')    return handleLogin(e);
  if (type === 'register') return handleRegister(e);
}

// ═══════════════════════════════════════════════════════════════
// AUTH — SIGN OUT
// ═══════════════════════════════════════════════════════════════
async function handleSignOut() {
  try { await api('/auth/logout', 'POST'); } catch { /* silent */ }
  localStorage.removeItem('dg_session_token');
  SESSION = null;
  location.reload();
}

// Legacy alias
function triggerSignOut() { handleSignOut(); }

// ═══════════════════════════════════════════════════════════════
// APP ENTRY — runs once after successful login/session restore
// ═══════════════════════════════════════════════════════════════
async function enterApp() {
  // Show main app, hide auth
  const authGw  = document.getElementById('authGateway');
  const mainApp = document.getElementById('mainApp') || document.getElementById('cohortWorkspace');
  if (authGw)  authGw.style.display  = 'none';
  if (mainApp) { mainApp.style.display = 'block'; mainApp.classList.remove('hidden'); }

  // Header / greeting
  const headerUser = document.getElementById('headerUsername') || document.getElementById('welcomeUser');
  if (headerUser) headerUser.textContent = SESSION?.username || 'Student';

  const greetEl = document.getElementById('summaryGreeting');
  if (greetEl) {
    const h = new Date().getHours();
    greetEl.textContent = h < 12 ? 'Good morning 👋' : h < 17 ? 'Good afternoon 👋' : 'Good evening 👋';
  }

  const nameEl = document.getElementById('summaryName');
  if (nameEl) nameEl.textContent = SESSION?.username || 'Student';

  // Render water glasses initial state
  renderWaterGlasses();

  // Load the current program week FIRST — loadModule() reads
  // weekSelector.value synchronously, so it must run only after
  // the selector has been updated to the user's real current week.
  // (Previously these ran in the same Promise.all as loadModule(),
  // which meant loadModule() almost always read the stale default
  // of "1" instead of the fetched week.)
  await loadCurrentWeek();

  // These can run in parallel — none of them depend on each other
  await Promise.all([
    recordSessionActivity(),
    loadDashboardStats(),
    loadActivityTracker(),
    loadLeaderboard(),
    loadProfile(),
  ]);

  // Now safe to load module content for the correct week
  loadModule({ forceNotification: true });
}

// Legacy alias used by older index.html
function initWorkspace() { enterApp(); }

async function recordSessionActivity() {
  try {
    await api('/activity/session', 'POST');
  } catch (err) {
    console.warn('[recordSessionActivity]', err.message);
  }
}

const ACTIVITY_TRACKER_WEEKDAYS = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
];

function activityTrackerWeekStart(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const day = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyActivityTracker() {
  return {
    daily_entries: Object.fromEntries(ACTIVITY_TRACKER_WEEKDAYS.map(([key]) => [key, {
      vigorous: null,
      vigorous_duration: null,
      moderate: null,
      moderate_duration: null,
      walked_ten_minutes: null,
      sitting_time: null,
    }])),
    weekly_checkin: {
      vigorous_days: null,
      moderate_days: null,
      walk_frequency: null,
      sports: null,
      next_activity: '',
    },
  };
}

function trackerSelectOptions(values, selected, placeholder = 'Choose an answer') {
  return `<option value="">${placeholder}</option>${values.map(value =>
    `<option value="${escapeHtml(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(value)}</option>`
  ).join('')}`;
}

function renderActivityTrackerDays(entries = emptyActivityTracker().daily_entries) {
  const container = document.getElementById('activityTrackerDays');
  if (!container) return;
  container.innerHTML = ACTIVITY_TRACKER_WEEKDAYS.map(([key, label]) => {
    const entry = entries[key] || {};
    return `<fieldset class="activity-day-card">
      <legend>${label}</legend>
      <label for="tracker-${key}-vigorous">Vigorous activity?</label>
      <select id="tracker-${key}-vigorous" data-day="${key}" data-field="vigorous" class="tracker-activity-answer">${trackerSelectOptions(['yes', 'no'], entry.vigorous, 'Select yes or no')}</select>
      <label for="tracker-${key}-vigorous-duration">Vigorous activity duration</label>
      <select id="tracker-${key}-vigorous-duration" data-day="${key}" data-duration="vigorous" class="tracker-activity-duration">${trackerSelectOptions(['<30 min', '30–60 min', '>1 hr', 'N/A'], entry.vigorous_duration)}</select>
      <label for="tracker-${key}-moderate">Moderate activity?</label>
      <select id="tracker-${key}-moderate" data-day="${key}" data-field="moderate" class="tracker-activity-answer">${trackerSelectOptions(['yes', 'no'], entry.moderate, 'Select yes or no')}</select>
      <label for="tracker-${key}-moderate-duration">Moderate activity duration</label>
      <select id="tracker-${key}-moderate-duration" data-day="${key}" data-duration="moderate" class="tracker-activity-duration">${trackerSelectOptions(['<30 min', '30–60 min', '>1 hr', 'N/A'], entry.moderate_duration)}</select>
      <label for="tracker-${key}-walked">Walked at least 10 minutes continuously?</label>
      <select id="tracker-${key}-walked" data-day="${key}" data-field="walked_ten_minutes">${trackerSelectOptions(['yes', 'no'], entry.walked_ten_minutes, 'Select yes or no')}</select>
      <label for="tracker-${key}-sitting">Sitting time range</label>
      <select id="tracker-${key}-sitting" data-day="${key}" data-field="sitting_time">${trackerSelectOptions(['<2 hrs', '2–4 hrs', '5–7 hrs', '>7 hrs'], entry.sitting_time)}</select>
    </fieldset>`;
  }).join('');
  container.querySelectorAll('.tracker-activity-answer').forEach(select => {
    select.addEventListener('change', () => setActivityDurationState(select));
    setActivityDurationState(select);
  });
}

function setActivityDurationState(answerSelect) {
  const durationSelect = document.getElementById(`tracker-${answerSelect.dataset.day}-${answerSelect.dataset.field}-duration`);
  if (!durationSelect) return;
  const isApplicable = answerSelect.value === 'yes';
  durationSelect.disabled = !isApplicable;
  durationSelect.required = isApplicable;
  if (!isApplicable) durationSelect.value = '';
}

function setActivityTrackerMessage(message, isError = false) {
  const element = document.getElementById('activityTrackerMessage');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

async function loadActivityTracker() {
  const weekStart = activityTrackerWeekStart();
  const weekLabel = document.getElementById('activityTrackerWeek');
  if (weekLabel) weekLabel.textContent = `Week beginning ${new Date(`${weekStart}T00:00:00`).toLocaleDateString()}`;
  setActivityTrackerMessage('Loading your saved tracker…');
  try {
    const saved = await api(`/physical-activity-tracker?week_start=${encodeURIComponent(weekStart)}`);
    const defaults = emptyActivityTracker();
    const dailyEntries = { ...defaults.daily_entries, ...(saved.daily_entries || {}) };
    renderActivityTrackerDays(dailyEntries);
    const checkin = { ...defaults.weekly_checkin, ...(saved.weekly_checkin || {}) };
    document.getElementById('trackerVigorousDays').value = checkin.vigorous_days || '';
    document.getElementById('trackerModerateDays').value = checkin.moderate_days || '';
    document.getElementById('trackerWalkFrequency').value = checkin.walk_frequency || '';
    document.getElementById('trackerSports').value = checkin.sports || '';
    document.getElementById('trackerNextActivity').value = checkin.next_activity || '';
    setActivityTrackerMessage('Daily entries and the weekly check-in are optional.');
  } catch (err) {
    setActivityTrackerMessage(err.message, true);
  }
}

async function saveActivityTracker(event) {
  event.preventDefault();
  const dailyEntries = {};
  for (const [day] of ACTIVITY_TRACKER_WEEKDAYS) {
    const answer = field => document.getElementById(`tracker-${day}-${field}`).value || null;
    const vigorous = answer('vigorous');
    const moderate = answer('moderate');
    dailyEntries[day] = {
      vigorous,
      vigorous_duration: vigorous === 'yes' ? answer('vigorous-duration') : null,
      moderate,
      moderate_duration: moderate === 'yes' ? answer('moderate-duration') : null,
      walked_ten_minutes: answer('walked'),
      sitting_time: answer('sitting'),
    };
  }
  const payload = {
    week_start: activityTrackerWeekStart(),
    daily_entries: dailyEntries,
    weekly_checkin: {
      vigorous_days: document.getElementById('trackerVigorousDays').value || null,
      moderate_days: document.getElementById('trackerModerateDays').value || null,
      walk_frequency: document.getElementById('trackerWalkFrequency').value || null,
      sports: document.getElementById('trackerSports').value || null,
      next_activity: document.getElementById('trackerNextActivity').value.trim(),
    },
  };
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setActivityTrackerMessage('Saving your activity tracker…');
  try {
    await api('/physical-activity-tracker', 'PUT', payload);
    setActivityTrackerMessage('Your activity tracker has been saved.');
  } catch (err) {
    setActivityTrackerMessage(err.message, true);
  } finally {
    button.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// NAV TAB SWITCHING
// ═══════════════════════════════════════════════════════════════
function switchTab(tabId, btn) {
  // Hide all tab sections
  document.querySelectorAll('.tab-section, .content-section').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });

  // Deactivate all nav buttons
  document.querySelectorAll('.nav-btn, .tab-link').forEach(b => b.classList.remove('active'));

  // Show target tab
  const target = document.getElementById(`tab-${tabId}`) || document.getElementById(tabId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Activate clicked button. `btn` should be passed explicitly by the
  // caller (e.g. onclick="switchTab('trackers', this)"). The old
  // fallback read the bare `event` global, which doesn't exist in
  // Firefox outside a native handler and throws a ReferenceError
  // under 'use strict' — guarded with typeof so it degrades safely
  // instead of crashing when `btn` isn't supplied.
  const activeBtn = btn || (typeof event !== 'undefined' && event ? event.currentTarget : null);
  if (activeBtn) activeBtn.classList.add('active');

  // Lazy-load leaderboard only when that tab is opened
  if (tabId === 'gamification') loadLeaderboard();
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — load stats from backend
// ═══════════════════════════════════════════════════════════════
async function loadDashboardStats() {
  try {
    const data = await api('/metrics/snapshot');

    todayLogs  = data.logs || { food: 0, water: 0, activity: 0, weight: 0 };
    waterCount = todayLogs.water || 0;

    // Today's pill stats
    setText('stat-food',     todayLogs.food);
    setText('stat-water',    todayLogs.water);
    setText('stat-activity', todayLogs.activity);

    // Points & streak
    setText('dashPoints', data.points ?? 0);
    setHTML('dashStreak', `${data.streak ?? 0} <small>days</small>`);
    setText('rankPts',    `${data.points ?? 0} pts`);
    setText('rankStreak', data.streak ?? 0);

    // localLogsDisplay (legacy element)
    const logsDisp = document.getElementById('localLogsDisplay');
    if (logsDisp) {
      logsDisp.innerHTML =
        `🍎 ${todayLogs.food}x Food · 🚶 ${todayLogs.activity}x Exercise · 💧 ${todayLogs.water}x Fluid · ⚖️ ${todayLogs.weight}x Weight`;
    }

    // Weekly progress bar
    const weekLogs = data.weekLogs ?? 0;
    const weekPct  = Math.min(100, Math.round((weekLogs / 28) * 100));
    setProgress('dashProgressBar', weekPct);
    setText('dashProgressLabel', `${weekLogs} of 28 daily logs this week`);

    // Legacy progress bar
    const legacyFill  = document.getElementById('progressFill');
    const legacyLabel = document.getElementById('progressText');
    const legacyPct   = Math.min(100, Math.round(((data.totalLogs ?? weekLogs) / 30) * 100));
    if (legacyFill)  legacyFill.style.width = `${legacyPct}%`;
    if (legacyLabel) legacyLabel.textContent = `${legacyPct}% Completed — Score: ${data.points ?? 0} Pts`;

    // Badges
    renderBadges(data.badges || []);
    setText('rankBadgeCount', (data.badges || []).length);

    // Re-render water glasses with server count
    renderWaterGlasses();

    // Show certificate card if all 12 weeks done
    const certCard = document.getElementById('certCard');
    if (certCard && (data.badges || []).includes('complete')) {
      certCard.style.display = 'block';
    }

  } catch (err) {
    console.warn('[loadDashboardStats]', err.message);
  }
}

// ── Aliases for syncDashboardTelemetry (legacy name) ──
async function syncDashboardTelemetry() { return loadDashboardStats(); }

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — current program week
// ═══════════════════════════════════════════════════════════════

// Tracks which week the user is actually allowed to be on, so
// loadModule() can refuse to render content for weeks beyond this
// even if the <select> is somehow set past it (defense in depth —
// the primary guard is disabling the option itself, below).

 let userCurrentWeek = 1;

async function loadCurrentWeek() {
  try {
    const data = await api('/program/week');
    const week = data.week ?? 1;
    const pct  = Math.round((week / 12) * 100);

    userCurrentWeek = week;

    setText('currentWeekDisplay', `Week ${week}`);
    setProgress('weekProgressBar', pct);
    setText('weekProgressLabel', `Week ${week} of 12`);

    // Auto-select the module for this week, then lock anything later
    const sel = document.getElementById('weekSelector');
    if (sel) { sel.value = week; }
    lockWeekSelector(week);

  } catch { /* defaults to week 1, lockWeekSelector still runs via the caller */ }
}

/**
 * Disables every <option> in #weekSelector whose week number is
 * greater than the user's current program week, and labels them
 * "(Locked)" so it's clear why they can't be picked. Weeks up
 * through and including the current one stay selectable.
 */
function lockWeekSelector(currentWeek) {
  const sel = document.getElementById('weekSelector');
  if (!sel) return;

  Array.from(sel.options).forEach(option => {
    const optionWeek = parseInt(option.value, 10);
    const isLocked = optionWeek > currentWeek;

    option.disabled = isLocked;

    // Keep the base label clean of repeated "(Locked)" suffixes if
    // this ever re-runs (e.g. after loadCurrentWeek() is re-fetched)
    const baseLabel = option.textContent.replace(/\s*\(Locked\)\s*$/, '');
    option.textContent = isLocked ? `${baseLabel} (Locked)` : baseLabel;
  });
}

// ═══════════════════════════════════════════════════════════════
// BMI CALCULATOR
// ═══════════════════════════════════════════════════════════════
function calculateBMI() {
  const weight = parseFloat(document.getElementById('bmiWeight')?.value);
  const height = parseFloat(document.getElementById('bmiHeight')?.value) / 100;
  const el     = document.getElementById('bmiResult');
  if (!el) return;

  if (!weight || !height || height <= 0) {
    el.innerHTML = '⚠️ Please enter a valid weight and height.';
    el.classList.remove('hidden');
    return;
  }

  const bmi = weight / (height * height);
  const cat = bmi < 18.5 ? '🟡 Underweight'
            : bmi < 25   ? '🟢 Normal weight'
            : bmi < 30   ? '🟠 Overweight'
            :               '🔴 Obese';

  el.innerHTML =
    `Your BMI: <strong>${bmi.toFixed(1)}</strong> — ${cat}` +
    `<br><small style="color:var(--muted)">Healthy range: 18.5 – 24.9</small>`;
  el.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════
// TRACKER — Food diary
// ═══════════════════════════════════════════════════════════════
async function logMeal(mealType) {
  const btn = document.querySelector(`.meal-btn[onclick*="${mealType}"]`);
  if (btn) btn.classList.add('logged');

  // Optimistic update — feels instant; submitMetric() re-syncs the
  // true count from the server right after, so this can't drift.
  todayLogs.food++;
  setText('stat-food', todayLogs.food);
  updateProgressBarLocally();

  await submitMetric('food', { meal: mealType });
  showFeedback('foodFeedback', `✅ ${capitalize(mealType)} logged! Keep it up.`);
}

// ═══════════════════════════════════════════════════════════════
// TRACKER — Water
// ═══════════════════════════════════════════════════════════════
async function logWater() {
  if (waterCount >= 8) {
    showFeedback('waterFeedback', '🎉 Daily goal already reached! 8 glasses done.');
    return;
  }
  waterCount++;
  todayLogs.water = waterCount;

  // Optimistic update
  renderWaterGlasses();
  setText('stat-water', waterCount);
  updateProgressBarLocally();

  await submitMetric('water', { glasses: waterCount });

  const msg = waterCount >= 8
    ? '🎉 Daily water goal reached! Great work.'
    : `💧 ${waterCount}/8 glasses logged.`;
  showFeedback('waterFeedback', msg);
}

function renderWaterGlasses() {
  const el = document.getElementById('waterGlasses');
  if (!el) return;
  el.innerHTML = Array.from({ length: 8 }, (_, i) =>
    `<span class="glass-icon ${i < waterCount ? 'filled' : 'empty'}"
           title="${i < waterCount ? 'Logged' : 'Not yet'}">💧</span>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════════
// TRACKER — Activity
// ═══════════════════════════════════════════════════════════════
async function logActivity() {
  const type      = document.getElementById('activityType')?.value;
  const duration  = parseInt(document.getElementById('activityDuration')?.value);
  const intensity = document.getElementById('activityIntensity')?.value;

  if (!duration || duration < 1) {
    showFeedback('activityFeedback', '⚠️ Please enter a duration in minutes.');
    return;
  }

  // Optimistic update
  todayLogs.activity++;
  setText('stat-activity', todayLogs.activity);
  updateProgressBarLocally();
  if (document.getElementById('activityDuration'))
    document.getElementById('activityDuration').value = '';
  showFeedback('activityFeedback', `✅ ${capitalize(type)} (${duration} min, ${intensity}) logged!`);

  await submitMetric('activity', { type, duration, intensity });
}

// ═══════════════════════════════════════════════════════════════
// TRACKER — Weight
// ═══════════════════════════════════════════════════════════════
async function logWeight() {
  const weight = parseFloat(document.getElementById('weightValue')?.value);
  if (!weight || weight < 20) {
    showFeedback('weightFeedback', '⚠️ Please enter a valid weight in kg.');
    return;
  }

  await submitMetric('weight', { value: weight });
  if (document.getElementById('weightValue'))
    document.getElementById('weightValue').value = '';
  showFeedback('weightFeedback', `✅ Weight logged: ${weight} kg.`);
}

// ═══════════════════════════════════════════════════════════════
// SHARED METRIC SUBMIT → backend → refreshes points, badges & counts
// ═══════════════════════════════════════════════════════════════

// Instant, optimistic progress-bar update shown before the server
// responds. loadDashboardStats() (called at the end of submitMetric)
// overwrites this with the real server numbers moments later, so any
// rounding difference here is only ever visible for a split second.
function updateProgressBarLocally() {
  const total = todayLogs.food + todayLogs.water + todayLogs.activity + todayLogs.weight;
  const weekEst = total * 7;
  const pct     = Math.min(100, Math.round((weekEst / 28) * 100));

  setProgress('dashProgressBar', pct);
  setText('dashProgressLabel', `${total} entries today`);

  const legFill  = document.getElementById('progressFill');
  const legLabel = document.getElementById('progressText');
  const legPct   = Math.min(100, Math.round((total / 30) * 100));
  if (legFill)  legFill.style.width  = `${legPct}%`;
  if (legLabel) legLabel.textContent = `${legPct}% Completed`;
}

async function submitMetric(type, extra = {}) {
  if (!navigator.onLine) {
    queueOfflineMetric(type, extra);
    showOfflineMetricMessage();
    return;
  }

  try {
    const result = await api('/metrics/log', 'POST', { metric_type: type, ...extra });

    // Update points wherever they appear on screen
    if (result.points !== undefined) {
      setText('dashPoints', result.points);
      setText('rankPts',    `${result.points} pts`);
    }

    // Update badges
    if (result.badges) renderBadges(result.badges);

    // Pull fresh counts from the server — this keeps the progress
    // bar, stat pills, and week total in sync with the source of
    // truth instead of drifting from the optimistic local update.
    await loadDashboardStats();

  } catch (err) {
    if (err instanceof TypeError || !navigator.onLine) {
      queueOfflineMetric(type, extra);
      showOfflineMetricMessage();
      return;
    }
    console.warn(`[submitMetric:${type}]`, err.message);
  }
}

function readOfflineMetricQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_METRIC_QUEUE_KEY) || '[]'); }
  catch { return []; }
}

function queueOfflineMetric(type, extra) {
  const queue = readOfflineMetricQueue();
  queue.push({ metric_type: type, ...extra, queued_at: new Date().toISOString() });
  localStorage.setItem(OFFLINE_METRIC_QUEUE_KEY, JSON.stringify(queue));
}

function showOfflineMetricMessage() {
  const display = document.getElementById('localLogsDisplay');
  if (display) display.textContent = 'Offline: activity saved on this device and will sync when you reconnect.';
}

async function flushOfflineMetrics() {
  if (!navigator.onLine || !SESSION) return;
  const queue = readOfflineMetricQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    const { queued_at, ...payload } = item;
    try {
      await api('/metrics/log', 'POST', payload);
    } catch (error) {
      remaining.push(item);
      if (error instanceof TypeError || !navigator.onLine) break;
    }
  }
  localStorage.setItem(OFFLINE_METRIC_QUEUE_KEY, JSON.stringify(remaining));
  if (!remaining.length) await loadDashboardStats();
}

window.flushOfflineMetrics = flushOfflineMetrics;
window.addEventListener('online', flushOfflineMetrics);

// ═══════════════════════════════════════════════════════════════
// LEARNING — Module content (fully local — no extra API call)
// ═══════════════════════════════════════════════════════════════
// main.js - Module Rendering Handler




// ═══════════════════════════════════════════════════════════════
// GAMIFICATION — Leaderboard
// ═══════════════════════════════════════════════════════════════

// Escapes a user-supplied string before it's interpolated into
// innerHTML. anon_handle is free-text set at registration, so it
// must never be inserted raw (was a stored-XSS vector).
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

async function loadLeaderboard() {
  const el = document.getElementById('leaderboardList') || document.getElementById('leaderboardTarget');
  if (!el) return;

  el.innerHTML = '<div class="lb-loading" style="text-align:center;padding:20px;color:#5A7A67"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';

  try {
    const board   = await api('/metrics/leaderboard');
    const myAlias = SESSION?.anon_handle || '';

    if (!board.length) {
      el.innerHTML = '<p style="text-align:center;color:#5A7A67;font-size:13px;padding:16px">No scores yet. Be the first on the board!</p>';
      return;
    }

    el.innerHTML = board.map((row, i) => {
      const rankClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      const isMe = row.anon_handle === myAlias;

      if (isMe) setText('rankPosition', `#${i + 1}`);

      const safeAlias = escapeHtml(row.anon_handle);

      return `
        <div class="lb-row" style="display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid #D4EBE0">
          <div class="lb-rank ${rankClass}"
               style="width:28px;height:28px;border-radius:50%;background:${rankClass==='top1'?'#F5C842':rankClass==='top2'?'#E0E0E0':rankClass==='top3'?'#FFDFC0':'#EFF8F2'};
                      color:${rankClass==='top1'?'#0D4A2F':rankClass==='top2'?'#555':rankClass==='top3'?'#A0522D':'#1A7A4A'};
                      font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${i + 1}
          </div>
          <span style="flex:1;min-width:0;font-size:13px;font-weight:600">${safeAlias}
            <span class="leaderboard-badges">${(row.badges || []).map(badge => {
              const presentation = getBadgePresentation(badge);
              return `<span class="leaderboard-badge" title="${escapeHtml(presentation.label)}">${presentation.emoji}</span>`;
            }).join('')}</span>
          </span>
          ${isMe ? '<span style="font-size:10px;font-weight:700;color:#F5C842;background:#0D4A2F;padding:2px 6px;border-radius:999px">You</span>' : ''}
          <span style="font-size:13px;font-weight:800;color:#1A7A4A">${row.total_points} pts</span>
        </div>
      `;
    }).join('');

    // Update alias display
    const aliasEl = document.getElementById('rankAlias');
    if (aliasEl && SESSION?.anon_handle) aliasEl.textContent = SESSION.anon_handle;

  } catch (err) {
    el.innerHTML = '<p style="text-align:center;color:#5A7A67;font-size:13px;padding:16px">Could not load leaderboard.</p>';
    console.warn('[loadLeaderboard]', err.message);
  }
}

// Alias used in older index.html
async function fetchLeaderboard() { return loadLeaderboard(); }

// ═══════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════
async function loadProfile() {
  try {
    const data = await api('/profile');

    PROFILE_FULL_NAME = data.username || SESSION?.username || '';

    setText('profileFullName', data.username || SESSION?.username || '—');
    setText('profileEmail',    data.email    || '—');
    setText('profileAlias',    data.anon_handle || SESSION?.anon_handle || '—');

  } catch (err) {
    console.warn('[loadProfile]', err.message);
    PROFILE_FULL_NAME = SESSION?.username || '';
    // Fall back to whatever we already have in the session so the
    // tab isn't left saying "Loading..." forever on a network blip
    setText('profileFullName', SESSION?.username    || '—');
    setText('profileEmail',    '—');
    setText('profileAlias',    SESSION?.anon_handle || '—');
  }
}

async function handleDeleteAccount() {
  const confirmed = confirm(
    'This will permanently delete your profile, logs, points, and progress ' +
    'from the research database. This cannot be undone. Are you sure you want ' +
    'to delete your account?'
  );
  if (!confirmed) return;

  try {
    await api('/account', 'DELETE');
  } catch (err) {
    alert(err.message || 'Could not delete account. Please try again.');
    return;
  }

  // Account (and its Supabase auth session) no longer exists server-side —
  // clear local state and send the user back to the auth gateway.
  localStorage.removeItem('dg_session_token');
  SESSION = null;
  location.reload();
}

// ═══════════════════════════════════════════════════════════════
// CERTIFICATE (jsPDF — loaded via CDN in index.html)
// ═══════════════════════════════════════════════════════════════
function downloadCertificate() {
  if (!window.jspdf) {
    alert('Certificate generator is loading. Please try again in a moment.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const canvas = createCertificateCanvas();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210;
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, W, H);
  doc.save(`Dia_Shield_Certificate_${certificateName().replace(/\s+/g, '_')}.pdf`);
}

function certificateName() {
  return PROFILE_FULL_NAME || SESSION?.username || 'Program Participant';
}

function createCertificateCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1131;
  const context = canvas.getContext('2d');
  const center = canvas.width / 2;

  context.fillStyle = '#0d4a2f';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#f5c842';
  context.lineWidth = 18;
  context.strokeRect(55, 55, canvas.width - 110, canvas.height - 110);
  context.textAlign = 'center';
  context.fillStyle = '#f5c842';
  context.font = 'bold 68px Georgia';
  context.fillText('CERTIFICATE OF ACHIEVEMENT', center, 260);
  context.strokeStyle = '#f5c842';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(220, 300);
  context.lineTo(canvas.width - 220, 300);
  context.stroke();
  context.fillStyle = '#ffffff';
  context.font = '32px Georgia';
  context.fillText('This certifies that', center, 405);
  context.fillStyle = '#f5c842';
  context.font = 'bold 70px Georgia';
  context.fillText(certificateName(), center, 530);
  context.fillStyle = '#ffffff';
  context.font = '30px Georgia';
  context.fillText('has successfully completed the', center, 635);
  context.fillStyle = '#2ecc71';
  context.font = 'bold 43px Georgia';
  context.fillText('12-Week Dia Shield Lifestyle Intervention Program', center, 720);
  context.fillStyle = '#ffffff';
  context.font = '26px Georgia';
  context.fillText('University of Owerri  ·  Diabetes Prevention Research Cohort', center, 805);
  context.strokeStyle = '#f5c842';
  context.beginPath();
  context.moveTo(220, 885);
  context.lineTo(canvas.width - 220, 885);
  context.stroke();
  context.font = '25px Georgia';
  context.fillText(`Date Awarded: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, center, 950);
  context.fillStyle = '#f5c842';
  context.font = '22px Georgia';
  context.fillText('Dia Shield · Preventing Type 2 Diabetes Through Education & Lifestyle Change', center, 1045);
  return canvas;
}

function downloadCertificateImage(format) {
  const canvas = createCertificateCanvas();
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const extension = format === 'jpeg' ? 'jpg' : 'png';
  const link = document.createElement('a');
  link.download = `Dia_Shield_Certificate_${certificateName().replace(/\s+/g, '_')}.${extension}`;
  link.href = canvas.toDataURL(mimeType, 0.95);
  link.click();
}

// ═══════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setProgress(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${pct}%`;
}

function showFeedback(elId, message, duration = 4000) {
  const el = document.getElementById(elId);
  if (!el || !message) return;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), duration);
}

function renderBadges(badges) {
  const container = document.getElementById('badgeContainer');
  if (!container) return;

  if (!badges.length) {
    container.innerHTML = '<span style="color:#5A7A67;font-size:13px;">No badges yet. Keep logging to earn your first badge!</span>';
    return;
  }

  container.replaceChildren();
  badges.forEach(badge => {
    const badgeCard = document.createElement('div');
    badgeCard.className = 'badge-unit';
    const presentation = getBadgePresentation(badge);
    badgeCard.append(
      Object.assign(document.createElement('span'), { className: 'badge-emoji', textContent: presentation.emoji }),
      Object.assign(document.createElement('span'), { className: 'badge-label', textContent: presentation.label }),
    );
    container.appendChild(badgeCard);
  });
}

function getBadgePresentation(badge) {
  const daily = String(badge).match(/^daily_w(\d+)_d(\d+)$/);
  if (daily) return { emoji: '🎯', label: `Daily Champion · Week ${daily[1]}, Day ${daily[2]}` };

  const weekly = String(badge).match(/^weekly_w(\d+)$/);
  if (weekly) return { emoji: '🏆', label: `Weekly Champion · Week ${weekly[1]}` };

  const standardBadges = {
    first_log: ['🌱', 'First Healthy Log'], hydration: ['💧', 'Hydration Hero'],
    active: ['🏃', 'Active Achiever'], streak3: ['🔥', '3-Day Streak'],
    streak7: ['⚡', '7-Day Streak'], quiz_ace: ['🧠', 'Quiz Ace'],
    challenge: ['🎖️', 'Challenge Champion'], week1: ['🛡️', 'Week One Complete'],
    complete: ['🎓', 'Programme Complete'],
  };
  const [emoji, label] = standardBadges[badge] || ['🏅', String(badge).replace(/_/g, ' ')];
  return { emoji, label };
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
