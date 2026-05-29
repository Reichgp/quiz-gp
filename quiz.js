const DATA_FILE = "gp_questions.json";

let settings = {
  show_progress: true,
  shuffle_options: true,
  show_explanation: true,
  shuffle_questions: true
};

let questions = [];
let order = [];
let idx = 0;

let score = 0;
let answered = 0;
let currentAnswered = false;
let lastWasCorrect = false;

// key: question.id  value: { selectedIndex: number, selectedText: string, isCorrect: boolean }
const responses = new Map();

const elStatus = document.getElementById("status");
const elProgress = document.getElementById("progress");
const elQuestion = document.getElementById("question");
const elOptions = document.getElementById("options");
const elResult = document.getElementById("result");
const elExplanation = document.getElementById("explanation");
const elScore = document.getElementById("score");
const elAnswered = document.getElementById("answered");
const elTotal = document.getElementById("total");
const elFails = document.getElementById("fails");

const btnAnswer = document.getElementById("btnAnswer");
const btnNext = document.getElementById("btnNext");
const btnPrev = document.getElementById("btnPrev");
const btnRestart = document.getElementById("btnRestart");

btnAnswer.addEventListener("click", onAnswer);
btnNext.addEventListener("click", onNext);
btnPrev.addEventListener("click", onPrev);
btnRestart.addEventListener("click", restart);

init();

async function init() {
  try {
    elStatus.textContent = "Cargando preguntas…";

    const res = await fetch(DATA_FILE, { cache: "no-store" });
    if (!res.ok) throw new Error(`No se pudo cargar ${DATA_FILE} (HTTP ${res.status})`);

    const data = await res.json();

    if (data.settings && typeof data.settings === "object") {
      settings = { ...settings, ...data.settings };
    }

    if (!Array.isArray(data.questions)) throw new Error("El JSON no contiene 'questions' como array.");

    questions = data.questions.map(q => normalizeQuestion(q));

    // Defensa: si hubiera IDs duplicados, los hacemos únicos sin tocar el contenido
    const seenIds = new Map();
    questions.forEach((qq, i) => {
      const base = qq.id || `q__${i}`;
      const n = (seenIds.get(base) || 0) + 1;
      seenIds.set(base, n);
      if (n > 1) qq.id = `${base}__${n}`;
    });

    order = Array.from({ length: questions.length }, (_, i) => i);
    if (settings.shuffle_questions) shuffleInPlace(order);

    elTotal.textContent = String(questions.length);
    elStatus.textContent = "";
    btnRestart.disabled = false;

    renderQuestion();
  } catch (err) {
    elStatus.textContent = "Error al cargar.";
    elQuestion.textContent = "No se pudo iniciar el test.";
    elOptions.innerHTML = `<div class="muted small">Detalle: ${escapeHtml(err.message)}</div>`;
    btnAnswer.disabled = true;
    btnNext.disabled = true;
    btnPrev.disabled = true;
  }
}

// Si tus preguntas traen explanation en raíz o explicacion en meta:
function normalizeQuestion(q) {
  const question = String(q.question ?? "");
  const options = Array.isArray(q.options) ? q.options.map(String) : [];
  const correct = String(q.correct_answer ?? "");

  // Índice correcto (0..n-1) si viene; si no, se calcula por coincidencia exacta de texto.
  let correct_index =
    (typeof q.correct_index === "number") ? q.correct_index :
    (q.meta && typeof q.meta === "object" && typeof q.meta.correct_index === "number") ? q.meta.correct_index :
    null;

  if (correct_index == null) {
    const idx = options.indexOf(correct);
    correct_index = (idx >= 0) ? idx : null;
  }

  const meta = (q.meta && typeof q.meta === "object") ? q.meta : {};
  const explanation =
    q.explanation != null ? String(q.explanation) :
    meta.explicacion != null ? String(meta.explicacion) :
    "";

  return {
    id: String(q.id ?? ""),
    type: String(q.type ?? "single_choice"),
    question,
    options,
    correct_answer: correct,
    correct_index,
    explanation
  };
}

