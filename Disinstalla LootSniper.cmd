@echo off
setlocal
cd /d "%TEMP%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0disinstalla.ps1"
if errorlevel 1 (
    echo.
    echo Disinstallazione non completata. Leggi il messaggio sopra e riprova.
    pause
    exit /b 1
)
echo.
pause
exit /b 0
