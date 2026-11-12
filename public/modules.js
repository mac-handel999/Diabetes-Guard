// ═══════════════════════════════════════════════════════════════
// LEARNING — Curriculum renderer
// ═══════════════════════════════════════════════════════════════

// Cache curriculum data in memory, local storage, and the service worker for offline lessons.
// The cache is keyed by a version stamp so a curriculum.json update (new lessons,
// fixed bullets, the Week 5 activity tracker, etc.) is picked up without
// forcing participants to clear their browser storage.
let MODULE_CONTENT_CACHE = null;
const CURRICULUM_CACHE_VERSION_KEY = 'dg_curriculum_cache_version';
const CURRICULUM_CACHE_DATA_KEY   = 'dg_curriculum_cache';

/**
 * Asynchronously fetches curriculum data with Service Worker / Cache Storage fallback.
 *
 * The curriculum changes between deploys (new lessons, fixed content, added
 * tracker cards), so the cached copy is stamped with the response's
 * ETag/Last-Modified and only reused when that stamp matches. This stops a
 * participant from being stuck on an old lesson set after an update.
 */
async function fetchCurriculumData() {
  if (MODULE_CONTENT_CACHE) {
    return MODULE_CONTENT_CACHE;
  }

  let networkData = null;
  let versionStamp = null;

  try {
    const response = await fetch('curriculum.json', { cache: 'no-store' });
    if (response.ok) {
      networkData = await response.json();
      // ETag or Last-Modified — either one is a fine fingerprint for
      // "has this file changed since we cached it?".
      versionStamp = response.headers.get('ETag')
        || response.headers.get('Last-Modified')
        || String(Date.now());
    }
  } catch (error) {
    console.warn('Network request failed. Attempting to load curriculum from Cache Storage...', error);
  }

  if (networkData) {
    MODULE_CONTENT_CACHE = networkData;
    try {
      localStorage.setItem(CURRICULUM_CACHE_DATA_KEY, JSON.stringify(networkData));
      localStorage.setItem(CURRICULUM_CACHE_VERSION_KEY, versionStamp);
    } catch { /* storage full — keep the in-memory copy */ }
    return networkData;
  }

  // Fallback: Check Cache Storage directly if Service Worker is handling it
  if ('caches' in window) {
    try {
      const cacheResponse = await caches.match(new URL('curriculum.json', location.href));
      if (cacheResponse) {
        MODULE_CONTENT_CACHE = await cacheResponse.json();
        return MODULE_CONTENT_CACHE;
      }
    } catch { /* cache read failed — fall through to localStorage */ }
  }

  // Last resort: the previously-stamped localStorage copy, but only if
  // its version stamp still matches the network's — otherwise the
  // participant would silently keep seeing an old lesson set.
  try {
    const storedVersion = localStorage.getItem(CURRICULUM_CACHE_VERSION_KEY);
    const storedData   = localStorage.getItem(CURRICULUM_CACHE_DATA_KEY);
    if (storedData && storedVersion && storedVersion === versionStamp) {
      MODULE_CONTENT_CACHE = JSON.parse(storedData);
      return MODULE_CONTENT_CACHE;
    }
    if (storedData) {
      // Stamp mismatch — the lesson set has changed. Use the new copy
      // if we have one, otherwise warn rather than silently serving old content.
      console.warn('[curriculum] Stored lesson cache is stale; a newer curriculum.json is available.');
    }
  } catch { /* ignore */ }

  return null;
}

// Modal state for infographic full-screen view
let infographicModal = null;
let infographicModalImage = null;
let infographicModalCaption = null;
let infographicModalTitle = null;

// The week currently rendered in the Courses view, so the
// quiz-completion handler can fire the week's push notification.
let CURRENT_WEEK = null;

function getCurriculumWeeks(curriculumData) {
  if (Array.isArray(curriculumData)) return curriculumData;
  if (!curriculumData || typeof curriculumData !== 'object') return [];
  return [...(curriculumData.weeks || []), ...(curriculumData.additionalWeeks || [])];
}

// Small DOM helpers keep lesson rendering safe by using textContent instead of raw HTML.
function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

// Curriculum data is authored with "•"/"-" bullet lines, embedded
// <ul>/<li> blocks, and **bold** / <strong> inline markup. These
// helpers convert that text into real DOM nodes (never innerHTML),
// so bullets and bold render correctly in the app UI while the
// text itself stays escaped.

