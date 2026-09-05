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

// CORS Headers
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
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

async function handleChat(request, env) {
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

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        return await handleChat(request, env);
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
          headers: {
            ...corsHeaders(),
            'Content-Type': 'audio/mpeg',
          },
        });
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    return new Response('Jarvis API Ready', { headers: corsHeaders() });
  },
};
