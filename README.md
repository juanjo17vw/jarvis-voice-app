# 🎩 Jarvis - Voice Assistant Web App

Web app con detección de palabra clave que permite interactuar con el asistente personal mediante voz.

## Características

- ✅ Detección automática de la palabra clave "Jarvis"
- 🎤 Grabación de voz después de la activación
- 🔊 Reproducción automática de respuestas en audio
- 🔒 Conexión segura al gateway via túnel LocalTunnel
- 📱 Interfaz responsive

## Cómo funciona

1. La página escucha continuamente esperando oír "Jarvis"
2. Al detectar la palabra clave, inicia grabación
3. Envía el audio grabado al gateway
4. Recibe la respuesta y la reproduce automáticamente

## Instalación

```bash
git clone <repository-url>
cd jarvis-voice-app
```

## Despliegue en GitHub Pages

1. Push el repositorio a GitHub
2. En Settings → Pages → Source: `main` branch / `root`
3. La app estará disponible en: `https://<usuario>.github.io/jarvis-voice-app`

## Gateway requerido

La app necesita acceso al gateway en: `https://little-ears-end.loca.lt`

El gateway debe proporcionar estos endpoints:
- `POST /api/chat` - Procesar audio/texto
- `POST /api/speak` - Convertir texto a audio

## Compatibilidad

- Chrome/Edge 25+
- Firefox 25+
- Safari 14.1+
- Requiere HTTPS (o localhost)
