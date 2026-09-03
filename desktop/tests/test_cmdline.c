/* Prueba de jarvis_cmdline.h con gcc nativo: la parte del lanzador que se
   puede romper en silencio es armar la linea de comandos y filtrar la URL. */
#include <assert.h>
#include <stdio.h>
#include <wchar.h>

#include "../jarvis_cmdline.h"

static int fallos = 0;

static void check(int cond, const char *nombre)
{
    printf("  %s %s\n", cond ? "ok  " : "FALLO", nombre);
    if (!cond) fallos++;
}

int main(void)
{
    wchar_t out[4096];
    wchar_t pequeno[10];

    printf("jarvis_url_is_safe:\n");
    check(jarvis_url_is_safe(L"https://juanjo17vw.github.io/jarvis-voice-app/"), "url normal");
    check(jarvis_url_is_safe(L"http://localhost:8000/index.html"), "localhost para pruebas");
    check(!jarvis_url_is_safe(L"file:///C:/x.html"), "rechaza file:");
    check(!jarvis_url_is_safe(L"javascript:alert(1)"), "rechaza javascript:");
    check(!jarvis_url_is_safe(L"C:\\Windows\\System32\\calc.exe"), "rechaza ruta local");
    check(!jarvis_url_is_safe(L"https://"), "rechaza esquema sin host");
    check(!jarvis_url_is_safe(NULL), "rechaza NULL");
    check(!jarvis_url_is_safe(L"https://x/\" --headless \""), "rechaza comillas incrustadas");
    check(!jarvis_url_is_safe(L"https://x/\ny"), "rechaza salto de linea");

    printf("jarvis_build_command_line:\n");
    check(jarvis_build_command_line(L"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                                    L"https://ejemplo.test/", out, 4096), "construye la linea");
    check(wcscmp(out, L"\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\""
                      L" --app=https://ejemplo.test/ --window-size=520,780") == 0,
          "ruta entrecomillada y flags correctos");

    check(!jarvis_build_command_line(L"C:\\chrome.exe", L"no-es-una-url", out, 4096),
          "no construye nada con una url invalida");

    out[0] = L'X';
    check(!jarvis_build_command_line(L"C:\\chrome.exe", L"https://ejemplo.test/", pequeno, 10)
          && (pequeno[0] == L'\0'), "buffer pequeno: falla y deja la salida vacia");

    check(!jarvis_build_command_line(NULL, L"https://ejemplo.test/", out, 4096), "rechaza browser NULL");
    check(!jarvis_build_command_line(L"C:\\chrome.exe", L"https://ejemplo.test/", out, 0), "rechaza tamano 0");

    printf(fallos ? "\n%d FALLOS\n" : "\nTodo correcto (%d fallos)\n", fallos);
    return fallos ? 1 : 0;
}