function renderInlineMarkup(parent, text) {
  const pattern = /(\*\*.+?\*\*|<strong>[\s\S]*?<\/strong>|<b>[\s\S]*?<\/b>)/gi;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    const inner = match[0].replace(/^\*\*|\*\*$/g, '').replace(/<\/?[a-z]+>/gi, '');
    parent.appendChild(createElement('strong', '', inner));
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  return parent;
}

function normalizeCurriculumText(text) {
  return text
    .replace(/<ul[^>]*>/gi, '\n')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<\/li>[ \t]*\n?/gi, '')
    .replace(/<li[^>]*>\s*(?:•\s*)?/gi, '\n• ');
}

function renderCurriculumText(text) {
  const container = document.createDocumentFragment();
  let list = null;
  let paragraph = null;

  const closeList = () => { if (list) { container.appendChild(list); list = null; } };
  const closeParagraph = () => { if (paragraph) { container.appendChild(paragraph); paragraph = null; } };

  for (const rawLine of normalizeCurriculumText(text).split('\n')) {
    const line = rawLine.trim();
    const bullet = line.match(/^[•·-]\s+(.+)$/);
    if (bullet) {
      closeParagraph();
      if (!list) list = createElement('ul');
      list.appendChild(renderInlineMarkup(createElement('li'), bullet[1]));
      continue;
    }
    closeList();
    if (!line) { closeParagraph(); continue; }
    if (!paragraph) paragraph = createElement('p');
    else paragraph.appendChild(document.createElement('br'));
    renderInlineMarkup(paragraph, line);
  }
  closeList();
  closeParagraph();
  return container;
}

function appendTextBlock(parent, text, className) {
  if (!text) return;
  const block = createElement('div', className);
  block.appendChild(renderCurriculumText(text));
  parent.appendChild(block);
}

function getSelectedDayNumber() {
  return parseInt(document.getElementById('daySelector')?.value, 10) || 1;
}

// Convert one curriculum day into lesson, infographic, quiz, and challenge content.
function getVisibleDayContent(day) {
  return (day.lesson || day.content || '')
    .replace(/\n(?:Interactive Activity|Knowledge Check|Weekly Quiz|Quiz)\b[\s\S]*$/i, '')
    .replace(/\n?Push Notification\n[\s\S]*$/i, '')
    .trim();
}

function getInfographicTitle(day) {
  if (day.interactiveActivity?.image?.alt) return day.interactiveActivity.image.alt;
  const instructions = day.interactiveActivity?.instructions || '';
  if (!/infographic/i.test(instructions)) return '';
  return instructions
    .split('\n')
    .map(line => line.replace(/^(watch|review)\s+infographic\s*:?\s*/i, '').replace(/^"|"$/g, '').trim())
    .find(line => line && !/^infographic/i.test(line)) || 'Interactive infographic';
}

function renderInfographic(day) {
  const title = getInfographicTitle(day);
  const image = day.interactiveActivity?.image;
  if (!title && !image?.src) return null;

  const card = createElement('section', 'infographic-card');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Infographic: ${title || 'View full size'}`);
  
  if (image?.src) {
    const imageElement = document.createElement('img');
    imageElement.className = 'infographic-image';
    imageElement.src = image.src;
    imageElement.alt = image.alt || title;
    imageElement.loading = 'lazy';
    imageElement.addEventListener('error', () => imageElement.classList.add('is-missing'));
    card.appendChild(imageElement);
  } else {
    card.appendChild(createElement('span', 'infographic-icon', '📊'));
  }
  
  const body = createElement('div', 'infographic-content');
  body.appendChild(createElement('strong', '', title || 'Infographic'));
  body.appendChild(createElement('p', '', image?.caption || 'Tap to view full size'));
  card.appendChild(body);
  
  // Add click and keyboard handlers for modal
  const openModal = () => openInfographicModal(image?.src, image?.alt || title, image?.caption);
  card.addEventListener('click', openModal);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal();
    }
  });
  
  return card;
}

function openInfographicModal(src, alt, caption) {
  if (!src) return;
  
  // Create modal if it doesn't exist
  if (!infographicModal) {
    createInfographicModal();
  }
  
  infographicModalImage.src = src;
  infographicModalImage.alt = alt;
  infographicModalTitle.textContent = alt;
  infographicModalCaption.textContent = caption || '';
  
  infographicModal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  
  // Focus the close button for accessibility
  setTimeout(() => {
    document.querySelector('.infographic-modal-close')?.focus();
  }, 100);
}

function closeInfographicModal() {
  if (!infographicModal) return;
  infographicModal.classList.remove('is-open');
  document.body.style.overflow = '';
}

function createInfographicModal() {
  const overlay = document.createElement('div');
  overlay.className = 'infographic-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'infographicModalTitle');
  
  overlay.innerHTML = `
    <div class="infographic-modal">
      <header class="infographic-modal-header">
        <h3 id="infographicModalTitle"></h3>
        <button type="button" class="infographic-modal-close" aria-label="Close infographic">&times;</button>
      </header>
      <div class="infographic-modal-body">
        <img class="infographic-modal-image" src="" alt="" />
        <p class="infographic-modal-caption"></p>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  infographicModal = overlay;
  infographicModalImage = overlay.querySelector('.infographic-modal-image');
  infographicModalCaption = overlay.querySelector('.infographic-modal-caption');
  infographicModalTitle = overlay.querySelector('#infographicModalTitle');
  
  // Close handlers
  overlay.querySelector('.infographic-modal-close').addEventListener('click', closeInfographicModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeInfographicModal();
  });
  
  // Keyboard handlers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && infographicModal?.classList.contains('is-open')) {
      closeInfographicModal();
    }
  });
}

