// Configuración
const GATEWAY_URL = 'https://little-ears-end.loca.lt';
const ELEVENLABS_API_KEY = 'sk_5f9883cfbbc0d5c94d545471d3375070700610cfea7bc97f';
const ELEVENLABS_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9';

// Middleware CORS
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// Manejo de OPTIONS (CORS preflight)
function handleOptions(request) {
  if (request.headers.get('Origin') !== null &&
      request.headers.get('Access-Control-Request-Method') !== null &&
      request.headers.get('Access-Control-Request-Headers') !== null) {
    return new Response(null, {
      headers: corsHeaders(),
    });
  }
  return new Response(null, {
    headers: {
      Allow: 'GET, POST, OPTIONS',
    },
  });
}

// Procesar audio a texto (usando Whisper API de OpenAI vía proxy)
async function audioToText(audioBase64) {
  // Para simplificar, vamos a enviar directamente al gateway
  // El gateway debería procesar el audio con su propia API
  return 'Mensaje de usuario'; // Placeholder
}

// Convertir texto a audio (ElevenLabs)
async function textToSpeech(text) {
  try {
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

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error('TTS Error:', error);
    throw error;
  }
}

// Enviar mensaje al gateway
async function sendToGateway(message) {
  try {
    const response = await fetch(GATEWAY_URL + '/api/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        user: 'web-user',
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      // Si falla, intenta con /api/chat
      const fallbackResponse = await fetch(GATEWAY_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      
      if (fallbackResponse.ok) {
        return await fallbackResponse.json();
      }
      throw new Error(`Gateway error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Gateway Error:', error);
    // Respuesta por defecto si el gateway no está disponible
    return {
      message: 'Disculpe, no puedo conectar con el servidor en este momento. Por favor, intente más tarde.',
      success: false,
    };
  }
}

// Manejar solicitud POST /api/chat
async function handleChat(request) {
  try {
    const data = await request.json();
    
    let userMessage = '';
    
    if (data.audio) {
      // Procesar audio (convertir a texto)
      userMessage = await audioToText(data.audio);
    } else if (data.text) {
      userMessage = data.text;
    } else {
      return new Response(
        JSON.stringify({ error: 'No audio o text proporcionado' }),
        { status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
      );
    }

    // Enviar al gateway
    const response = await sendToGateway(userMessage);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    );
  }
}

// Manejar solicitud POST /api/speak
async function handleSpeak(request) {
  try {
    const data = await request.json();
    const text = data.text || data.message;

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'No text proporcionado' }),
        { status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
      );
    }

    const audioBuffer = await textToSpeech(text);

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders(),
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength,
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    );
  }
}

// Router
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Rutas
    if (path === '/api/chat' && request.method === 'POST') {
      return await handleChat(request);
    }

    if (path === '/api/speak' && request.method === 'POST') {
      return await handleSpeak(request);
    }

    if (path === '/' && request.method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'Jarvis API',
          endpoints: ['/api/chat', '/api/speak'],
          gateway: GATEWAY_URL,
        }),
        { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  },
};
