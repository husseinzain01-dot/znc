# Started by Fr3oon.exe (hidden). Makes sure the helper is running, then
# opens the program in its own window (not with -NoWindow: after an online
# update, where the open window reloads itself). Any failure is shown in a
# message box and written to %APPDATA%\Fr3oon\logs\launch.log.
# -Restart (the «إعادة تشغيل Fr3oon» shortcut): stop the helper first.
param([switch]$NoWindow, [switch]$Restart)
$ErrorActionPreference = 'Stop'
$Url = 'http://localhost:8770/'
$Here = $PSScriptRoot
$LogDir = Join-Path $env:APPDATA 'Fr3oon\logs'

function Log([string]$msg) {
    try {
        New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
        Add-Content -LiteralPath (Join-Path $LogDir 'launch.log') -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg)
    } catch { }
}

function Fail([string]$msg) {
    Log "ERROR $msg"
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show("$msg`n`nالتفاصيل محفوظة في:`n$LogDir\launch.log", 'Fr3oon')
    exit 1
}

# Straight to the program, never through a VPN or proxy set on Windows
# (one that doesn't skip local addresses would make the program look stopped).
[Net.WebRequest]::DefaultWebProxy = $null

function Get-Helper([int]$timeout = 3) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ($Url + 'api/ping') -TimeoutSec $timeout
        if ($r.StatusCode -ne 200) { return $null }
        try { return ($r.Content | ConvertFrom-Json) } catch { return [pscustomobject]@{ version = '' } }
    } catch { return $null }
}
function Test-Helper { return $null -ne (Get-Helper) }
# Answering, allowing a moment for a helper busy with a save or a backup.
function Wait-Helper([int]$tries = 3) {
    for ($i = 0; $i -lt $tries; $i++) {
        $h = Get-Helper 3
        if ($h) { return $h }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

# The helper's process: the one it noted at start (helper.pid), and any
# other PowerShell running this server.ps1 (one stuck from before).
$PidFile = Join-Path $env:APPDATA 'Fr3oon\helper.pid'
function Get-HelperProcesses([string]$server) {
    $ids = New-Object System.Collections.Generic.List[int]
    try {
        $n = 0
        if ([int]::TryParse(((Get-Content -LiteralPath $PidFile -ErrorAction Stop) | Select-Object -First 1), [ref]$n)) {
            $p = Get-Process -Id $n -ErrorAction SilentlyContinue
            if ($p -and $p.ProcessName -like 'powershell*') { $ids.Add($n) }
        }
    } catch { }
    try {
        foreach ($w in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop)) {
            if ($w.ProcessId -ne $PID -and $w.CommandLine -and $w.CommandLine.IndexOf($server, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and -not $ids.Contains([int]$w.ProcessId)) {
                $ids.Add([int]$w.ProcessId)
            }
        }
    } catch { Log "process list: $($_.Exception.Message)" }
    return , $ids.ToArray()
}
# A helper that no longer answers keeps the port, and a new one cannot
# start: stop it (no need to restart the computer).
function Stop-Helpers([string]$server, [string]$why) {
    try { Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{ 'X-Lawha' = '1' } -Uri ($Url + 'api/shutdown') -TimeoutSec 2 | Out-Null } catch { }
    $ids = Get-HelperProcesses $server
    foreach ($id in $ids) {
        Log "stopping helper pid $id ($why)"
        try { Stop-Process -Id $id -Force -ErrorAction Stop } catch { Log "could not stop ${id}: $($_.Exception.Message)" }
    }
    if ($ids.Count) { Start-Sleep -Milliseconds 1200 }
    try { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue } catch { }
}
function Start-Helper([string]$server) {
    $env:LAWHA_HIDDEN = '1'
    $ps = Get-HelperHost
    $proc = Start-Process -FilePath $ps -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $server + '"'), '-NoBrowser'
    )
    Log "helper started, pid $($proc.Id)"
    $deadline = (Get-Date).AddSeconds(40)
    while (-not (Test-Helper)) {
        if ($proc.HasExited) { return "exited:$($proc.ExitCode)" }
        if ((Get-Date) -gt $deadline) { return 'timeout' }
        Start-Sleep -Milliseconds 400
    }
    return 'ok'
}

# Access's fast engine (DAO) only loads into a PowerShell of the same
# bitness as Office. Fr3oon.exe is 32-bit, so this script runs in the
# 32-bit PowerShell; with 64-bit Office (the usual today) the helper must run
# in the 64-bit one, or every save goes through Access itself and is slow.
# Try 64-bit first, then 32-bit; keep the one where DAO loads.
function Test-Dao([string]$exe) {
    if (-not (Test-Path -LiteralPath $exe)) { return $false }
    try {
        $out = & $exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { [void](New-Object -ComObject DAO.DBEngine.120); 'yes' } catch { 'no' }" 2>$null
        return ([string]($out | Select-Object -Last 1)).Trim() -eq 'yes'
    } catch { return $false }
}

