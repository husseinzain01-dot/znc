# Started by LawhatAlMahal.exe (hidden). Makes sure the helper is running,
# then opens the app in its own window. Any failure is shown in a message
# box and written to %APPDATA%\LawhatAlMahal\logs\launch.log.
$ErrorActionPreference = 'Stop'
$Url = 'http://localhost:8765/'
$Here = $PSScriptRoot
$LogDir = Join-Path $env:APPDATA 'LawhatAlMahal\logs'

function Log([string]$msg) {
    try {
        New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
        Add-Content -LiteralPath (Join-Path $LogDir 'launch.log') -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg)
    } catch { }
}

function Fail([string]$msg) {
    Log "ERROR $msg"
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show("$msg`n`nالتفاصيل محفوظة بـ:`n$LogDir\launch.log", 'لوحة المحل')
    exit 1
}

# Straight to the program, never through a VPN or proxy set on Windows
# (one that doesn't skip local addresses would make the program look stopped).
[Net.WebRequest]::DefaultWebProxy = $null

function Get-Helper {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ($Url + 'api/ping') -TimeoutSec 2
        if ($r.StatusCode -ne 200) { return $null }
        try { return ($r.Content | ConvertFrom-Json) } catch { return [pscustomobject]@{ version = '' } }
    } catch { return $null }
}
function Test-Helper { return $null -ne (Get-Helper) }

# Access's fast engine (DAO) only loads into a PowerShell of the same
# bitness as Office. LawhatAlMahal.exe is 32-bit, so this script runs in the
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
    if (-not (Test-Path -LiteralPath $server)) { Fail "ملف server.ps1 مو موجود يم البرنامج: $Here" }

    # A helper from before an update may still be running hidden: replace it,
    # or the old code keeps answering.
    $want = ''
    $m = Select-String -LiteralPath $server -Pattern "^\`$Version = '([^']+)'" | Select-Object -First 1
    if ($m) { $want = $m.Matches[0].Groups[1].Value }
    $running = Get-Helper
    if ($running -and $want -and [string]$running.version -ne $want) {
        Log "helper $($running.version) running, installed ${want}: restarting it"
        try { Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{ 'X-Lawha' = '1' } -Uri ($Url + 'api/shutdown') -TimeoutSec 3 | Out-Null } catch { }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Test-Helper) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    }

    if (-not (Test-Helper)) {
        $env:LAWHA_HIDDEN = '1'
        $ps = Get-HelperHost
        $proc = Start-Process -FilePath $ps -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $server + '"'), '-NoBrowser'
        )
        Log "helper started, pid $($proc.Id)"
        $deadline = (Get-Date).AddSeconds(30)
        while (-not (Test-Helper)) {
            if ($proc.HasExited) {
                Fail "البرنامج المساعد انسد أول ما اشتغل (رمز $($proc.ExitCode)). شوف إذا أكو برنامج حماية منعه، وجرّب مرة ثانية."
            }
            if ((Get-Date) -gt $deadline) {
                Fail 'البرنامج المساعد ما رد خلال 30 ثانية. سد البرنامج وجرّب مرة ثانية.'
            }
            Start-Sleep -Milliseconds 400
        }
        Log 'helper answering'
    } else {
        Log 'helper already running'
    }

    # Linked to the main computer (a second device): open that, if it answers.
    $open = $Url
    try {
        $cfg = Get-Content -LiteralPath (Join-Path $env:APPDATA 'LawhatAlMahal\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
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
    Fail ('ما اشتغل البرنامج: ' + $_.Exception.Message)
}