// ─────────────────────────────────────────────
// INTERACTIVE — Diabetes Risk Checklist (Week 2, Day 6)
// ─────────────────────────────────────────────
function riskChecklistKey() {
  const user = (typeof SESSION !== 'undefined' && SESSION?.user_id) || 'anonymous';
  return `dg_risk_checklist:${user}:w2:d6`;
}

function readRiskChecklistAnswers() {
  try { return JSON.parse(localStorage.getItem(riskChecklistKey()) || '{}'); }
  catch { return {}; }
}

function renderRiskChecklist(day) {
  const config = day.riskChecklist;
  if (!config || !Array.isArray(config.items) || !config.items.length) return null;

  const card = createElement('section', 'risk-checklist-card');
  card.appendChild(createElement('strong', 'risk-checklist-title', config.title || 'Risk checklist'));
  if (config.description) card.appendChild(createElement('p', '', config.description));

  const answers = readRiskChecklistAnswers();
  const list = createElement('ul', 'risk-checklist-items');

  const updateResult = () => {
    const yesCount = config.items.filter((_, index) => answers[index] === true).length;
    const category = (config.categories || []).find(c => yesCount >= c.min && yesCount <= c.max);
    result.textContent = category
      ? `${yesCount} of ${config.items.length} risk factors — ${category.label}`
      : `${yesCount} of ${config.items.length} risk factors`;
  };

  const result = createElement('p', 'risk-checklist-result');
  config.items.forEach((item, index) => {
    const row = createElement('li', 'risk-checklist-item');
    row.appendChild(createElement('span', 'risk-checklist-label', item));
    const toggle = createElement('div', 'risk-checklist-toggle');
    ['Yes', 'No'].forEach(answer => {
      const isYes = answer === 'Yes';
      const button = createElement('button', 'quiz-option risk-checklist-btn', answer);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(answers[index] === isYes));
      if (answers[index] === isYes) button.classList.add('is-selected');
      button.addEventListener('click', () => {
        answers[index] = isYes;
        localStorage.setItem(riskChecklistKey(), JSON.stringify(answers));
        toggle.querySelectorAll('.risk-checklist-btn').forEach(btn => {
          btn.classList.remove('is-selected');
          btn.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('is-selected');
        button.setAttribute('aria-pressed', 'true');
        updateResult();
      });
      toggle.appendChild(button);
    });
    row.appendChild(toggle);
    list.appendChild(row);
  });

  card.appendChild(list);
  card.appendChild(result);
  updateResult();
  return card;
}

// ─────────────────────────────────────────────
// INTERACTIVE — Food Diary (Week 3, Day 6)
// Entries persist in localStorage (survives refresh
// and logout) and sync to the research database via
// the existing /api/v1/metrics/log pipeline.
// ─────────────────────────────────────────────
function foodDiaryStorageKey() {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const user = (typeof SESSION !== 'undefined' && SESSION?.user_id) || 'anonymous';
  return `dg_food_diary:${user}:${date}`;
}

function readFoodDiaryEntries() {
  try { return JSON.parse(localStorage.getItem(foodDiaryStorageKey()) || '[]'); }
  catch { return []; }
}

function renderFoodDiaryEntries(container, entries) {
  container.replaceChildren();
  if (!entries.length) {
    container.appendChild(createElement('p', 'food-diary-empty', 'No entries saved yet today.'));
    return;
  }
  const list = createElement('ul', 'food-diary-entry-list');
  entries.forEach(entry => {
    const row = createElement('li', 'food-diary-entry');
    row.appendChild(createElement('strong', '', `${entry.meal}: `));
    row.appendChild(document.createTextNode(entry.text));
    list.appendChild(row);
  });
  container.appendChild(list);
}

function renderFoodDiary(day) {
  const config = day.foodDiary;
  if (!config || !Array.isArray(config.meals) || !config.meals.length) return null;

  const card = createElement('section', 'food-diary-card');
  card.appendChild(createElement('strong', 'food-diary-title', config.title || 'Food Diary'));
  if (config.description) card.appendChild(createElement('p', '', config.description));

  let entries = readFoodDiaryEntries();

  const entriesContainer = createElement('div', 'food-diary-entries');
  renderFoodDiaryEntries(entriesContainer, entries);

  const form = createElement('form', 'food-diary-form');
  config.meals.forEach(meal => {
    const field = meal.toLowerCase();
    const row = createElement('label', 'food-diary-row');
    row.appendChild(createElement('span', 'food-diary-meal', meal));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'food-diary-input';
    input.name = field;
    input.placeholder = `What did you have for ${field}?`;
    input.setAttribute('aria-label', meal);
    row.appendChild(input);
    form.appendChild(row);
  });

  const feedback = createElement('p', 'food-diary-feedback');
  feedback.hidden = true;
  const saveButton = createElement('button', 'action-btn wide-btn food-diary-save', 'Save Diary Entry');
  saveButton.type = 'submit';
  form.appendChild(saveButton);
  form.appendChild(feedback);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const saved = [];
    for (const meal of config.meals) {
      const text = (formData.get(meal.toLowerCase()) || '').toString().trim();
      if (!text) continue;
      const entry = { meal, text, saved_at: new Date().toISOString() };
      entries.push(entry);
      saved.push(entry);
    }
    if (!saved.length) {
      feedback.textContent = '⚠️ Enter something for at least one meal.';
      feedback.hidden = false;
      return;
    }
    localStorage.setItem(foodDiaryStorageKey(), JSON.stringify(entries));
    renderFoodDiaryEntries(entriesContainer, entries);
    form.reset();
    feedback.textContent = `✅ ${saved.length} ${saved.length === 1 ? 'entry' : 'entries'} saved.`;
    feedback.hidden = false;
    for (const entry of saved) {
      await submitMetric('food', { meal: entry.meal, entry: entry.text });
    }
  });

  card.appendChild(form);
  card.appendChild(entriesContainer);
  return card;
}