function Get-HelperHost {
    $win = $env:windir
    $sys = Join-Path $win 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if ([Environment]::Is64BitOperatingSystem) {
        # from a 32-bit process, System32 leads to the 32-bit copy; Sysnative to the real one
        $x64 = if ([Environment]::Is64BitProcess) { $sys } else { Join-Path $win 'Sysnative\WindowsPowerShell\v1.0\powershell.exe' }
        $x86 = Join-Path $win 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
        foreach ($c in @(@($x64, '64-bit'), @($x86, '32-bit'))) {
            if (Test-Dao $c[0]) { Log "helper: $($c[1]) PowerShell (DAO loads there)"; return $c[0] }
        }
        Log 'helper: DAO loads in neither PowerShell; 64-bit, saving through Access itself'
        if (Test-Path -LiteralPath $x64) { return $x64 }
    }
    return (Join-Path $PSHOME 'powershell.exe')
}

try {
    Log "launch from $Here (PowerShell $($PSVersionTable.PSVersion), $([IntPtr]::Size * 8)-bit)"
    $server = Join-Path $Here 'server.ps1'
    if (-not (Test-Path -LiteralPath $server)) { Fail "الملف server.ps1 غير موجود في مجلد البرنامج: $Here" }

    if ($Restart) { Stop-Helpers $server 'restart requested' }

    # A helper from before an update may still be running hidden: replace it,
    # or the old code keeps answering.
    $want = ''
    $m = Select-String -LiteralPath $server -Pattern "^\`$Version = '([^']+)'" | Select-Object -First 1
    if ($m) { $want = $m.Matches[0].Groups[1].Value }
    $running = Wait-Helper
    if ($running -and $want -and [string]$running.version -ne $want) {
        Log "helper $($running.version) running, installed ${want}: restarting it"
        try { Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{ 'X-Lawha' = '1' } -Uri ($Url + 'api/shutdown') -TimeoutSec 3 | Out-Null } catch { }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Test-Helper) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
        if (Test-Helper) { Stop-Helpers $server 'old version did not stop' }
        $running = $null
    }

    if (-not $running) {
        # not answering: anything left from before is stuck, so stop it first
        Stop-Helpers $server 'not answering'
        $r = Start-Helper $server
        if ($r -ne 'ok') {
            # once more, after stopping whatever still holds the port
            Log "helper start failed ($r), retrying"
            Stop-Helpers $server "start failed: $r"
            $r = Start-Helper $server
        }
        if ($r -like 'exited:*') {
            Fail "توقّف البرنامج المساعد فور تشغيله ($r). أعد تشغيل البرنامج من «إعادة تشغيل Fr3oon» في قائمة ابدأ، وإن تكرر فتحقّق من أن برنامج الحماية لم يمنعه."
        }
        if ($r -ne 'ok') {
            Fail 'لم يستجب البرنامج المساعد خلال 40 ثانية. شغّل «إعادة تشغيل Fr3oon» من قائمة ابدأ.'
        }
        Log 'helper answering'
    } else {
        Log 'helper already running'
    }

    # Linked to the main computer (a second device): open that, if it answers.
    $open = $Url
    try {
        $cfg = Get-Content -LiteralPath (Join-Path $env:APPDATA 'Fr3oon\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $remote = [string]$cfg.remoteUrl
    } catch { $remote = '' }
    if ($remote) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri ($remote + 'api/ping') -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $open = $remote; Log "opening the main computer $remote" }
        } catch {
            Log "main computer $remote not answering: $($_.Exception.Message)"
            $open = $Url + '?remote-down=1'
        }
    }

    if ($NoWindow) { Log 'no window (update)'; return }

    # Its own window, without browser bars: Edge (always on Windows 10/11),
    # else Chrome, else the default browser.
    function Under([string]$base, [string]$rel) { if ($base) { Join-Path $base $rel } }
    $candidates = @(
        (Under ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Under $env:ProgramW6432 'Microsoft\Edge\Application\msedge.exe'),
        (Under $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Under $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
        (Under $env:ProgramW6432 'Google\Chrome\Application\chrome.exe'),
        (Under ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Under $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ }
    $browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($browser) {
        Log "opening $browser"
        Start-Process -FilePath $browser -ArgumentList @("--app=$open", '--start-maximized')
    } else {
        Log 'opening default browser'
        Start-Process $open
    }
} catch {
    Fail ('تعذّر تشغيل البرنامج: ' + $_.Exception.Message)
}
