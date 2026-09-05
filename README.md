# 🎩 Jarvis - Voice Assistant Web App

Web app con detección de palabra clave que permite interactuar con el asistente personal mediante voz.

## Características

- ✅ Detección automática de la palabra clave "Jarvis"
- 💬 Captura de la pregunta tras la activación y envío al gateway
- 🧠 Respuestas generadas por Claude (Anthropic), con memoria de la conversación
- 🔊 Reproducción automática de respuestas en audio (ElevenLabs)
- 🗣️ Voz del navegador como respaldo si el gateway no responde
- 📱 Interfaz responsive

## Cómo funciona

1. La página escucha continuamente esperando oír **Jarvis**
2. Al detectar la palabra clave responde al instante con un acuse ("¿En qué puedo ayudarle, señor?")
3. Escucha la pregunta y la da por terminada tras 1,5 s de silencio
4. Envía la pregunta a `POST /api/chat`, que la responde con Claude, y reproduce la
   respuesta con `POST /api/speak`
5. Vuelve a esperar la palabra clave

El micrófono se cierra mientras Jarvis habla, para que no se oiga a sí mismo.

La web guarda los últimos 10 turnos y los manda con cada pregunta, así que se puede
seguir el hilo ("¿qué tiempo hace?" → "¿y mañana?"). El historial vive solo en memoria:
al recargar la página se olvida.

## Instalación

```bash
git clone https://github.com/juanjo17vw/jarvis-voice-app.git
cd jarvis-voice-app
npm install
npm start   # sirve en http://localhost:8000
```

## Despliegue en GitHub Pages

1. Push el repositorio a GitHub
2. En Settings → Pages → Source: `main` branch / `root`
3. La app estará disponible en: `https://<usuario>.github.io/jarvis-voice-app`

## API Gateway (Cloudflare Workers)

Desplegado en: `https://jarvis-api.juanjojimenez89.workers.dev`

Endpoints:

- `POST /api/chat` — recibe `{ "text": "...", "history": [{ "role": "user" | "assistant", "content": "..." }] }`
  y devuelve `{ "message": "...", "success": true, "source": "claude" | "fallback" }`.
  `history` es opcional; el worker la valida y se queda con los 20 últimos mensajes.
- `POST /api/speak` — recibe `{ "text": "..." }`, devuelve audio `audio/mpeg`

### Orígenes permitidos (CORS)

La API solo devuelve cabeceras CORS al origen concreto que las pide, y responde 403 a
cualquier otro. La lista está en `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://juanjo17vw.github.io,http://localhost:8000,http://127.0.0.1:8000"
```

La comparación es exacta, así que `http://` en vez de `https://`, un puerto distinto o un
`…github.io.otrositio.com` quedan fuera. Si abres `test.html` con doble clic (`file://`) el
navegador manda `Origin: null` y la llamada falla: sírvelo con `npm start`.

Esto solo lo aplica el navegador. Frena a otra web que quiera gastar tu cuota, pero no a
alguien con `curl`, que puede omitir o falsear la cabecera `Origin`. Para eso hace falta
otra cosa: un token compartido, Cloudflare Access o límites de gasto en cada proveedor.

### El modelo

`/api/chat` llama a la Messages API de Anthropic con el SDK oficial (`@anthropic-ai/sdk`):

- Modelo `claude-opus-5`, con un system prompt que fija el personaje de Jarvis y le pide
  frases cortas en texto plano, porque la respuesta se lee en voz alta.
- `effort: "low"`: en una conversación por voz importa más la latencia que la profundidad.
  El pensamiento adaptativo sigue activo, que da mejor resultado que desactivarlo.
- `fallbacks: "default"`: si el modelo declina una petición, la API la reintenta sola en
  otro modelo dentro de la misma llamada, en vez de quedarse sin respuesta.

### Configuración de secretos

La API key de ElevenLabs **no se guarda en el repositorio**. Se configura como secret del Worker:

```bash
npx wrangler secret put ANTHROPIC_API_KEY     # https://console.anthropic.com
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put ELEVENLABS_VOICE_ID   # opcional, hay una voz por defecto
```

Ninguna de las dos es obligatoria para que la app arranque, y cada una degrada por separado:

| Falta | Qué pasa |
| --- | --- |
| `ANTHROPIC_API_KEY` | `/api/chat` responde con las frases fijas de siempre (`source: "fallback"`) |
| `ELEVENLABS_API_KEY` | `/api/speak` devuelve un 500 con el motivo y la web usa la voz del navegador |

### Desplegar Worker

```bash
npm install
npx wrangler login
npm run deploy-worker
```

Si cambias de cuenta de Cloudflare, actualiza `GATEWAY_URL` en `app.js` y `API_URL` en `test.html`
con tu subdominio `*.workers.dev`.

## Ajustes: añadir claves de API

`settings.html` es una pantalla para ir añadiendo claves de otros servicios (tiempo,
música, lo que integres) sin tocar la línea de comandos. Las claves **se guardan en el
Worker**, en KV: nunca quedan en el navegador ni se envían desde él a esos servicios.

Requiere dos cosas antes de funcionar:

```bash
npx wrangler kv namespace create SETTINGS   # pega el id en wrangler.toml y descomenta el bloque
npx wrangler secret put ADMIN_TOKEN         # la contraseña de la pantalla
npm run deploy-worker
```

Sin `ADMIN_TOKEN` la pantalla queda **cerrada**, no abierta: `/api/settings` responde 401.
Sin el namespace KV, responde 500 explicándolo, y el resto de la app sigue funcionando.

Los endpoints (todos con `Authorization: Bearer <ADMIN_TOKEN>`):

- `GET /api/settings` — lista los nombres, los 4 últimos caracteres y la fecha.
  **Nunca devuelve el valor de una clave**: el listado se construye con los metadatos de KV,
  así que no hay forma de leerlas desde fuera.
- `PUT /api/settings/<NOMBRE>` — guarda o actualiza. El nombre debe ser `MAYUSCULAS_Y_NUMEROS`.
- `DELETE /api/settings/<NOMBRE>` — la borra.

## Pruebas

`test.html` permite probar los endpoints del Worker por separado, sin usar la palabra clave.

## Compatibilidad

La detección de palabra clave usa la Web Speech API (`SpeechRecognition`):

- Chrome/Edge: soportado
- Safari 14.1+: soportado (`webkitSpeechRecognition`)
- Firefox: sin soporte — la app avisa y no arranca la escucha
- Requiere HTTPS (o localhost)
