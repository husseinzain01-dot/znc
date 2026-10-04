# Started by LawhatAlMahal.exe (hidden). Makes sure the helper is running,
# then opens the app in its own window.
$ErrorActionPreference = 'Stop'
$Url = 'http://localhost:8765/'
$Here = $PSScriptRoot

function Test-Helper {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ($Url + 'api/ping') -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch { return $false }
}

if (-not (Test-Helper)) {
    $env:LAWHA_HIDDEN = '1'
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $Here 'server.ps1') + '"'), '-NoBrowser'
    )
    $deadline = (Get-Date).AddSeconds(25)
    while (-not (Test-Helper)) {
        if ((Get-Date) -gt $deadline) {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show('البرنامج المساعد ما اشتغل. سد البرنامج وجرّب مرة ثانية، وإذا تكررت صوّر هاي الرسالة.', 'لوحة المحل')
            exit 1
        }
        Start-Sleep -Milliseconds 400
    }
}

# Its own window, without browser bars: Edge (always on Windows 10/11),
# else Chrome, else the default browser.
$candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) {
    Start-Process -FilePath $browser -ArgumentList @("--app=$Url", '--start-maximized')
} else {
    Start-Process $Url
}
