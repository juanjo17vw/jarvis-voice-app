#!/usr/bin/env python3
"""video_tools.py - convierte un video en cosas que Claude si puede leer.

Claude no puede abrir un .mp4, pero si puede leer imagenes y texto. Este script
hace la traduccion: fotogramas -> JPG, audio -> transcripcion con timestamps.

Subcomandos:
  probe       datos tecnicos (duracion, resolucion, fps, si tiene audio)
  frames      extrae fotogramas clave a JPG + manifest.json
  sheet       junta los fotogramas en una unica hoja de contactos
  transcribe  audio -> texto con marcas de tiempo (txt / srt / json)
  fetch       descarga un video de YouTube/web con yt-dlp (y sus subtitulos)
  watch       todo lo anterior de una vez sobre un fichero o una URL

Uso tipico:
  python3 video_tools.py watch demo.mp4
  python3 video_tools.py watch "https://youtu.be/XXXX" --lang es
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# --------------------------------------------------------------------------
# localizacion de binarios
# --------------------------------------------------------------------------

_FFMPEG = None

FFMPEG_HELP = """No se encuentra ffmpeg. Opciones para instalarlo:
  pip3 install imageio-ffmpeg     (binario estatico, no necesita permisos root)
  brew install ffmpeg             (macOS)
  sudo apt-get install -y ffmpeg  (Debian/Ubuntu)
