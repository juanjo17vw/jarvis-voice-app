#!/usr/bin/env bash
# Compila jarvis.exe (Windows 64 bits) desde Linux, macOS o Windows.
#
#   Linux/WSL:  sudo apt-get install -y mingw-w64
#   macOS:      brew install mingw-w64
#
# Salida: desktop/jarvis.exe
set -euo pipefail

cd "$(dirname "$0")"

CC="${CC:-x86_64-w64-mingw32-gcc}"

if ! command -v "$CC" >/dev/null; then
    echo "No se encuentra $CC. Instala mingw-w64 (ver cabecera de este script)." >&2
    exit 1
fi

echo "== test de la logica (compilado nativo) =="
cc -std=c99 -Wall -Wextra -Werror -o /tmp/jarvis_test tests/test_cmdline.c
/tmp/jarvis_test

echo "== compilando jarvis.exe =="
"$CC" -std=c99 -Wall -Wextra -O2 -municode -mwindows \
    -o jarvis.exe jarvis_launcher.c \
    -lshell32 -ladvapi32
x86_64-w64-mingw32-strip jarvis.exe 2>/dev/null || true

ls -lh jarvis.exe
echo "Listo: desktop/jarvis.exe"
