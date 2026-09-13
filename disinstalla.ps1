param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\LootSniper'),
    [switch]$Yes,
    [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$installRoot = [IO.Path]::GetFullPath($InstallDir)

function Get-WorkspaceId([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Path.TrimEnd('\').ToLowerInvariant())
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant().Substring(0,16)
    } finally { $sha.Dispose() }
}

function Remove-LootSniperShortcut([string]$Path, [string]$ExpectedFragment) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    try {
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
        $description = [string]$shortcut.Description
        $targetAndArguments = ([string]$shortcut.TargetPath) + ' ' + ([string]$shortcut.Arguments)
        if ($targetAndArguments.IndexOf($ExpectedFragment, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Remove-Item -LiteralPath $Path -Force
        }
    } catch {
        Write-Warning ('Impossibile controllare il collegamento: ' + $Path)
    }
}

if ($installRoot -eq [IO.Path]::GetPathRoot($installRoot)) { throw 'Percorso di installazione non valido.' }
if (-not $Yes) {
    Write-Host 'LootSniper - disinstallazione completa' -ForegroundColor Cyan
    Write-Host ('Verranno rimossi programma, runtime privato, ricerche, webhook Discord, log e collegamenti da: ' + $installRoot)
    Write-Host 'Gli eventuali backup esportati in altre cartelle non verranno eliminati.'
    $answer = (Read-Host 'Continuare? Scrivi S per confermare').Trim()
    if ($answer -notmatch '^(s|si)$') {
        Write-Host 'Disinstallazione annullata. Non e stato modificato nulla.' -ForegroundColor Yellow
        exit 0
    }
}

if (Test-Path -LiteralPath $installRoot) {
    $item = Get-Item -LiteralPath $installRoot -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'La cartella installata e un collegamento: rimozione interrotta.' }
    # These markers exist in older releases too, so the new uninstaller can remove them safely.
    foreach ($marker in @('server.py', 'launcher.py', 'distribuzione.json', 'radar usato 3 market.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $marker) -PathType Leaf)) {
            throw ('La cartella non sembra una installazione completa di LootSniper. File mancante: ' + $marker)
        }
    }

    $expectedWorkspace = Get-WorkspaceId $installRoot
    try { $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2 } catch { $status = $null }
    if ($status -and $status.online -and $status.workspace -eq $expectedWorkspace) {
        Write-Host 'Arresto LootSniper...'
        try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/api/shutdown' -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null } catch {}
        $stopped = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 200
            try { $current = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 1 } catch { $current = $null }
            if (-not $current -or $current.workspace -ne $expectedWorkspace) { $stopped = $true; break }
        }
        if (-not $stopped) { throw 'LootSniper non si e arrestato. Premi Arresta LootSniper nella dashboard e riprova.' }
    }
}

if (-not $NoShortcuts) {
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'LootSniper.lnk'
    $programs = [Environment]::GetFolderPath('Programs')
    Remove-LootSniperShortcut $desktop (Join-Path $installRoot 'avvia radar.vbs')
    Remove-LootSniperShortcut (Join-Path $programs 'LootSniper.lnk') (Join-Path $installRoot 'avvia radar.vbs')
    Remove-LootSniperShortcut (Join-Path $programs 'Disinstalla LootSniper.lnk') (Join-Path $installRoot 'Disinstalla LootSniper.cmd')
}

if (Test-Path -LiteralPath $installRoot) {
    Set-Location ([IO.Path]::GetTempPath())
    Remove-Item -LiteralPath $installRoot -Recurse -Force
}
if (Test-Path -LiteralPath $installRoot) { throw 'La cartella di LootSniper non e stata rimossa completamente.' }
Write-Host 'LootSniper e stato disinstallato completamente.' -ForegroundColor Green
