#!/usr/bin/env python3
"""record_app.py - graba en video la app Jarvis corriendo en un navegador real.

Levanta un servidor estatico sobre el repo, abre Chromium con microfono falso
(opcionalmente alimentado con un WAV), graba el video de la sesion y guarda todo
lo que la pagina escriba en consola. Despues se analiza con video_tools.py.

Ejemplos:
  python3 record_app.py --duration 15
  python3 record_app.py --audio muestra.wav --duration 20
  python3 record_app.py --url https://juanjo17vw.github.io/jarvis-voice-app --duration 10
"""
from __future__ import annotations

import argparse
import contextlib
import functools
import glob
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]

PLAYWRIGHT_HELP = """Falta Playwright. Instalalo con:
  pip3 install playwright && python3 -m playwright install chromium
En entornos donde Chromium ya viene preinstalado basta con:
  pip3 install playwright   (con PLAYWRIGHT_BROWSERS_PATH ya configurado)"""


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(directory: Path, port: int):
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):  # sin ruido en stdout
            pass

    handler = functools.partial(QuietHandler, directory=str(directory))

    class Quiet(socketserver.TCPServer):
        allow_reuse_address = True

        def handle_error(self, request, client_address):
            pass

    httpd = Quiet(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def chromium_candidates():
    """Chromium alternativo cuando el que espera Playwright no esta instalado."""
    env = os.environ.get("VIDEO_TOOLS_CHROMIUM")
    if env:
        yield env
    roots = [os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or "",
             os.path.expanduser("~/.cache/ms-playwright"),
             os.path.expanduser("~/Library/Caches/ms-playwright")]
    patterns = []
    for root in roots:
        if not root:
            continue
        patterns += [
            os.path.join(root, "chromium"),
            os.path.join(root, "chromium-*", "chrome-linux", "chrome"),
            os.path.join(root, "chromium-*", "chrome-mac", "Chromium.app",
                         "Contents", "MacOS", "Chromium"),
        ]
    for pattern in patterns:
        for path in sorted(glob.glob(pattern), reverse=True):
            yield path
    for name in ("chromium", "chromium-browser", "google-chrome"):
        found = shutil.which(name)
        if found:
            yield found


def launch_chromium(pw, headless: bool, flags: list, explicit: str | None):
    """Lanza Chromium; si el build que espera Playwright falta, usa otro binario."""
    if not explicit:
        try:
            return pw.chromium.launch(headless=headless, args=flags)
        except Exception as exc:
            first_error = exc
    else:
        first_error = None
    for cand in ([explicit] if explicit else chromium_candidates()):
        if cand and os.path.exists(cand) and os.access(cand, os.X_OK):
            print(f"(usando Chromium alternativo: {cand})")
            return pw.chromium.launch(headless=headless, args=flags,
                                      executable_path=cand)
    raise SystemExit(f"no se pudo lanzar Chromium: {first_error}\n{PLAYWRIGHT_HELP}")


def find_ffmpeg():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from video_tools import ffmpeg
        return ffmpeg()
    except SystemExit:
        return None


def to_wav(path: str, tmpdir: str) -> str:
    """Chromium solo acepta WAV PCM como microfono falso."""
    if path.lower().endswith(".wav"):
        return path
    ff = find_ffmpeg()
    if not ff:
        raise SystemExit("para convertir el audio a WAV hace falta ffmpeg "
                         "(pip3 install imageio-ffmpeg)")
    out = os.path.join(tmpdir, "fake_mic.wav")
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-ac", "1",
                    "-ar", "48000", "-c:a", "pcm_s16le", out], check=True)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="URL a grabar (por defecto sirve el repo en localhost)")
    ap.add_argument("--page", default="index.html", help="fichero a abrir del repo servido")
    ap.add_argument("--root", default=str(REPO_ROOT), help="carpeta a servir")
    ap.add_argument("--duration", type=float, default=15, help="segundos de grabacion")
    ap.add_argument("--audio", help="WAV/MP3 que se inyecta como microfono falso")
    ap.add_argument("--out", default=".video-cache/app-recording")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=800)
    ap.add_argument("--headed", action="store_true", help="mostrar la ventana (no headless)")
    ap.add_argument("--chromium", help="ruta a un binario de Chromium concreto")
    ap.add_argument("--eval", dest="script", help="JS a ejecutar tras cargar la pagina")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit(PLAYWRIGHT_HELP)

    outdir = Path(args.out)
    if outdir.exists():
        shutil.rmtree(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    httpd = None
    url = args.url
    if not url:
        port = free_port()
        httpd = serve(Path(args.root), port)
        url = f"http://127.0.0.1:{port}/{args.page}"

    logs = []
    with tempfile.TemporaryDirectory() as tmp:
        flags = [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ]
        if args.audio:
            flags.append(f"--use-file-for-fake-audio-capture={to_wav(args.audio, tmp)}%noloop")

        with sync_playwright() as pw:
            browser = launch_chromium(pw, not args.headed, flags, args.chromium)
            context = browser.new_context(
                viewport={"width": args.width, "height": args.height},
                record_video_dir=str(outdir / "_raw"),
                record_video_size={"width": args.width, "height": args.height},
                permissions=["microphone"],
            )
            page = context.new_page()
            page.on("console", lambda m: logs.append(
                {"t": round(time.time() - t0, 2), "type": m.type, "text": m.text}))
            page.on("pageerror", lambda e: logs.append(
                {"t": round(time.time() - t0, 2), "type": "pageerror", "text": str(e)}))
            page.on("requestfailed", lambda r: logs.append(
                {"t": round(time.time() - t0, 2), "type": "requestfailed",
                 "text": f"{r.url} :: {r.failure}"}))

            t0 = time.time()
            print(f"grabando {url} durante {args.duration}s ...")
            page.goto(url, wait_until="domcontentloaded")
            page.screenshot(path=str(outdir / "start.png"))
            if args.script:
                with contextlib.suppress(Exception):
                    page.evaluate(args.script)
            page.wait_for_timeout(int(args.duration * 1000))
            page.screenshot(path=str(outdir / "end.png"), full_page=False)

            video = page.video
            context.close()
            browser.close()
            raw = Path(video.path()) if video else None

    final = outdir / "recording.webm"
    if raw and raw.exists():
        shutil.move(str(raw), str(final))
    shutil.rmtree(outdir / "_raw", ignore_errors=True)

    (outdir / "console.json").write_text(json.dumps(logs, indent=2, ensure_ascii=False))
    (outdir / "console.log").write_text(
        "\n".join(f"[{l['t']:7.2f}s] {l['type']:>12}: {l['text']}" for l in logs))

    if httpd:
        httpd.shutdown()

    print(f"video:     {final if final.exists() else '(no se genero)'}")
    print(f"capturas:  {outdir / 'start.png'} , {outdir / 'end.png'}")
    print(f"consola:   {outdir / 'console.log'} ({len(logs)} entradas)")
    if final.exists():
        print(f"\nAnalizalo con:\n  python3 {Path(__file__).with_name('video_tools.py')} "
              f"watch {final} --no-audio")


if __name__ == "__main__":
    main()
