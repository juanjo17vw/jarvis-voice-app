/*
 * jarvis_cmdline.h - logica pura del lanzador, sin nada de Win32.
 *
 * Esta separado del resto para poder probarlo con gcc en cualquier sistema
 * (ver tests/test_cmdline.c): armar la linea de comandos con comillas es la
 * parte que mas facil se rompe, y en un .exe cruzado no se puede depurar.
 */
#ifndef JARVIS_CMDLINE_H
#define JARVIS_CMDLINE_H

#include <stddef.h>
#include <wchar.h>

#define JARVIS_DEFAULT_URL L"https://juanjo17vw.github.io/jarvis-voice-app/"

/* Solo aceptamos http(s): evita que un argumento raro acabe en ShellExecute
   ejecutando otra cosa (file:, javascript:, una ruta a un .exe...). */
static int jarvis_is_http_url(const wchar_t *s)
{
    if (!s) return 0;
    if (wcsncmp(s, L"https://", 8) == 0) return wcslen(s) > 8;
    if (wcsncmp(s, L"http://", 7) == 0)  return wcslen(s) > 7;
    return 0;
}

/* Rechaza comillas y caracteres de control: no hay forma segura de meterlos
   en una linea de comandos de Windows y no aparecen en una URL legitima. */
static int jarvis_url_is_safe(const wchar_t *url)
{
    size_t i;
    if (!jarvis_is_http_url(url)) return 0;
    for (i = 0; url[i]; i++) {
        if (url[i] == L'"' || url[i] < 32 || url[i] == 127) return 0;
    }
    return 1;
}

/*
 * Construye:  "C:\...\chrome.exe" --app=URL --window-size=520,780
 *
 * El modo --app abre una ventana limpia, sin barra de direcciones, que es lo
 * que hace que parezca una aplicacion y no una pestaña del navegador.
 * Devuelve 1 si cupo entero, 0 si no (y entonces out queda vacio).
 */
static int jarvis_build_command_line(const wchar_t *browser, const wchar_t *url,
                                     wchar_t *out, size_t out_len)
{
    const wchar_t *prefix = L" --app=";
    const wchar_t *suffix = L" --window-size=520,780";
    size_t needed;

    if (!browser || !url || !out || out_len == 0) return 0;
    if (!jarvis_url_is_safe(url)) return 0;

    /* comillas del ejecutable (2) + prefijo + url + sufijo + terminador */
    needed = 2 + wcslen(browser) + wcslen(prefix) + wcslen(url) + wcslen(suffix) + 1;
    if (needed > out_len) {
        out[0] = L'\0';
        return 0;
    }

    out[0] = L'\0';
    wcscat(out, L"\"");
    wcscat(out, browser);
    wcscat(out, L"\"");
    wcscat(out, prefix);
    wcscat(out, url);
    wcscat(out, suffix);
    return 1;
}

#endif /* JARVIS_CMDLINE_H */
