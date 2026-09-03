# jarvis.exe - lanzador de escritorio (Windows)

Un ejecutable pequeño (19 KB, sin dependencias) que abre Jarvis como si fuera una
aplicación de escritorio: busca Chrome o Edge y los lanza en **modo aplicación**,
una ventana limpia sin barra de direcciones ni pestañas.

```
desktop/
├── jarvis.exe            <- el ejecutable ya compilado
├── jarvis_launcher.c     <- código del lanzador (Win32)
├── jarvis_cmdline.h      <- lógica pura, probada aparte
├── tests/test_cmdline.c  <- pruebas que corren en cualquier sistema
└── build.sh              <- compila jarvis.exe
```

## Uso

Doble clic en `jarvis.exe`. Abre `https://juanjo17vw.github.io/jarvis-voice-app/`.

Para apuntar a otra dirección (por ejemplo, la copia local mientras desarrollas):

```
jarvis.exe http://localhost:8000/index.html
```

Solo acepta URLs `http://` o `https://`. Cualquier otra cosa se rechaza, para que un
argumento inesperado no acabe ejecutando otro programa.

**Para tenerlo a mano:** clic derecho en `jarvis.exe` → *Enviar a* → *Escritorio*, o
arrástralo a la barra de tareas. Si quieres cambiarle el icono, es propiedad del
acceso directo (clic derecho → Propiedades → Cambiar icono).

## Por qué Chrome o Edge, y no una ventana propia

Jarvis oye mediante la **Web Speech API** (`webkitSpeechRecognition`), que **solo**
está implementada en Chrome y Edge. Firefox y Safari no la tienen.

Y no es un envoltorio tipo Electron a propósito: el Chromium que empaqueta Electron
viene sin las claves del servicio de reconocimiento de Google, así que el
reconocimiento de voz **no funciona** dentro de Electron. Un envoltorio parecería más
"aplicación de verdad" y rompería justo lo único que hace Jarvis. Por eso el lanzador
usa el Chrome que ya tienes instalado.

Si no encuentra ninguno de los dos, abre el navegador por defecto y avisa por pantalla
de que la voz puede no funcionar.

## Cómo lo busca

1. El registro de Windows (`App Paths`), que es donde cada navegador apunta su ruta real
2. Rutas habituales de Chrome (Program Files, Program Files (x86), LocalAppData)
3. Las mismas rutas para Edge

## Compilar

No hace falta Windows: se compila cruzado desde Linux, WSL o macOS.

```bash
sudo apt-get install -y mingw-w64   # o: brew install mingw-w64
./desktop/build.sh                  # ejecuta los tests y genera desktop/jarvis.exe
```

## Aviso de SmartScreen

El ejecutable no está firmado digitalmente (una firma de código cuesta dinero), así que
la primera vez Windows puede mostrar "Windows protegió su PC". Es *Más información* →
*Ejecutar de todas formas*. Si prefieres no lidiar con eso, un acceso directo a
`chrome.exe --app=https://juanjo17vw.github.io/jarvis-voice-app/` hace lo mismo sin
ningún ejecutable de por medio.
