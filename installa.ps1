param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\LootSniper'),
    [switch]$NoLaunch,
    [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$sourceRoot = $PSScriptRoot
$installRoot = [IO.Path]::GetFullPath($InstallDir)
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'distribuzione.json') -Raw | ConvertFrom-Json
if ($installRoot -eq [IO.Path]::GetPathRoot($installRoot)) { throw 'Scegli una cartella dedicata a LootSniper.' }
if ((Test-Path -LiteralPath $installRoot) -and ((Get-Item -LiteralPath $installRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'La cartella di installazione non puo essere un collegamento.' }
foreach ($name in $manifest.files) {
    $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $name))
    $target = [IO.Path]::GetFullPath((Join-Path $installRoot $name))
    if (-not $source.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
        -not $target.StartsWith($installRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Percorso non valido nel pacchetto.' }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw ('Estrai tutto lo ZIP prima di installare. File mancante: ' + $name) }
}
try {
    $running = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2
} catch { $running = $null }
$sha = [Security.Cryptography.SHA256]::Create()
try { $targetId = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($installRoot.TrimEnd('\').ToLowerInvariant())))).Replace('-','').ToLowerInvariant().Substring(0,16) } finally { $sha.Dispose() }
if ($running -and $running.online -and $running.workspace -eq $targetId) {
    Write-Host 'Chiudo automaticamente LootSniper per completare l aggiornamento...'
    try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/api/shutdown' -Headers @{ Origin = 'http://127.0.0.1:8765' } -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null } catch {}
    $deadline = (Get-Date).AddSeconds(5)
    do {
        Start-Sleep -Milliseconds 200
        $installedProcess = Get-Process -Name 'LootSniper' -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($installRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) } catch { $false }
        }
    } while ($installedProcess -and (Get-Date) -lt $deadline)
    $installedProcess | Stop-Process -Force -ErrorAction SilentlyContinue
} elseif ($running -and $running.online -and -not $NoLaunch) {
    throw 'La porta 8765 e usata da un altra copia di LootSniper. Chiudila e riprova.'
}
$nativeArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($nativeArch) { 'ARM64' {'arm64'} 'AMD64' {'amd64'} 'x86' {'win32'} default {throw 'Architettura Windows non supportata.'} }
$pythonVersion = '3.14.7'
# SHA-256 published by Python.org for these exact embeddable distributions.
$hashes = @{
    amd64 = 'd297e5ff019966817ad8502465176139f2d3d840fa4ed84b13bed399a6ab1f15'
    win32 = '2bce2347adb05b4565d0bf50f7a44298f6c0bb08ae4f9d88d051b8512a55fcf7'
    arm64 = 'f6773983c8959d4281e48c4540cb0bdd23e42391e4e951ce17e7ceb52658f21c'
}
$runtimeRoot = Join-Path $installRoot '.runtime'
if ((Test-Path -LiteralPath $runtimeRoot) -and ((Get-Item -LiteralPath $runtimeRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Cartella runtime non sicura.' }
$python = Join-Path $runtimeRoot 'python.exe'
Write-Host 'LootSniper - installazione personale' -ForegroundColor Cyan
Write-Host ('Destinazione: ' + $installRoot)
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$ready = $false
if (Test-Path -LiteralPath $python) {
    $detected = & $python -I -c "import sys,ssl,http.server; print('.'.join(map(str,sys.version_info[:3])))" 2>$null
    $ready = $LASTEXITCODE -eq 0 -and $detected -eq $pythonVersion
}
if (-not $ready) {
    Write-Host '[1/4] Scarico Python privato da python.org (circa 12 MB)...'
    $download = Join-Path ([IO.Path]::GetTempPath()) ('lootsniper-python-' + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        $uri = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-$arch.zip"
        Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $download -TimeoutSec 180
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes[$arch]) { throw 'Il download non supera la verifica SHA-256. Nessun file scaricato verra eseguito.' }
        if ((Test-Path -LiteralPath $runtimeRoot) -and ((Get-Item -LiteralPath $runtimeRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Cartella runtime non sicura.' }
        Expand-Archive -LiteralPath $download -DestinationPath $runtimeRoot -Force
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
    }
} else { Write-Host '[1/4] Python privato gia pronto: nessun download necessario.' }
# The isolated interpreter can import the application from its parent directory.
[IO.File]::WriteAllText((Join-Path $runtimeRoot 'python314._pth'), "python314.zip`n.`nDLLs`nLib`n..`n", [Text.Encoding]::ASCII)
Write-Host '[2/4] Preparo il programma e conservo gli archivi esistenti...'
if (-not $sourceRoot.Equals($installRoot,[StringComparison]::OrdinalIgnoreCase)) {
    foreach ($name in $manifest.files) {
        $target = Join-Path $installRoot $name
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $target -Force
    }
    foreach ($name in @('radar-searches.json','radar-imports.json','radar-discord.json')) {
        $source = Join-Path $sourceRoot $name
        $target = Join-Path $installRoot $name
        if ((Test-Path -LiteralPath $source -PathType Leaf) -and -not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath $source -Destination $target }
    }
}
& $python -I -c 'import server, radar_discord, radar_lifecycle'
if ($LASTEXITCODE -ne 0) { throw 'Il runtime non riesce ad avviare il programma. Controlla che Windows sia aggiornato e riprova.' }
Write-Host 'Verifica programma: OK'
$desktopPackage = Join-Path $installRoot ([string]$manifest.desktop.file)
if (-not (Test-Path -LiteralPath $desktopPackage -PathType Leaf)) { throw 'Pacchetto desktop mancante. Estrai nuovamente lo ZIP di LootSniper.' }
if ((Get-FileHash -LiteralPath $desktopPackage -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$manifest.desktop.sha256).ToLowerInvariant()) {
    throw 'Il pacchetto LootSniper.exe non supera la verifica SHA-256.'
}
Expand-Archive -LiteralPath $desktopPackage -DestinationPath $installRoot -Force
Remove-Item -LiteralPath $desktopPackage -Force
if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'LootSniper.exe') -PathType Leaf)) { throw 'LootSniper.exe non e stato installato correttamente.' }
Write-Host '[3/4] Controllo il browser Microsoft WebView2...'
$webViewReady = $false
foreach ($registryPath in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*','HKCU:\Software\Microsoft\EdgeUpdate\Clients\*')) {
    if (Get-ItemProperty $registryPath -ErrorAction SilentlyContinue | Where-Object { $_.name -eq 'Microsoft Edge WebView2 Runtime' }) { $webViewReady = $true; break }
}
if (-not $webViewReady) {
    Write-Host 'Scarico WebView2 Evergreen dal sito Microsoft...'
    $webViewInstaller = Join-Path ([IO.Path]::GetTempPath()) ('lootsniper-webview2-' + [guid]::NewGuid().ToString('N') + '.exe')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $webViewInstaller -TimeoutSec 180
        $webViewProcess = Start-Process -FilePath $webViewInstaller -ArgumentList '/silent /install' -Wait -PassThru -WindowStyle Hidden
        if ($webViewProcess.ExitCode -ne 0) { throw ('Installazione WebView2 non riuscita. Codice: ' + $webViewProcess.ExitCode) }
    } finally { if (Test-Path -LiteralPath $webViewInstaller) { Remove-Item -LiteralPath $webViewInstaller -Force } }
} else { Write-Host 'WebView2 gia disponibile: nessun download necessario.' }
Write-Host '[4/4] Creo i collegamenti...'
if (-not $NoShortcuts) {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
        $shortcut = $shell.CreateShortcut((Join-Path $folder 'LootSniper.lnk'))
        $shortcut.TargetPath = Join-Path $installRoot 'LootSniper.exe'
        $shortcut.Arguments = ''
        $shortcut.WorkingDirectory = $installRoot
        $shortcut.IconLocation = (Join-Path $installRoot 'assets\lootsniper.ico') + ',0'
        $shortcut.Description = 'LootSniper - trova e confronta tecnologia usata'
        $shortcut.Save()
    }
    $uninstallShortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Disinstalla LootSniper.lnk'))
    $uninstallShortcut.TargetPath = $env:ComSpec
    $uninstallShortcut.Arguments = '/d /c ""' + (Join-Path $installRoot 'Disinstalla LootSniper.cmd') + '""'
    $uninstallShortcut.WorkingDirectory = $installRoot
    $uninstallShortcut.IconLocation = (Join-Path $installRoot 'assets\lootsniper.ico') + ',0'
    $uninstallShortcut.Description = 'LootSniper - disinstallazione completa'
    $uninstallShortcut.Save()
}
Write-Host 'Installazione completata. Avvia LootSniper dal collegamento sul desktop.' -ForegroundColor Green
if (-not $NoLaunch) { Start-Process -FilePath (Join-Path $installRoot 'LootSniper.exe') -WorkingDirectory $installRoot }
