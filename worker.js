import Anthropic from '@anthropic-ai/sdk';

// Configuración vía secrets/vars del Worker (wrangler secret put ...)
const DEFAULT_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9';
const MODEL = 'claude-opus-5';
const MAX_HISTORY_MESSAGES = 20; // 10 turnos de ida y vuelta
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `Eres Jarvis, el asistente personal por voz de un usuario español.

Tu respuesta se convierte en audio y se reproduce en voz alta, así que:
- Responde en español, siempre en 1-3 frases cortas.
- Escribe texto plano y hablado: nada de markdown, listas, viñetas, emojis, código ni URLs.
- Escribe los números y las abreviaturas como se pronuncian ("veinticinco grados", no "25°C").
- Trata al usuario de usted y llámale "señor".

Mantén el tono sobrio y servicial del Jarvis de Iron Man: eficiente y con un punto de
ironía educada, nunca efusivo. Si no sabes algo o no tienes acceso a un dato (la hora,
el tiempo, sus correos), dilo en una frase en lugar de inventarlo.`;

// Orígenes permitidos si no se define la variable ALLOWED_ORIGINS en wrangler.toml
const DEFAULT_ALLOWED_ORIGINS = [
  'https://juanjo17vw.github.io', // GitHub Pages
  'http://localhost:8000',        // npm start
  'http://127.0.0.1:8000',
];

function allowedOrigins(env) {
  if (typeof env.ALLOWED_ORIGINS === 'string' && env.ALLOWED_ORIGINS.trim()) {
    return env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

// Las peticiones sin cabecera Origin (curl, health checks) no vienen de una página
// web, así que no hay nada que bloquear: solo se les niegan las cabeceras CORS.
function isOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || allowedOrigins(env).includes(origin);
}

// Solo se devuelven cabeceras CORS al origen concreto que las pide, nunca '*'.
// Vary: Origin evita que una caché sirva la respuesta de un origen a otro.
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = { 'Vary': 'Origin' };

  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '86400';
  }

  return headers;
}

// Text to Speech
async function textToSpeech(text, env) {
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY no configurada en el Worker');
  }

  const voiceId = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
    }),
  });

  if (!response.ok) throw new Error(`TTS Error: ${response.status}`);
  return await response.arrayBuffer();
}

// El historial llega del navegador: hay que validarlo antes de reenviarlo a la API.
// Solo se conservan los últimos turnos y la lista debe empezar por un mensaje de usuario.
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const clean = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .filter((m) => typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .slice(-MAX_HISTORY_MESSAGES);

  while (clean.length && clean[0].role !== 'user') clean.shift();
  return clean;
}

// Respuestas de reserva cuando no hay ANTHROPIC_API_KEY configurada
function fallbackResponse(userInput) {
  const responses = {
    'hola': '¡Hola señor! ¿En qué puedo ayudarle?',
    'buenos dias': 'Buenos días señor. ¿Necesita algo?',
    'como estoy': 'Espero que se encuentre bien, señor.',
    'que hora es': 'Disculpe, no tengo acceso a la hora en este momento.',
    'default': 'Entendido señor. Estoy listo para asistirle con lo que necesite.'
  };

  const lower = userInput.toLowerCase();
  for (const [key, value] of Object.entries(responses)) {
    if (lower.includes(key)) return value;
  }
  return responses.default;
}

async function askClaude(text, history, env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    // Voz: prima la latencia. El pensamiento adaptativo sigue activo (por defecto
    // en Opus 5) pero con esfuerzo bajo, que es mejor que desactivarlo.
    output_config: { effort: 'low' },
    messages: [...history, { role: 'user', content: text }],
    // Si el modelo declina la petición, la API la reintenta sola en otro modelo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });

  if (response.stop_reason === 'refusal') {
    return { message: 'Disculpe señor, no puedo ayudarle con eso.', refused: true };
  }

  const message = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  return { message: message || 'No he sabido qué responder, señor.' };
}

// --- Ajustes: claves de API guardadas en KV -------------------------------
//
// Los valores solo se pueden escribir, nunca leer desde fuera: el listado se
// construye con los metadatos, así que ningún endpoint devuelve una clave.

