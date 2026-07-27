// ═══════════════════════════════════════════════════════════════
// LEARNING — Curriculum renderer
// ═══════════════════════════════════════════════════════════════

// Cache curriculum data in memory, local storage, and the service worker for offline lessons.
let MODULE_CONTENT_CACHE = null;

/**
 * Asynchronously fetches curriculum data with Service Worker / Cache Storage fallback.
 */
async function fetchCurriculumData() {
  if (MODULE_CONTENT_CACHE) {
    return MODULE_CONTENT_CACHE;
  }

  try {
    const response = await fetch('curriculum.json');
    if (!response.ok) {
      throw new Error(`Failed to load curriculum.json: ${response.status}`);
    }
    MODULE_CONTENT_CACHE = await response.json();
    localStorage.setItem('dg_curriculum_cache', JSON.stringify(MODULE_CONTENT_CACHE));
    return MODULE_CONTENT_CACHE;
  } catch (error) {
    console.warn('Network request failed. Attempting to load curriculum from Cache Storage...', error);
    
    // Fallback: Check Cache Storage directly if Service Worker is handling it
    if ('caches' in window) {
      const cacheResponse = await caches.match(new URL('curriculum.json', location.href));
      if (cacheResponse) {
        MODULE_CONTENT_CACHE = await cacheResponse.json();
        return MODULE_CONTENT_CACHE;
      }
    }
    const stored = localStorage.getItem('dg_curriculum_cache');
    if (stored) {
      MODULE_CONTENT_CACHE = JSON.parse(stored);
      return MODULE_CONTENT_CACHE;
    }
    return null;
  }
}

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

function appendTextBlock(parent, text, className) {
  if (!text) return;
  const block = createElement('p', className);
  block.style.whiteSpace = 'pre-line';
  block.textContent = text;
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
  if (!title) return null;

  const card = createElement('section', 'infographic-card');
  card.setAttribute('aria-label', `Infographic: ${title}`);
  const image = day.interactiveActivity?.image;
  if (image?.src) {
    const imageElement = document.createElement('img');
    imageElement.className = 'infographic-image';
    imageElement.src = image.src;
    imageElement.alt = image.alt || title;
    imageElement.addEventListener('error', () => imageElement.classList.add('is-missing'));
    card.appendChild(imageElement);
  } else {
    card.appendChild(createElement('span', 'infographic-icon', '📊'));
  }
  const body = createElement('div');
  body.appendChild(createElement('strong', '', title));
  body.appendChild(createElement('p', '', image?.caption || 'Review this infographic, then complete the daily quiz.'));
  card.appendChild(body);
  return card;
}

