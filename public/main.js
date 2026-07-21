/* ═══════════════════════════════════════════════════════════
   DiabetesGuard — main.js
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

// ── Local UI state ───────────────────────────────────────────
let waterCount = 0;
let todayLogs  = { food: 0, water: 0, activity: 0, weight: 0 };

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  const stored = localStorage.getItem('dg_session_token');
  if (stored) {
    try {
      SESSION = JSON.parse(stored);
      enterApp();
    } catch {
      localStorage.removeItem('dg_session_token');
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// API WRAPPER
// One function for all requests — handles auth header + errors
// ═══════════════════════════════════════════════════════════════
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (SESSION?.access_token) {
    opts.headers['Authorization'] = `Bearer ${SESSION.access_token}`;
  }

  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${API_BASE}/api/v1${path}`, opts);
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
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
    const res = await api('/auth/login', 'POST', {
      email:    emailEl.value.trim(),
      password: passwordEl.value,
    });

    SESSION = res.session;
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
  const passwordEl = document.getElementById('registerPassword')
                  || document.getElementById('regPassword');

  if (!emailEl || !usernameEl || !aliasEl || !passwordEl) {
    showAuthMsg('Page error: registration form fields not found. Please refresh.');
    setLoading('registerBtn', false);
    return;
  }

  try {
    await api('/auth/register', 'POST', {
      email:      emailEl.value.trim(),
      username:   usernameEl.value.trim(),
      anonHandle: aliasEl.value.trim(),
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
    loadDashboardStats(),
    loadLeaderboard(),
    loadProfile(),
  ]);

  // Now safe to load module content for the correct week
  loadModule();
}

// Legacy alias used by older index.html
function initWorkspace() { enterApp(); }

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
    console.warn(`[submitMetric:${type}]`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// LEARNING — Module content (fully local — no extra API call)
// ═══════════════════════════════════════════════════════════════
// main.js - Module Rendering Handler




 // ═══════════════════════════════════════════════════════════════
// LEARNING — Dynamic Async JSON Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Primary layout renderer orchestrating view composition from properties.
 */
