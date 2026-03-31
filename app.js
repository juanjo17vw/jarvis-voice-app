// Configuración
const GATEWAY_URL = 'https://jarvis-api.juanjojimenez89.workers.dev';
const KEYWORD = 'jarvis';

let recognition;
let isListening = true;
let isSpeaking = false;

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
      startBtn.disabled = true;
      updateStatus('🎧 Escuchando la palabra clave <span class="keyword">Jarvis</span>', 'listening');
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
    };
    
    recognition.onend = () => {
      console.log('Terminado');
      if (isListening && !isSpeaking) {
        setTimeout(() => {
          recognition.start();
        }, 500);
      } else if (isSpeaking) {
        // Esperar a que termine la respuesta
        setTimeout(() => {
          isSpeaking = false;
          recognition.start();
        }, 3000);
      }
    };
    
    recognition.start();
    startBtn.disabled = false;
  } catch (err) {
    updateStatus('❌ Error: Reconocimiento no disponible', 'error');
  }
}

function updateStatus(text, className = '') {
  statusEl.innerHTML = text;
  statusEl.className = 'status ' + className;
}

function respond(text) {
  updateStatus('🔊 Respondiendo...', 'processing');
  displayResponse(text);
  playAudio(text);
}

function displayResponse(text) {
  outputEl.classList.add('show');
  responseTextEl.textContent = text;
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
      updateStatus('🎧 Escuchando la palabra clave <span class="keyword">Jarvis</span>', 'listening');
    };
    
    audio.play();
  } catch (err) {
    console.error('Error:', err);
    updateStatus('❌ Error de audio', 'error');
  }
}

startBtn.addEventListener('click', () => {
  if (isListening) {
    isListening = false;
    recognition.stop();
    startBtn.textContent = 'Reanudar';
    updateStatus('⏸️ Pausado', '');
  } else {
    isListening = true;
    startBtn.textContent = 'Pausar';
    recognition.start();
  }
});

window.addEventListener('load', init);
