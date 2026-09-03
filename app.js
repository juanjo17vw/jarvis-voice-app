// Configuración
const GATEWAY_URL = 'https://jarvis-api.juanjojimenez89.workers.dev';
const KEYWORD = 'jarvis';

// Errores de los que no se sale reintentando: insistir solo gasta batería
const FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture'];
const RESTART_DELAY = 500;
const MAX_RESTART_DELAY = 10000;
// Si la respuesta se queda colgada, volvemos a escuchar igualmente
const SPEAK_TIMEOUT = 15000;

const LISTENING_HTML = '🎧 Escuchando la palabra clave <span class="keyword">Jarvis</span>';

let recognition;
let isListening = true;
let isSpeaking = false;
let isStopped = false;
let restartDelay = RESTART_DELAY;
let speakWatchdog = null;

const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const outputEl = document.getElementById('output');
const responseTextEl = document.getElementById('responseText');

// Respuestas predefinidas
const responses = [
  '¿En qué puedo ayudarle, señor?',
  'A sus órdenes, señor.',
  '¿Qué necesita señor?',
  'Aquí estoy señor, ¿qué desea?',
  'Estoy listo para asistirle.',
];

// Inicializar
function init() {
  try {
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      console.log('Iniciado');
      restartDelay = RESTART_DELAY;
      startBtn.disabled = false;
      startBtn.textContent = 'Pausar';
      updateStatus(LISTENING_HTML, 'listening');
    };

    recognition.onresult = (event) => {
      let transcript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript.toLowerCase();
      }

      // Detectar palabra clave
      if (transcript.includes(KEYWORD) && !isSpeaking) {
        console.log('Palabra clave detectada');
        isSpeaking = true;
        recognition.stop();

        // Responder después de 500ms
        setTimeout(() => {
          const response = responses[Math.floor(Math.random() * responses.length)];
          respond(response);
        }, 500);
      }
    };

    recognition.onerror = (event) => {
      console.error('Error:', event.error);

      if (FATAL_ERRORS.includes(event.error)) {
        // Sin micrófono o sin permiso: parar y dejar que el usuario reintente
        haltWith(errorMessage(event.error));
      } else if (event.error !== 'no-speech') {
        // Fallo transitorio (red, aborto): espaciar los reintentos
        restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY);
      }
    };

    recognition.onend = () => {
      console.log('Terminado');
      if (isStopped || !isListening || isSpeaking) return;
      setTimeout(safeStart, restartDelay);
    };

    safeStart();
  } catch (err) {
    console.error('Error:', err);
    updateStatus('❌ Error: Reconocimiento no disponible', 'error');
  }
}

// recognition.start() lanza InvalidStateError si ya estaba escuchando
function safeStart() {
  if (isStopped || !isListening) return;
  try {
    recognition.start();
  } catch (err) {
    console.log('Ya estaba escuchando');
  }
}

function haltWith(message) {
  isStopped = true;
  isListening = false;
  clearTimeout(speakWatchdog);
  startBtn.disabled = false;
  startBtn.textContent = 'Reintentar';
  updateStatus(message, 'error');
}

function errorMessage(error) {
  if (error === 'audio-capture') return '❌ No se detecta ningún micrófono';
  return '❌ Permiso de micrófono denegado. Actívelo y pulse Reintentar';
}

function updateStatus(text, className = '') {
  statusEl.innerHTML = text;
  statusEl.className = 'status ' + className;
}

function respond(text) {
  updateStatus('🔊 Respondiendo...', 'processing');
  displayResponse(text);
  // Red de seguridad: si el audio nunca termina, se vuelve a escuchar igual
  clearTimeout(speakWatchdog);
  speakWatchdog = setTimeout(resumeListening, SPEAK_TIMEOUT);
  playAudio(text);
}

function displayResponse(text) {
  outputEl.classList.add('show');
  responseTextEl.textContent = text;
}

// Se vuelve a escuchar cuando acaba la respuesta, no tras una espera fija
function resumeListening(statusText = LISTENING_HTML, className = 'listening') {
  clearTimeout(speakWatchdog);
  if (!isSpeaking) return;
  isSpeaking = false;
  updateStatus(statusText, className);
  safeStart();
}

async function playAudio(text) {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    audio.onended = () => {
      URL.revokeObjectURL(url);
      resumeListening();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resumeListening('❌ Error de audio', 'error');
    };

    await audio.play();
  } catch (err) {
    console.error('Error:', err);
    resumeListening('❌ Error de audio', 'error');
  }
}

startBtn.addEventListener('click', () => {
  if (isStopped) {
    // Reintentar tras un error fatal
    isStopped = false;
    isListening = true;
    restartDelay = RESTART_DELAY;
    updateStatus('⏳ Reintentando...', '');
    safeStart();
  } else if (isListening) {
    isListening = false;
    recognition.stop();
    startBtn.textContent = 'Reanudar';
    updateStatus('⏸️ Pausado', '');
  } else {
    isListening = true;
    startBtn.textContent = 'Pausar';
    safeStart();
  }
});

window.addEventListener('load', init);