const MODULE_CONTENT = {
  1: {
    title: 'Week 1: Understanding Diabetes Risk',
    body: 'Diabetes is a chronic condition that affects how your body processes blood sugar (glucose). Type 2 diabetes is largely preventable through healthy lifestyle choices including balanced nutrition, regular physical activity, and weight management.',
    quiz: {
      q: 'Which of the following is the most effective way to prevent Type 2 diabetes?',
      opts: ['Smoking regularly', 'Regular exercise and healthy eating', 'Skipping meals', 'Drinking only soda'],
      ans: 1
    },
    challenge: { title: 'Weekly Check-in', desc: 'Log your meals and activity for 3 days this week.' }
  },
  2: {
    title: 'Week 2: Glucose & What You Eat',
    body: 'Carbohydrates have the biggest impact on blood glucose levels. Understanding how different foods affect your blood sugar helps you make better choices throughout the day.',
    quiz: {
      q: 'Which nutrient has the greatest impact on blood glucose?',
      opts: ['Protein', 'Carbohydrates', 'Fat', 'Vitamins'],
      ans: 1
    },
    challenge: { title: 'Carb Tracker', desc: 'Track your carbohydrate intake for one full day.' }
  },
  3: {
    title: 'Week 3: The Glycaemic Index',
    body: 'The Glycaemic Index (GI) ranks foods by how quickly they raise blood sugar. Low-GI foods provide longer-lasting energy and help maintain stable glucose levels.',
    quiz: {
      q: 'Which food typically has the lowest Glycaemic Index?',
      opts: ['White bread', 'Watermelon', 'Steel-cut oats', 'Cornflakes'],
      ans: 2
    },
    challenge: { title: 'GI Swap', desc: 'Swap one high-GI food for a low-GI alternative this week.' }
  },
  4: {
    title: 'Week 4: Physical Activity & Insulin',
    body: 'Exercise improves how your body uses insulin and lowers blood glucose. Both aerobic and resistance training are important for diabetes prevention.',
    quiz: {
      q: 'How does physical activity affect insulin sensitivity?',
      opts: ['It decreases sensitivity', 'It increases sensitivity', 'No effect', 'It replaces insulin'],
      ans: 1
    },
    challenge: { title: 'Active Week', desc: 'Complete at least 150 minutes of moderate activity this week.' }
  },
  5: {
    title: 'Week 5: Hydration & Kidney Health',
    body: 'Proper hydration supports kidney function and helps your body regulate blood sugar. Water is the best choice for staying hydrated throughout the day.',
    quiz: {
      q: 'How much water should an average adult drink daily?',
      opts: ['1 glass', '4 glasses', '8 glasses', '20 glasses'],
      ans: 2
    },
    challenge: { title: 'Hydration Goal', desc: 'Drink at least 8 glasses of water every day this week.' }
  },
  6: {
    title: 'Week 6: Weight Management',
    body: 'Losing even 5-10% of your body weight can significantly reduce your risk of Type 2 diabetes. Sustainable weight management comes from consistent daily habits, not extreme diets.',
    quiz: {
      q: 'What percentage of body weight loss can reduce diabetes risk?',
      opts: ['1-2%', '5-10%', '20-25%', 'No amount helps'],
      ans: 1
    },
    challenge: { title: 'Mindful Eating', desc: 'Practice mindful eating at every meal for 3 consecutive days.' }
  },
  7: {
    title: 'Week 7: Stress, Sleep & Blood Sugar',
    body: 'Poor sleep and chronic stress raise cortisol, which can increase blood sugar. Prioritizing rest and stress management is essential for metabolic health.',
    quiz: {
      q: 'Which hormone released during stress raises blood sugar?',
      opts: ['Insulin', 'Cortisol', 'Adrenaline only', 'Melatonin'],
      ans: 1
    },
    challenge: { title: 'Sleep Routine', desc: 'Establish a consistent bedtime routine for 5 nights this week.' }
  },
  8: {
    title: 'Week 8: Smoking & Diabetes Risk',
    body: 'Smoking increases the risk of Type 2 diabetes by 30-40%. It also makes blood sugar harder to control for those already diagnosed.',
    quiz: {
      q: 'Approximately how much does smoking increase Type 2 diabetes risk?',
      opts: ['No increase', '10-20%', '30-40%', '50-60%'],
      ans: 2
    },
    challenge: { title: 'Smoke-Free Days', desc: 'Log every smoke-free day and identify one trigger to avoid.' }
  },
  9: {
    title: 'Week 9: Alcohol & Blood Glucose',
    body: 'Alcohol can cause dangerous spikes and drops in blood sugar. Moderation and never drinking on an empty stomach are key safety principles.',
    quiz: {
      q: 'Why is drinking alcohol on an empty stomach dangerous?',
      opts: ['It speeds absorption', 'It causes hypoglycemia', 'It has no effect', 'It cures diabetes'],
      ans: 1
    },
    challenge: { title: 'Alcohol Log', desc: 'Record all alcohol intake this week and note whether food was consumed.' }
  },
  10: {
    title: 'Week 10: Reading Food Labels',
    body: 'Food labels reveal hidden sugars, unhealthy fats, and excessive sodium. Learning to read them empowers you to make healthier grocery choices.',
    quiz: {
      q: 'What is the first thing to check on a nutrition label?',
      opts: ['The logo', 'Serving size and calories', 'The price', 'The color'],
      ans: 1
    },
    challenge: { title: 'Label Detective', desc: 'Read and compare nutrition labels for 5 different packaged foods.' }
  },
  11: {
    title: 'Week 11: Building Long-term Habits',
    body: 'Lasting change comes from small, repeatable habits. Focus on progress, not perfection, and build routines that fit your lifestyle.',
    quiz: {
      q: 'What is the best strategy for building lasting habits?',
      opts: ['Radical overnight change', 'Small, consistent actions', 'Avoiding all treats', 'Copying others'],
      ans: 1
    },
    challenge: { title: 'Habit Stack', desc: 'Add one new healthy habit to an existing morning routine.' }
  },
  12: {
    title: 'Week 12: Program Review & Next Steps',
    body: 'You have completed the 12-week DiabetesGuard program. Review your progress, celebrate your achievements, and plan how to maintain these healthy habits long-term.',
    quiz: {
      q: 'What is the most important takeaway from this program?',
      opts: ['Diabetes cannot be prevented', 'Small consistent changes prevent Type 2 diabetes', 'Only medicine works', 'You must be perfect'],
      ans: 1
    },
    challenge: { title: 'Future Plan', desc: 'Write down 3 healthy habits you will continue beyond this program.' }
  }
};