// ─────────────────────────────────────────────
// WEEK 5 ACTIVITY TRACKER (embedded per day)
// ─────────────────────────────────────────────
// Week 5 ("Physical activity and diabetes prevention") carries a
// self-monitoring card on every day. Day 1 → Monday, Day 2 → Tuesday,
// and so on. Each day's answers save independently to the existing
// physical_activity_days table (the same store the 7-day tracker uses),
// keyed by the current week so a participant can fill in Monday on
// Monday and Tuesday on Tuesday without losing Monday's answers.
function renderActivityTracker(day) {
  const config = day.activityTracker;
  if (!config) return null;

  const dayKey = (day.dayNumber >= 1 && day.dayNumber <= 7)
    ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][day.dayNumber - 1]
    : null;
  if (!dayKey) return null;

  const card = createElement('section', 'activity-tracker-card');
  card.appendChild(createElement('strong', 'activity-tracker-title', config.title || 'Physical Activity Tracker'));
  if (config.description) card.appendChild(createElement('p', '', config.description));

  const form = createElement('form', 'activity-tracker-form');
  form.setAttribute('data-day', dayKey);

  // Keep references to the form fields so we can populate them once the
  // saved entry for this day loads (the first render uses empty values).
  const fields = {};

  const field = (label, id) => {
    const row = createElement('label', 'activity-tracker-field');
    row.appendChild(createElement('span', 'activity-tracker-label', label));
    const select = document.createElement('select');
    select.id = id;
    select.className = 'tracker-activity-answer';
    select.setAttribute('data-day', dayKey);
    select.setAttribute('data-field', id.replace('-answer', ''));
    select.innerHTML = `<option value="">Choose an answer</option>${['yes', 'no'].map(v =>
      `<option value="${v}">${v}</option>`).join('')}`;
    select.addEventListener('change', () => setActivityDurationState(select));
    fields[id] = select;
    row.appendChild(select);
    return row;
  };

  form.appendChild(field('Vigorous activity?', `${dayKey}-vigorous-answer`));
  form.appendChild(field('Moderate activity?', `${dayKey}-moderate-answer`));

  const duration = (label, id, fieldId) => {
    const row = createElement('label', 'activity-tracker-field');
    row.appendChild(createElement('span', 'activity-tracker-label', label));
    const select = document.createElement('select');
    select.id = id;
    select.className = 'tracker-activity-duration';
    select.setAttribute('data-day', dayKey);
    select.setAttribute('data-duration', fieldId);
    select.innerHTML = `<option value="">Choose a duration</option>${['<30 min', '30–60 min', '>1 hr', 'N/A'].map(v =>
      `<option value="${v}">${v}</option>`).join('')}`;
    select.addEventListener('change', () => setActivityDurationState(document.getElementById(`${dayKey}-${fieldId}-answer`)));
    fields[id] = select;
    row.appendChild(select);
    const hint = createElement('p', 'duration-hint', 'Only needed if you answered "yes" above.');
    hint.hidden = true;
    row.appendChild(hint);
    return row;
  };

  form.appendChild(duration('Vigorous activity duration', `${dayKey}-vigorous-duration`, 'vigorous'));
  form.appendChild(duration('Moderate activity duration', `${dayKey}-moderate-duration`, 'moderate'));

  const simple = (label, id) => {
    const row = createElement('label', 'activity-tracker-field');
    row.appendChild(createElement('span', 'activity-tracker-label', label));
    const select = document.createElement('select');
    select.id = id;
    select.className = 'tracker-activity-answer';
    select.setAttribute('data-day', dayKey);
    select.setAttribute('data-field', id.replace('-answer', ''));
    select.innerHTML = `<option value="">Choose an answer</option>${['yes', 'no'].map(v =>
      `<option value="${v}">${v}</option>`).join('')}`;
    fields[id] = select;
    row.appendChild(select);
    return row;
  };

  form.appendChild(simple('Walked at least 10 minutes continuously?', `${dayKey}-walked-answer`));

  const sittingRow = createElement('label', 'activity-tracker-field');
  sittingRow.appendChild(createElement('span', 'activity-tracker-label', 'Sitting time range'));
  const sitting = document.createElement('select');
  sitting.id = `${dayKey}-sitting`;
  sitting.className = 'tracker-activity-answer';
  sitting.setAttribute('data-day', dayKey);
  sitting.setAttribute('data-field', 'sitting_time');
  sitting.innerHTML = `<option value="">Choose a range</option>${['<2 hrs', '2–4 hrs', '5–7 hrs', '>7 hrs'].map(v =>
    `<option value="${v}">${v}</option>`).join('')}`;
  fields[`${dayKey}-sitting`] = sitting;
  sittingRow.appendChild(sitting);
  form.appendChild(sittingRow);

  const feedback = createElement('p', 'activity-tracker-feedback');
  feedback.hidden = true;
  const saveButton = createElement('button', 'action-btn wide-btn', 'Save this day');
  saveButton.type = 'submit';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    feedback.hidden = true;
    try {
      const answer = id => document.getElementById(id)?.value || null;
      const payload = {
        week_start: activityTrackerWeekStart(),
        day: dayKey,
        entry: {
          vigorous: answer(`${dayKey}-vigorous-answer`),
          vigorous_duration: answer(`${dayKey}-vigorous-answer`) === 'yes' ? answer(`${dayKey}-vigorous-duration`) : null,
          moderate: answer(`${dayKey}-moderate-answer`),
          moderate_duration: answer(`${dayKey}-moderate-answer`) === 'yes' ? answer(`${dayKey}-moderate-duration`) : null,
          walked_ten_minutes: answer(`${dayKey}-walked-answer`),
          sitting_time: answer(`${dayKey}-sitting`),
        },
      };
      await api('/physical-activity-tracker', 'PUT', payload);
      feedback.textContent = `✅ ${config.dayLabel} saved.`;
      feedback.hidden = false;
    } catch (err) {
      feedback.textContent = '⚠️ Could not save this day. Please try again.';
      feedback.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  });

  form.appendChild(saveButton);
  form.appendChild(feedback);
  card.appendChild(form);

  // Populate the form with any previously-saved entry for this day.
  // Day 1 (Monday) loads Monday's saved answers, Day 2 (Tuesday) loads
  // Tuesday's, etc — so a participant can fill in each day as the week
  // progresses without overwriting earlier days.
  if (typeof api === 'function' && typeof activityTrackerWeekStart === 'function') {
    (async () => {
      try {
        const saved = await api(`/physical-activity-tracker?week_start=${encodeURIComponent(activityTrackerWeekStart())}`);
        const entry = (saved.daily_entries || {})[dayKey] || {};
        for (const [key, value] of Object.entries(entry)) {
          const select = fields[`${dayKey}-${key}`] || fields[`${dayKey}-${key}-answer`];
          if (select && value) {
            select.value = value;
            setActivityDurationState(select);
          }
        }
      } catch (err) {
        console.warn('[renderActivityTracker/load]', err.message);
      }
    })();
  }

  return card;
}

