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

function Test-Helper {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ($Url + 'api/ping') -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch { return $false }
}

try {
    Log "launch from $Here (PowerShell $($PSVersionTable.PSVersion), $([IntPtr]::Size * 8)-bit)"
    $server = Join-Path $Here 'server.ps1'
    if (-not (Test-Path -LiteralPath $server)) { Fail "ملف server.ps1 مو موجود يم البرنامج: $Here" }

    if (-not (Test-Helper)) {
        $env:LAWHA_HIDDEN = '1'
        $ps = Join-Path $PSHOME 'powershell.exe'
        $proc = Start-Process -FilePath $ps -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $server + '"'), '-NoBrowser'
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
        Start-Process -FilePath $browser -ArgumentList @("--app=$Url", '--start-maximized')
    } else {
        Log 'opening default browser'
        Start-Process $Url
    }
} catch {
    Fail ('ما اشتغل البرنامج: ' + $_.Exception.Message)
}
