// Configuración simple sin dependencia del gateway
const ELEVENLABS_API_KEY = 'sk_5f9883cfbbc0d5c94d545471d3375070700610cfea7bc97f';
const ELEVENLABS_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9';

// CORS Headers
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Text to Speech
async function textToSpeech(text) {
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + ELEVENLABS_VOICE_ID, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
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
  async fetch(request) {
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
        const data = await request.json();
        const text = data.text || 'Hola';
        const audioBuffer = await textToSpeech(text);

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
