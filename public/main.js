// Local variable storage holding runtime authorization cache
let currentSessionUser = JSON.parse(localStorage.getItem('dg_session_token')) || null;

function toggleAuthForm(mode) {
  const isLogin = mode === 'login';
  document.getElementById('loginForm').style.display = isLogin ? 'block' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none' : 'block';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
}

async function handleAuthSubmit(e, type) {
  e.preventDefault();
  const msgEl = document.getElementById('authMessage');
  msgEl.textContent = "Processing connection handshake...";

  const email = document.getElementById(`${type}Email`).value.trim();
  const password = document.getElementById(`${type}Password`).value;
  
  let bodyPayload = { email, password };
  if(type === 'register') {
    bodyPayload.username = document.getElementById('registerUsername').value.trim();
    bodyPayload.anonHandle = document.getElementById('registerAnonHandle').value.trim();
  }

  try {
    const res = await fetch(`/api/v1/auth/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();

    if(!res.ok) throw new Error(data.error || "Authentication structural block failure.");

    if(type === 'login') {
      currentSessionUser = data.session;
      localStorage.setItem('dg_session_token', JSON.stringify(currentSessionUser));
      initWorkspace();
    } else {
      alert("Registration completed successfully! Proceed with login verification.");
      toggleAuthForm('login');
      msgEl.textContent = "";
    }
  } catch(err) {
    msgEl.textContent = `⚠️ ${err.message}`;
  }
}

function initWorkspace() {
  if(!currentSessionUser) return;
  document.getElementById('authGateway').style.display = 'none';
  document.getElementById('cohortWorkspace').style.display = 'block';
  document.getElementById('welcomeUser').textContent = `👋 Profile: ${currentSessionUser.username}`;
  syncDashboardTelemetry();
  loadWeekModule();
}

async function submitMetric(type) {
  if(!currentSessionUser || !currentSessionUser.access_token) return;
  try {
    const res = await fetch('/api/v1/metrics/log', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentSessionUser.access_token}`
      },
      body: JSON.stringify({ metric_type: type })
    });
    if(res.ok) syncDashboardTelemetry();
  } catch(err) {
    console.error("Telemetry channel broken.", err);
  }
}

async function syncDashboardTelemetry() {
  if(!currentSessionUser || !currentSessionUser.access_token) return;
  try {
    const res = await fetch('/api/v1/metrics/snapshot', {
      headers: { 'Authorization': `Bearer ${currentSessionUser.access_token}` }
    });
    const data = await res.json();
    
    document.getElementById('localLogsDisplay').innerHTML = 
      `🍎 ${data.logs.food}x Food · 🚶 ${data.logs.activity}x Exercise · 💧 ${data.logs.water}x Fluid · ⚖️ ${data.logs.weight}x Weight`;
    
    const fillPercent = Math.min(100, Math.round((data.totalLogs / 30) * 100));
    document.getElementById('progressFill').style.width = `${fillPercent}%`;
    document.getElementById('progressText').textContent = `${fillPercent}% Completed — Score: ${data.points} Pts`;
  } catch (err) {
    console.error("Telemetry sync failure.", err);
  }
}

function switchTab(element, tabId) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-link').forEach(t => t.classList.remove('active'));

  const targetSection = document.getElementById(tabId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  if (element) {
    element.classList.add('active');
  } else {
    // If element is not passed, find the tab element by matching index or text/attributes
    const tabs = document.querySelectorAll('.tab-link');
    if (tabId === 'trackers' && tabs[0]) tabs[0].classList.add('active');
    else if (tabId === 'learning' && tabs[1]) tabs[1].classList.add('active');
    else if (tabId === 'gamification' && tabs[2]) tabs[2].classList.add('active');
  }

  if(tabId === 'gamification') fetchLeaderboard();
}

async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/v1/metrics/leaderboard');
    const list = await res.json();
    if (Array.isArray(list)) {
      document.getElementById('leaderboardTarget').innerHTML = list.map((u, i) => `
        <div class="leaderboard-item"><span>${i+1}. 👤 ${u.anon_handle}</span><strong>${u.total_points} pts</strong></div>
      `).join('');
    }
  } catch (err) {
    console.error("Leaderboard fetch failure.", err);
  }
}

function triggerSignOut() {
  localStorage.removeItem('dg_session_token');
  currentSessionUser = null;
  location.reload();
}

function loadWeekModule() {
  const weekSelector = document.getElementById('weekSelector');
  const moduleTarget = document.getElementById('moduleTarget');
  if (!weekSelector || !moduleTarget) return;
  const week = weekSelector.value;
  if(week === "1") {
    moduleTarget.innerHTML = `
      <h4>Week 1: Foundations of Glucose Control</h4>
      <p>Discover the fundamentals of blood glucose tracking, insulin sensitivity, and basic carbohydrate counting to manage your daily glycemic load.</p>
    `;
  } else if(week === "2") {
    moduleTarget.innerHTML = `
      <h4>Week 2: Physical Activity Dynamics</h4>
      <p>Analyze how aerobic and resistance exercises influence metabolic rates, immediate blood glucose utilization, and post-workout glycemic stability.</p>
    `;
  } else {
    moduleTarget.innerHTML = `<p>Select a valid week module to begin learning.</p>`;
  }
}

window.onload = () => { if(currentSessionUser) initWorkspace(); };
