// Configuración
const GATEWAY_URL = 'https://jarvis-api.juanjojimenez89.workers.dev';
const KEYWORD = 'jarvis';
const CONFIDENCE_THRESHOLD = 0.5;

let mediaRecorder;
let audioContext;
let analyser;
let isListening = false;
let isRecording = false;
let recordedChunks = [];
let keywordDetected = false;

const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const outputEl = document.getElementById('output');
const responseTextEl = document.getElementById('responseText');
const errorMsgEl = document.getElementById('errorMsg');

// Inicializar
async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        source.connect(analyser);
        
        const mediaStream = audioContext.createMediaStreamDestination();
        source.connect(mediaStream);
        
        mediaRecorder = new MediaRecorder(mediaStream.stream);
        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = sendAudio;
        
        startBtn.disabled = false;
        updateStatus('Escuchando la palabra clave <span class="keyword">Jarvis</span>', 'listening');
    } catch (err) {
        updateStatus('Error: Permiso de micrófono denegado', 'error');
    }
}

function updateStatus(text, className = '') {
    statusEl.innerHTML = text;
    statusEl.className = 'status ' + className;
}

startBtn.addEventListener('click', () => {
    isListening = !isListening;
    if (isListening) {
        startBtn.textContent = 'Detener Escucha';
        startBtn.style.background = 'linear-gradient(45deg, #ff6b6b, #ff0055)';
        startBtn.disabled = true;
        listenForKeyword();
    } else {
        startBtn.textContent = 'Iniciar Escucha';
        startBtn.style.background = 'linear-gradient(45deg, #00d4ff, #0099ff)';
        startBtn.disabled = false;
        isListening = false;
    }
});

async function listenForKeyword() {
    updateStatus('Escuchando...', 'listening');
    
    // Simulación de detección (Web Audio API simple)
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.toLowerCase();
            if (event.results[i].isFinal) {
                if (transcript.includes(KEYWORD)) {
                    keywordDetected = true;
                    recognition.stop();
                    startRecording();
                    return;
                }
            } else {
                interimTranscript += transcript;
            }
        }
    };
    
    recognition.onerror = (event) => {
        console.error('Error en reconocimiento:', event.error);
    };
    
    recognition.start();
}

function startRecording() {
    updateStatus('🎤 Grabando...', 'recording');
    recordedChunks = [];
    mediaRecorder.start();
    isRecording = true;
    
    // Detener grabación después de 10 segundos de silencio o 30 segundos máximo
    setTimeout(() => {
        if (isRecording) {
            mediaRecorder.stop();
        }
    }, 30000);
}

async function sendAudio() {
    isRecording = false;
    updateStatus('Procesando...', 'processing');
    
    const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
    
    try {
        // Convertir blob a base64
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64Audio = reader.result.split(',')[1];
            
            // Enviar al gateway
            const response = await fetch(`${GATEWAY_URL}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'audio',
                    audio: base64Audio,
                    userId: 'web-user'
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            displayResponse(data.message || data.response);
            
            // Reproducir respuesta con TTS
            if (data.message) {
                playAudio(data.message);
            }
        };
        reader.readAsDataURL(audioBlob);
        
    } catch (err) {
        displayError(`Error: ${err.message}`);
        updateStatus('Escuchando la palabra clave <span class="keyword">Jarvis</span>', 'listening');
    }
}

function displayResponse(text) {
    outputEl.classList.add('show');
    responseTextEl.textContent = text;
    errorMsgEl.textContent = '';
    updateStatus('✓ Respuesta recibida', 'listening');
}

function displayError(error) {
    outputEl.classList.add('show');
    errorMsgEl.textContent = error;
    responseTextEl.textContent = '';
    updateStatus('Error', 'error');
}

async function playAudio(text) {
    try {
        const response = await fetch(`${GATEWAY_URL}/api/speak`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
    } catch (err) {
        console.error('Error reproduciendo audio:', err);
    }
}

// Inicializar cuando carga la página
window.addEventListener('load', init);