function getWeeklyQuiz(week, dayNumber) {
  if (dayNumber !== 7) return [];
  const day7 = (week.days || []).find(d => Number(d.dayNumber) === 7);
  if (!day7?.quiz?.questions) return [];
  return day7.quiz.questions.filter(item => Array.isArray(item.options) && item.options.length > 1);
}

function getDailyQuiz(day) {
  const questions = (day.quiz?.questions || day.interactiveActivity?.questions || [])
    .filter(item => Array.isArray(item.options) && item.options.length > 1);
  if (questions.length) return questions;

  const activity = day.interactiveActivity?.instructions
    ?.split('\n')
    .find(line => line.trim())
    ?.trim() || 'today\'s activity';
  const correctAnswer = `Complete ${activity}`;
  return [{
    question: `What should you do to complete Day ${day.dayNumber}'s interactive activity?`,
    options: [correctAnswer, 'Skip the lesson', 'Wait until the end of the programme', 'Ignore today\'s challenge'],
    correctAnswer,
    explanation: 'Completing each daily activity helps you apply what you learned.',
  }];
}

function notificationKey(weekNumber, dayNumber) {
  return `diashield:last-notification:${weekNumber}:${dayNumber}`;
}

function showDayNotification(week, day, force) {
  const message = day.pushNotification || `Week ${week.weekNumber}, Day ${day.dayNumber}: ${day.topic}`;
  const key = notificationKey(week.weekNumber, day.dayNumber);
  if (!force && sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, 'shown');
  triggerBrowserNotificationMock(message, `Week ${week.weekNumber} · Day ${day.dayNumber}`);
}

