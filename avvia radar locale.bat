@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if "%~1"=="--background" goto background
start "" wscript.exe "%~dp0avvia radar.vbs"
exit /b 0
:background
if exist "%~dp0.runtime\python.exe" (
    "%~dp0.runtime\python.exe" "%~dp0launcher.py" --background >> "%~dp0radar-avvio.log" 2>&1
    exit /b
)
where py >nul 2>nul
if not errorlevel 1 (
    py -3 "%~dp0launcher.py" --background >> "%~dp0radar-avvio.log" 2>&1
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python non trovato. Installa Python 3.10 o successivo e riprova. >> "%~dp0radar-avvio.log"
        exit /b 1
    ) else (
        python "%~dp0launcher.py" --background >> "%~dp0radar-avvio.log" 2>&1
    )
)
exit /b %errorlevel%
