# 🎩 Jarvis - Voice Assistant Web App

Web app con detección de palabra clave que permite interactuar con el asistente personal mediante voz.

## Características

- ✅ Detección automática de la palabra clave "Jarvis"
- 💬 Captura de la pregunta tras la activación y envío al gateway
- 🔊 Reproducción automática de respuestas en audio (ElevenLabs)
- 🗣️ Voz del navegador como respaldo si el gateway no responde
- 📱 Interfaz responsive

## Cómo funciona

1. La página escucha continuamente esperando oír **Jarvis**
2. Al detectar la palabra clave responde al instante con un acuse ("¿En qué puedo ayudarle, señor?")
3. Escucha la pregunta y la da por terminada tras 1,5 s de silencio
4. Envía la pregunta a `POST /api/chat` y reproduce la respuesta con `POST /api/speak`
5. Vuelve a esperar la palabra clave

El micrófono se cierra mientras Jarvis habla, para que no se oiga a sí mismo.

## Instalación

```bash
git clone https://github.com/juanjo17vw/jarvis-voice-app.git
cd jarvis-voice-app
npm start   # sirve en http://localhost:8000
```

## Despliegue en GitHub Pages

1. Push el repositorio a GitHub
2. En Settings → Pages → Source: `main` branch / `root`
3. La app estará disponible en: `https://<usuario>.github.io/jarvis-voice-app`

## API Gateway (Cloudflare Workers)

Desplegado en: `https://jarvis-api.juanjojimenez89.workers.dev`

Endpoints:

- `POST /api/chat` — recibe `{ "text": "..." }`, devuelve `{ "message": "...", "success": true }`
- `POST /api/speak` — recibe `{ "text": "..." }`, devuelve audio `audio/mpeg`

### Configuración de secretos

La API key de ElevenLabs **no se guarda en el repositorio**. Se configura como secret del Worker:

```bash
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put ELEVENLABS_VOICE_ID   # opcional, hay una voz por defecto
```

Si `ELEVENLABS_API_KEY` no está configurada, `/api/speak` devuelve un 500 explicando el motivo
y la web app cae automáticamente a la voz del navegador.

### Desplegar Worker

```bash
npm install
npx wrangler login
npm run deploy-worker
```

Si cambias de cuenta de Cloudflare, actualiza `GATEWAY_URL` en `app.js` y `API_URL` en `test.html`
con tu subdominio `*.workers.dev`.

## Pruebas

`test.html` permite probar los endpoints del Worker por separado, sin usar la palabra clave.

## Compatibilidad

La detección de palabra clave usa la Web Speech API (`SpeechRecognition`):

- Chrome/Edge: soportado
- Safari 14.1+: soportado (`webkitSpeechRecognition`)
- Firefox: sin soporte — la app avisa y no arranca la escucha
- Requiere HTTPS (o localhost)