async function loadModule({ forceNotification = false } = {}) {
  const weekNumber = parseInt(document.getElementById('weekSelector')?.value, 10) || 1;
  const completionButton = document.getElementById('markCompleteBtn');
  if (completionButton) {
    // Reflect whether this week is already complete so the button
    // doesn't invite a re-submission of a week that's already done.
    const alreadyDone = (typeof window.COMPLETED_WEEKS !== 'undefined' &&
      window.COMPLETED_WEEKS.has(weekNumber));
    completionButton.disabled = alreadyDone;
    completionButton.innerHTML = alreadyDone
      ? '<i class="fas fa-check-circle" aria-hidden="true"></i> Already completed ✓'
      : '<i class="fas fa-check-circle" aria-hidden="true"></i> Mark as Complete (+30 pts)';
  }

  const weeks = getCurriculumWeeks(await fetchCurriculumData());
  const week = weeks.find(item => Number(item.weekNumber) === weekNumber);
  if (!week) return renderErrorState(`No content found for Week ${weekNumber}.`);

  const dayNumber = getSelectedDayNumber();
  const day = (week.days || []).find(item => Number(item.dayNumber) === dayNumber) || week.days?.[0];
  if (!day) return renderErrorState(`No content found for Week ${weekNumber}, Day ${dayNumber}.`);

  CURRENT_WEEK = week;

  if (typeof submitMetric === 'function') {
    submitMetric('module_opened', { week: weekNumber, day: day.dayNumber }).catch(error =>
      console.warn('[module_opened]', error.message));
  }

  const moduleElement = document.getElementById('moduleTarget') || document.getElementById('moduleContent');
  if (moduleElement) {
    moduleElement.replaceChildren();
    moduleElement.appendChild(createElement('strong', '', `Week ${week.weekNumber}: ${week.theme || week.title || 'Module'}`));
    appendTextBlock(moduleElement, week.weeklyGoal || week.overview, 'module-week-goal');
    if (Array.isArray(week.learningOutcomes) && week.learningOutcomes.length) {
      const outcomes = createElement('div', 'module-outcomes');
      outcomes.appendChild(createElement('strong', '', '🎯 Weekly Learning Outcomes'));
      const list = createElement('ul');
      week.learningOutcomes.forEach(outcome => list.appendChild(createElement('li', '', outcome)));
      outcomes.appendChild(list);
      moduleElement.appendChild(outcomes);
    }
    moduleElement.appendChild(renderDay(day));
  }

  renderWeeklyQuizCard(week, day.dayNumber);
  showDayNotification(week, day, forceNotification);
}

