---
name: watch-video
description: Ver, analizar y entender videos - ficheros locales (mp4/mov/webm), URLs de YouTube o web, y grabaciones de la propia app Jarvis en el navegador. Extrae fotogramas clave que Claude puede mirar, transcribe el audio con marcas de tiempo y genera un informe. Usar cuando el usuario diga "mira este video", "analiza este clip", "que pasa en este video", "resume este video de YouTube", "graba la app y dime que ves", o pase una ruta a un fichero de video o un enlace de YouTube/Vimeo. Also for English requests - watch this video, analyze this clip, summarize this YouTube video, transcribe this recording.
---

# Ver videos

Claude no puede abrir un `.mp4` directamente: la tool `Read` lee imagenes y texto, no
video. Esta skill hace de traductor — convierte el video en **fotogramas JPG** (que se
leen con `Read`) y en **transcripcion con timestamps** (que se lee como texto).

## Inicio rapido

```bash
S=.claude/skills/watch-video/scripts

# fichero local: fotogramas + transcripcion + informe
python3 $S/video_tools.py watch ruta/al/video.mp4

# YouTube o cualquier URL soportada por yt-dlp
python3 $S/video_tools.py watch "https://youtu.be/XXXXXXXX" --lang es

# grabar la app Jarvis en un navegador real y analizarla despues
python3 $S/record_app.py --duration 20 --audio muestra.wav
python3 $S/video_tools.py watch .video-cache/app-recording/recording.webm --no-audio
```

## Flujo recomendado

1. **Ejecuta `watch`.** Deja los resultados en `.video-cache/<nombre>/`:
   `frames/*.jpg`, `contact_sheet.jpg`, `transcript.txt|srt|json` y `report.md`.
2. **Mira las imagenes con `Read`.** Empieza por `contact_sheet.jpg` (todos los
   fotogramas en una sola imagen, orden izquierda→derecha, arriba→abajo); si algo
   merece detalle, lee el JPG suelto de ese instante — el nombre lleva el timestamp
   (`frame_003_t00-01-23.450.jpg`) y `frames/manifest.json` lo mapea exactamente.
3. **Lee `transcript.txt`** para lo que se dice, con `[hh:mm:ss]` por segmento.
4. **Responde citando el minuto.** "En 00:01:23 aparece X" vale mucho mas que un
   resumen generico. Si necesitas mas resolucion temporal en un tramo concreto,
   vuelve a extraer solo ahi con `frames --mode uniform --count 20`.

Regla practica: 10-15 fotogramas bastan para entender un clip corto. No leas 60
imagenes de golpe — consume contexto y aporta poco frente a la hoja de contactos.

## Subcomandos de `video_tools.py`

| Comando | Para que |
|---|---|
| `probe VIDEO` | duracion, resolucion, fps, si tiene audio (JSON) |
| `frames VIDEO` | fotogramas a JPG + `manifest.json` |
| `sheet FRAMES_DIR` | hoja de contactos a partir de una carpeta de fotogramas |
| `transcribe VIDEO` | audio → `transcript.txt` / `.srt` / `.json` |
| `fetch URL` | descarga con yt-dlp (y subtitulos si existen) |
| `watch VIDEO\|URL` | todo lo anterior + `report.md` |

Opciones utiles:

- `--mode auto\|scene\|uniform` — `auto` (por defecto) busca cambios de plano y, si
  encuentra menos de 4, reparte los fotogramas de forma uniforme. `scene` es mejor
  para video editado; `uniform` para pantallas o capturas donde casi nada cambia.
- `--count N` (uniform, por defecto 12) · `--max N` (tope en modo scene, 24)
- `--threshold 0.4` — sensibilidad del detector de escenas (mas bajo = mas cortes)
- `--width 960` — ancho de los JPG; subelo solo si hay que leer texto pequeño
- `--lang es` y `--model tiny|base|small|medium|large-v3` para la transcripcion
- `--no-audio` (solo imagen) · `--audio-only` (solo transcripcion)

## Grabar la app Jarvis (`record_app.py`)

Levanta un servidor estatico sobre el repo, abre Chromium con **microfono falso**,
graba el video de la sesion y guarda todo lo que la pagina escribe en consola.

```bash
python3 $S/record_app.py --duration 15                    # repo local
python3 $S/record_app.py --audio hola-jarvis.wav          # inyecta voz al micro
python3 $S/record_app.py --url https://juanjo17vw.github.io/jarvis-voice-app
```

Deja en `.video-cache/app-recording/`: `recording.webm`, `start.png`, `end.png`,
`console.log` y `console.json`. **`console.log` suele ser mas revelador que el video**
para depurar: lleva timestamps y captura errores de JS, permisos y peticiones fallidas.

Opciones: `--page`, `--root`, `--width/--height`, `--headed`, `--eval "JS"`,
`--chromium /ruta/al/binario`.

## Dependencias

- **ffmpeg** — imprescindible. Se busca en este orden: `$VIDEO_TOOLS_FFMPEG`, el del
  `PATH`, el del paquete pip `imageio-ffmpeg`, y el que trae Playwright. Instalacion
  sin permisos de root: `pip3 install imageio-ffmpeg`.
- **Transcripcion** — `pip3 install faster-whisper` (local, CPU, recomendado). Alternativas:
  `openai-whisper`, o `OPENAI_API_KEY` para la API remota (ojo: eso **sube el audio** a
  un tercero; no lo uses con material privado sin permiso del usuario).
- **Descargas** — `pip3 install -U yt-dlp`.
- **Grabacion** — `pip3 install playwright` (+ `python3 -m playwright install chromium`
  si no hay navegador ya instalado).

Los scripts detectan lo que falta y dicen el comando exacto de instalacion; instalar
dependencias es decision del usuario, pregunta antes de hacerlo tu.

## Limites conocidos

- La primera transcripcion descarga el modelo desde `huggingface.co` (~75 MB `tiny`,
  ~150 MB `base`). En redes restringidas falla: copia la cache de HuggingFace desde
  otra maquina (`HF_HOME`) o usa la API remota.
- `fetch` respeta lo que permita yt-dlp: no sirve para contenido de pago o con DRM.
  Ademas, en sesiones remotas de Claude Code (claude.ai/code) el proxy suele bloquear
  la salida a YouTube: ahi solo funcionan los ficheros locales. Descarga en tu maquina.
  Si el video ya trae subtitulos, usalos antes que la transcripcion automatica — son
  mas fieles y gratis.
- En Chromium headless la Web Speech API **no** reconoce voz real (no hay servicio de
  reconocimiento detras), asi que `record_app.py` sirve para ver la UI, los estados y
  los errores de consola, no para validar el reconocimiento de la palabra clave
  end-to-end. Para eso hace falta Chrome de verdad, con `--headed` y micro real.
- `.video-cache/` esta en `.gitignore`: son artefactos, no se commitean.
