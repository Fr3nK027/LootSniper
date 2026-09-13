param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\LootSniper'),
    [switch]$Yes,
    [switch]$NoShortcuts,
    [string[]]$ShortcutRoots = @()
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

function Add-UniqueFolder($Folders, [string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    try {
        $fullPath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd('\')
        if ($fullPath -and -not $Folders.Contains($fullPath)) { [void]$Folders.Add($fullPath) }
    } catch {}
}

function Get-ShortcutFolders {
    $folders = New-Object 'Collections.Generic.List[string]'
    if ($ShortcutRoots.Count) {
        foreach ($path in $ShortcutRoots) { Add-UniqueFolder $folders $path }
        return $folders
    }
    Add-UniqueFolder $folders ([Environment]::GetFolderPath('Desktop'))
    Add-UniqueFolder $folders (Join-Path $env:USERPROFILE 'Desktop')
    foreach ($variable in @('OneDrive', 'OneDriveConsumer', 'OneDriveCommercial')) {
        $oneDrive = [Environment]::GetEnvironmentVariable($variable)
        if ($oneDrive) { Add-UniqueFolder $folders (Join-Path $oneDrive 'Desktop') }
    }
    foreach ($registryPath in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders'
    )) {
        try { Add-UniqueFolder $folders ([string](Get-ItemProperty -LiteralPath $registryPath -Name Desktop).Desktop) } catch {}
    }
    Add-UniqueFolder $folders ([Environment]::GetFolderPath('Programs'))
    return $folders
}

function Remove-LootSniperShortcuts {
    foreach ($folder in (Get-ShortcutFolders)) {
        foreach ($name in @('LootSniper.lnk', 'Disinstalla LootSniper.lnk')) {
            $path = Join-Path $folder $name
            try { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue } catch {
                Write-Warning ('Impossibile eliminare il collegamento: ' + $path)
            }
        }
    }
}

function Refresh-Desktop {
    try {
        if (-not ('LootSniper.NativeShell' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace LootSniper {
    public static class NativeShell {
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    }
}
'@
        }
        [LootSniper.NativeShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
        $desktopShell = New-Object -ComObject Shell.Application
        $desktopShell.NameSpace(0).Self.InvokeVerb('refresh')
    } catch {}
}

function Get-ProtectedProcessIds {
    $ids = New-Object 'Collections.Generic.HashSet[int]'
    $nextId = $PID
    while ($nextId -gt 0 -and $ids.Add([int]$nextId)) {
        try { $nextId = [int](Get-CimInstance Win32_Process -Filter ('ProcessId=' + $nextId)).ParentProcessId } catch { break }
    }
    return ,$ids
}

function Stop-LootSniperProcesses {
    $protectedIds = Get-ProtectedProcessIds
    $allowedNames = @('python.exe', 'pythonw.exe', 'py.exe', 'wscript.exe', 'cscript.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe')
    $stoppedIds = New-Object 'Collections.Generic.HashSet[int]'
    foreach ($process in (Get-Process -ErrorAction SilentlyContinue)) {
        if ($protectedIds.Contains([int]$process.Id)) { continue }
        try { $executable = [string]$process.Path } catch { $executable = '' }
        if ($executable.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            Write-Host ('Chiusura processo LootSniper: ' + $process.ProcessName)
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            [void]$stoppedIds.Add([int]$process.Id)
        }
    }
    try { $processes = Get-CimInstance Win32_Process -ErrorAction Stop } catch { $processes = @() }
    foreach ($process in $processes) {
        if ($protectedIds.Contains([int]$process.ProcessId) -or $stoppedIds.Contains([int]$process.ProcessId) -or
            $allowedNames -notcontains ([string]$process.Name).ToLowerInvariant()) { continue }
        if (([string]$process.CommandLine).IndexOf($installRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Write-Host ('Chiusura processo LootSniper: ' + $process.Name)
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            [void]$stoppedIds.Add([int]$process.ProcessId)
        }
    }
    foreach ($stoppedId in $stoppedIds) { Wait-Process -Id $stoppedId -Timeout 5 -ErrorAction SilentlyContinue }
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
    # Two markers are enough to recognize old or partially removed installations without deleting an unrelated folder.
    $markerCount = @('server.py', 'launcher.py', 'distribuzione.json', 'radar usato 3 market.html').Where({
        Test-Path -LiteralPath (Join-Path $installRoot $_) -PathType Leaf
    }).Count
    if ($markerCount -lt 2) { throw 'La cartella non sembra una installazione di LootSniper: rimozione interrotta.' }

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
        if (-not $stopped) { Write-Host 'Arresto normale non completato: chiusura forzata dei soli processi LootSniper.' -ForegroundColor Yellow }
    }
    Stop-LootSniperProcesses
}

if (-not $NoShortcuts) {
    Remove-LootSniperShortcuts
    Refresh-Desktop
}

if (Test-Path -LiteralPath $installRoot) {
    Set-Location ([IO.Path]::GetTempPath())
    $lastError = $null
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $installRoot); $attempt++) {
        try { Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction Stop; $lastError = $null } catch {
            $lastError = $_
            Stop-LootSniperProcesses
            Start-Sleep -Milliseconds 250
        }
    }
    if ($lastError -and (Test-Path -LiteralPath $installRoot)) { throw $lastError }
}
if (Test-Path -LiteralPath $installRoot) { throw 'La cartella di LootSniper non e stata rimossa completamente.' }
if (-not $NoShortcuts) { Remove-LootSniperShortcuts; Refresh-Desktop }
Write-Host 'LootSniper e stato disinstallato completamente.' -ForegroundColor Green