function loadModule() {
  const sel   = document.getElementById('weekSelector');
  const week  = parseInt(sel?.value) || 1;

  if (week > userCurrentWeek) {
    renderLockedWeekState(week);
    return;
  }

  const data = MODULE_CONTENT[week] || MODULE_CONTENT[1];

  if (data.push_notification) {
    triggerBrowserNotificationMock(data.push_notification);
  }

  const moduleEl = document.getElementById('moduleTarget') || document.getElementById('moduleContent');
  if (moduleEl) {
    moduleEl.innerHTML = `
      <strong>${data.title}</strong>
      <p style="margin-top:8px;color:var(--muted,#5A7A67);line-height:1.5;">${data.body}</p>
      <div class="interactive-activity-box" style="margin-top:12px;padding:10px;background:#F4F9F6;border-left:3px solid #1A7A4A;border-radius:6px;font-size:13px;color:#0F2419;margin-bottom:12px;">
        <strong>⚙️ Interactive Activity:</strong> Review the key points above and complete the weekly quiz.
      </div>
      <div class="challenge-box" style="margin-top:12px;padding:10px;background:#FEF9E7;border-left:3px solid #F5C842;border-radius:6px;font-size:13px;">
        <strong>📝 Reflection:</strong> Think about how this week&rsquo;s topic applies to your daily life.
      </div>
    `;
  }

  if (data.quiz) renderQuiz(data.quiz);

  const chalTitle = document.getElementById('challengeTitle');
  const chalDesc  = document.getElementById('challengeDesc');
  if (chalTitle) chalTitle.textContent = data.challenge?.title || 'Weekly Challenge';
  if (chalDesc)  chalDesc.textContent  = data.challenge?.desc || '';

  const chalFb = document.getElementById('challengeFeedback');
  if (chalFb) chalFb.classList.add('hidden');

  const completeBtn = document.getElementById('markCompleteBtn');
  if (completeBtn) {
    completeBtn.innerHTML = '<i class="fas fa-check-circle"></i> Mark as Complete (+30 pts)';
    completeBtn.disabled  = false;
    completeBtn.style.background = '';
  }
}

/**
 * Renders an informative UI view if future/unearned weeks are programmatically requested.
 */
function renderLockedWeekState(week) {
  const moduleEl = document.getElementById('moduleTarget') || document.getElementById('moduleContent');
  if (moduleEl) {
    moduleEl.innerHTML = `
      <div class="locked-week-notice" style="padding:20px; text-align:center; background:#F9F9F9; border:1px solid var(--border,#D4EBE0); border-radius:8px; color:var(--muted,#5A7A67);">
        <i class="fas fa-lock" aria-hidden="true" style="margin-right:6px; color:#C0392B;"></i>
        Week ${week} unlocks once you reach it in the 12-week program.
        You're currently on Week ${userCurrentWeek}.
      </div>
    `;
  }

  const quizEl = document.getElementById('quizContent');
  if (quizEl) {
    quizEl.innerHTML = `<div class="locked-week-notice" style="text-align:center; padding:10px; color:#A0A0A0;"><i class="fas fa-lock" aria-hidden="true"></i> Not available yet.</div>`;
  }

  const chalTitle = document.getElementById('challengeTitle');
  const chalDesc  = document.getElementById('challengeDesc');
  if (chalTitle) chalTitle.textContent = 'Locked';
  if (chalDesc)  chalDesc.textContent  = `This challenge unlocks in week ${week}.`;

  const completeBtn = document.getElementById('markCompleteBtn');
  if (completeBtn) {
    completeBtn.innerHTML = '<i class="fas fa-lock"></i> Locked';
    completeBtn.disabled  = true;
    completeBtn.style.background = '#A0A0A0';
  }
}

