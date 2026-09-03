# 🎩 Jarvis - Voice Assistant Web App

Web app con detección de palabra clave que permite interactuar con el asistente personal mediante voz.

## Características

- ✅ Detección automática de la palabra clave "Jarvis"
- 🔊 Respuesta hablada automática (TTS de ElevenLabs vía Cloudflare Worker)
- ♻️ Reintentos con espera creciente, y parada limpia si no hay micrófono o permiso
- 📱 Interfaz responsive

## Cómo funciona

1. La página escucha continuamente esperando oír "Jarvis"
2. Al detectar la palabra clave, elige una respuesta de cortesía
3. Pide el audio de esa frase al worker (`POST /api/speak`, TTS de ElevenLabs)
4. Lo reproduce y vuelve a escuchar en cuanto termina

Hoy la respuesta es una frase fija: la app **no** graba ni envía tu pregunta.
El endpoint `/api/chat` del worker ya existe y responde texto, pero la web
todavía no lo llama.

## Instalación

```bash
git clone <repository-url>
cd jarvis-voice-app
```

## Despliegue en GitHub Pages

1. Push el repositorio a GitHub
2. En Settings → Pages → Source: `main` branch / `root`
3. La app estará disponible en: `https://<usuario>.github.io/jarvis-voice-app`

## API Gateway (Cloudflare Workers)

Desplegado en: `https://jarvis-api.juanjojimenez89.workers.dev`
(es la URL que usa `app.js`; si despliegas en otra cuenta, cambia `GATEWAY_URL`)

Endpoints:
- `POST /api/chat` - Procesar audio/texto
- `POST /api/speak` - Convertir texto a audio

### Desplegar Worker

```bash
npm install -D wrangler
wrangler login

# La API key de ElevenLabs va como secret, nunca en el código
wrangler secret put ELEVENLABS_API_KEY

# Opcional: cambiar la voz (por defecto onwK4e9ZLuTAKqWW03F9)
wrangler secret put ELEVENLABS_VOICE_ID

npm run deploy-worker
```

Sin el secret `ELEVENLABS_API_KEY`, `/api/speak` responde 500 con un mensaje que lo
explica en vez de fallar en silencio.

`worker-simple.js` es una copia idéntica de `worker.js`; el que se despliega es
`worker.js` (lo fija `wrangler.toml`).

## Compatibilidad

- Chrome/Edge 25+
- Firefox 25+
- Safari 14.1+
- Requiere HTTPS (o localhost)

## Skill de Claude: ver vídeos

En `.claude/skills/watch-video/` hay una skill que permite a Claude Code "ver" vídeos:
extrae fotogramas clave a JPG, transcribe el audio con marcas de tiempo y genera un
informe. Funciona con ficheros locales, URLs de YouTube/web y grabaciones de la propia
app en un navegador real.

```bash
S=.claude/skills/watch-video/scripts

python3 $S/video_tools.py watch demo.mp4              # vídeo local
python3 $S/video_tools.py watch "https://youtu.be/X"  # YouTube
python3 $S/record_app.py --duration 15                # graba esta app + consola
```

Dependencias mínimas: `pip3 install imageio-ffmpeg` (ffmpeg) y, para transcribir,
`pip3 install faster-whisper`. Detalles y opciones en el propio `SKILL.md`.