function renderQuestion() {
  const q = questions[order[idx]];
  const saved = responses.get(q.id);

  currentAnswered = Boolean(saved);
  lastWasCorrect = saved ? saved.isCorrect : false;

  elResult.innerHTML = "";
  elExplanation.style.display = "none";
  elExplanation.textContent = "";

  elQuestion.textContent = q.question || "(Sin enunciado)";
  elOptions.innerHTML = "";

  // progreso
  if (settings.show_progress) {
    elProgress.textContent = `Pregunta ${idx + 1} / ${questions.length}`;
  } else {
    elProgress.textContent = "";
  }

  // opciones (con shuffle opcional)
  // IMPORTANTE: si ya estaba respondida, NO barajar, para que coincida la selección guardada
  let opts = q.options.map((text, origIndex) => ({ text, origIndex }));
  if (!saved && settings.shuffle_options) shuffleInPlace(opts);

  opts.forEach((opt, i) => {
    const id = `opt_${idx}_${i}`;
    const label = document.createElement("label");
    label.className = "opt";
    label.setAttribute("for", id);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "opt";
    input.id = id;

    // Guardamos el índice ORIGINAL (no el texto) para que sea robusto aunque haya barajado
    input.value = String(opt.origIndex);
    input.dataset.text = opt.text;

    // restaurar selección si ya estaba respondida
    if (saved && saved.selectedIndex === opt.origIndex) input.checked = true;

    // si no está respondida, habilita botón responder al seleccionar
    input.addEventListener("change", () => {
      if (!currentAnswered) btnAnswer.disabled = false;
    });

    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + opt.text));
    elOptions.appendChild(label);
  });

  // botones
  btnPrev.disabled = idx === 0;
  btnNext.disabled = !currentAnswered;
  btnAnswer.disabled = true;

  // si ya estaba respondida, mostramos feedback y bloqueamos inputs
  if (saved) {
    showFeedbackForSaved(q, saved);
    document.querySelectorAll('input[name="opt"]').forEach(inp => (inp.disabled = true));
    btnAnswer.disabled = true;
  }

  elStatus.textContent = "";
  updateScoreboard();
}

function showFeedbackForSaved(q, saved) {
  if (saved.isCorrect) {
    elResult.innerHTML = `<span class="ok">Correcta</span>`;
  } else {
    elResult.innerHTML =
      `<span class="bad">Incorrecta</span>` +
      `<div class="muted small" style="margin-top:6px;">Correcta: <strong>${escapeHtml(q.correct_answer)}</strong></div>`;
  }

  if (settings.show_explanation && q.explanation && q.explanation.trim().length > 0) {
    elExplanation.textContent = q.explanation;
    elExplanation.style.display = "block";
  }
}

function onAnswer() {
  if (currentAnswered) return;

  const q = questions[order[idx]];
  const selected = document.querySelector('input[name="opt"]:checked');
  if (!selected) return;

  const selectedIndex = Number(selected.value);
  const selectedText = String(selected.dataset.text ?? "");

  // ✅ CORRECCIÓN: validar por TEXTO (robusto aunque correct_index esté mal en el JSON)
  const isCorrect = (selectedText === q.correct_answer);

  // guardar respuesta para permitir volver atrás sin recontar
  responses.set(q.id, { selectedIndex, selectedText, isCorrect });

  currentAnswered = true;
  answered += 1;
  if (isCorrect) score += 1;

  // feedback
  if (isCorrect) {
    elResult.innerHTML = `<span class="ok">Correcta</span>`;
  } else {
    elResult.innerHTML =
      `<span class="bad">Incorrecta</span>` +
      `<div class="muted small" style="margin-top:6px;">Correcta: <strong>${escapeHtml(q.correct_answer)}</strong></div>`;
  }

  // explicación
  if (settings.show_explanation && q.explanation && q.explanation.trim().length > 0) {
    elExplanation.textContent = q.explanation;
    elExplanation.style.display = "block";
  }

  // bloquear inputs
  document.querySelectorAll('input[name="opt"]').forEach(inp => (inp.disabled = true));

  btnNext.disabled = false;
  btnAnswer.disabled = true;

  updateScoreboard();
}

function onNext() {
  if (!currentAnswered) return;

  if (idx < questions.length - 1) {
    idx += 1;
    renderQuestion();
  } else {
    showEnd();
  }
}

function onPrev() {
  if (idx === 0) return;
  idx -= 1;
  renderQuestion();
}

function showEnd() {
  elStatus.textContent = "";
  elProgress.textContent = settings.show_progress ? `Fin` : "";
  elQuestion.textContent = "Fin del test";
  elOptions.innerHTML = "";

  elResult.innerHTML = `<div><strong>Puntuación:</strong> ${score} / ${questions.length}</div>`;
  elExplanation.style.display = "none";
  elExplanation.textContent = "";

  btnAnswer.disabled = true;
  btnNext.disabled = true;
  btnPrev.disabled = false;

  updateScoreboard();
}

function restart() {
  idx = 0;
  score = 0;
  answered = 0;
  currentAnswered = false;

  responses.clear();

  order = Array.from({ length: questions.length }, (_, i) => i);
  if (settings.shuffle_questions) shuffleInPlace(order);

  elStatus.textContent = "";
  renderQuestion();
}

function updateScoreboard() {
  elScore.textContent = String(score);
  elAnswered.textContent = String(answered);
  elTotal.textContent = String(questions.length);

  const fails = Math.max(0, answered - score);

  // Seguridad: si no existe el elemento, no rompas el test
  if (elFails) {
    elFails.textContent = String(fails);
  } else {
    console.warn("No existe #fails en el HTML");
  }
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