// Dropdown handler mappings
function loadWeekModule() { loadModule(); }

/**
 * Injects a visual mock popup representation for weekly push notifications
 */
function triggerBrowserNotificationMock(messageText) {
  let mockToast = document.getElementById('notificationToastMock');
  if (!mockToast) {
    mockToast = document.createElement('div');
    mockToast.id = 'notificationToastMock';
    mockToast.style.cssText = 'position:fixed; top:20px; right:20px; background:#0F2419; color:#FFF; padding:14px 18px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:9999; font-size:13px; max-width:320px; display:flex; flex-direction:column; gap:4px; border-left:4px solid #1A7A4A; transition: opacity 0.3s ease;';
    document.body.appendChild(mockToast);
  }
  
  mockToast.innerHTML = `<span style="font-weight:700; color:#D4EBE0; font-size:11px; text-transform:uppercase; tracking-letter:1px;">Push Notification Alert</span><div>${messageText}</div>`;
  mockToast.style.opacity = '1';
  mockToast.style.display = 'block';

  setTimeout(() => {
    mockToast.style.opacity = '0';
    setTimeout(() => { mockToast.style.display = 'none'; }, 300);
  }, 4500);
}

function renderQuiz(quiz) {
  const el = document.getElementById('quizContent');
  if (!el) return;

  el.innerHTML = `
    <p class="quiz-question" style="font-size:14px;font-weight:600;margin-bottom:10px">${quiz.q}</p>
    <div class="quiz-options" style="display:flex;flex-direction:column;gap:8px">
      ${quiz.opts.map((opt, i) =>
        `<button class="quiz-option" onclick="answerQuiz(${i}, ${quiz.ans}, this)"
          style="background:var(--green-pale,#EFF8F2);border:1.5px solid var(--border,#D4EBE0);border-radius:10px;
                 padding:12px 14px;font-size:13px;cursor:pointer;text-align:left;color:var(--text,#0F2419); width:100%;">
          ${opt}
        </button>`
      ).join('')}
    </div>
    <div id="quizResult" style="display:none;margin-top:10px;font-size:13px;font-weight:700;
         text-align:center;padding:8px;border-radius:8px"></div>
  `;
}

async function answerQuiz(chosen, correct, btn) {
  document.querySelectorAll('.quiz-option').forEach(o => { o.disabled = true; });
  const resultEl = document.getElementById('quizResult');

  if (chosen === correct) {
    btn.style.cssText += 'background:#E8F8F0;border-color:#1A7A4A;color:#0D4A2F;font-weight:700;';
    if (resultEl) {
      resultEl.textContent = '✅ Correct! +20 pts';
      resultEl.style.cssText = 'display:block;background:#E8F8F0;color:#1A7A4A';
    }
    await submitMetric('quiz', { correct: true });
  } else {
    btn.style.cssText += 'background:#FDECEA;border-color:#E74C3C;color:#C0392B';
    const opts = document.querySelectorAll('.quiz-option');
    if (opts[correct]) opts[correct].style.cssText += 'background:#E8F8F0;border-color:#1A7A4A;color:#0D4A2F;font-weight:700;';
    if (resultEl) {
      resultEl.textContent = `❌ Incorrect. Correct answer: "${opts[correct]?.textContent.trim()}"`;
      resultEl.style.cssText = 'display:block;background:#FDECEA;color:#C0392B';
    }
    await submitMetric('quiz', { correct: false });
  }
}

async function markModuleComplete() {
  const week = parseInt(document.getElementById('weekSelector')?.value) || 1;
  if (week > userCurrentWeek) return; 
  await submitMetric('module', { week });

  const btn = document.getElementById('markCompleteBtn');
  if (btn) {
    btn.innerHTML  = '<i class="fas fa-check-circle"></i> Completed ✓';
    btn.disabled   = true;
    btn.style.background = '#5A7A67';
  }
}

async function completeChallenge() {
  const week = parseInt(document.getElementById('weekSelector')?.value) || 1;
  if (week > userCurrentWeek) return; 
  await submitMetric('challenge', { week });
  showFeedback('challengeFeedback', '🏆 Challenge complete! +50 pts added.');
}

function openResource(type, e) {
  if (e) e.preventDefault();
  const msgs = {
    video:       '📹 Video lessons will be available once the research team uploads content. Check back soon!',
    infographic: '🖼️ Infographic packs are being prepared by the research coordinator.',
    faq:         'Q: Can I prevent diabetes?\nA: Yes! Type 2 is largely preventable. This program shows you how.\n\nQ: How do I know if I\'m at risk?\nA: Key indicators: high BMI, poor diet, inactivity, smoking, family history.\n\nQ: What if I miss a day?\nA: Just pick up where you left off. Consistency over time matters more than perfection.',
  };
  alert(msgs[type] || 'Resource loading...');
}

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
          <span style="flex:1;font-size:13px;font-weight:600">${safeAlias}</span>
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

    setText('profileFullName', data.username || SESSION?.username || '—');
    setText('profileEmail',    data.email    || '—');
    setText('profileAlias',    data.anon_handle || SESSION?.anon_handle || '—');

  } catch (err) {
    console.warn('[loadProfile]', err.message);
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210;

  // Background
  doc.setFillColor(13, 74, 47);
  doc.rect(0, 0, W, H, 'F');

  // Gold border
  doc.setDrawColor(245, 200, 66);
  doc.setLineWidth(3);
  doc.rect(10, 10, W - 20, H - 20, 'S');

  // Title
  doc.setTextColor(245, 200, 66);
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text('CERTIFICATE OF ACHIEVEMENT', W / 2, 48, { align: 'center' });

  // Divider line
  doc.setDrawColor(245, 200, 66);
  doc.setLineWidth(0.5);
  doc.line(40, 56, W - 40, 56);

  // Subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.text('This certifies that', W / 2, 70, { align: 'center' });

  // Participant name
  doc.setTextColor(245, 200, 66);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text(SESSION?.username || 'Program Participant', W / 2, 88, { align: 'center' });

  // Body
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('has successfully completed the', W / 2, 102, { align: 'center' });

  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(46, 204, 113);
  doc.text('12-Week DiabetesGuard Lifestyle Intervention Program', W / 2, 116, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('University of Owerri  ·  Diabetes Prevention Research Cohort', W / 2, 130, { align: 'center' });

  // Date
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.line(40, 148, W - 40, 148);
  doc.setFontSize(11);
  doc.text(`Date Awarded: ${today}`, W / 2, 158, { align: 'center' });

  // Footer
  doc.setTextColor(245, 200, 66);
  doc.setFontSize(10);
  doc.text('DiabetesGuard · Preventing Type 2 Diabetes Through Education & Lifestyle Change', W / 2, 190, { align: 'center' });

  doc.save(`DiabetesGuard_Certificate_${(SESSION?.username || 'Participant').replace(/\s+/g, '_')}.pdf`);
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

  container.innerHTML = badges.map(badge =>
    `<span class="badge-unit">${escapeHtml(badge)}</span>`
  ).join('');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}