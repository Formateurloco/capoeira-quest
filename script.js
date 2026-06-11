const STORAGE_KEY = "capoeira_quest_v4_state";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_EARLY_END_MS = 1800;
const SPEECH_RETRY_DELAY_MS = 500;
const SPEECH_MAX_AUTO_RETRIES = 1;
const ACTIVE_SONG_IDS = new Set([
  "song_mare_cheia",
  "song_folha_seca",
  "song_oi_sim_sim",
  "song_abc"
]);

let activeRecognition = null;
let isResettingSession = false;

let state = {
  xp: 0,
  credits: 20,
  streak: 0,
  correctCombo: 0,
  lastDailyCreditDate: null,
  unlockedIndex: 0,
  points: {},
  questionStats: {},
  delayedMistakes: [],
  unlockedLibrary: [],
  currentNodeId: null,
  currentTestNumber: 1,
  currentTestMode: "standard",
  session: [],
  sessionIndex: 0,
  correct: 0,
  answers: []
};

function init() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved) {
    try {
      state = { ...state, ...JSON.parse(saved) };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  PATH.forEach(node => {
    if (!state.points[node.id]) {
      state.points[node.id] = createNodeProgress();
    } else {
      state.points[node.id] = {
        ...createNodeProgress(),
        ...state.points[node.id]
      };

      if (!Array.isArray(state.points[node.id].moduleMistakes)) {
        state.points[node.id].moduleMistakes = [];
      }

      if (state.points[node.id].completed) {
        state.points[node.id].testsPassed = getTestsRequired(node);
      }
    }
  });

  QUESTIONS.forEach(question => {
    if (!state.questionStats[question.id]) {
      state.questionStats[question.id] = { seen: 0, correct: 0, wrong: 0, mastery: 0 };
    }
  });

  applyDailyCredits();
  save();

  if (hasActiveSession()) {
    resumeActiveSession();
  } else {
    renderHome();
  }
}

function createNodeProgress() {
  return {
    best: 0,
    completed: false,
    attempts: 0,
    testsPassed: 0,
    moduleMistakes: []
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function applyDailyCredits() {
  const today = todayKey();

  if (state.lastDailyCreditDate !== today) {
    state.credits += DAILY_CREDITS;
    state.lastDailyCreditDate = today;

    setTimeout(() => {
      const box = document.getElementById("dailyRewardBox");
      if (box) box.classList.remove("hidden");
      showToast(`🎁 +${DAILY_CREDITS} bananes quotidiennes`);
      burstBananas();
    }, 250);
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveBeforeExit() {
  if (isResettingSession) return;

  save();
}

function hasActiveSession() {
  return Boolean(
    state.currentNodeId &&
    Array.isArray(state.session) &&
    state.session.length &&
    state.sessionIndex < state.session.length
  );
}

function resumeActiveSession() {
  const node = PATH.find(item => item.id === state.currentNodeId);

  if (!node) {
    renderHome();
    return;
  }

  advancePastAnsweredQuestions();

  if (state.sessionIndex >= state.session.length) {
    endSession();
    return;
  }

  const progress = state.points[node.id] || createNodeProgress();

  document.getElementById("lessonTitle").textContent =
    `${node.number}. ${node.title}`;

  document.getElementById("lessonSubtitle").textContent =
    getLessonSubtitle(progress, state.currentTestNumber, state.currentTestMode, node);

  showScreen("lessonScreen");
  renderSongCard(node, "compact");
  setLessonPracticeVisible(true);
  showCurrentQuestion();
  showToast("Session reprise automatiquement.");
}

function advancePastAnsweredQuestions() {
  const answeredIds = new Set(state.answers.map(answer => answer.id));

  while (
    state.sessionIndex < state.session.length &&
    answeredIds.has(state.session[state.sessionIndex]?.id)
  ) {
    state.sessionIndex += 1;
  }
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });

  document.getElementById(id).classList.add("active");

  if (id === "libraryScreen") renderLibrary();
}

function renderHome() {
  renderHeader();
  renderProgress();
  renderPath();
  showScreen("homeScreen");
}

function renderHeader() {
  document.getElementById("xp").textContent = state.xp;
  document.getElementById("credits").textContent = state.credits;
  document.getElementById("streak").textContent = state.streak;
}

function renderProgress() {
  const skills = ["chants", "berimbau", "portugais", "culture", "techniques"];

  skills.forEach(skill => {
    const skillQuestions = QUESTIONS.filter(q => q.skill === skill);
    const mastered = skillQuestions.filter(q => state.questionStats[q.id]?.mastery >= 2).length;
    const percent = skillQuestions.length ? Math.round((mastered / skillQuestions.length) * 100) : 0;

    document.getElementById(`progress-${skill}`).style.width = percent + "%";
    document.getElementById(`label-${skill}`).textContent = percent + "% maîtrisé";
  });
}

function renderPath() {
  const map = document.getElementById("pathMap");
  map.innerHTML = `<div class="path-line"></div>`;

  PATH.forEach((node, index) => {
    const button = document.createElement("button");
    const status = getNodeStatus(node, index);

    button.className = `path-node ${status} ${node.kind === "evaluation" ? "eval" : ""}`;
    button.onclick = () => handleNodeClick(node, index);

    const progress = state.points[node.id] || createNodeProgress();
    const best = progress.best || 0;
    const label = node.kind === "evaluation" ? "Éval" : "Leçon";
    const lessonDots = renderLessonDots(node, progress);
    const title = getPathNodeTitle(node);

    button.innerHTML = `
      <div>
        <strong>${node.number}</strong>
        <small>${title}</small>
        ${lessonDots}
        <div class="score">${label}<br>${best}% · 🍌 ${LESSON_COST}</div>
      </div>
    `;

    map.appendChild(button);
  });
}

function getPathNodeTitle(node) {
  if (node.songId) {
    const song = SONGS.find(item => item.id === node.songId);
    if (song) return song.title;
  }

  return node.title.replace(/^Chanson :\s*/, "");
}

function renderLessonDots(node, progress) {
  const total = getTestsRequired(node);
  const passed = progress.completed ? total : Math.min(progress.testsPassed || 0, total);

  return `
    <div class="lesson-dots" aria-label="${passed} leçon${passed > 1 ? "s" : ""} sur ${total}">
      ${Array.from({ length: total }, (_, index) => {
        const isFilled = index < passed;
        return `<span class="${isFilled ? "filled" : ""}"></span>`;
      }).join("")}
    </div>
  `;
}

function getNodeTestLabel(node) {
  const progress = state.points[node.id] || createNodeProgress();
  const testsRequired = getTestsRequired(node);

  if (progress.completed) return `${testsRequired}/${testsRequired}`;
  if (node.kind === "evaluation") return "1 test";

  const nextTest = getNextTestNumber(node.id);
  return `${Math.min(nextTest, testsRequired)}/${testsRequired}`;
}

function getNodeStatus(node, index) {
  if (state.points[node.id]?.completed) return "done";
  if (index <= state.unlockedIndex) return "available";
  return "locked";
}

function handleNodeClick(node, index) {
  if (index > state.unlockedIndex) {
    showToast("🔒 Palier verrouillé. Valide le précédent à 90%.");
    return;
  }

  startNode(node.id);
}

function canSpendCredits() {
  if (state.credits < LESSON_COST) {
    showToast("🍌 Pas assez de bananes. Reviens demain ou échange ton XP.");
    showShop();
    return false;
  }

  return true;
}

function spendLessonCredits() {
  state.credits -= LESSON_COST;
  save();
  renderHeader();
}

function buyCredits() {
  if (state.xp < SHOP_XP_COST) {
    showToast(`⭐ Il faut ${SHOP_XP_COST} XP pour acheter des bananes.`);
    return;
  }

  state.xp -= SHOP_XP_COST;
  state.credits += SHOP_CREDITS_GAIN;
  save();
  renderHeader();
  showToast(`🍌 +${SHOP_CREDITS_GAIN} bananes achetées`);
  burstBananas();
}

function showShop() {
  showScreen("shopScreen");
  renderHeader();
}

function resetSession() {
  const confirmed = window.confirm("Réinitialiser ta session de test ? La progression, les XP et les bananes seront remis à zéro.");

  if (!confirmed) return;

  isResettingSession = true;
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

function startNode(nodeId) {
  if (!canSpendCredits()) return;

  spendLessonCredits();

  const node = PATH.find(item => item.id === nodeId);
  const progress = state.points[nodeId];
  const testNumber = getNextTestNumber(nodeId);
  const testMode = getTestMode(nodeId, testNumber);

  state.currentNodeId = nodeId;
  state.currentTestNumber = testNumber;
  state.currentTestMode = testMode;
  state.sessionIndex = 0;
  state.correct = 0;
  state.answers = [];

  const baseQuestions = getQuestionsForNode(node);
  const reviewQuestions = getDelayedReviewQuestions(nodeId);
  const questionCount = getQuestionCountForNode(node);

  let session = buildModuleTestSession(nodeId, baseQuestions, reviewQuestions, testNumber, testMode);

  state.session = session.slice(0, questionCount);

  if (state.session.length < questionCount) {
    state.session = fillSessionToCount(state.session, baseQuestions, questionCount);
  }

  save();

  document.getElementById("lessonTitle").textContent =
    `${node.number}. ${node.title}`;

  document.getElementById("lessonSubtitle").textContent =
    node.kind === "evaluation"
      ? "Évaluation des 5 paliers précédents. 90% requis."
      : getLessonSubtitle(progress, testNumber, testMode, node);

  showScreen("lessonScreen");

  if (shouldShowSongIntro(node)) {
    showSongIntro(node);
  } else {
    beginLessonQuestions();
  }
}

function shouldShowSongIntro(node) {
  return ACTIVE_SONG_IDS.has(node.songId) && node.kind !== "evaluation";
}

function showSongIntro(node) {
  renderSongCard(node, "intro");
  setLessonPracticeVisible(false);
}

function beginLessonQuestions() {
  const node = PATH.find(item => item.id === state.currentNodeId);

  renderSongCard(node, "compact");
  setLessonPracticeVisible(true);
  showCurrentQuestion();
}

function setLessonPracticeVisible(isVisible) {
  document.getElementById("lessonProgress").classList.toggle("hidden", !isVisible);
  document.getElementById("questionCard").classList.toggle("hidden", !isVisible);
}

function renderSongCard(node, mode = "compact") {
  const card = document.getElementById("songCard");
  const song = SONGS.find(item => item.id === node.songId);

  if (!song || !ACTIVE_SONG_IDS.has(node.songId) || node.kind === "evaluation") {
    card.classList.add("hidden");
    card.innerHTML = "";
    return;
  }

  card.classList.remove("hidden");

  if (mode === "intro") {
    card.classList.add("song-intro");
    card.innerHTML = `
      <div class="song-card-head">
        <span>Écoute et repère</span>
        <strong>${escapeHtml(song.title)}</strong>
      </div>
      <p>${escapeHtml(song.focus)}</p>
      <div class="lyrics">
        ${song.lines.map(line => `<div>${escapeHtml(line)}</div>`).join("")}
      </div>
      <small>${escapeHtml(song.note)}</small>
      <div class="actions">
        <button class="primary" onclick="beginLessonQuestions()">Commencer les exercices</button>
      </div>
    `;
    return;
  }

  card.classList.remove("song-intro");
  card.innerHTML = `
    <div class="song-card-head">
      <span>Chanson du module</span>
      <strong>${escapeHtml(song.title)}</strong>
    </div>
    <p>${escapeHtml(song.focus)}</p>
    <small>Les paroles complètes ont été vues au début. Les exercices se font maintenant sans aide complète.</small>
  `;
}

function getLessonSubtitle(progress, testNumber, testMode, node) {
  const testsRequired = getTestsRequired(node);
  const questionCount = getQuestionCountForNode(node);

  if (testMode === "mistakes") {
    return `Reprise des erreurs du module. 90% requis. Coût : ${LESSON_COST} bananes.`;
  }

  return `${questionCount} questions différentes. 90% requis pour avancer. Coût : ${LESSON_COST} bananes.`;
}

function getNextTestNumber(nodeId) {
  const progress = state.points[nodeId] || createNodeProgress();
  return Math.min(progress.testsPassed + 1, getTestsRequired(nodeId));
}

function getTestsRequired(nodeOrId) {
  const node = typeof nodeOrId === "string"
    ? PATH.find(item => item.id === nodeOrId)
    : nodeOrId;

  if (node?.kind === "evaluation") return 1;
  return node?.testsRequired || TESTS_PER_MODULE;
}

function getQuestionCountForNode(nodeOrId) {
  const node = typeof nodeOrId === "string"
    ? PATH.find(item => item.id === nodeOrId)
    : nodeOrId;

  if (node?.skill === "chants" && node.kind === "lesson") return 15;
  return QUESTIONS_PER_NODE;
}

function getTestMode(nodeId, testNumber) {
  const node = PATH.find(item => item.id === nodeId);
  const progress = state.points[nodeId] || createNodeProgress();
  const testsRequired = getTestsRequired(node);

  if (node?.kind === "evaluation") return "evaluation";
  if (testNumber === testsRequired && progress.moduleMistakes.length) return "mistakes";
  return "standard";
}

function getQuestionsForNode(node) {
  if (node.kind === "evaluation") {
    return QUESTIONS.filter(q => node.includes.includes(q.node));
  }

  if (node.kind === "review") {
    const currentIndex = PATH.findIndex(n => n.id === node.id);
    const previousNodeIds = PATH.slice(0, currentIndex).map(n => n.id);
    return QUESTIONS.filter(q => previousNodeIds.includes(q.node));
  }

  return QUESTIONS.filter(q => q.node === node.id);
}

function getDelayedReviewQuestions(currentNodeId) {
  const currentIndex = PATH.findIndex(n => n.id === currentNodeId);

  return state.delayedMistakes
    .filter(item => item.dueIndex <= currentIndex)
    .map(item => QUESTIONS.find(q => q.id === item.questionId))
    .filter(Boolean);
}

function buildNodeSession(baseQuestions, reviewQuestions) {
  const selectedReviews = shuffle(uniqueById(reviewQuestions)).slice(0, 2);
  const selectedNew = takeUniqueQuestions(shuffle([...baseQuestions]), QUESTIONS_PER_NODE - selectedReviews.length, selectedReviews);
  return shuffle([...selectedNew, ...selectedReviews]);
}

function buildModuleTestSession(nodeId, baseQuestions, reviewQuestions, testNumber, testMode) {
  const questionCount = getQuestionCountForNode(nodeId);

  if (testMode === "mistakes") {
    const progress = state.points[nodeId] || createNodeProgress();
    const mistakes = progress.moduleMistakes
      .map(id => QUESTIONS.find(question => question.id === id))
      .filter(Boolean);

    const selectedMistakes = shuffle(uniqueById(mistakes)).slice(0, questionCount);
    return fillSessionToCount(selectedMistakes, baseQuestions, questionCount);
  }

  if (testMode === "evaluation") {
    return buildNodeSession(baseQuestions, reviewQuestions);
  }

  return buildRotatingNodeSession(baseQuestions, [], testNumber);
}

function buildRotatingNodeSession(baseQuestions, reviewQuestions, testNumber) {
  const selectedReviews = shuffle(uniqueById(reviewQuestions)).slice(0, 2);
  const node = baseQuestions.length
    ? PATH.find(item => item.id === baseQuestions[0].node)
    : null;
  const questionCount = getQuestionCountForNode(node);
  const newLimit = questionCount - selectedReviews.length;
  const offset = ((testNumber - 1) * newLimit) % Math.max(1, baseQuestions.length);
  const rotatedQuestions = rotateArray(baseQuestions, offset);
  const selectedNew = takeUniqueQuestions(rotatedQuestions, newLimit, selectedReviews);

  return shuffle([...selectedNew, ...selectedReviews]);
}

function fillSessionToCount(session, baseQuestions, count = QUESTIONS_PER_NODE) {
  const result = [...session];
  const source = baseQuestions.length ? baseQuestions : QUESTIONS;

  for (const question of shuffle([...source])) {
    if (result.length >= count) break;
    if (!result.some(item => item.id === question.id)) {
      result.push(question);
    }
  }

  return result;
}

function takeUniqueQuestions(source, limit, excluded = []) {
  const excludedIds = new Set(excluded.map(question => question.id));
  const selected = [];

  for (const question of source) {
    if (selected.length >= limit) break;
    if (!excludedIds.has(question.id) && !selected.some(item => item.id === question.id)) {
      selected.push(question);
    }
  }

  return selected;
}

function showCurrentQuestion() {
  const question = state.session[state.sessionIndex];

  document.getElementById("questionCounter").textContent =
    `${state.sessionIndex + 1}/${state.session.length}`;

  document.getElementById("scoreCounter").textContent =
    `Score : ${state.correct}`;

  document.getElementById("lessonBar").style.width =
    `${Math.round((state.sessionIndex / state.session.length) * 100)}%`;

  document.getElementById("questionKind").textContent = getTypeLabel(question.type);
  document.getElementById("comboBadge").textContent = `Combo x${state.correctCombo}`;
  document.getElementById("questionText").textContent = question.question;
  document.getElementById("feedback").textContent = "";
  document.getElementById("feedback").className = "feedback";

  resetQuestionUI();

  if (question.type === "mcq") renderMCQ(question);
  if (question.type === "hole") renderHole(question);
  if (question.type === "order") renderOrder(question);
  if (question.type === "match") renderMatch(question);
  if (question.type === "speak") renderSpeak(question);
}

function resetQuestionUI() {
  if (activeRecognition) {
    activeRecognition.abort();
    activeRecognition = null;
  }

  ["holeBox", "orderBox", "matchBox", "speakBox"].forEach(id => {
    document.getElementById(id).innerHTML = "";
    document.getElementById(id).classList.add("hidden");
  });

  document.getElementById("choicesBox").innerHTML = "";
  document.getElementById("validateBtn").classList.add("hidden");
  document.getElementById("nextBtn").classList.add("hidden");
}

function getTypeLabel(type) {
  const labels = {
    mcq: "Quiz",
    hole: "Texte à trou",
    order: "Remettre dans l’ordre",
    match: "Associer",
    speak: "Écris"
  };

  return labels[type] || "Exercice";
}

function renderMCQ(question) {
  const box = document.getElementById("choicesBox");

  shuffle([...question.choices]).forEach(choice => {
    const button = document.createElement("button");
    button.className = "choice";
    button.textContent = choice;
    button.onclick = () => answerMCQ(question, choice, button);
    box.appendChild(button);
  });
}

function renderHole(question) {
  const box = document.getElementById("holeBox");
  box.classList.remove("hidden");

  let html = question.text.replaceAll("\n", "<br>");

  question.holes.forEach((hole, index) => {
    const options = shuffle([...hole.choices])
      .map(choice => `<option value="${choice}">${choice}</option>`)
      .join("");

    html = html.replace(
      `{${hole.answer}}`,
      `<select class="hole-select" data-index="${index}">
        <option value="">...</option>
        ${options}
      </select>`
    );
  });

  box.innerHTML = html;
  document.getElementById("validateBtn").classList.remove("hidden");
}

function renderOrder(question) {
  const box = document.getElementById("orderBox");
  box.classList.remove("hidden");

  const shuffled = shuffle([...question.lines]);

  box.innerHTML = question.correct.map((_, index) => {
    const options = shuffled
      .map(line => `<option value="${escapeHtml(line)}">${line}</option>`)
      .join("");

    return `
      <div class="order-line">
        ${index + 1}.
        <select class="order-select" data-index="${index}">
          <option value="">Choisir une ligne</option>
          ${options}
        </select>
      </div>
    `;
  }).join("");

  document.getElementById("validateBtn").classList.remove("hidden");
}

function renderMatch(question) {
  const box = document.getElementById("matchBox");
  box.classList.remove("hidden");

  const rightValues = shuffle(question.pairs.map(pair => pair[1]));

  box.innerHTML = question.pairs.map((pair, index) => {
    const options = rightValues
      .map(value => `<option value="${escapeHtml(value)}">${value}</option>`)
      .join("");

    return `
      <div class="match-line">
        <strong>${pair[0]}</strong> →
        <select class="match-select" data-index="${index}">
          <option value="">Choisir</option>
          ${options}
        </select>
      </div>
    `;
  }).join("");

  document.getElementById("validateBtn").classList.remove("hidden");
}

function renderSpeak(question) {
  const box = document.getElementById("speakBox");
  box.classList.remove("hidden");

  const canListen = Boolean(SpeechRecognition);

  box.innerHTML = `
    <div class="speak-target">
      <span>Écris la ligne. Les accents ne comptent pas.</span>
      <strong>${escapeHtml(question.prompt || question.answer)}</strong>
    </div>
    <input
      id="speechWrittenAnswer"
      class="speech-written-answer"
      type="text"
      autocomplete="off"
      placeholder="Écris la phrase ici"
      onkeydown="handleWrittenSpeechKey(event)"
    />
    <div class="speech-actions">
      <button class="mic-btn" type="button" ${canListen ? "" : "disabled"} onclick="startSpeechQuestion()">
        <span aria-hidden="true">🎙️</span>
        <strong>${canListen ? "Dicter au micro" : "Micro non disponible"}</strong>
      </button>
    </div>
    <p id="speechTranscript" class="speech-transcript">
      ${canListen ? "Tu peux écrire directement ou dicter au micro." : "Écris la phrase pour valider."}
    </p>
  `;

  document.getElementById("validateBtn").classList.remove("hidden");
  setTimeout(() => document.getElementById("speechWrittenAnswer")?.focus(), 0);
}

function startSpeechQuestion(retryCount = 0) {
  const question = state.session[state.sessionIndex];
  const transcriptBox = document.getElementById("speechTranscript");

  if (!SpeechRecognition) {
    transcriptBox.textContent = "Reconnaissance vocale indisponible sur ce navigateur.";
    return;
  }

  if (activeRecognition) {
    activeRecognition.abort();
    activeRecognition = null;
  }

  const recognition = new SpeechRecognition();
  activeRecognition = recognition;
  recognition.lang = question.lang || "pt-BR";
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  const button = document.querySelector(".mic-btn");
  let startedAt = 0;
  let hasResult = false;
  let isFinished = false;
  const questionId = question.id;

  button.classList.add("listening");
  transcriptBox.textContent = retryCount
    ? "Le micro est prêt. Parle maintenant..."
    : "Autorise le micro si demandé, puis parle après le signal.";

  recognition.onstart = () => {
    startedAt = Date.now();
    transcriptBox.textContent = "Je t'écoute...";
  };

  recognition.onresult = event => {
    const results = Array.from(event.results);
    const transcript = results
      .flatMap(result => Array.from(result).map(alternative => alternative.transcript))
      .join(" ")
      .trim();

    if (!transcript) return;

    transcriptBox.textContent = `Entendu : ${transcript}`;

    if (!results.some(result => result.isFinal)) return;

    hasResult = true;
    isFinished = true;

    const input = document.getElementById("speechWrittenAnswer");
    if (input) input.value = transcript;

    button.classList.remove("listening");
    activeRecognition = null;
    transcriptBox.textContent = "J'ai rempli le champ. Tu peux corriger si besoin puis valider.";
  };

  recognition.onerror = event => {
    if (event.error === "aborted") return;

    const elapsed = startedAt ? Date.now() - startedAt : 0;
    const endedTooSoon = !hasResult && elapsed < SPEECH_EARLY_END_MS;

    button.classList.remove("listening");
    activeRecognition = null;

    if (
      state.session[state.sessionIndex]?.id === questionId &&
      retryCount < SPEECH_MAX_AUTO_RETRIES &&
      (endedTooSoon || event.error === "no-speech")
    ) {
      transcriptBox.textContent = "Le micro vient de s'activer. Je relance la dictée...";
      setTimeout(() => {
        if (state.session[state.sessionIndex]?.id === questionId) {
          startSpeechQuestion(retryCount + 1);
        }
      }, SPEECH_RETRY_DELAY_MS);
      return;
    }

    transcriptBox.textContent = getSpeechErrorMessage(event.error);
  };

  recognition.onend = () => {
    button.classList.remove("listening");

    if (!isFinished && activeRecognition === recognition) {
      activeRecognition = null;
      transcriptBox.textContent = "Je n'ai rien entendu. Tu peux écrire la réponse au clavier.";
    }
  };

  try {
    recognition.start();
  } catch {
    button.classList.remove("listening");
    activeRecognition = null;
    transcriptBox.textContent = "Le micro n'a pas démarré. Tu peux écrire la réponse au clavier.";
  }
}

function getSpeechErrorMessage(error) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Le micro est refusé. Tu peux écrire la réponse au clavier.";
  }

  if (error === "audio-capture") {
    return "Je ne trouve pas de micro. Tu peux écrire la réponse au clavier.";
  }

  return "Je n'ai pas pu entendre clairement. Tu peux corriger au clavier puis valider.";
}

function handleWrittenSpeechKey(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    validateCurrentQuestion();
  }
}

function isWrittenSpeechAnswerCorrect(transcript, question) {
  const expected = [question.answer, ...(question.accept || [])].map(normalizeSpeech);
  const heard = normalizeSpeech(transcript);

  if (!heard) return false;

  return expected.some(answer => {
    if (!answer) return false;
    const isCloseFragment = answer.includes(heard) && heard.length >= Math.max(3, Math.floor(answer.length * 0.65));
    return heard.includes(answer) || isCloseFragment || similarityScore(heard, answer) >= 0.72;
  });
}

function normalizeSpeech(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(a, b) {
  const aWords = new Set(a.split(" ").filter(Boolean));
  const bWords = new Set(b.split(" ").filter(Boolean));
  const shared = [...aWords].filter(word => bWords.has(word)).length;
  const total = new Set([...aWords, ...bWords]).size;
  return total ? shared / total : 0;
}

function answerMCQ(question, choice, selectedButton) {
  const isCorrect = choice === question.answer;

  document.querySelectorAll(".choice").forEach(button => {
    button.disabled = true;

    if (button.textContent === question.answer) {
      button.classList.add("correct");
    }
  });

  if (!isCorrect) selectedButton.classList.add("wrong");

  finishAnswer(question, isCorrect, choice, question.answer);
}

function validateCurrentQuestion() {
  const question = state.session[state.sessionIndex];

  if (question.type === "hole") validateHole(question);
  if (question.type === "order") validateOrder(question);
  if (question.type === "match") validateMatch(question);
  if (question.type === "speak") validateSpeak(question);
}

function validateSpeak(question) {
  if (activeRecognition) {
    activeRecognition.abort();
    activeRecognition = null;
  }

  const input = document.getElementById("speechWrittenAnswer");
  const value = input?.value.trim() || "";
  const isCorrect = isWrittenSpeechAnswerCorrect(value, question);

  if (input) {
    input.disabled = true;
    input.style.borderColor = isCorrect ? "var(--green)" : "var(--red)";
    input.style.background = isCorrect ? "#dcfce7" : "#fee2e2";
  }

  document.querySelector(".mic-btn")?.setAttribute("disabled", "disabled");
  finishAnswer(question, isCorrect, value || "vide", question.answer);
}

function validateHole(question) {
  let isCorrect = true;
  const userAnswers = [];

  document.querySelectorAll(".hole-select").forEach(select => {
    const index = Number(select.dataset.index);
    const expected = question.holes[index].answer;
    const value = select.value || "vide";

    userAnswers.push(value);

    if (value === expected) {
      select.style.borderColor = "var(--green)";
      select.style.background = "#dcfce7";
    } else {
      select.style.borderColor = "var(--red)";
      select.style.background = "#fee2e2";
      isCorrect = false;
    }

    select.disabled = true;
  });

  const expected = question.holes.map(hole => hole.answer).join(", ");
  finishAnswer(question, isCorrect, userAnswers.join(", "), expected);
}

function validateOrder(question) {
  let isCorrect = true;
  const userAnswers = [];

  document.querySelectorAll(".order-select").forEach(select => {
    const index = Number(select.dataset.index);
    const expected = question.correct[index];
    const value = select.value || "vide";

    userAnswers.push(value);

    if (value === expected) {
      select.style.borderColor = "var(--green)";
      select.style.background = "#dcfce7";
    } else {
      select.style.borderColor = "var(--red)";
      select.style.background = "#fee2e2";
      isCorrect = false;
    }

    select.disabled = true;
  });

  finishAnswer(question, isCorrect, userAnswers.join(" / "), question.correct.join(" / "));
}

function validateMatch(question) {
  let isCorrect = true;
  const userAnswers = [];

  document.querySelectorAll(".match-select").forEach(select => {
    const index = Number(select.dataset.index);
    const expected = question.pairs[index][1];
    const value = select.value || "vide";

    userAnswers.push(`${question.pairs[index][0]}=${value}`);

    if (value === expected) {
      select.style.borderColor = "var(--green)";
      select.style.background = "#dcfce7";
    } else {
      select.style.borderColor = "var(--red)";
      select.style.background = "#fee2e2";
      isCorrect = false;
    }

    select.disabled = true;
  });

  const expected = question.pairs.map(pair => `${pair[0]}=${pair[1]}`).join(" / ");
  finishAnswer(question, isCorrect, userAnswers.join(" / "), expected);
}

function finishAnswer(question, isCorrect, userAnswer, expectedAnswer) {
  const stat = state.questionStats[question.id];

  stat.seen += 1;

  if (isCorrect) {
    stat.correct += 1;
    stat.mastery = Math.min(3, stat.mastery + 1);
    state.correct += 1;
    state.correctCombo += 1;
    const xpGain = getCorrectAnswerXpGain();
    state.xp += xpGain;
    removeDelayedMistake(question.id);

    if (question.unlock && !state.unlockedLibrary.includes(question.unlock)) {
      state.unlockedLibrary.push(question.unlock);
    }

    const reward = maybeComboCreditReward();
    const feedback = document.getElementById("feedback");
    const xpLabel = xpGain > XP_PER_CORRECT ? ` +${xpGain} XP bonus x2.` : "";
    feedback.className = "feedback success pop";
    feedback.textContent =
      reward
        ? `Boa ! Combo x3 : +${reward} bananes bonus.${xpLabel} ${question.explanation}`
        : `Boa !${xpLabel} ${question.explanation}`;

    if (reward) burstBananas();
  } else {
    stat.wrong += 1;
    stat.mastery = Math.max(0, stat.mastery - 1);
    state.correctCombo = 0;
    rememberModuleMistake(question.id);
    scheduleMistake(question.id);

    const feedback = document.getElementById("feedback");
    feedback.className = "feedback error shake";
    feedback.textContent = `À revoir plus tard. ${question.explanation}`;
  }

  state.answers.push({ id: question.id, ok: isCorrect, userAnswer, expectedAnswer });

  save();
  renderHeader();

  document.getElementById("comboBadge").textContent = `Combo x${state.correctCombo}`;
  document.getElementById("scoreCounter").textContent = `Score : ${state.correct}`;
  document.getElementById("validateBtn").classList.add("hidden");
  document.getElementById("nextBtn").classList.remove("hidden");
}

function rememberModuleMistake(questionId) {
  const progress = state.points[state.currentNodeId];

  if (!progress || progress.moduleMistakes.includes(questionId)) return;

  progress.moduleMistakes.push(questionId);
}

function getCorrectAnswerXpGain() {
  if (state.correctCombo > 0 && state.correctCombo % XP_DOUBLE_COMBO_INTERVAL === 0) {
    return XP_PER_CORRECT * 2;
  }

  return XP_PER_CORRECT;
}

function maybeComboCreditReward() {
  if (state.correctCombo > 0 && state.correctCombo % 3 === 0) {
    const bonus = Math.floor(Math.random() * (COMBO_REWARD_MAX - COMBO_REWARD_MIN + 1)) + COMBO_REWARD_MIN;
    state.credits += bonus;
    return bonus;
  }

  return 0;
}

function scheduleMistake(questionId) {
  const currentIndex = PATH.findIndex(node => node.id === state.currentNodeId);
  const existing = state.delayedMistakes.find(item => item.questionId === questionId);

  if (existing) {
    existing.dueIndex = Math.min(PATH.length - 1, currentIndex + 1);
    existing.count += 1;
  } else {
    state.delayedMistakes.push({
      questionId,
      dueIndex: Math.min(PATH.length - 1, currentIndex + 1),
      count: 1
    });
  }
}

function removeDelayedMistake(questionId) {
  state.delayedMistakes = state.delayedMistakes.filter(item => item.questionId !== questionId);
}

function nextQuestion() {
  state.sessionIndex += 1;
  save();

  if (state.sessionIndex >= state.session.length) {
    endSession();
  } else {
    showCurrentQuestion();
  }
}

function endSession() {
  const node = PATH.find(item => item.id === state.currentNodeId);
  const percent = Math.round((state.correct / state.session.length) * 100);
  const nodeState = state.points[node.id];
  const testsRequired = getTestsRequired(node);

  nodeState.attempts += 1;
  nodeState.best = Math.max(nodeState.best, percent);

  const passed = percent >= PASS_PERCENT;
  let moduleCompleted = false;
  let needsMistakeReview = false;

  if (passed) {
    if (node.kind === "evaluation") {
      moduleCompleted = completeNode(node);
    } else {
      nodeState.testsPassed = Math.max(nodeState.testsPassed, state.currentTestNumber);
      clearPassedMistakesFromModule(nodeState);

      if (nodeState.testsPassed >= testsRequired || (nodeState.testsPassed >= testsRequired - 1 && !nodeState.moduleMistakes.length)) {
        moduleCompleted = completeNode(node);
      } else {
        needsMistakeReview = getNextTestNumber(node.id) === testsRequired && nodeState.moduleMistakes.length;
      }
    }
  }

  save();
  showResult(percent, passed, moduleCompleted, needsMistakeReview);
}

function clearPassedMistakesFromModule(nodeState) {
  const passedQuestionIds = state.answers
    .filter(answer => answer.ok)
    .map(answer => answer.id);

  nodeState.moduleMistakes = nodeState.moduleMistakes.filter(id => !passedQuestionIds.includes(id));
}

function completeNode(node) {
  const nodeState = state.points[node.id];

  if (!nodeState.completed) {
    nodeState.completed = true;
    nodeState.testsPassed = getTestsRequired(node);
    nodeState.moduleMistakes = [];

    const currentIndex = PATH.findIndex(item => item.id === node.id);

    if (currentIndex === state.unlockedIndex && state.unlockedIndex < PATH.length - 1) {
      state.unlockedIndex += 1;
    }

    state.streak += 1;
  }

  return true;
}

function showResult(percent, passed, moduleCompleted, needsMistakeReview) {
  showScreen("resultScreen");
  renderHeader();

  const retryButton = document.getElementById("retryBtn");
  const testsRequired = getTestsRequired(state.currentNodeId);

  if (moduleCompleted) {
    document.getElementById("resultTitle").textContent = "Module validé 🎉";
    document.getElementById("resultText").textContent = "Tous les tests nécessaires sont validés. Le module suivant est débloqué.";
    retryButton.textContent = `Rejouer · ${LESSON_COST} bananes`;
  } else if (passed) {
    document.getElementById("resultTitle").textContent = needsMistakeReview ? "Erreurs à reprendre" : "Test validé";
    document.getElementById("resultText").textContent = needsMistakeReview
      ? "Il reste un test final avec les erreurs du module avant validation."
      : `Test ${state.currentTestNumber}/${testsRequired} validé. Continue pour valider le module.`;
    retryButton.textContent = `Test suivant · ${LESSON_COST} bananes`;
  } else {
    document.getElementById("resultTitle").textContent = "Test à recommencer";
    document.getElementById("resultText").textContent = "Il faut 90%. Les erreurs restent dans le test de rattrapage du module.";
    retryButton.textContent = `Recommencer · ${LESSON_COST} bananes`;
  }

  retryButton.classList.toggle("hidden", false);

  document.getElementById("resultPercent").textContent = `${percent}%`;

  const mistakes = state.answers.filter(answer => !answer.ok);
  const box = document.getElementById("mistakesBox");

  if (!mistakes.length) {
    box.innerHTML = "<p>Aucune erreur sur cette session.</p>";
    return;
  }

  box.innerHTML = `
    <h3>Erreurs à revoir plus tard</h3>
    ${mistakes.map(answer => {
      const question = QUESTIONS.find(q => q.id === answer.id);
      return `
        <div class="mistake">
          <strong>${question.question}</strong><br>
          <small>Ta réponse : ${answer.userAnswer}</small><br>
          <small>Attendu : ${answer.expectedAnswer}</small>
        </div>
      `;
    }).join("")}
  `;
}

function retryLesson() {
  startNode(state.currentNodeId);
}

function goHome() {
  renderHome();
}

function showLibrary() {
  renderLibrary();
  showScreen("libraryScreen");
}

function renderLibrary() {
  const list = document.getElementById("libraryList");

  list.innerHTML = LIBRARY.map(item => {
    const unlocked = state.unlockedLibrary.includes(item.id);

    return `
      <article class="library-item ${unlocked ? "" : "locked"}">
        <h3>${unlocked ? "✅" : "🔒"} ${item.title}</h3>
        <p>${unlocked ? item.text : "Notion non débloquée pour le moment."}</p>
        <small>${item.skill}</small>
      </article>
    `;
  }).join("");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.remove("toast-pop");
  void toast.offsetWidth;
  toast.classList.add("toast-pop");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2400);
}

function burstBananas() {
  const burst = document.createElement("div");
  burst.className = "banana-burst";
  const count = window.matchMedia("(max-width: 720px)").matches ? 10 : 14;

  for (let index = 0; index < count; index += 1) {
    const item = document.createElement("span");
    item.textContent = "🍌";
    item.style.setProperty("--x", `${Math.random() * 180 - 90}px`);
    item.style.setProperty("--r", `${Math.random() * 120 - 60}deg`);
    item.style.animationDelay = `${index * 24}ms`;
    burst.appendChild(item);
  }

  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1200);
}

function uniqueById(items) {
  const map = new Map();
  items.forEach(item => map.set(item.id, item));
  return [...map.values()];
}

function rotateArray(items, offset) {
  if (!items.length) return [];
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.addEventListener("pagehide", saveBeforeExit);
window.addEventListener("beforeunload", saveBeforeExit);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveBeforeExit();
});

init();
