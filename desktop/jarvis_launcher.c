/*
 * jarvis_launcher.c - abre Jarvis como si fuera una app de escritorio.
 *
 * Busca Chrome (o Edge) y lo abre en modo --app: ventana limpia, sin barra de
 * direcciones ni pestañas. Si no encuentra ninguno de los dos, abre el
 * navegador por defecto y avisa de que el reconocimiento de voz puede no
 * funcionar: la Web Speech API que usa Jarvis solo existe en Chrome y Edge.
 *
 * Uso:  jarvis.exe [https://otra-url]
 *
 * Compilar (desde Linux o desde Windows con mingw):
 *   ./desktop/build.sh
 */
/* -municode ya los define; las guardas evitan el aviso de redefinicion */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <shellapi.h>

#include "jarvis_cmdline.h"

#define MAX_CMDLINE 4096

/* Rutas habituales de instalacion, con variables de entorno sin expandir. */
static const wchar_t *BROWSER_PATHS[] = {
    L"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
    L"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
    L"%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe",
    L"%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
    L"%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
};

static int file_exists(const wchar_t *path)
{
    DWORD attrs = GetFileAttributesW(path);
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

/* Windows registra la ruta real de cada navegador en App Paths. */
static int browser_from_registry(HKEY root, const wchar_t *exe,
                                 wchar_t *out, DWORD out_bytes)
{
    wchar_t key[256];
    DWORD size = out_bytes;

    key[0] = L'\0';
    wcscat(key, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\");
    wcscat(key, exe);

    if (RegGetValueW(root, key, NULL, RRF_RT_REG_SZ, NULL, out, &size) != ERROR_SUCCESS)
        return 0;

    return file_exists(out);
}

static int find_browser(wchar_t *out, DWORD out_chars)
{
    const wchar_t *exes[] = { L"chrome.exe", L"msedge.exe" };
    wchar_t expanded[MAX_PATH];
    size_t i;

    for (i = 0; i < sizeof(exes) / sizeof(exes[0]); i++) {
        if (browser_from_registry(HKEY_CURRENT_USER, exes[i], out, out_chars * sizeof(wchar_t)))
            return 1;
        if (browser_from_registry(HKEY_LOCAL_MACHINE, exes[i], out, out_chars * sizeof(wchar_t)))
            return 1;
    }

    for (i = 0; i < sizeof(BROWSER_PATHS) / sizeof(BROWSER_PATHS[0]); i++) {
        if (ExpandEnvironmentStringsW(BROWSER_PATHS[i], expanded, MAX_PATH) == 0)
            continue;
        if (file_exists(expanded)) {
            wcsncpy(out, expanded, out_chars - 1);
            out[out_chars - 1] = L'\0';
            return 1;
        }
    }

    return 0;
}

static int launch(const wchar_t *browser, const wchar_t *url)
{
    wchar_t cmdline[MAX_CMDLINE];
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;

    if (!jarvis_build_command_line(browser, url, cmdline, MAX_CMDLINE))
        return 0;

    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    if (!CreateProcessW(NULL, cmdline, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi))
        return 0;

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return 1;
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrev, PWSTR lpCmdLine, int nCmdShow)
{
    wchar_t browser[MAX_PATH];
    const wchar_t *url = JARVIS_DEFAULT_URL;
    LPWSTR *argv;
    int argc = 0;

    (void)hInstance; (void)hPrev; (void)lpCmdLine; (void)nCmdShow;

    /* Se puede pasar otra URL como argumento (util para probar en local). */
    argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (argv) {
        if (argc > 1 && jarvis_url_is_safe(argv[1]))
            url = argv[1];
        else if (argc > 1)
            MessageBoxW(NULL, L"La URL indicada no es valida. Se abrira la de siempre.",
                        L"Jarvis", MB_OK | MB_ICONWARNING);
    }

    if (find_browser(browser, MAX_PATH) && launch(browser, url))
        return 0;

    /* Sin Chrome ni Edge: el navegador por defecto, avisando de la limitacion. */
    MessageBoxW(NULL,
                L"No se ha encontrado Chrome ni Edge.\n\n"
                L"Jarvis se abrira en el navegador por defecto, pero el "
                L"reconocimiento de voz solo funciona en Chrome o Edge "
                L"(Firefox y Safari no implementan la Web Speech API).",
                L"Jarvis", MB_OK | MB_ICONINFORMATION);

    if ((INT_PTR)ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL) <= 32) {
        MessageBoxW(NULL, L"No se ha podido abrir el navegador.", L"Jarvis",
                    MB_OK | MB_ICONERROR);
        return 1;
    }

    return 0;
}
