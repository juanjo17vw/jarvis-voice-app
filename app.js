// Configuración
const GATEWAY_URL = 'https://jarvis-api.juanjojimenez89.workers.dev';
const KEYWORD = 'jarvis';
const SILENCE_MS = 1500;   // pausa que da la pregunta por terminada
const QUESTION_TIMEOUT_MS = 10000; // máximo esperando una pregunta

// Estados: 'idle' | 'question' | 'processing' | 'speaking' | 'paused'
let state = 'idle';
let recognition;
let recognizing = false;
let questionText = '';
let silenceTimer = null;
let questionTimer = null;

const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const outputEl = document.getElementById('output');
const responseTextEl = document.getElementById('responseText');

const LISTENING_MSG = '🎧 Escuchando la palabra clave <span class="keyword">Jarvis</span>';

// Acuses de recibo inmediatos al detectar la palabra clave
const acks = [
  '¿En qué puedo ayudarle, señor?',
  'A sus órdenes, señor.',
  '¿Qué necesita señor?',
  'Aquí estoy señor, ¿qué desea?',
  'Estoy listo para asistirle.',
];

// Normaliza para comparar sin acentos ni mayúsculas
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function updateStatus(text, className = '') {
  statusEl.innerHTML = text;
  statusEl.className = 'status ' + className;
}

function displayResponse(text) {
  outputEl.classList.add('show');
  responseTextEl.textContent = text;
}

// --- Control del reconocimiento -------------------------------------------

function startRecognition() {
  if (recognizing || state === 'paused') return;
  try {
    recognition.start();
  } catch (err) {
    // start() lanza InvalidStateError si ya estaba arrancando; se reintenta en onend
    console.warn('start() ignorado:', err.message);
  }
}

function stopRecognition() {
  if (!recognizing) return;
  recognition.stop();
}

function clearTimers() {
  clearTimeout(silenceTimer);
  clearTimeout(questionTimer);
  silenceTimer = null;
  questionTimer = null;
}

// Vuelve a esperar la palabra clave
function backToIdle() {
  clearTimers();
  questionText = '';
  state = 'idle';
  updateStatus(LISTENING_MSG, 'listening');
  startRecognition();
}

// --- Ciclo de conversación -------------------------------------------------

function init() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateStatus('❌ Reconocimiento de voz no disponible en este navegador', 'error');
    startBtn.textContent = 'No disponible';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    recognizing = true;
  };

  recognition.onresult = handleResult;

  recognition.onerror = (event) => {
    console.error('Error de reconocimiento:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      state = 'paused';
      updateStatus('❌ Permiso de micrófono denegado', 'error');
      startBtn.textContent = 'Reintentar';
    }
    // 'no-speech' y 'aborted' son normales: onend se encarga de reanudar
  };

  recognition.onend = () => {
    recognizing = false;
    // Solo reanudamos mientras esperamos palabra clave o pregunta.
    // Durante processing/speaking el micro queda cerrado para no oírse a sí mismo.
    if (state === 'idle' || state === 'question') {
      setTimeout(startRecognition, 300);
    }
  };

  startBtn.disabled = false;
  startBtn.textContent = 'Pausar';
  backToIdle();
}

function handleResult(event) {
  let interim = '';
  let final = '';

  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    if (result.isFinal) {
      final += result[0].transcript;
    } else {
      interim += result[0].transcript;
    }
  }

  if (state === 'idle') {
    if (normalize(interim + final).includes(KEYWORD)) {
      onKeywordDetected();
    }
    return;
  }

  if (state === 'question') {
    if (final) questionText += ' ' + final;

    // Cada vez que se oye algo se reinicia la cuenta de silencio
    clearTimeout(silenceTimer);
    if (questionText.trim() || interim) {
      silenceTimer = setTimeout(submitQuestion, SILENCE_MS);
    }
  }
}

function onKeywordDetected() {
  state = 'processing';
  stopRecognition();

  const ack = acks[Math.floor(Math.random() * acks.length)];
  displayResponse(ack);
  updateStatus('🔊 ' + ack, 'processing');

  speak(ack).then(() => {
    // Tras el acuse, escuchamos la pregunta
    questionText = '';
    state = 'question';
    updateStatus('🎤 Le escucho, señor...', 'recording');
    startRecognition();

    questionTimer = setTimeout(() => {
      if (state === 'question' && !questionText.trim()) {
        stopRecognition();
        backToIdle();
      }
    }, QUESTION_TIMEOUT_MS);
  });
}

async function submitQuestion() {
  const question = questionText.replace(new RegExp(KEYWORD, 'gi'), '').trim();
  clearTimers();

  if (!question) {
    backToIdle();
    return;
  }

  state = 'processing';
  stopRecognition();
  updateStatus('⏳ Procesando...', 'processing');
  displayResponse('«' + question + '»');

  let reply;
  try {
    const response = await fetch(`${GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: question }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    reply = data.message || 'No he recibido respuesta, señor.';
  } catch (err) {
    console.error('Error consultando el gateway:', err);
    reply = 'Lo siento señor, no he podido contactar con el servidor.';
  }

  displayResponse(reply);
  updateStatus('🔊 Respondiendo...', 'processing');
  await speak(reply);
  backToIdle();
}

// --- Audio -----------------------------------------------------------------

// Reproduce texto por el gateway; si falla, usa la voz del navegador.
// Siempre resuelve, para que el ciclo nunca se quede bloqueado.
async function speak(text) {
  state = 'speaking';
  try {
    const response = await fetch(`${GATEWAY_URL}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    await playAudio(url);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error de audio, usando voz local:', err);
    await speakLocally(text);
  }
}

function playAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
  });
}

function speakLocally(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

// --- Controles -------------------------------------------------------------

startBtn.addEventListener('click', () => {
  if (state === 'paused') {
    startBtn.textContent = 'Pausar';
    backToIdle();
  } else {
    state = 'paused';
    clearTimers();
    stopRecognition();
    startBtn.textContent = 'Reanudar';
    updateStatus('⏸️ Pausado', '');
  }
});

window.addEventListener('load', init);
