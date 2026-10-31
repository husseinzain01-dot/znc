# What the Sana shortcut runs (hidden): starts the helper if it is not
# running, then opens Sana in its own Edge window, full screen.
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = 'http://localhost:8780/'
[Net.WebRequest]::DefaultWebProxy = $null
function Test-Helper {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri ($Url + 'api/ping') -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}
function Fail([string]$msg) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($msg, 'سنا', 'OK', 'Error') | Out-Null
    exit 1
}
try {
    if (-not (Test-Helper)) {
        Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $Here 'server.ps1') + '"'))
        $deadline = (Get-Date).AddSeconds(30)
        while (-not (Test-Helper)) {
            if ((Get-Date) -gt $deadline) { Fail 'تعذّر تشغيل سنا. أعد المحاولة، وإذا تكرر أعد تشغيل الحاسبة.' }
            Start-Sleep -Milliseconds 250
        }
    }
    function Under([string]$base, [string]$rel) { if ($base) { Join-Path $base $rel } }
    $edge = @(
        (Under ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Under $env:ProgramW6432 'Microsoft\Edge\Application\msedge.exe'),
        (Under $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Under $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    # Edge: its speech recognition and its natural Iraqi voice are what Sana uses
    if ($edge) { Start-Process -FilePath $edge -ArgumentList @("--app=$Url", '--start-fullscreen') }
    else { Start-Process $Url }
} catch {
    Fail ('تعذّر تشغيل سنا: ' + $_.Exception.Message)
}
