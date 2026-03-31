// Configuración
const GATEWAY_URL = 'https://jarvis-api.juanjojimenez89.workers.dev';
const KEYWORD = 'jarvis';

let mediaRecorder;
let audioContext;
let isListening = false;
let isRecording = false;
let recordedChunks = [];
let recognition;

const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const outputEl = document.getElementById('output');
const responseTextEl = document.getElementById('responseText');

// Inicializar al cargar
async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        
        const mediaStream = audioContext.createMediaStreamDestination();
        source.connect(mediaStream);
        
        mediaRecorder = new MediaRecorder(mediaStream.stream);
        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = sendAudio;
        
        startBtn.disabled = false;
        startListening();
    } catch (err) {
        updateStatus('❌ Error: Permiso de micrófono denegado', 'error');
    }
}

function updateStatus(text, className = '') {
    statusEl.innerHTML = text;
    statusEl.className = 'status ' + className;
}

// Iniciar escucha continua
function startListening() {
    isListening = true;
    startBtn.textContent = 'Escuchando...';
    startBtn.disabled = true;
    updateStatus('🎧 Escuchando la palabra clave <span class="keyword">Jarvis</span>', 'listening');
    
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onstart = () => {
        console.log('Reconocimiento iniciado');
    };
    
    recognition.onresult = (event) => {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.toLowerCase().trim();
            
            if (event.results[i].isFinal) {
                console.log('Final:', transcript);
                if (transcript.includes(KEYWORD)) {
                    console.log('Palabra clave detectada');
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
        console.error('Error:', event.error);
        if (event.error === 'network') {
            setTimeout(() => {
                if (isListening) {
                    recognition.start();
                }
            }, 1000);
        }
    };
    
    recognition.onend = () => {
        console.log('Reconocimiento terminado');
        if (isListening && !isRecording) {
            setTimeout(() => {
                recognition.start();
            }, 500);
        }
    };
    
    recognition.start();
}

function startRecording() {
    updateStatus('🎤 Grabando...', 'recording');
    recordedChunks = [];
    mediaRecorder.start();
    isRecording = true;
    
    // Detener después de 15 segundos de silencio detectado o 30 segundos máximo
    setTimeout(() => {
        if (isRecording) {
            mediaRecorder.stop();
        }
    }, 30000);
}

async function sendAudio() {
    isRecording = false;
    updateStatus('⚙️ Procesando...', 'processing');
    
    const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
    
    try {
        // Obtener transcripción simple (enviamos el audio como datos)
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64Audio = reader.result.split(',')[1];
            
            // Llamar al API para procesar
            const response = await fetch(`${GATEWAY_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: 'Usuario pregunta algo', // Placeholder
                    audio: base64Audio
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            const message = data.message || 'Disculpe, no pude procesar su solicitud.';
            
            displayResponse(message);
            playAudio(message);
        };
        reader.readAsDataURL(audioBlob);
        
    } catch (err) {
        displayError(`Error: ${err.message}`);
    }
    
    // Reiniciar escucha
    setTimeout(() => {
        if (isListening) {
            startListening();
        }
    }, 2000);
}

function displayResponse(text) {
    outputEl.classList.add('show');
    responseTextEl.textContent = text;
    updateStatus('✅ Respuesta lista', 'listening');
}

function displayError(error) {
    outputEl.classList.add('show');
    responseTextEl.textContent = error;
    updateStatus('❌ Error', 'error');
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
        console.error('Error de audio:', err);
    }
}

// Botón para detener/reanudar
startBtn.addEventListener('click', () => {
    if (isListening) {
        isListening = false;
        recognition.stop();
        startBtn.textContent = 'Reanudar';
        updateStatus('⏸️ Pausado', '');
    } else {
        isListening = true;
        startBtn.textContent = 'Pausar';
        startListening();
    }
});

// Inicializar cuando carga la página
window.addEventListener('load', init);