function renderDay(day) {
  const section = createElement('section', 'module-day');
  section.appendChild(createElement('h4', 'module-day-title', `Day ${day.dayNumber}: ${day.topic || 'Daily lesson'}`));
  appendTextBlock(section, getVisibleDayContent(day), 'module-day-lesson');
  const infographic = renderInfographic(day);
  if (infographic) section.appendChild(infographic);
  return section;
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
  if (typeof userCurrentWeek !== 'undefined' && weekNumber > userCurrentWeek) {
    renderLockedWeekState(weekNumber);
    return;
  }

  const weeks = getCurriculumWeeks(await fetchCurriculumData());
  const week = weeks.find(item => Number(item.weekNumber) === weekNumber);
  if (!week) return renderErrorState(`No content found for Week ${weekNumber}.`);

  const dayNumber = getSelectedDayNumber();
  const day = (week.days || []).find(item => Number(item.dayNumber) === dayNumber) || week.days?.[0];
  if (!day) return renderErrorState(`No content found for Week ${weekNumber}, Day ${dayNumber}.`);

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

  renderQuiz(getDailyQuiz(day), { weekNumber: week.weekNumber, dayNumber: day.dayNumber });
  renderDailyChallenge(week, day);
  renderWeeklyChallenge(week, day);
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

function renderDailyChallenge(week, day) {
  const title = document.getElementById('dailyChallengeTitle');
  const description = document.getElementById('dailyChallengeDesc');
  const button = document.getElementById('completeDailyChallengeBtn');
  if (title) title.textContent = `Day ${day.dayNumber} Challenge`;
  if (description) description.textContent = day.dailyChallenge || 'Complete today\'s lesson and interactive quiz.';
  if (button) {
    button.disabled = false;
    button.dataset.week = week.weekNumber;
    button.dataset.day = day.dayNumber;
    button.innerHTML = '<i class="fas fa-star" aria-hidden="true"></i> Complete Daily Challenge (+20 pts)';
  }
}

function renderWeeklyChallenge(week, day) {
  const title = document.getElementById('challengeTitle');
  const description = document.getElementById('challengeDesc');
  if (title) title.textContent = getBadgeTitle(week.weeklyBadge) || 'Weekly Challenge';
  if (description) description.textContent = week.weeklyChallenge || day.dailyChallenge || 'Complete this week\'s lessons and activities.';
  document.getElementById('challengeFeedback')?.classList.add('hidden');
}

function getBadgeTitle(value) {
  return value?.split('\n').map(line => line.replace(/^"|"$/g, '').trim()).find(Boolean) || '';
}

function renderLockedWeekState(week) {
  const currentWeek = typeof userCurrentWeek !== 'undefined' ? userCurrentWeek : 1;
  const moduleElement = document.getElementById('moduleTarget') || document.getElementById('moduleContent');
  if (moduleElement) moduleElement.textContent = `Week ${week} unlocks once you reach it in the program. You're currently on Week ${currentWeek}.`;
  document.getElementById('quizContent')?.replaceChildren(createElement('p', '', 'Not available yet.'));
}

function renderErrorState(message) {
  const moduleElement = document.getElementById('moduleTarget') || document.getElementById('moduleContent');
  if (moduleElement) moduleElement.textContent = message;
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
    renderQuizCompletion(state.questions.length, updatedCorrectCount);
  });
  result?.appendChild(nextButton);
}

function renderQuizCompletion(totalQuestions, correctCount) {
  const element = document.getElementById('quizContent');
  if (!element) return;
  element.replaceChildren();
  const result = createElement('div', 'quiz-completion');
  result.appendChild(createElement('span', 'quiz-completion-emoji', correctCount === totalQuestions ? '🌟' : '👏'));
  result.appendChild(createElement('strong', '', 'Daily quiz complete!'));
  result.appendChild(createElement('p', '', `You answered ${correctCount} of ${totalQuestions} correctly.`));
  element.appendChild(result);
}

async function markModuleComplete() {
  const week = parseInt(document.getElementById('weekSelector')?.value, 10) || 1;
  if (typeof userCurrentWeek !== 'undefined' && week > userCurrentWeek) return;
  if (typeof submitMetric === 'function') await submitMetric('module', { week });
  const button = document.getElementById('markCompleteBtn');
  if (button) { button.innerHTML = '<i class="fas fa-check-circle"></i> Completed ✓'; button.disabled = true; }
}

async function completeDailyChallenge() {
  const button = document.getElementById('completeDailyChallengeBtn');
  const week = Number(button?.dataset.week);
  const day = Number(button?.dataset.day);
  if (!week || !day || (typeof userCurrentWeek !== 'undefined' && week > userCurrentWeek)) return;
  if (typeof submitMetric === 'function') await submitMetric('daily_challenge', { week, day, badge: `daily_w${week}_d${day}` });
  if (button) { button.innerHTML = '<i class="fas fa-check-circle"></i> Daily Challenge Completed ✓'; button.disabled = true; }
}

async function completeChallenge() {
  const week = parseInt(document.getElementById('weekSelector')?.value, 10) || 1;
  if (typeof userCurrentWeek !== 'undefined' && week > userCurrentWeek) return;
  if (typeof submitMetric === 'function') await submitMetric('weekly_challenge', { week, badge: `weekly_w${week}` });
  if (typeof showFeedback === 'function') showFeedback('challengeFeedback', '🏆 Weekly challenge complete! Your badge has been added.');
}

function openResource(type, event) {
  event?.preventDefault();
  alert(type === 'infographic' ? '📊 Open the infographic included in today\'s lesson.' : 'Resource loading...');
}
