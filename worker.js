// Configuración vía secrets/vars del Worker (wrangler secret put ELEVENLABS_API_KEY)
const DEFAULT_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9';

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

// Simple response generator
function generateResponse(userInput) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const data = await request.json();
        const userMessage = data.text || 'Hola';
        const response = generateResponse(userMessage);

        return jsonResponse({ message: response, success: true });
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
