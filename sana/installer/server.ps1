# Sana's helper: serves the page on this computer only (http://localhost:8780)
# and opens the programs she is asked to open. It lives as long as Sana's
# window: the page says "still here" every few seconds and "bye" on closing.
param([int]$Port = 8780, [switch]$NoAutoStop)
$ErrorActionPreference = 'Stop'
$Version = '1.0.0'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = if ($env:APPDATA) { Join-Path $env:APPDATA 'Sana' } else { Join-Path $HOME '.sana' }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$LogFile = Join-Path $DataDir 'sana.log'
function Log([string]$m) { try { Add-Content -LiteralPath $LogFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m) -Encoding UTF8 } catch { } }

# the page: next to this file when installed, release/ while developing
$Page = Join-Path $Here 'sana.html'
if (-not (Test-Path -LiteralPath $Page)) { $Page = Join-Path (Split-Path $Here -Parent) 'release/sana.html' }

# What she may open, and nothing else.
function Get-AppCommand([string]$app) {
    switch ($app) {
        'fr3oon' {
            foreach ($base in @($env:LOCALAPPDATA, ${env:ProgramFiles})) {
                if (-not $base) { continue }
                $p = Join-Path $base $(if ($base -eq $env:LOCALAPPDATA) { 'Programs\Fr3oon\Fr3oon.exe' } else { 'Fr3oon\Fr3oon.exe' })
                if (Test-Path -LiteralPath $p) { return @{ file = $p } }
            }
            return $null
        }
        'calc' { return @{ file = 'calc.exe' } }
        'notepad' { return @{ file = 'notepad.exe' } }
        'explorer' { return @{ file = 'explorer.exe' } }
        'paint' { return @{ file = 'mspaint.exe' } }
        'settings' { return @{ file = 'ms-settings:' } }
    }
    return $null
}

function Send($ctx, [int]$code, $body, [string]$type = 'application/json; charset=utf-8') {
    $bytes = if ($body -is [byte[]]) { $body } else { [Text.Encoding]::UTF8.GetBytes([string]$body) }
    $ctx.Response.StatusCode = $code
    $ctx.Response.ContentType = $type
    $ctx.Response.Headers['Cache-Control'] = 'no-store'
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
}
function Json($o) { return ($o | ConvertTo-Json -Compress -Depth 4) }
function Read-Body($req) {
    $r = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
    $t = $r.ReadToEnd()
    if (-not $t) { return [pscustomobject]@{} }
    try { return $t | ConvertFrom-Json } catch { return [pscustomobject]@{} }
}

$script:LastSeen = Get-Date
$script:SeenPage = $false
$script:ByeAt = $null
$script:Stop = $false
function Test-NoWindow {
    if ($NoAutoStop) { return $false }
    $now = Get-Date
    if ($script:ByeAt -and $now -gt $script:ByeAt) { return $true }
    $limit = if ($script:SeenPage) { 60 } else { 120 }
    return ($now - $script:LastSeen).TotalSeconds -gt $limit
}

function Handle($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    # the page's own calls carry X-Sana: another site cannot send it without asking first
    $ours = $req.Headers['X-Sana'] -eq '1'
    if ($req.HttpMethod -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
        $script:LastSeen = Get-Date
        return Send $ctx 200 ([IO.File]::ReadAllBytes($Page)) 'text/html; charset=utf-8'
    }
    if ($path -eq '/api/ping') { return Send $ctx 200 (Json @{ ok = $true; product = 'Sana'; version = $Version }) }
    if ($req.HttpMethod -ne 'POST') { return Send $ctx 404 (Json @{ ok = $false }) }
    switch ($path) {
        '/api/alive' { $script:LastSeen = Get-Date; $script:SeenPage = $true; $script:ByeAt = $null; return Send $ctx 200 (Json @{ ok = $true }) }
        # a reload says bye then alive again: a few seconds' grace
        '/api/bye' { $script:ByeAt = (Get-Date).AddSeconds(6); return Send $ctx 200 (Json @{ ok = $true }) }
        '/api/open' {
            if (-not $ours) { return Send $ctx 403 (Json @{ ok = $false }) }
            $b = Read-Body $req
            $cmd = Get-AppCommand ([string]$b.app)
            if (-not $cmd) { Log "open refused: $($b.app)"; return Send $ctx 200 (Json @{ ok = $false; error = 'not found' }) }
            try { Start-Process -FilePath $cmd.file | Out-Null; Log "opened $($b.app)"; return Send $ctx 200 (Json @{ ok = $true }) }
            catch { Log "open failed $($b.app): $($_.Exception.Message)"; return Send $ctx 200 (Json @{ ok = $false; error = $_.Exception.Message }) }
        }
        '/api/shutdown' {
            if (-not $ours) { return Send $ctx 403 (Json @{ ok = $false }) }
            $script:Stop = $true
            return Send $ctx 200 (Json @{ ok = $true })
        }
    }
    return Send $ctx 404 (Json @{ ok = $false })
}

$listener = $null
for ($try = 0; $try -lt 8 -and -not $listener; $try++) {
    try {
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add("http://localhost:$Port/")
        $l.Start()
        $listener = $l
    } catch { Start-Sleep -Milliseconds 1000 }
}
if (-not $listener) { Log "port $Port busy, not started"; exit 3 }
$PidFile = Join-Path $DataDir 'helper.pid'
try { Set-Content -LiteralPath $PidFile -Value $PID -Encoding ASCII } catch { }
Log "sana $Version started on port $Port (pid $PID)"
try {
    while ($listener.IsListening -and -not $script:Stop) {
        if (Test-NoWindow) { Log 'no window open: stopping'; break }
        $async = $listener.BeginGetContext($null, $null)
        while (-not $async.AsyncWaitHandle.WaitOne(500)) {
            if (Test-NoWindow) { $script:Stop = $true; Log 'no window open: stopping'; break }
        }
        if ($script:Stop) { break }
        try { $ctx = $listener.EndGetContext($async) } catch { continue }
        try { Handle $ctx } catch { try { Send $ctx 500 (Json @{ ok = $false; error = $_.Exception.Message }) } catch { } }
    }
} finally {
    try { $listener.Close() } catch { }
    try { if ((Get-Content -LiteralPath $PidFile | Select-Object -First 1) -eq [string]$PID) { Remove-Item -LiteralPath $PidFile -Force } } catch { }
    Log 'stopped'
}
