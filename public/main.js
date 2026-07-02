// ===== GLOBAL LOCAL STORAGE LAYER CONTAINER =====
let localState = JSON.parse(localStorage.getItem('dg_local_state')) || {
  points: 10,
  logs: { food: 0, activity: 0, water: 0, weight: 0 },
  unlockedBadges: ["Starter Badge"]
};

// Commit mutated objects back to browser storage safely
function saveState() {
  localStorage.setItem('dg_local_state', JSON.stringify(localState));
  updateVisualDisplays();
}

// Control Module Tab switches completely client-side
function switchTab(tabId) {
  document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
  document.querySelectorAll('.tab-link').forEach(tab => tab.classList.remove('active'));
  
  document.getElementById(tabId).classList.add('active');
  event.currentTarget.classList.add('active');
  
  if (tabId === 'gamification') fetchLeaderboard();
}

// Log habit tracking values dynamically
function logMetric(type) {
  localState.logs[type]++;
  localState.points += 15; // Reward programmatic points structure
  
  // Dynamic localized programmatic achievement rule check
  if (localState.logs.water >= 3 && !localState.unlockedBadges.includes("Hydration Champion")) {
      localState.unlockedBadges.push("Hydration Champion");
  }
  saveState();
}

// Redraw UI tracking interfaces and math ratios dynamically
function updateVisualDisplays() {
  const logs = localState.logs;
  document.getElementById('localLogsDisplay').innerHTML = 
    `🍎 ${logs.food}x Diary · 🚶 ${logs.activity}x Activities · 💧 ${logs.water}x Fluid · ⚖️ ${logs.weight}x Weight`;
  
  // Calculate completion percentage towards current weekly goal benchmarks
  const totalLogsCount = logs.food + logs.activity + logs.water + logs.weight;
  const targetThresholdCap = 30;
  const computedPercentage = Math.min(100, Math.round((totalLogsCount / targetThresholdCap) * 100));
  
  document.getElementById('progressFill').style.width = `${computedPercentage}%`;
  document.getElementById('progressText').textContent = 
    `${computedPercentage}% toward weekly tasks completed (${localState.points} Accumulated Points)`;

  // Populate localized digital badges matrix
  const badgeZone = document.getElementById('badgeZone');
  badgeZone.innerHTML = localState.unlockedBadges.map(badgeTitle => 
    `<span class="badge-unit"><i class="fas fa-star" style="color:var(--accent-gold);"></i> ${badgeTitle}</span>`
  ).join('');
}

// Asynchronous call reading curated learning materials from express API
async function loadWeekModule() {
  const weekNum = document.getElementById('weekSelector').value;
  try {
    const response = await fetch(`/api/v1/modules/${weekNum}`);
    const data = await response.json();
    document.getElementById('moduleTarget').innerHTML = `
      <strong>📚 ${data.title}</strong>
      <p style="margin-top:6px; color:#4a5568;">${data.content}</p>
      <div style="margin-top:10px; padding:8px; background:#fffaf0; border-left:3px solid var(--accent-gold); border-radius:4px;">
        <strong>Weekly Target Action:</strong> ${data.challenge}
      </div>
    `;
  } catch (err) {
    document.getElementById('moduleTarget').textContent = "Content delivery pipeline disconnected.";
  }
}

// Form validation and verification rule logic for the custom BMI utility
function calculateBMI() {
  const weight = parseFloat(document.getElementById('bmiWeight').value);
  const height = parseFloat(document.getElementById('bmiHeight').value) / 100;
  const resultDiv = document.getElementById('bmiResult');
  
  if (!weight || !height || height === 0) {
    resultDiv.innerHTML = `<span style="color:#c0392b;">⚠️ Please specify real values.</span>`;
    resultDiv.style.display = 'block';
    return;
  }
  
  const bmi = weight / (height * height);
  let classCategory = '';
  if (bmi < 18.5) classCategory = 'Underweight';
  else if (bmi < 25) classCategory = 'Normal Weight Status';
  else if (bmi < 30) classCategory = 'Overweight Baseline';
  else classCategory = 'Clinical Obesity Vector';
  
  resultDiv.innerHTML = `<strong>Computed BMI: ${bmi.toFixed(1)}</strong> — ${classCategory}`;
  resultDiv.style.display = 'block';
}

function answerQuiz(isCorrect) {
   if (isCorrect) {
       alert("Excellent analysis! Programmatic points issued.");
       localState.points += 30;
       saveState();
   } else {
       alert("Incorrect statement. Review curriculum matrices.");
   }
}

// Pull score array structures cleanly from Node.js backend
async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/v1/gamification/leaderboard');
    const boardArray = await res.json();
    document.getElementById('leaderboardTarget').innerHTML = boardArray.map((userRow, index) => `
      <div class="leaderboard-item">
        <span>${index + 1}. 👤 ${userRow.anonHandle}</span>
        <strong>${userRow.totalPoints} pts</strong>
      </div>
    `).join('');
  } catch(err) {
    document.getElementById('leaderboardTarget').textContent = "Unable to read global scoring standings.";
  }
}

// Push local browser points up onto live shared dashboard
async function syncScoreToCloud() {
  const handleInput = document.getElementById('anonHandleInput').value.trim();
  if (!handleInput) return alert("Specify an anonymous tracking handle first.");
  
  try {
    const response = await fetch('/api/v1/gamification/submit-score', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ anonHandle: handleInput, points: localState.points })
    });
    if (response.ok) {
       alert("Local state synchronized smoothly.");
       fetchLeaderboard();
    }
  } catch(err) {
    alert("Cloud registry handshake timed out.");
  }
}

// Initialization bootstrap point
window.onload = () => {
  updateVisualDisplays();
  loadWeekModule();
};