O exporta VIDEO_TOOLS_FFMPEG=/ruta/a/ffmpeg"""


def _ffmpeg_candidates():
    env = os.environ.get("VIDEO_TOOLS_FFMPEG")
    if env:
        yield env
    which = shutil.which("ffmpeg")
    if which:
        yield which
    try:  # binario estatico que trae el paquete pip imageio-ffmpeg
        import imageio_ffmpeg

        yield imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    patterns = [
        "/opt/pw-browsers/ffmpeg-*/ffmpeg-linux",
        os.path.expanduser("~/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux"),
        os.path.expanduser("~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac"),
    ]
    for pattern in patterns:
        for path in sorted(glob.glob(pattern)):
            yield path


def ffmpeg() -> str:
    global _FFMPEG
    if _FFMPEG:
        return _FFMPEG
    for cand in _ffmpeg_candidates():
        if cand and os.path.exists(cand) and os.access(cand, os.X_OK):
            _FFMPEG = cand
            return _FFMPEG
    die(FFMPEG_HELP)


def die(msg: str, code: int = 1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def run(cmd, check=True, quiet=True):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        tail = "\n".join((proc.stderr or "").strip().splitlines()[-12:])
        die(f"fallo el comando: {' '.join(str(c) for c in cmd[:4])} ...\n{tail}")
    return proc


# --------------------------------------------------------------------------
# probe
# --------------------------------------------------------------------------


def _probe_with_ffprobe(path: str):
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    proc = run([ffprobe, "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", path], check=False)
    if proc.returncode != 0:
        return None
    data = json.loads(proc.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    fps = 0.0
    if video and video.get("r_frame_rate", "0/0") != "0/0":
        num, _, den = video["r_frame_rate"].partition("/")
        fps = float(num) / float(den or 1)
    return {
        "duration": float(data.get("format", {}).get("duration") or 0.0),
        "width": int(video.get("width", 0)) if video else 0,
        "height": int(video.get("height", 0)) if video else 0,
        "fps": round(fps, 3),
        "video_codec": video.get("codec_name") if video else None,
        "audio_codec": audio.get("codec_name") if audio else None,
        "has_audio": audio is not None,
        "has_video": video is not None,
    }


def _probe_with_ffmpeg(path: str):
    # imageio-ffmpeg no trae ffprobe: sacamos los datos del stderr de ffmpeg -i
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-i", path],
                          capture_output=True, text=True)
    text = proc.stderr or ""
    info = {"duration": 0.0, "width": 0, "height": 0, "fps": 0.0,
            "video_codec": None, "audio_codec": None,
            "has_audio": False, "has_video": False}
    m = re.search(r"Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)", text)
    if m:
        h, mi, s = m.groups()
        info["duration"] = int(h) * 3600 + int(mi) * 60 + float(s)
    m = re.search(r"Stream #\S+: Video: (\w+)[^\n]*?(\d{2,5})x(\d{2,5})", text)
    if m:
        info.update(has_video=True, video_codec=m.group(1),
                    width=int(m.group(2)), height=int(m.group(3)))
        f = re.search(r"(\d+(?:\.\d+)?) fps", text)
        if f:
            info["fps"] = float(f.group(1))
    m = re.search(r"Stream #\S+: Audio: (\w+)", text)
    if m:
        info.update(has_audio=True, audio_codec=m.group(1))
    if not info["duration"] and not info["has_video"] and not info["has_audio"]:
        tail = "\n".join(text.strip().splitlines()[-8:])
        die(f"no se pudo leer el video: {path}\n{tail}")
    return info


def probe(path: str) -> dict:
    if not os.path.exists(path):
        die(f"no existe el fichero: {path}")
    info = _probe_with_ffprobe(path) or _probe_with_ffmpeg(path)
    info["path"] = os.path.abspath(path)
    info["size_bytes"] = os.path.getsize(path)
    return info


def hhmmss(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def stamp(seconds: float) -> str:
    """timestamp apto para nombre de fichero: 00-01-23.450"""
    return hhmmss(seconds).replace(":", "-")


# --------------------------------------------------------------------------
# frames
# --------------------------------------------------------------------------


def _write_manifest(outdir: Path, src: str, frames: list, mode: str, info: dict):
    manifest = {
        "source": os.path.abspath(src),
        "mode": mode,
        "duration": info.get("duration"),
        "count": len(frames),
        "frames": frames,
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def extract_uniform(src: str, outdir: Path, count: int, width: int, info: dict) -> list:
    duration = info.get("duration") or 0.0
    if duration <= 0:
        die("duracion desconocida: usa --mode scene o indica --count con un video valido")
    times = [duration * (i + 0.5) / count for i in range(count)]
    frames = []
    for i, t in enumerate(times):
        out = outdir / f"frame_{i:03d}_t{stamp(t)}.jpg"
        run([ffmpeg(), "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", src,
             "-frames:v", "1", "-vf", f"scale={width}:-2:flags=lanczos",
             "-q:v", "3", str(out)])
        if out.exists():
            frames.append({"file": out.name, "t": round(t, 3), "time": hhmmss(t)})
    return frames


def extract_scene(src: str, outdir: Path, threshold: float, width: int) -> list:
    tmp = outdir / "_scene"
    tmp.mkdir(exist_ok=True)
    vf = f"select='gt(scene,{threshold})',showinfo,scale={width}:-2:flags=lanczos"
    cmd = [ffmpeg(), "-y", "-hide_banner", "-i", src, "-vf", vf,
           "-fps_mode", "vfr", "-q:v", "3", str(tmp / "s_%04d.jpg")]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:  # ffmpeg antiguo: -fps_mode no existe
        cmd[cmd.index("-fps_mode")] = "-vsync"
        proc = subprocess.run(cmd, capture_output=True, text=True)
    times = [float(m) for m in re.findall(r"pts_time:(\d+(?:\.\d+)?)", proc.stderr or "")]
    files = sorted(tmp.glob("s_*.jpg"))
    frames = []
    for i, f in enumerate(files):
        t = times[i] if i < len(times) else 0.0
        dest = outdir / f"frame_{i:03d}_t{stamp(t)}.jpg"
        shutil.move(str(f), str(dest))
        frames.append({"file": dest.name, "t": round(t, 3), "time": hhmmss(t)})
    shutil.rmtree(tmp, ignore_errors=True)
    return frames


def thin_out(frames: list, outdir: Path, maximum: int) -> list:
    if len(frames) <= maximum:
        return frames
    step = len(frames) / maximum
    keep = {int(i * step) for i in range(maximum)}
    kept = []
    for i, fr in enumerate(frames):
        if i in keep:
            kept.append(fr)
        else:
            (outdir / fr["file"]).unlink(missing_ok=True)
    return kept


def cmd_frames(args) -> dict:
    info = probe(args.video)
    if not info["has_video"]:
        die("el fichero no tiene pista de video (usa 'transcribe' si solo quieres el audio)")
    outdir = Path(args.out or default_outdir(args.video) / "frames")
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob("frame_*.jpg"):
        old.unlink()

    mode = args.mode
    frames = []
    if mode in ("auto", "scene"):
        frames = extract_scene(args.video, outdir, args.threshold, args.width)
        if mode == "auto" and len(frames) < 4:
            for fr in frames:
                (outdir / fr["file"]).unlink(missing_ok=True)
            frames = []
    if not frames:
        mode = "uniform"
        frames = extract_uniform(args.video, outdir, args.count, args.width, info)
    else:
        mode = "scene"
        frames = thin_out(frames, outdir, args.max)

    manifest = _write_manifest(outdir, args.video, frames, mode, info)
    print(f"{len(frames)} fotogramas ({mode}) en {outdir}")
    for fr in frames:
        print(f"  {fr['time']}  {outdir / fr['file']}")
    return manifest


# --------------------------------------------------------------------------
# hoja de contactos
# --------------------------------------------------------------------------


def cmd_sheet(args) -> str:
    src = Path(args.frames)
    files = sorted(src.glob("frame_*.jpg")) if src.is_dir() else []
    if not files:
        die(f"no hay fotogramas en {src} (ejecuta antes 'frames')")
    cols = min(args.cols, len(files))
    rows = math.ceil(len(files) / cols)
    out = Path(args.out or src.parent / "contact_sheet.jpg")
    tile = f"scale={args.tile_width}:-1:flags=lanczos,tile={cols}x{rows}:margin=8:padding=6:color=0x111111"
    run([ffmpeg(), "-y", "-loglevel", "error", "-pattern_type", "glob",
         "-i", str(src / "frame_*.jpg"), "-vf", tile, "-frames:v", "1",
         "-q:v", "3", str(out)])
    print(f"hoja de contactos ({cols}x{rows}, orden izq->der, arriba->abajo): {out}")
    return str(out)


# --------------------------------------------------------------------------
# transcripcion
# --------------------------------------------------------------------------


def extract_audio(src: str, wav: str):
    run([ffmpeg(), "-y", "-loglevel", "error", "-i", src, "-vn",
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav])


def _transcribe_faster_whisper(wav: str, model_size: str, lang, notes: list):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        notes.append("faster-whisper no instalado -> pip3 install faster-whisper")
        return None
    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, info = model.transcribe(wav, language=lang, vad_filter=True, beam_size=1)
        segs = [{"start": round(s.start, 2), "end": round(s.end, 2),
                 "text": s.text.strip()} for s in segments]
    except Exception as exc:
        notes.append(
            f"faster-whisper fallo con el modelo '{model_size}': {exc}\n"
            "    Si el error es de red/proxy, el modelo se baja de huggingface.co la primera "
            "vez.\n    Descargalo en una maquina con salida a internet y copia la cache "
            "(HF_HOME o ~/.cache/huggingface), o usa un modelo mas pequeno (--model tiny).")
        return None
    return {"backend": f"faster-whisper:{model_size}",
            "language": getattr(info, "language", lang), "segments": segs}


def _transcribe_whisper_cli(wav: str, model_size: str, lang, notes: list):
    if not shutil.which("whisper"):
        notes.append("whisper CLI no instalado -> pip3 install -U openai-whisper")
        return None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cmd = ["whisper", wav, "--model", model_size, "--output_format", "json",
                   "--output_dir", tmp, "--fp16", "False"]
            if lang:
                cmd += ["--language", lang]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                notes.append("whisper CLI fallo: " +
                             "\n".join((proc.stderr or "").splitlines()[-3:]))
                return None
            results = list(Path(tmp).glob("*.json"))
            if not results:
                return None
            data = json.loads(results[0].read_text())
    except Exception as exc:
        notes.append(f"whisper CLI fallo: {exc}")
        return None
    segs = [{"start": round(s["start"], 2), "end": round(s["end"], 2),
             "text": s["text"].strip()} for s in data.get("segments", [])]
    return {"backend": f"whisper-cli:{model_size}",
            "language": data.get("language", lang), "segments": segs}


def _transcribe_openai_api(wav: str, lang, notes: list):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        notes.append("OPENAI_API_KEY no definida (backend remoto no disponible)")
        return None
    if not shutil.which("curl"):
        notes.append("curl no disponible para el backend remoto")
        return None
    if os.path.getsize(wav) > 24 * 1024 * 1024:
        notes.append("el audio supera el limite de 25 MB de la API; usa un backend local "
                     "o recorta el video")
        return None
    cmd = ["curl", "-sS", "https://api.openai.com/v1/audio/transcriptions",
           "-H", f"Authorization: Bearer {key}",
           "-F", f"file=@{wav}", "-F", "model=whisper-1",
           "-F", "response_format=verbose_json"]
    if lang:
        cmd += ["-F", f"language={lang}"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(proc.stdout)
    except Exception:
        notes.append("la API remota no devolvio JSON valido")
        return None
    if "segments" not in data:
        notes.append(f"la API remota devolvio: {str(data)[:200]}")
        return None
    segs = [{"start": round(s["start"], 2), "end": round(s["end"], 2),
             "text": s["text"].strip()} for s in data["segments"]]
    return {"backend": "openai-api:whisper-1",
            "language": data.get("language", lang), "segments": segs}


TRANSCRIBE_HELP = """No hay ningun motor de transcripcion disponible. Elige uno:
  pip3 install faster-whisper     (local, recomendado, CPU)
  pip3 install -U openai-whisper  (local, mas lento)
  export OPENAI_API_KEY=...       (API remota; el audio sale de la maquina)"""


def to_srt(segments: list) -> str:
    def ts(x):
        return hhmmss(x).replace(".", ",")
    out = []
    for i, s in enumerate(segments, 1):
        out.append(f"{i}\n{ts(s['start'])} --> {ts(s['end'])}\n{s['text']}\n")
    return "\n".join(out)


def to_txt(segments: list) -> str:
    return "\n".join(f"[{hhmmss(s['start'])[:8]}] {s['text']}" for s in segments)


def cmd_transcribe(args) -> dict:
    info = probe(args.video)
    if not info["has_audio"]:
        print("el fichero no tiene pista de audio: nada que transcribir")
        return {"segments": [], "backend": None}
    outdir = Path(args.out_dir or default_outdir(args.video))
    outdir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")
        extract_audio(args.video, wav)
        notes: list = []
        result = (_transcribe_faster_whisper(wav, args.model, args.lang, notes)
                  or _transcribe_whisper_cli(wav, args.model, args.lang, notes)
                  or _transcribe_openai_api(wav, args.lang, notes))
    if result is None:
        die(TRANSCRIBE_HELP + "\n\nLo que se intento:\n  - " + "\n  - ".join(notes))
    segments = result["segments"]
    (outdir / "transcript.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    (outdir / "transcript.srt").write_text(to_srt(segments))
    txt = to_txt(segments)
    (outdir / "transcript.txt").write_text(txt)
    print(f"transcripcion ({result['backend']}, idioma={result.get('language')}): "
          f"{len(segments)} segmentos -> {outdir / 'transcript.txt'}")
    if txt:
        print("--- primeras lineas ---")
        print("\n".join(txt.splitlines()[:8]))
    return result


# --------------------------------------------------------------------------
# descarga
# --------------------------------------------------------------------------


YTDLP_HELP = """No se encuentra yt-dlp. Instalalo con:
  pip3 install -U yt-dlp"""


def ytdlp_cmd():
    if shutil.which("yt-dlp"):
        return ["yt-dlp"]
    probe_mod = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"],
                               capture_output=True, text=True)
    if probe_mod.returncode == 0:
        return [sys.executable, "-m", "yt_dlp"]
    die(YTDLP_HELP)


def cmd_fetch(args) -> str:
    outdir = Path(args.out or ".video-cache/downloads")
    outdir.mkdir(parents=True, exist_ok=True)
    fmt = (f"bv*[height<={args.max_height}]+ba/b[height<={args.max_height}]/b")
    cmd = ytdlp_cmd() + [
        "-f", fmt,
        "--no-playlist",
        "--merge-output-format", "mp4",
        "-o", str(outdir / "%(title).80s.%(ext)s"),
        "--print", "after_move:filepath",
    ]
    if args.subs:
        cmd += ["--write-subs", "--write-auto-subs", "--sub-langs", args.sub_langs,
                "--convert-subs", "srt"]
    cmd.append(args.url)
    proc = run(cmd)
    path = ""
    for line in proc.stdout.strip().splitlines():
        if os.path.exists(line.strip()):
            path = line.strip()
    if not path:
        candidates = sorted(outdir.glob("*.*"), key=os.path.getmtime)
        candidates = [c for c in candidates if c.suffix not in (".srt", ".vtt")]
        if candidates:
            path = str(candidates[-1])
    if not path:
        die("yt-dlp no dejo ningun fichero descargado")
    print(f"descargado: {path}")
    for sub in sorted(outdir.glob("*.srt")):
        print(f"subtitulos: {sub}")
    return path


# --------------------------------------------------------------------------
# watch (todo junto)
# --------------------------------------------------------------------------


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-")[:60] or "video"


def default_outdir(video: str) -> Path:
    return Path(".video-cache") / slug(Path(video).stem)


def cmd_watch(args):
    source = args.video
    if source.startswith(("http://", "https://")):
        fetch_args = argparse.Namespace(url=source, out=None, max_height=args.max_height,
                                        subs=True, sub_langs=args.sub_langs)
        source = cmd_fetch(fetch_args)

    info = probe(source)
    outdir = Path(args.out or default_outdir(source))
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"\n== {source}")
    print(f"   duracion {hhmmss(info['duration'])}  {info['width']}x{info['height']} "
          f"@{info['fps']}fps  audio={'si' if info['has_audio'] else 'no'}")

    manifest = None
    if info["has_video"] and not args.audio_only:
        frames_args = argparse.Namespace(video=source, out=str(outdir / "frames"),
                                         mode=args.mode, count=args.count, max=args.max,
                                         threshold=args.threshold, width=args.width)
        print()
        manifest = cmd_frames(frames_args)
        if manifest["frames"] and not args.no_sheet:
            cmd_sheet(argparse.Namespace(frames=str(outdir / "frames"), out=None,
                                         cols=args.cols, tile_width=args.width))

    transcript = None
    if info["has_audio"] and not args.no_audio:
        print()
        transcript = cmd_transcribe(argparse.Namespace(
            video=source, out_dir=str(outdir), model=args.model, lang=args.lang))

    lines = [f"# Analisis de video: {Path(source).name}", "",
             f"- fichero: `{os.path.abspath(source)}`",
             f"- duracion: {hhmmss(info['duration'])}",
             f"- resolucion: {info['width']}x{info['height']} @ {info['fps']} fps",
             f"- audio: {'si' if info['has_audio'] else 'no'}", ""]
    if manifest:
        lines += ["## Fotogramas", ""]
        for fr in manifest["frames"]:
            lines.append(f"- {fr['time']} -> `{outdir / 'frames' / fr['file']}`")
        lines.append("")
    if transcript and transcript.get("segments"):
        lines += ["## Transcripcion", "", "```", to_txt(transcript["segments"]), "```", ""]
    (outdir / "report.md").write_text("\n".join(lines))
    print(f"\ninforme: {outdir / 'report.md'}")
    print("Siguiente paso: lee los JPG con la tool Read (uno a uno, o la hoja de contactos).")


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("probe", help="datos tecnicos del video")
    sp.add_argument("video")
    sp.set_defaults(func=lambda a: print(json.dumps(probe(a.video), indent=2)))

    sf = sub.add_parser("frames", help="extrae fotogramas a JPG")
    sf.add_argument("video")
    sf.add_argument("--out", help="carpeta destino")
    sf.add_argument("--mode", choices=["auto", "scene", "uniform"], default="auto")
    sf.add_argument("--count", type=int, default=12, help="fotogramas en modo uniform")
    sf.add_argument("--max", type=int, default=24, help="tope de fotogramas en modo scene")
    sf.add_argument("--threshold", type=float, default=0.4, help="sensibilidad de escena 0-1")
    sf.add_argument("--width", type=int, default=960)
    sf.set_defaults(func=cmd_frames)

    ss = sub.add_parser("sheet", help="hoja de contactos a partir de una carpeta de frames")
    ss.add_argument("frames")
    ss.add_argument("--out")
    ss.add_argument("--cols", type=int, default=4)
    ss.add_argument("--tile-width", type=int, default=480)
    ss.set_defaults(func=cmd_sheet)

    st = sub.add_parser("transcribe", help="audio -> texto con timestamps")
    st.add_argument("video")
    st.add_argument("--out-dir")
    st.add_argument("--model", default="base", help="tiny|base|small|medium|large-v3")
    st.add_argument("--lang", default=None, help="es, en, ... (por defecto autodeteccion)")
    st.set_defaults(func=cmd_transcribe)

    sd = sub.add_parser("fetch", help="descarga un video de YouTube/web")
    sd.add_argument("url")
    sd.add_argument("--out")
    sd.add_argument("--max-height", type=int, default=720)
    sd.add_argument("--subs", action="store_true", default=True)
    sd.add_argument("--sub-langs", default="es,en")
    sd.set_defaults(func=cmd_fetch)

    sw = sub.add_parser("watch", help="fichero o URL -> fotogramas + transcripcion + informe")
    sw.add_argument("video", help="ruta local o URL")
    sw.add_argument("--out")
    sw.add_argument("--mode", choices=["auto", "scene", "uniform"], default="auto")
    sw.add_argument("--count", type=int, default=12)
    sw.add_argument("--max", type=int, default=24)
    sw.add_argument("--threshold", type=float, default=0.4)
    sw.add_argument("--width", type=int, default=960)
    sw.add_argument("--cols", type=int, default=4)
    sw.add_argument("--model", default="base")
    sw.add_argument("--lang", default=None)
    sw.add_argument("--max-height", type=int, default=720, help="calidad maxima al descargar")
    sw.add_argument("--sub-langs", default="es,en")
    sw.add_argument("--no-audio", action="store_true", help="solo lo visual")
    sw.add_argument("--audio-only", action="store_true", help="solo la transcripcion")
    sw.add_argument("--no-sheet", action="store_true")
    sw.set_defaults(func=cmd_watch)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