// These handlers connect the week/day selectors and participant action buttons.
function loadWeekModule() {
  const selector = document.getElementById('daySelector');
  if (selector) selector.value = '1';
  loadModule();
}

function loadDayModule() {
  loadModule();
}

function renderWeeklyQuizCard(week, dayNumber) {
  const element = document.getElementById('quizContent');
  if (!element) return;
  if (dayNumber !== 7) {
    element.replaceChildren();
    element.appendChild(createElement('p', 'quiz-progress', 'Weekly Quiz'));
    element.appendChild(createElement('p', '', 'The weekly quiz is available on Day 7 (Weekly Review). Complete Days 1–6 to unlock it.'));
    return;
  }
  const questions = getWeeklyQuiz(week, dayNumber);
  if (!questions.length) {
    element.replaceChildren();
    element.appendChild(createElement('p', '', 'No quiz available for this week.'));
    return;
  }
  renderQuiz(questions, { weekNumber: week.weekNumber, dayNumber: 7 });
}

function renderErrorState(message) {
  const moduleElement = document.getElementById('moduleTarget') || document.getElementById('moduleContent');
  if (!moduleElement) return;
  moduleElement.replaceChildren();
  const notice = createElement('p', 'module-error-notice', message);
  moduleElement.appendChild(notice);
  // A dead lesson load used to leave the user staring at a static
  // error forever. Give them a way to retry instead of forcing a reload.
  const retry = createElement('button', 'action-btn', 'Retry loading lessons');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    MODULE_CONTENT_CACHE = null;
    loadModule({ forceNotification: true });
  });
  moduleElement.appendChild(retry);
}

function triggerBrowserNotificationMock(messageText, title = 'Dia Shield reminder') {
  let toast = document.getElementById('notificationToastMock');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'notificationToastMock';
    toast.className = 'notification-toast';
    document.body.appendChild(toast);
  }

  const closeButton = createElement('button', 'notification-toast-close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Dismiss notification');
  closeButton.addEventListener('click', dismissNotificationToast);

  toast.replaceChildren(
    createElement('strong', 'notification-toast-title', title),
    createElement('span', 'notification-toast-message', messageText.replace(/^"|"$/g, '')),
    closeButton,
  );
  toast.dataset.notificationVersion = String(Number(toast.dataset.notificationVersion || 0) + 1);
  toast.classList.remove('is-dismissing');
  toast.hidden = false;
  clearTimeout(triggerBrowserNotificationMock.timeout);
  triggerBrowserNotificationMock.timeout = setTimeout(dismissNotificationToast, 4500);
}

function dismissNotificationToast() {
  const toast = document.getElementById('notificationToastMock');
  clearTimeout(triggerBrowserNotificationMock.timeout);
  if (!toast || toast.hidden || toast.classList.contains('is-dismissing')) return;

  const notificationVersion = toast.dataset.notificationVersion;
  toast.classList.add('is-dismissing');
  toast.addEventListener('animationend', () => {
    if (toast.dataset.notificationVersion !== notificationVersion) return;
    toast.hidden = true;
    toast.classList.remove('is-dismissing');
  }, { once: true });
}

function renderQuiz(questions, context, questionIndex = 0, correctCount = 0) {
  const element = document.getElementById('quizContent');
  const question = questions[questionIndex];
  if (!element || !question?.options?.length) return;

  const correctIndex = question.options.findIndex(option => option === question.correctAnswer);
  if (correctIndex < 0) return;

  element.replaceChildren();
  element.appendChild(createElement('p', 'quiz-progress', `Question ${questionIndex + 1} of ${questions.length}`));
  element.appendChild(createElement('p', 'quiz-question', question.question));
  question.options.forEach((option, index) => {
    const button = createElement('button', 'quiz-option', option);
    button.type = 'button';
    button.addEventListener('click', () => answerQuiz(index, correctIndex, button, {
      question,
      questions,
      questionIndex,
      correctCount,
      context,
    }));
    element.appendChild(button);
  });
  const result = createElement('div');
  result.id = 'quizResult';
  element.appendChild(result);
}

