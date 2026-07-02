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

function switchTab(tabId) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-link').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  event.currentTarget.classList.add('active');
  if(tabId === 'gamification') fetchLeaderboard();
}

async function fetchLeaderboard() {
  const res = await fetch('/api/v1/metrics/leaderboard');
  const list = await res.json();
  document.getElementById('leaderboardTarget').innerHTML = list.map((u, i) => `
    <div class="leaderboard-item"><span>${i+1}. 👤 ${u.anon_handle}</span><strong>${u.total_points} pts</strong></div>
  `).join('');
}

function triggerSignOut() {
  localStorage.removeItem('dg_session_token');
  currentSessionUser = null;
  location.reload();
}

window.onload = () => { if(currentSessionUser) initWorkspace(); };