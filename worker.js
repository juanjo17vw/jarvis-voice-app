// Configuración simple sin dependencia del gateway
// La API key NUNCA va en el código: se guarda como secret de Cloudflare
//   wrangler secret put ELEVENLABS_API_KEY
const DEFAULT_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9';

// CORS Headers
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Text to Speech
async function textToSpeech(text, apiKey, voiceId) {
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
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

        return new Response(
          JSON.stringify({ message: response, success: true }),
          { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
        );
      }
    }

    if (url.pathname === '/api/speak' && request.method === 'POST') {
      try {
        const apiKey = env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: 'Falta el secret ELEVENLABS_API_KEY (wrangler secret put ELEVENLABS_API_KEY)' }),
            { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
          );
        }

        const data = await request.json();
        const text = data.text || 'Hola';
        const voiceId = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
        const audioBuffer = await textToSpeech(text, apiKey, voiceId);

        return new Response(audioBuffer, {
          headers: {
            ...corsHeaders(),
            'Content-Type': 'audio/mpeg',
          },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response('Jarvis API Ready', { headers: corsHeaders() });
  },
};