async function answerQuiz(chosen, correct, button, state) {
  const options = [...document.querySelectorAll('.quiz-option')];
  options.forEach(option => { option.disabled = true; });
  const isCorrect = chosen === correct;
  button.classList.add(isCorrect ? 'is-correct' : 'is-incorrect');
  if (!isCorrect && options[correct]) options[correct].classList.add('is-correct');
  const result = document.getElementById('quizResult');
  if (result) {
    result.className = isCorrect ? 'is-correct' : 'is-incorrect';
    result.textContent = `${isCorrect ? '✅ Correct! +20 points' : '❌ Incorrect.'}${state.question.explanation ? ` ${state.question.explanation}` : ''}`;
  }
  if (typeof submitMetric === 'function') {
    await submitMetric('quiz', {
      correct: isCorrect,
      week: state.context.weekNumber,
      day: state.context.dayNumber,
      question: state.questionIndex + 1,
      total_questions: state.questions.length,
    });
  }

  const nextButton = createElement('button', 'quiz-next-btn', state.questionIndex + 1 < state.questions.length ? 'Next Question →' : 'View Result');
  nextButton.type = 'button';
  nextButton.addEventListener('click', () => {
    const updatedCorrectCount = state.correctCount + (isCorrect ? 1 : 0);
    if (state.questionIndex + 1 < state.questions.length) {
      renderQuiz(state.questions, state.context, state.questionIndex + 1, updatedCorrectCount);
      return;
    }
    renderQuizCompletion(state.questions.length, updatedCorrectCount, state.context);
  });
  result?.appendChild(nextButton);
}

function renderQuizCompletion(totalQuestions, correctCount, context) {
  const element = document.getElementById('quizContent');
  if (!element) return;
  element.replaceChildren();
  const result = createElement('div', 'quiz-completion');
  result.appendChild(createElement('span', 'quiz-completion-emoji', correctCount === totalQuestions ? '🌟' : '👏'));
  result.appendChild(createElement('strong', '', 'Weekly quiz complete!'));
  result.appendChild(createElement('p', '', `You answered ${correctCount} of ${totalQuestions} correctly.`));
  element.appendChild(result);

  // Finishing the Day 7 quiz closes the week — fire the
  // week's push notification when the curriculum defines one.
  if (context?.dayNumber === 7 && CURRENT_WEEK?.pushNotification) {
    triggerBrowserNotificationMock(
      CURRENT_WEEK.pushNotification,
      `Week ${context.weekNumber} complete`
    );
  }
}

async function markModuleComplete() {
  const weekSelector = document.getElementById('weekSelector');
  const daySelector  = document.getElementById('daySelector');
  const week = parseInt(weekSelector?.value, 10) || 1;
  const day  = parseInt(daySelector?.value, 10)  || 1;
  if (typeof submitMetric !== 'function') return;
  const result = await submitMetric('module', { week });
  if (!result) {
    const button = document.getElementById('markCompleteBtn');
    if (button) button.innerHTML = 'Could not save completion — try again';
    return;
  }
  const button = document.getElementById('markCompleteBtn');
  if (button) {
    button.innerHTML = `<i class="fas fa-check-circle" aria-hidden="true"></i> ${result.already_completed ? 'Already completed ✓' : 'Completed ✓'}`;
    button.disabled = true;
  }

  // Keep the local completed-weeks set in sync so the button state is
  // correct the next time this week is visited, and so the
  // "already completed" check works without a server round-trip.
  if (typeof window !== 'undefined' && typeof window.setCompletedWeeks === 'function') {
    try {
      const data = await window.api('/program/modules-completed');
      window.setCompletedWeeks(data.completed_weeks || []);
    } catch (err) {
      console.warn('[markModuleComplete/modules-completed]', err.message);
      window.COMPLETED_WEEKS = window.COMPLETED_WEEKS || new Set();
      window.COMPLETED_WEEKS.add(week);
    }
  }

  // Auto-advance: move the learner forward to the next day, or — when
  // they close out Day 7 — to Day 1 of the following week. This keeps
  // the flow moving without forcing them to hunt through the dropdowns
  // (the most common "where's my next lesson?" friction point).
  if (!result.already_completed) {
    let nextWeek = week;
    let nextDay  = day + 1;
    if (nextDay > 7) {
      nextDay = 1;
      nextWeek += 1;
    }
    if (nextWeek <= 12 && nextDay <= 7) {
      if (weekSelector) weekSelector.value = String(nextWeek);
      if (daySelector)  daySelector.value  = String(nextDay);
      loadModule();
    } else if (nextWeek > 12) {
      // Closed out the programme — refresh the leaderboard so the
      // newly-earned completion points show up for everyone.
      if (typeof window.loadLeaderboard === 'function') window.loadLeaderboard();
    }
  }
}

function openResource(type, event) {
  event?.preventDefault();
  alert(type === 'infographic' ? '📊 Open the infographic included in today\'s lesson.' : 'Resource loading...');
}