const KEY_PREFIX = 'apikey:';
const KEY_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

// Comparación en tiempo constante, para no filtrar el token por lo que tarda
function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

// Sin ADMIN_TOKEN configurado la pantalla queda cerrada, no abierta
function isAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;

  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  return constantTimeEqual(header.slice('Bearer '.length), env.ADMIN_TOKEN);
}

function preview(value) {
  return value.length > 4 ? '…' + value.slice(-4) : '…';
}

async function handleSettings(request, env, url, jsonResponse) {
  if (!env.SETTINGS) {
    return jsonResponse({ error: 'Falta el binding KV "SETTINGS" en wrangler.toml' }, 500);
  }
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: 'No autorizado' }, 401);
  }

  if (url.pathname === '/api/settings' && request.method === 'GET') {
    const { keys } = await env.SETTINGS.list({ prefix: KEY_PREFIX });
    return jsonResponse({
      keys: keys.map((k) => ({
        name: k.name.slice(KEY_PREFIX.length),
        preview: k.metadata?.preview ?? '…',
        updated: k.metadata?.updated ?? null,
      })),
    });
  }

  const name = decodeURIComponent(url.pathname.slice('/api/settings/'.length));
  if (!KEY_NAME.test(name)) {
    return jsonResponse({ error: 'Nombre inválido: usa mayúsculas, números y _ (p. ej. OPENWEATHER_API_KEY)' }, 400);
  }

  if (request.method === 'PUT') {
    const { value } = await request.json();
    if (typeof value !== 'string' || !value.trim()) {
      return jsonResponse({ error: 'Falta el campo "value"' }, 400);
    }

    const clean = value.trim();
    await env.SETTINGS.put(KEY_PREFIX + name, clean, {
      metadata: { preview: preview(clean), updated: new Date().toISOString() },
    });
    return jsonResponse({ name, preview: preview(clean), saved: true });
  }

  if (request.method === 'DELETE') {
    await env.SETTINGS.delete(KEY_PREFIX + name);
    return jsonResponse({ name, deleted: true });
  }

  return jsonResponse({ error: 'Método no permitido' }, 405);
}

async function handleChat(request, env, jsonResponse) {
  const data = await request.json();
  const text = typeof data.text === 'string' ? data.text.trim() : '';

  if (!text) {
    return jsonResponse({ error: 'Falta el campo "text"' }, 400);
  }

  // Sin clave de Claude el asistente sigue respondiendo, con las frases fijas
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ message: fallbackResponse(text), success: true, source: 'fallback' });
  }

  try {
    const { message, refused } = await askClaude(text, sanitizeHistory(data.history), env);
    return jsonResponse({ message, success: !refused, source: 'claude' });
  } catch (error) {
    console.error('Error llamando a Claude:', error);

    if (error instanceof Anthropic.AuthenticationError) {
      return jsonResponse({ error: 'ANTHROPIC_API_KEY inválida' }, 500);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return jsonResponse(
        { message: 'Estoy recibiendo demasiadas peticiones, señor. Inténtelo en un momento.' },
        503
      );
    }
    if (error instanceof Anthropic.APIError) {
      return jsonResponse({ error: `Error de la API (${error.status}): ${error.message}` }, 502);
    }
    return jsonResponse({ error: error.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    const jsonResponse = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });

    if (!isOriginAllowed(request, env)) {
      return new Response('Origen no permitido', { status: 403, headers: cors });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/api/settings' || url.pathname.startsWith('/api/settings/')) {
      try {
        return await handleSettings(request, env, url, jsonResponse);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        return await handleChat(request, env, jsonResponse);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    if (url.pathname === '/api/speak' && request.method === 'POST') {
      try {
        const data = await request.json();
        const text = data.text || 'Hola';
        const audioBuffer = await textToSpeech(text, env);

        return new Response(audioBuffer, {
          headers: { ...cors, 'Content-Type': 'audio/mpeg' },
        });
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    return new Response('Jarvis API Ready', { headers: cors });
  },
};
