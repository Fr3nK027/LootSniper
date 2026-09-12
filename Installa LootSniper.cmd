@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1"
if errorlevel 1 (
    echo.
    echo Installazione non completata. Leggi il messaggio sopra e riprova.
    pause
    exit /b 1
)
exit /b 0
