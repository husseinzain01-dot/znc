# لوحة المحل — local helper.
#
# Serves the app at http://localhost:8765/, hands the browser the .accdb bytes
# for reading, signs users in against حساباتي's own tblUsers, and performs
# writes (invoices, vouchers, customers, items) through Microsoft's Access
# engine (DAO), one transaction per save. Field values follow what حساباتي
# stores, so entries show up there as usual.
#
# Settings (database path, shop name, managers) live in
# %APPDATA%\LawhatAlMahal\config.json, so they survive updates and reinstalls.
# A copy of the database is made before the first write of each day.
#
# Testing without Access: set $env:LAWHA_FAKEDAO to a JSON export of the
# tables (test/export-tables.mjs); writes then go to an in-memory copy.

param(
    [int]$Port = 8765,
    [string]$DataDir = '',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Version = '1.3.0'
$Here = $PSScriptRoot
# The launcher runs this without a window; then there is no console to print to.
$Hidden = $env:LAWHA_HIDDEN -eq '1'

# Startup failures in a hidden window would go unseen; show them.
trap {
    try {
        $logDir = if ($env:APPDATA) { Join-Path $env:APPDATA 'LawhatAlMahal\logs' } else { Join-Path $PSScriptRoot '.data' }
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        Add-Content -LiteralPath (Join-Path $logDir 'startup-errors.log') -Encoding UTF8 -Value ((Get-Date -Format 's') + '  ' + $_.Exception.Message + '  ' + $_.InvocationInfo.PositionMessage)
    } catch { }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show("ما اشتغل لوحة المحل:`n`n$($_.Exception.Message)", 'لوحة المحل')
    } catch { Write-Host $_ }
    break
}

if ($env:LAWHA_FAKEDAO) { . (Join-Path (Join-Path $Here 'test') 'FakeDao.ps1') }

# DAO constants
$dbOpenDynaset = 2
$dbOpenSnapshot = 4
$dbAppendOnly = 8
$dbFailOnError = 128

# ---------------------------------------------------------------- settings

if (-not $DataDir) {
    $DataDir = if ($env:APPDATA) { Join-Path $env:APPDATA 'LawhatAlMahal' } else { Join-Path $Here '.data' }
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$ConfigFile = Join-Path $DataDir 'config.json'
$LogDir = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$AppFile = Join-Path $Here 'lawha.html'
if (-not (Test-Path $AppFile)) { $AppFile = Join-Path (Join-Path (Split-Path $Here -Parent) 'release') 'hisabati-reader.html' }

# ---------------------------------------------------------------- permission lists
$AllPerms = @(
    'pos', 'home', 'sales', 'purchases', 'customers', 'suppliers', 'stock', 'cash', 'profit', 'checks',
    'sale_cash', 'sale_credit', 'sale_wholesale', 'edit_price', 'print', 'sale_edit', 'sale_delete',
    'purchase', 'purchase_edit', 'receipt', 'payment', 'voucher_edit',
    'customer_add', 'customer_edit', 'supplier_manage', 'item_manage'
)

# Permissions are kept and sent as one text, "pos,sale_cash,print": Windows
# PowerShell 5.1 can save or send a list as {"value": [...], "Count": n} or
# lose it, a text it leaves alone. Reads any shape an older version saved.
# $null: something was there but no permission in it (left unset).
function ConvertTo-PermText($v) {
    $texts = New-Object System.Collections.Generic.List[string]
    $walk = {
        param($x)
        if ($null -eq $x -or $x -is [DBNull]) { return }
        if ($x -is [string]) { $texts.Add($x); return }
        if ($x -is [System.Collections.IDictionary]) { foreach ($k in @($x.Keys)) { & $walk $x[$k] }; return }
        if ($x -is [System.Collections.IEnumerable]) { foreach ($i in $x) { & $walk $i }; return }
        if ($x -is [System.Management.Automation.PSCustomObject]) { foreach ($q in $x.PSObject.Properties) { & $walk $q.Value }; return }
        $texts.Add([string]$x)
    }
    & $walk $v
    $found = New-Object System.Collections.Generic.List[string]
    foreach ($t in $texts) {
        foreach ($m in [regex]::Matches($t, '[a-z_]+')) {
            if ($AllPerms -contains $m.Value -and -not $found.Contains($m.Value)) { $found.Add($m.Value) }
        }
    }
    if ($found.Count -eq 0 -and (@($texts | Where-Object { $_ -match '\S' }).Count -gt 0)) { return $null }
    return ($found.ToArray() -join ',')
}

function Read-Config {
    $c = @{ dbPath = ''; shopName = ''; admins = @(); perms = @{}; allowRemote = $false; remoteUrl = '' }
    if (Test-Path $ConfigFile) {
        try {
            $j = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
            # older versions saved network paths as "Microsoft.PowerShell.Core\FileSystem::\\PC\..."
            if ($j.dbPath) { $c.dbPath = ([string]$j.dbPath) -replace '^Microsoft\.PowerShell\.Core\\FileSystem::', '' }
            if ($j.shopName) { $c.shopName = [string]$j.shopName }
            if ($j.allowRemote) { $c.allowRemote = $true }
            if ($j.remoteUrl) { $c.remoteUrl = [string]$j.remoteUrl }
            if ($j.admins) { $c.admins = @($j.admins | ForEach-Object { [string]$_ }) }
            if ($j.perms) {
                foreach ($p in $j.perms.PSObject.Properties) {
                    $t = ConvertTo-PermText $p.Value
                    if ($null -ne $t) { $c.perms[$p.Name] = $t }
                }
            }
        } catch { }
    }
    return $c
}

function Save-Config {
    $script:Config.admins = [string[]]@($script:Config.admins)
    $json = $script:Config | ConvertTo-Json -Depth 4
    $json = [regex]::Replace($json, '\{\s*"value":\s*(\[[^\[\]{}]*\]),\s*"Count":\s*\d+\s*\}', '$1')
    $json | Set-Content $ConfigFile -Encoding UTF8
}

$script:Config = Read-Config

function Test-DbFile([string]$p) {
    return ($p -and (Test-Path -LiteralPath $p -PathType Leaf) -and ([IO.Path]::GetExtension($p) -in '.accdb', '.mdb'))
}

# Run from its own folder: a data file sitting next to the program is used
# without asking (Units2026.accdb first, else the only .accdb there).
if (-not ($script:Config.dbPath -and (Test-Path -LiteralPath $script:Config.dbPath))) {
    $local = @(Get-ChildItem -LiteralPath $Here -Filter '*.accdb' -File -ErrorAction SilentlyContinue)
    $pick = $local | Where-Object { $_.Name -ieq 'Units2026.accdb' } | Select-Object -First 1
    if (-not $pick -and $local.Count -eq 1) { $pick = $local[0] }
    if ($pick) {
        $script:Config.dbPath = $pick.FullName
        $script:Config | ConvertTo-Json -Depth 4 | Set-Content $ConfigFile -Encoding UTF8
    }
}

# The data file sits inside the program's own folder: on a computer the
# program was copied to, that is a copy, not the shared file.
function Test-DbLocal([string]$p) {
    return [bool]($p -and ((Split-Path $p -Parent).TrimEnd('\', '/') -eq ([string]$Here).TrimEnd('\', '/')))
}

function Get-DbPath {
    # the full test works on a copy while it runs
    if ($script:DbOverride) { return $script:DbOverride }
    $p = $script:Config.dbPath
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    return ''
}

function Write-LawhaLog([string]$line) {
    $file = Join-Path $LogDir ('lawha-' + (Get-Date -Format 'yyyy-MM') + '.log')
    Add-Content -LiteralPath $file -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $line)
    if (-not $Hidden) { Write-Host $line }
}

# ---------------------------------------------------------------- engine

$script:Engine = $null
$script:EngineName = ''
$script:AccessApp = $null
$script:LastUse = Get-Date

function Get-Engine {
    $script:LastUse = Get-Date
    if ($script:Engine) { return $script:Engine }
    if ($env:LAWHA_FAKEDAO) {
        $script:Engine = New-FakeEngine $env:LAWHA_FAKEDAO
        $script:EngineName = 'FakeDao (test)'
        return $script:Engine
    }
    # In-process DAO is quickest; it only loads when its bitness matches this
    # PowerShell. Otherwise drive DAO through an invisible Access instance.
    try {
        $script:Engine = New-Object -ComObject DAO.DBEngine.120
        $script:EngineName = 'DAO.DBEngine.120'
        return $script:Engine
    } catch { }
    try {
        $script:AccessApp = New-Object -ComObject Access.Application
        $script:Engine = $script:AccessApp.DBEngine
        $script:EngineName = 'Access.Application ' + $script:AccessApp.Version
        return $script:Engine
    } catch {
        throw 'ما لكيت Microsoft Access على هذا الجهاز. الحفظ يحتاج Access أو Access Runtime.'
    }
}

function Close-Engine {
    Close-Db
    if ($script:AccessApp) {
        try { $script:AccessApp.Quit() } catch { }
        try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:AccessApp) } catch { }
    }
    $script:AccessApp = $null
    if (-not $env:LAWHA_FAKEDAO) { $script:Engine = $null }
    [GC]::Collect()
}

# Opens the database and runs $body($db). Writes run inside a transaction
# that commits, or rolls back on any error (always, with -Rollback).
# Opening the file is the slow part of a save, above all when it is on
# another computer, so it stays open between requests and closes after 15
# idle minutes (main loop). Before each use the engine refreshes its cache,
# so what حساباتي saved meanwhile is seen.
$script:Db = $null
$script:DbOpenPath = ''
# a shop saves every few minutes: reopening each time would cost the most
$DbIdleSeconds = 900
$script:DbLastUse = Get-Date

function Close-Db {
    if ($script:Db) { try { $script:Db.Close() } catch { } }
    $script:Db = $null
    $script:DbOpenPath = ''
}

function Open-Db([string]$path) {
    if ($script:Db -and $script:DbOpenPath -eq $path) {
        # dbRefreshCache: see changes other programs wrote since
        try { $script:Engine.Idle(8) } catch { }
        return $script:Db
    }
    Close-Db
    $ws = $script:Engine.Workspaces.Item(0)
    try {
        $script:Db = $ws.OpenDatabase($path, $false, $false)
    } catch {
        throw "ما كدرت أفتح ملف البيانات. إذا حساباتي فاتحه بشكل حصري سدّه وجرّب مرة ثانية. ($($_.Exception.Message))"
    }
    $script:DbOpenPath = $path
    return $script:Db
}

function Use-Database([scriptblock]$body, [switch]$Rollback, [switch]$ReadOnly) {
    $path = Get-DbPath
    Need ($path -ne '') 'ما محدد ملف البيانات. اختاره من الإعدادات.'
    $engine = Get-Engine
    $ws = $engine.Workspaces.Item(0)
    $script:DbLastUse = Get-Date
    try {
        $db = Open-Db $path
    } catch {
        # a file that can only be read (read-only share) still opens for reading
        if (-not $ReadOnly) { throw }
        try { $db = $ws.OpenDatabase($path, $false, $true) } catch { throw "ما كدرت أفتح ملف البيانات. ($($_.Exception.Message))" }
        try { return (& $body $db) } finally { try { $db.Close() } catch { } }
    }
    try {
        if ($ReadOnly) { return (& $body $db) }
        $ws.BeginTrans()
        try {
            $result = & $body $db
            if ($Rollback) { $ws.Rollback() } else { $ws.CommitTrans() }
            return $result
        } catch {
            try { $ws.Rollback() } catch { }
            throw
        }
    } catch {
        # whatever went wrong (a refused save, or the file gone from the
        # network), the next request opens the file fresh
        Close-Db
        throw
    } finally {
        $script:DbLastUse = Get-Date
    }
}

# ---------------------------------------------------------------- backup

$script:BackupDay = ''
# The daily copy of the data file. It runs on the side, started as soon as
# the program starts (and again after midnight), so the day's first save
# never waits for it: copying 15 MB over a slow network can take a minute.
$BackupScript = {
    param($path)
    $dir = Join-Path (Split-Path $path -Parent) 'backups-lawha'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $name = [IO.Path]::GetFileNameWithoutExtension($path)
    $target = Join-Path $dir ("$name-" + (Get-Date -Format 'yyyy-MM-dd_HH-mm') + '.accdb')
    # a half-written copy never looks like a finished one
    $part = $target + '.part'
    $src = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
        $dst = [IO.File]::Create($part)
        try { $src.CopyTo($dst, 1048576) } finally { $dst.Close() }
    } finally { $src.Close() }
    Move-Item -LiteralPath $part -Destination $target -Force
    Get-ChildItem $dir -Filter "$name-*.accdb" | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Force
    $target
}
$script:BackupJob = $null
$script:BackupFailedAt = [datetime]::MinValue

# Collect a finished copy (called from the main loop and before saves).
function Update-Backup {
    $j = $script:BackupJob
    if (-not $j -or -not $j.h.IsCompleted) { return }
    try {
        $r = $j.ps.EndInvoke($j.h)
        if ($j.ps.Streams.Error.Count) { throw $j.ps.Streams.Error[0].Exception }
        $script:BackupDay = $j.day
        Write-LawhaLog "backup done: $r"
    } catch {
        $script:BackupFailedAt = Get-Date
        Write-LawhaLog "backup FAILED: $($_.Exception.Message)"
    } finally {
        $j.ps.Dispose(); $j.rs.Dispose()
        $script:BackupJob = $null
    }
}

function Start-Backup {
    Update-Backup
    $today = Get-Date -Format 'yyyy-MM-dd'
    if ($script:BackupDay -eq $today -or $script:BackupJob -or $script:DbOverride) { return }
    # after a failure, try again in half an hour, not at every save
    if (((Get-Date) - $script:BackupFailedAt).TotalMinutes -lt 30) { return }
    $path = Get-DbPath
    if (-not $path) { return }
    $rs = [runspacefactory]::CreateRunspace()
    $rs.Open()
    $ps = [PowerShell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($BackupScript.ToString()).AddArgument($path)
    $script:BackupJob = @{ ps = $ps; rs = $rs; h = $ps.BeginInvoke(); day = $today }
}

# Before a save: make sure today's copy is on its way; never wait for it.
function Backup-Database { Start-Backup }

# For tests and shutting down.
function Wait-Backup([int]$seconds = 120) {
    $until = (Get-Date).AddSeconds($seconds)
    while ($script:BackupJob -and -not $script:BackupJob.h.IsCompleted -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 100 }
    Update-Backup
}

# ---------------------------------------------------------------- helpers

function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }

# Numbers inside SQL text must not follow the Windows regional format.
function N([double]$n) { return $n.ToString([Globalization.CultureInfo]::InvariantCulture) }

function Day([string]$iso) {
    if (-not $iso) { return (Get-Date).Date }
    try {
        return [datetime]::ParseExact($iso, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    } catch { throw "التاريخ غلط: $iso" }
}

function Text([string]$s, [int]$max, [string]$label) {
    $s = if ($null -eq $s) { '' } else { $s.Trim() }
    if ($s.Length -gt $max) { throw "$label طويل: الحد $max حرف" }
    return $s
}

function Num($v, [string]$label) {
    if ($null -eq $v -or "$v".Trim() -eq '') { return 0.0 }
    if ($v -is [double] -or $v -is [int] -or $v -is [long] -or $v -is [decimal]) { return [double]$v }
    $d = 0.0
    if (-not [double]::TryParse("$v".Replace(',', ''), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) {
        throw "$label لازم يكون رقم"
    }
    return $d
}

function Need([bool]$cond, [string]$msg) { if (-not $cond) { throw $msg } }

# Writes go through SQL text, the same way حساباتي's own code saves
# (db.Execute "INSERT INTO ..."). Setting recordset fields one by one through
# COM left every value empty on a real Access 16 install, so values are never
# passed as COM variants: each becomes an Access SQL literal here.
function L($v) {
    if ($null -eq $v -or $v -is [DBNull]) { return 'Null' }
    if ($v -is [string]) {
        if ($v.Trim() -eq '') { return 'Null' }
        return Q $v
    }
    if ($v -is [bool]) { return $(if ($v) { 'True' } else { 'False' }) }
    if ($v -is [datetime]) { return '#' + $v.ToString('yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture) + '#' }
    if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal] -or $v -is [single] -or $v -is [int16] -or $v -is [byte]) {
        return N ([double]$v)
    }
    return Q ([string]$v)
}

# INSERT one row; returns the new AutoNumber (SELECT @@IDENTITY) when $idField is given.
function Add-Row($db, [string]$table, [hashtable]$values, [string]$idField) {
    $cols = @($values.Keys)
    $sql = "INSERT INTO [$table] (" + (($cols | ForEach-Object { "[$_]" }) -join ', ') + ') VALUES (' + (($cols | ForEach-Object { L $values[$_] }) -join ', ') + ')'
    $db.Execute($sql, $dbFailOnError)
    if (-not $idField) { return $null }
    $id = Get-Value $db 'SELECT @@IDENTITY'
    Need ($null -ne $id -and [int]$id -gt 0) "الحفظ بجدول $table ما رجّع رقم السجل"
    return [int]$id
}

function Edit-Row($db, [string]$table, [string]$idField, $id, [hashtable]$values) {
    $id = [int]$id
    Need ((Count $db "SELECT Count(*) FROM [$table] WHERE [$idField]=$id") -gt 0) 'السجل مو موجود (يمكن انمسح من حساباتي)'
    $sets = ($values.Keys | ForEach-Object { "[$_]=" + (L $values[$_]) }) -join ', '
    $db.Execute("UPDATE [$table] SET $sets WHERE [$idField]=$id", $dbFailOnError)
}

function Get-Value($db, [string]$sql) {
    $rs = $db.OpenRecordset($sql, $dbOpenSnapshot)
    try {
        if ($rs.EOF) { return $null }
        $v = $rs.Fields.Item(0).Value
        if ($v -is [DBNull]) { return $null }
        return $v
    } finally { $rs.Close() }
}

function Get-Column($db, [string]$sql) {
    $rs = $db.OpenRecordset($sql, $dbOpenSnapshot)
    $out = New-Object System.Collections.Generic.List[object]
    try {
        while (-not $rs.EOF) {
            $v = $rs.Fields.Item(0).Value
            if (-not ($v -is [DBNull]) -and $null -ne $v) { $out.Add($v) }
            $rs.MoveNext()
        }
    } finally { $rs.Close() }
    return , $out.ToArray()
}

function Count($db, [string]$sql) { return [int](Get-Value $db $sql) }

# Within one save the same item is looked up once (Invoke-Write sets the
# cache; each round trip counts when the file is on another computer).
$script:ItemCache = $null
function Get-MadaItem($db, [string]$name) {
    if ($null -ne $script:ItemCache -and $script:ItemCache.ContainsKey($name)) { return $script:ItemCache[$name] }
    $o = Read-MadaItem $db $name
    if ($null -ne $script:ItemCache) { $script:ItemCache[$name] = $o }
    return $o
}
function Read-MadaItem($db, [string]$name) {
    $rs = $db.OpenRecordset("SELECT IDcode, BpriceL1, BpriceL2, UnitL1, UnitL2, Fill, price, priceSeeat FROM madaCode WHERE madaName=$(Q $name)", $dbOpenSnapshot)
    try {
        Need (-not $rs.EOF) "المادة مو موجودة: $name"
        $o = @{}
        foreach ($f in 'IDcode', 'BpriceL1', 'BpriceL2', 'UnitL1', 'UnitL2', 'Fill', 'price', 'priceSeeat') {
            $v = $rs.Fields.Item($f).Value
            $o[$f] = if ($v -is [DBNull]) { $null } else { $v }
        }
        return $o
    } finally { $rs.Close() }
}

function Next-VoucherNo($db, [string]$table) {
    $max = 0
    foreach ($v in (Get-Column $db "SELECT mostandNO FROM [$table]")) {
        $n = 0
        if ([int]::TryParse([string]$v, [ref]$n) -and $n -gt $max) { $max = $n }
    }
    return [string]($max + 1)
}

# ---------------------------------------------------------------- operations
# Each takes ($db, $d): $d is the JSON payload; $d.user is set by the server
# from the signed-in session, never taken from the browser.

function Save-Lines($db, [string]$kind, [int]$masterId, $lines) {
    $lines = @($lines | Where-Object { $null -ne $_ })
    Need ($lines.Count -gt 0) 'القائمة ما بيها مواد'
    foreach ($l in $lines) {
        $name = Text $l.item 150 'اسم المادة'
        $it = Get-MadaItem $db $name
        $unit = Text $l.unit 10 'الوحدة'
        Need ($unit -eq $it.UnitL1 -or $unit -eq $it.UnitL2) "وحدة غلط للمادة $name"
        $qty = Num $l.qty 'الكمية'
        Need ($qty -gt 0) "الكمية لازم أكثر من صفر ($name)"
        $price = Num $l.price 'السعر'
        Need ($price -ge 0) "السعر غلط ($name)"
        $small = ($unit -eq $it.UnitL2 -and $it.UnitL1 -ne $it.UnitL2)
        if ($kind -eq 'sale') {
            Add-Row $db 'subOut' @{
                idOut = $masterId; madaNameOut = $name; QuntOut = $qty; Price = $price
                IDcode = $it.IDcode; unit = $unit
                BpriceL1 = $it.BpriceL1; BpriceL2 = $it.BpriceL2
                UnitFactor = $(if ($small) { 1 } else { 0 }); note = (Text $l.note 255 'الملاحظة')
            } '' | Out-Null
        } else {
            Add-Row $db 'subIN' @{
                IdIn = $masterId; madaNameIn = $name; QuntIn = $qty; Price = $price
                IDcode = $it.IDcode; unit = $unit
                UnitFactor = $(if ($small) { 1 } else { 0 }); note = (Text $l.note 255 'الملاحظة')
                expireDate = $(if ($l.expire) { Day $l.expire } else { $null })
            } '' | Out-Null
        }
    }
}

function Op-SaveSale($db, $d) {
    $type = [string]$d.type
    Need ($type -eq 'نقدي' -or $type -eq 'اجل') 'نوع القائمة غلط'
    $customer = Text $d.customer 50 'اسم الزبون'
    if ($type -eq 'اجل') {
        Need ($customer -ne '') 'القائمة الآجل تحتاج اسم زبون'
        Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $customer)") -gt 0) "الزبون مو موجود: $customer"
    } elseif (-not $customer) {
        $customer = 'قائمة نقدي'
    }
    $paid = Num $d.paid 'المدفوع'
    Need ($paid -ge 0) 'المدفوع غلط'
    $values = @{
        TOname = $customer; OutDate = (Day $d.date); OutType = $type
        Paid = [int]$(if ($type -eq 'اجل') { $paid } else { 0 }); strUserName = (Text $d.user 45 'اسم المستخدم')
        note = (Text $d.note 255 'الملاحظة')
    }
    if ($d.id) {
        $id = [int]$d.id
        Edit-Row $db 'MasterOut' 'idOut' $id $values
        $db.Execute("DELETE FROM subOut WHERE idOut=$id", $dbFailOnError)
    } else {
        $values.timeS = Get-Date
        $values.Mandob = 'مباشر'
        $values.Tagheez = $false
        $id = [int](Add-Row $db 'MasterOut' $values 'idOut')
    }
    Save-Lines $db 'sale' $id $d.lines
    return @{ id = $id }
}

function Op-DeleteSale($db, $d) {
    $id = [int]$d.id
    Need ((Count $db "SELECT Count(*) FROM MasterOut WHERE idOut=$id") -gt 0) 'القائمة مو موجودة'
    $db.Execute("DELETE FROM subOut WHERE idOut=$id", $dbFailOnError)
    $db.Execute("DELETE FROM MasterOut WHERE idOut=$id", $dbFailOnError)
    return @{ id = $id }
}

function Update-BuyPrices($db, $lines) {
    foreach ($l in @($lines)) {
        $it = Get-MadaItem $db $l.item
        $price = Num $l.price 'السعر'
        $fill = if ($it.Fill) { [double]$it.Fill } else { 0.0 }
        $name = Q $l.item
        if ($l.unit -eq $it.UnitL1) {
            $p2 = if ($fill -gt 0) { [math]::Round($price / $fill) } else { $price }
            $db.Execute("UPDATE madaCode SET BpriceL1=$(N $price), BpriceL2=$(N $p2) WHERE madaName=$name", $dbFailOnError)
        } elseif ($l.unit -eq $it.UnitL2) {
            $p1 = if ($fill -gt 0) { [math]::Round($price * $fill) } else { $price }
            $db.Execute("UPDATE madaCode SET BpriceL2=$(N $price), BpriceL1=$(N $p1) WHERE madaName=$name", $dbFailOnError)
        }
    }
}

function Op-SavePurchase($db, $d) {
    $type = [string]$d.type
    Need ($type -eq 'نقدي' -or $type -eq 'اجل') 'نوع القائمة غلط'
    $supplier = Text $d.supplier 50 'اسم المورد'
    Need ($supplier -ne '') 'لازم تختار المورد'
    Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $supplier)") -gt 0) "المورد مو موجود: $supplier"
    $no = $null
    if ("$($d.no)".Trim()) {
        $n = 0
        Need ([int]::TryParse("$($d.no)".Trim(), [ref]$n)) 'رقم قائمة المورد لازم يكون رقم'
        $no = $n
    }
    $values = @{
        fromname = $supplier; InvoiceDate = (Day $d.date); InType = $type; InvoiceNo = $no
        strUserName = (Text $d.user 45 'اسم المستخدم'); note = (Text $d.note 255 'الملاحظة')
    }
    if ($d.id) {
        $id = [int]$d.id
        Edit-Row $db 'MasterIn' 'IdIn' $id $values
        $db.Execute("DELETE FROM subIN WHERE IdIn=$id", $dbFailOnError)
    } else {
        $values.timeS = Get-Date
        $id = [int](Add-Row $db 'MasterIn' $values 'IdIn')
    }
    Save-Lines $db 'purchase' $id $d.lines
    if ($d.updatePrices) { Update-BuyPrices $db $d.lines }
    return @{ id = $id }
}

function Op-DeletePurchase($db, $d) {
    $id = [int]$d.id
    Need ((Count $db "SELECT Count(*) FROM MasterIn WHERE IdIn=$id") -gt 0) 'القائمة مو موجودة'
    $db.Execute("DELETE FROM subIN WHERE IdIn=$id", $dbFailOnError)
    $db.Execute("DELETE FROM MasterIn WHERE IdIn=$id", $dbFailOnError)
    return @{ id = $id }
}

function Save-Voucher($db, $d, [string]$table, [string]$nameField) {
    $amount = Num $d.amount 'المبلغ'
    Need ($amount -gt 0) 'المبلغ لازم أكثر من صفر'
    $cls = Text $d.cls 35 'النوع'
    Need ($cls -ne '') 'لازم تختار النوع'
    $name = Text $d.name 35 'الاسم'
    if ($cls -eq 'تسديد') { Need ($name -ne '') 'التسديد يحتاج اسم' }
    $values = @{
        dataS = (Day $d.date); classS = $cls; mablak = $amount
        note = (Text $d.note 255 'الملاحظة'); strUserName = (Text $d.user 45 'اسم المستخدم')
    }
    $values[$nameField] = $name
    if ($d.id) {
        $id = [int]$d.id
        Edit-Row $db $table 'idS' $id $values
    } else {
        $values.timeS = Get-Date
        $values.mostandNO = Next-VoucherNo $db $table
        $id = [int](Add-Row $db $table $values 'idS')
    }
    return @{ id = $id }
}

function Op-SaveReceipt($db, $d) {
    if ($d.cls -eq 'تسديد') {
        Need ("$($d.name)".Trim() -ne '') 'التسديد يحتاج اسم'
        Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $d.name)") -gt 0) "الزبون مو موجود: $($d.name)"
    }
    return Save-Voucher $db $d 'mablakIn' 'nameFrom'
}

function Op-SavePayment($db, $d) {
    if ($d.cls -eq 'تسديد') {
        Need ("$($d.name)".Trim() -ne '') 'التسديد يحتاج اسم'
        Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $d.name)") -gt 0) "المورد مو موجود: $($d.name)"
    }
    return Save-Voucher $db $d 'mablakOut' 'nameto'
}

function Delete-Voucher($db, [string]$table, $d) {
    $id = [int]$d.id
    Need ((Count $db "SELECT Count(*) FROM [$table] WHERE idS=$id") -gt 0) 'الوصل مو موجود'
    $db.Execute("DELETE FROM [$table] WHERE idS=$id", $dbFailOnError)
    return @{ id = $id }
}
function Op-DeleteReceipt($db, $d) { return Delete-Voucher $db 'mablakIn' $d }
function Op-DeletePayment($db, $d) { return Delete-Voucher $db 'mablakOut' $d }

# Names link invoices and vouchers to people and items, so a rename is
# carried into every table that stores the name.
$Links = @{
    customer = @(@('MasterOut', 'TOname'), @('mablakIn', 'nameFrom'))
    supplier = @(@('MasterIn', 'fromname'), @('mablakOut', 'nameto'))
    item     = @(@('subOut', 'madaNameOut'), @('subIN', 'madaNameIn'))
}

function Rename-Links($db, [string]$kind, [string]$old, [string]$new) {
    if (-not $old -or $old -eq $new) { return }
    foreach ($l in $Links[$kind]) {
        $db.Execute("UPDATE [$($l[0])] SET [$($l[1])]=$(Q $new) WHERE [$($l[1])]=$(Q $old)", $dbFailOnError)
    }
}

function Uses($db, [string]$kind, [string]$name) {
    $n = 0
    foreach ($l in $Links[$kind]) { $n += Count $db "SELECT Count(*) FROM [$($l[0])] WHERE [$($l[1])]=$(Q $name)" }
    return $n
}

function Op-SaveCustomer($db, $d) {
    # receipts store the name in a 35-character field
    $name = Text $d.name 35 'اسم الزبون'
    Need ($name -ne '') 'لازم تكتب اسم الزبون'
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $name) AND id<>$id") -eq 0) "أكو زبون بنفس الاسم: $name"
    $values = @{
        bayeeCode = $name; MB = [int](Num $d.opening 'الرصيد الافتتاحي'); CMobile = (Text $d.mobile 12 'الموبايل')
        Cadress = (Text $d.address 255 'العنوان'); Ctype = (Text $d.type 30 'النوع')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT bayeeCode FROM bayeeCode WHERE id=$id")
        Need ($old -ne '') 'الزبون مو موجود'
        Edit-Row $db 'bayeeCode' 'id' $id $values
        Rename-Links $db 'customer' $old $name
    } else {
        $now = Get-Date
        $values += @{ credit = 0; RegDate = $now.Date; Cdate = $now.Date; Ctime = $now; Mandob = 'مباشر'; Group = 'المجموعة العامة' }
        $id = [int](Add-Row $db 'bayeeCode' $values 'id')
    }
    return @{ id = $id }
}

function Op-SaveSupplier($db, $d) {
    $name = Text $d.name 35 'اسم المورد'
    Need ($name -ne '') 'لازم تكتب اسم المورد'
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $name) AND ID<>$id") -eq 0) "أكو مورد بنفس الاسم: $name"
    $values = @{
        shiraCode = $name; MB = (Num $d.opening 'الرصيد الافتتاحي'); CMobile = (Text $d.mobile 12 'الموبايل')
        Cadress = (Text $d.address 255 'العنوان')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT shiraCode FROM shiraCode WHERE ID=$id")
        Need ($old -ne '') 'المورد مو موجود'
        Edit-Row $db 'shiraCode' 'ID' $id $values
        Rename-Links $db 'supplier' $old $name
    } else {
        $now = Get-Date
        $values += @{ RegDate = $now.Date; Cdate = $now.Date; Ctime = $now }
        $id = [int](Add-Row $db 'shiraCode' $values 'ID')
    }
    return @{ id = $id }
}

function Op-SaveItem($db, $d) {
    $name = Text $d.name 150 'اسم المادة'
    Need ($name -ne '') 'لازم تكتب اسم المادة'
    # subOut.IDcode holds 15 characters
    $code = Text $d.code 15 'الرمز'
    $u1 = Text $d.unitL1 10 'الوحدة الكبيرة'
    $u2 = Text $d.unitL2 10 'الوحدة الصغيرة'
    Need ($u1 -ne '') 'لازم تكتب الوحدة الكبيرة'
    if (-not $u2) { $u2 = $u1 }
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM madaCode WHERE madaName=$(Q $name) AND ID<>$id") -eq 0) "أكو مادة بنفس الاسم: $name"
    if ($code) { Need ((Count $db "SELECT Count(*) FROM madaCode WHERE IDcode=$(Q $code) AND ID<>$id") -eq 0) "أكو مادة بنفس الرمز: $code" }
    $price = [int](Num $d.priceL1 'سعر البيع')
    $values = @{
        madaName = $name; IDcode = $code; MadaClass = (Text $d.cls 255 'الصنف')
        price = $price; 'price$' = $price; priceSeeat = [int](Num $d.priceL2 'سعر البيع')
        Fill = [int](Num $d.fill 'التعبئة'); BpriceL1 = (Num $d.buyL1 'سعر الشراء'); BpriceL2 = (Num $d.buyL2 'سعر الشراء')
        UnitL1 = $u1; UnitL2 = $u2; harig = [int](Num $d.harig 'حد الطلب')
        Pr = (Num $d.openL1 'الرصيد الافتتاحي'); Pru = (Num $d.openL2 'الرصيد الافتتاحي')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT madaName FROM madaCode WHERE ID=$id")
        Need ($old -ne '') 'المادة مو موجودة'
        Edit-Row $db 'madaCode' 'ID' $id $values
        Rename-Links $db 'item' $old $name
    } else {
        $id = [int](Add-Row $db 'madaCode' $values 'ID')
    }
    return @{ id = $id }
}

function Delete-Named($db, [string]$kind, [string]$table, [string]$idField, [string]$nameField, $d) {
    $id = [int]$d.id
    $name = [string](Get-Value $db "SELECT [$nameField] FROM [$table] WHERE [$idField]=$id")
    Need ($name -ne '') 'السجل مو موجود'
    $n = Uses $db $kind $name
    Need ($n -eq 0) "ما يصير ينمسح: عنده $n حركة. امسح حركاته أول."
    $db.Execute("DELETE FROM [$table] WHERE [$idField]=$id", $dbFailOnError)
    return @{ id = $id }
}
function Op-DeleteCustomer($db, $d) { return Delete-Named $db 'customer' 'bayeeCode' 'id' 'bayeeCode' $d }
function Op-DeleteSupplier($db, $d) { return Delete-Named $db 'supplier' 'shiraCode' 'ID' 'shiraCode' $d }
function Op-DeleteItem($db, $d) { return Delete-Named $db 'item' 'madaCode' 'ID' 'madaName' $d }

$Ops = @{
    saveSale = 'Op-SaveSale'; deleteSale = 'Op-DeleteSale'
    savePurchase = 'Op-SavePurchase'; deletePurchase = 'Op-DeletePurchase'
    saveReceipt = 'Op-SaveReceipt'; deleteReceipt = 'Op-DeleteReceipt'
    savePayment = 'Op-SavePayment'; deletePayment = 'Op-DeletePayment'
    saveCustomer = 'Op-SaveCustomer'; deleteCustomer = 'Op-DeleteCustomer'
    saveSupplier = 'Op-SaveSupplier'; deleteSupplier = 'Op-DeleteSupplier'
    saveItem = 'Op-SaveItem'; deleteItem = 'Op-DeleteItem'
}

# ---------------------------------------------------------------- permissions
# Managers can do everything. Everyone else gets the permissions a manager
# ticked for them in Settings; with nothing set, a user can only make cash
# sales and print them.
$DefaultPerms = @('pos', 'sale_cash', 'print')

# A screen comes with the work done on it: whoever may sell gets the sale
# screen, whoever may edit sales gets the sales list, and so on, so a manager
# ticking only the actions still gives a working set.
$ImpliedBy = [ordered]@{
    pos       = @('sale_cash', 'sale_credit')
    sales     = @('sale_edit', 'sale_delete')
    purchases = @('purchase', 'purchase_edit')
    customers = @('customer_add', 'customer_edit', 'receipt')
    suppliers = @('supplier_manage')
    stock     = @('item_manage')
    cash      = @('payment', 'voucher_edit')
}

# What a user may do, as text ("pos,sale_cash,print"), with the screens their
# actions need.
function Get-PermText([string]$user) {
    if (Test-Admin $user) { return ($AllPerms -join ',') }
    $t = $null
    if ($script:Config.perms.ContainsKey($user)) { $t = ConvertTo-PermText $script:Config.perms[$user] }
    if ($null -eq $t) { $t = $DefaultPerms -join ',' }
    $set = New-Object System.Collections.Generic.List[string]
    foreach ($p in ($t -split ',')) { if ($p -and -not $set.Contains($p)) { $set.Add($p) } }
    foreach ($screen in $ImpliedBy.Keys) {
        if (-not $set.Contains($screen) -and @($ImpliedBy[$screen] | Where-Object { $set.Contains($_) }).Count) { $set.Add($screen) }
    }
    return ($set.ToArray() -join ',')
}

# The same as a list, for checks on the helper.
function Get-Perms([string]$user) {
    return , [string[]]@((Get-PermText $user) -split ',' | Where-Object { $_ })
}

$PermNames = @{
    sale_cash = 'البيع النقدي'; sale_credit = 'البيع الآجل'; sale_wholesale = 'البيع بالجملة (الوحدة الكبيرة)'
    edit_price = 'تغيير السعر'; sale_edit = 'تعديل قوائم البيع'; sale_delete = 'مسح قوائم البيع'
    purchase = 'قوائم الشراء'; purchase_edit = 'تعديل ومسح قوائم الشراء'; receipt = 'وصل القبض'
    payment = 'وصل الدفع والمصاريف'; voucher_edit = 'تعديل ومسح الوصولات'; customer_add = 'إضافة زبون'
    customer_edit = 'تعديل ومسح الزبائن'; supplier_manage = 'الموردين'; item_manage = 'المواد والأسعار'
}

function Need-Perm($session, [string]$perm) {
    $name = if ($PermNames.ContainsKey($perm)) { $PermNames[$perm] } else { $perm }
    Need ($session.admin -or ($session.perms -contains $perm)) "ما عندك صلاحية: $name. اطلبها من المدير."
}

# Before running a write: may this user do it at all?
function Test-Allowed([string]$op, $data, $session) {
    if ($session.admin) { return }
    $isNew = -not $data.id
    switch ($op) {
        'saveSale' {
            Need-Perm $session $(if ([string]$data.type -eq 'اجل') { 'sale_credit' } else { 'sale_cash' })
            if (-not $isNew) { Need-Perm $session 'sale_edit' }
        }
        'deleteSale' { Need-Perm $session 'sale_delete' }
        'savePurchase' { Need-Perm $session $(if ($isNew) { 'purchase' } else { 'purchase_edit' }) }
        'deletePurchase' { Need-Perm $session 'purchase_edit' }
        'saveReceipt' { Need-Perm $session $(if ($isNew) { 'receipt' } else { 'voucher_edit' }) }
        'deleteReceipt' { Need-Perm $session 'voucher_edit' }
        'savePayment' { Need-Perm $session $(if ($isNew) { 'payment' } else { 'voucher_edit' }) }
        'deletePayment' { Need-Perm $session 'voucher_edit' }
        'saveCustomer' { Need-Perm $session $(if ($isNew) { 'customer_add' } else { 'customer_edit' }) }
        'deleteCustomer' { Need-Perm $session 'customer_edit' }
        { $_ -in 'saveSupplier', 'deleteSupplier' } { Need-Perm $session 'supplier_manage' }
        { $_ -in 'saveItem', 'deleteItem' } { Need-Perm $session 'item_manage' }
        default { Need $false 'هاي العملية تحتاج صلاحية مدير' }
    }
}

# Inside the save: selling by the big unit (wholesale) and changing a price
# away from the item card need their own permissions.
function Test-SaleLines($db, $data, $session) {
    if ($session.admin) { return }
    # editing an old invoice may keep the prices it already had
    $old = @{}
    if ($data.id) {
        $rs = $db.OpenRecordset("SELECT madaNameOut, unit, Price FROM subOut WHERE idOut=$([int]$data.id)", $dbOpenSnapshot)
        try {
            while (-not $rs.EOF) {
                $k = [string]$rs.Fields.Item('madaNameOut').Value + '|' + [string]$rs.Fields.Item('unit').Value
                $v = $rs.Fields.Item('Price').Value
                if (-not $old.ContainsKey($k)) { $old[$k] = @() }
                if ($v -isnot [DBNull]) { $old[$k] += [double]$v }
                $rs.MoveNext()
            }
        } finally { $rs.Close() }
    }
    foreach ($l in @($data.lines | Where-Object { $null -ne $_ })) {
        $it = Get-MadaItem $db ([string]$l.item)
        $k = [string]$l.item + '|' + [string]$l.unit
        # items with a single unit have no wholesale unit
        $big = ($it.UnitL2 -and [string]$l.unit -eq $it.UnitL1 -and $it.UnitL1 -ne $it.UnitL2)
        if ($big -and -not $old.ContainsKey($k)) { Need-Perm $session 'sale_wholesale' }
        if ($session.perms -contains 'edit_price') { continue }
        # same rule as the app: big unit → carton price, small unit → piece price
        $list = if ([string]$l.unit -eq $it.UnitL1) { $it.price } else { $it.priceSeeat }
        if ($null -eq $list -or $list -is [DBNull]) { $list = 0 }
        $price = Num $l.price 'السعر'
        $ok = @(@([double]$list) + @($old[$k]) | Where-Object { $null -ne $_ -and [math]::Abs($price - $_) -le 0.001 }).Count -gt 0
        Need $ok "ما عندك صلاحية: تغيير السعر ($($l.item)). اطلبها من المدير."
    }
}

function Invoke-Write([string]$op, $data, $session = $null) {
    Need ($Ops.ContainsKey($op)) "عملية مو معروفة: $op"
    Backup-Database
    $fn = $Ops[$op]
    $script:ItemCache = @{}
    $script:DataCache = $null
    try {
        return Use-Database { param($db)
            if ($session -and $op -eq 'saveSale') { Test-SaleLines $db $data $session }
            & $fn $db $data
        }
    } finally { $script:ItemCache = $null }
}

# ---------------------------------------------------------------- users

function Get-TableNames($db) {
    $names = @()
    foreach ($t in $db.TableDefs) { $names += [string]$t.Name }
    return , $names
}

function Get-UserNames {
    return Use-Database -ReadOnly { param($db)
        if ((Get-TableNames $db) -notcontains 'tblUsers') { return , @() }
        return , @((Get-Column $db 'SELECT UserName FROM tblUsers') | ForEach-Object { [string]$_ } | Where-Object { $_ })
    }
}

# Same rule as حساباتي's login (Module1.sec): the stored password must equal
# what was typed.
function Test-Login([string]$user, [string]$password) {
    return Use-Database -ReadOnly { param($db)
        if ((Get-TableNames $db) -notcontains 'tblUsers') { return $true }
        $rs = $db.OpenRecordset("SELECT UserPWD FROM tblUsers WHERE UserName=$(Q $user)", $dbOpenSnapshot)
        try {
            if ($rs.EOF) { return $false }
            $stored = $rs.Fields.Item(0).Value
            if ($stored -is [DBNull] -or $null -eq $stored) { return $false }
            return ([string]$stored -ceq $password)
        } finally { $rs.Close() }
    }
}

function Test-Admin([string]$user) {
    $admins = @($script:Config.admins)
    return ($admins.Count -eq 0 -or $admins -contains $user)
}

$script:Sessions = @{}

function New-Token {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLower()
}

function Get-Session($req) {
    $t = [string]$req.Headers['X-Token']
    if ($t -and $script:Sessions.ContainsKey($t)) {
        $s = $script:Sessions[$t]
        # managers and permissions can change while someone is signed in
        $s.admin = Test-Admin $s.user
        $s.perms = [string[]](Get-Perms $s.user)
        return $s
    }
    return $null
}

# ---------------------------------------------------------------- full test
# Before handing the program over: on a COPY of the data file, with the real
# Access engine, save / edit / delete one of everything through the same
# path the app uses (permission checks included) and commit each one. The
# app then reads the copy back and checks the reports (balances, stock, cash,
# profit) came out as expected. The real file is never touched.
$script:FT = $null

function Use-TestCopy([scriptblock]$body) {
    Need ($script:FT -and (Test-Path -LiteralPath $script:FT.path)) 'ابدأ الفحص الشامل من جديد'
    $script:DbOverride = $script:FT.path
    try { return (& $body) } finally { $script:DbOverride = $null }
}

function Start-FullTest {
    Stop-FullTest
    $src = Get-DbPath
    Need ($src -ne '') 'ما محدد ملف البيانات'
    $dir = Join-Path ([IO.Path]::GetTempPath()) 'lawha-fulltest'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    # copies left by a test that was cut off (closed window, power cut)
    Get-ChildItem -LiteralPath $dir -Filter 'test-*' -ErrorAction SilentlyContinue | ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force } catch { } }
    $target = Join-Path $dir ('test-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + [IO.Path]::GetExtension($src))
    $in = [IO.File]::Open($src, 'Open', 'Read', 'ReadWrite')
    try {
        $out = [IO.File]::Create($target)
        try { $in.CopyTo($out) } finally { $out.Close() }
    } finally { $in.Close() }
    $tag = 'فحص-شامل ' + (Get-Random -Minimum 1000 -Maximum 9999)
    $script:FT = @{ path = $target; tag = $tag; ids = @{} }
    return @{ file = [IO.Path]::GetFileName($target); size = (Get-Item -LiteralPath $target).Length }
}

function Stop-FullTest {
    if ($script:FT -and $script:FT.path) {
        foreach ($f in @($script:FT.path, [IO.Path]::ChangeExtension($script:FT.path, '.laccdb'))) {
            try { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } } catch { }
        }
    }
    $script:FT = $null
}

function New-StepList {
    $steps = New-Object System.Collections.Generic.List[object]
    $step = {
        param([string]$name, [scriptblock]$body)
        try {
            $msg = & $body
            $steps.Add(@{ name = $name; ok = $true; msg = [string]$msg })
        } catch {
            $steps.Add(@{ name = $name; ok = $false; msg = $_.Exception.Message })
        }
    }.GetNewClosure()
    return @{ list = $steps; step = $step }
}

# Writes the way /api/write does: permission check, then the save.
function Write-As($session, [string]$op, [hashtable]$data) {
    $data.user = $script:FT.user
    $x = [pscustomobject]$data
    Test-Allowed $op $x $session
    return Invoke-Write $op $x $session
}

function Read-One([string]$sql) { return Use-Database -ReadOnly { param($db) Get-Value $db $sql } }
function Read-Count([string]$sql) { return [int](Use-Database -ReadOnly { param($db) Count $db $sql }) }

function Invoke-FullTestRun {
    $S = New-StepList
    $step = $S.step
    Use-TestCopy {
        $t = $script:FT.tag
        $ids = $script:FT.ids
        $script:FT.user = 'فحص شامل'
        $today = Get-Date -Format 'yyyy-MM-dd'
        $mgr = @{ user = $script:FT.user; admin = $true; perms = [string[]]$AllPerms }
        $cust = "$t زبون"; $cust2 = "$t زبون2"; $sup = "$t مورد"; $item = "$t مادة"
        $script:FT.names = @{ customer = $cust2; supplier = $sup; item = $item }

        & $step 'إضافة مورد' {
            $ids.sup = (Write-As $mgr 'saveSupplier' @{ name = $sup; mobile = '07800000000'; opening = 0 }).id
            Need ((Read-One "SELECT shiraCode FROM shiraCode WHERE ID=$($ids.sup)") -eq $sup) 'المورد ما انحفظ'
            "رقم $($ids.sup)"
        }
        & $step 'إضافة زبون' {
            $ids.cust = (Write-As $mgr 'saveCustomer' @{ name = $cust; mobile = '07700000000'; opening = 1000; type = 'جملة' }).id
            Need ((Read-One "SELECT bayeeCode FROM bayeeCode WHERE id=$($ids.cust)") -eq $cust) 'الزبون ما انحفظ'
            "رقم $($ids.cust)"
        }
        & $step 'تعديل الزبون (موبايل ورصيد افتتاحي)' {
            Write-As $mgr 'saveCustomer' @{ id = $ids.cust; name = $cust; mobile = '07711111111'; opening = 2000; type = 'جملة' } | Out-Null
            Need ([string](Read-One "SELECT CMobile FROM bayeeCode WHERE id=$($ids.cust)") -eq '07711111111') 'الموبايل ما تغيّر'
            Need ([double](Read-One "SELECT MB FROM bayeeCode WHERE id=$($ids.cust)") -eq 2000) 'الرصيد الافتتاحي ما تغيّر'
            'تمام'
        }
        & $step 'إضافة مادة (كارتون = 10 قطع)' {
            $ids.item = (Write-As $mgr 'saveItem' @{ name = $item; code = ''; cls = 'فحص'; unitL1 = 'كارتون'; unitL2 = 'قطعة'; fill = 10
                    priceL1 = 10000; priceL2 = 1100; buyL1 = 8000; buyL2 = 800 }).id
            Need ([double](Read-One "SELECT priceSeeat FROM madaCode WHERE ID=$($ids.item)") -eq 1100) 'سعر القطعة ما انحفظ'
            "رقم $($ids.item)"
        }
        & $step 'تعديل سعر المادة' {
            Write-As $mgr 'saveItem' @{ id = $ids.item; name = $item; code = ''; cls = 'فحص'; unitL1 = 'كارتون'; unitL2 = 'قطعة'; fill = 10
                priceL1 = 12000; priceL2 = 1100; buyL1 = 8000; buyL2 = 800 } | Out-Null
            Need ([double](Read-One "SELECT price FROM madaCode WHERE ID=$($ids.item)") -eq 12000) 'السعر ما تغيّر'
            '12,000 للكارتون'
        }
        & $step 'قائمة شراء آجل (5 كارتون × 8,000)' {
            $ids.pur = (Write-As $mgr 'savePurchase' @{ type = 'اجل'; supplier = $sup; date = $today; updatePrices = $true
                    lines = @(@{ item = $item; unit = 'كارتون'; qty = 5; price = 8000 }) }).id
            Need ((Read-Count "SELECT Count(*) FROM subIN WHERE IdIn=$($ids.pur)") -eq 1) 'سطر الشراء ما انحفظ'
            Need ([string](Read-One "SELECT fromname FROM MasterIn WHERE IdIn=$($ids.pur)") -eq $sup) 'اسم المورد ما انحفظ'
            "رقم $($ids.pur)"
        }
        & $step 'تعديل قائمة الشراء (6 كارتون × 8,500) وتحديث سعر الشراء' {
            Write-As $mgr 'savePurchase' @{ id = $ids.pur; type = 'اجل'; supplier = $sup; date = $today; updatePrices = $true
                lines = @(@{ item = $item; unit = 'كارتون'; qty = 6; price = 8500 }) } | Out-Null
            Need ([double](Read-One "SELECT QuntIn FROM subIN WHERE IdIn=$($ids.pur)") -eq 6) 'الكمية ما تغيّرت'
            Need ([double](Read-One "SELECT BpriceL1 FROM madaCode WHERE ID=$($ids.item)") -eq 8500) 'سعر الشراء بالمادة ما تحدّث'
            Need ([double](Read-One "SELECT BpriceL2 FROM madaCode WHERE ID=$($ids.item)") -eq 850) 'سعر شراء القطعة ما تحدّث'
            'تمام'
        }
        & $step 'بيع نقدي (3 قطع × 1,100)' {
            $ids.cash = (Write-As $mgr 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 3; price = 1100 }) }).id
            Need ([string](Read-One "SELECT OutType FROM MasterOut WHERE idOut=$($ids.cash)") -eq 'نقدي') 'نوع القائمة ما انحفظ'
            "رقم $($ids.cash)"
        }
        & $step 'بيع آجل (2 كارتون × 12,000، دفع 4,000)' {
            $ids.credit = (Write-As $mgr 'saveSale' @{ type = 'اجل'; customer = $cust; paid = 4000; date = $today
                    lines = @(@{ item = $item; unit = 'كارتون'; qty = 2; price = 12000 }) }).id
            Need ([string](Read-One "SELECT TOname FROM MasterOut WHERE idOut=$($ids.credit)") -eq $cust) 'اسم الزبون ما انحفظ'
            Need ([double](Read-One "SELECT Paid FROM MasterOut WHERE idOut=$($ids.credit)") -eq 4000) 'المدفوع ما انحفظ'
            "رقم $($ids.credit)"
        }
        & $step 'تعديل البيع الآجل (كارتون + 5 قطع)' {
            Write-As $mgr 'saveSale' @{ id = $ids.credit; type = 'اجل'; customer = $cust; paid = 4000; date = $today
                lines = @(@{ item = $item; unit = 'كارتون'; qty = 1; price = 12000 }, @{ item = $item; unit = 'قطعة'; qty = 5; price = 1100 }) } | Out-Null
            Need ((Read-Count "SELECT Count(*) FROM subOut WHERE idOut=$($ids.credit)") -eq 2) 'أسطر التعديل ما انحفظت'
            Need ((Read-Count "SELECT Count(*) FROM MasterOut WHERE idOut=$($ids.credit)") -eq 1) 'القائمة تكررت'
            'المبلغ 17,500'
        }
        & $step 'وصل قبض من الزبون (3,000)' {
            $ids.rec = (Write-As $mgr 'saveReceipt' @{ cls = 'تسديد'; name = $cust; amount = 3000; date = $today }).id
            "رقم $($ids.rec)"
        }
        & $step 'تعديل وصل القبض (3,500)' {
            Write-As $mgr 'saveReceipt' @{ id = $ids.rec; cls = 'تسديد'; name = $cust; amount = 3500; date = $today } | Out-Null
            Need ([double](Read-One "SELECT mablak FROM mablakIn WHERE idS=$($ids.rec)") -eq 3500) 'المبلغ ما تغيّر'
            'تمام'
        }
        & $step 'وصل دفع للمورد (20,000)' {
            $ids.pay = (Write-As $mgr 'savePayment' @{ cls = 'تسديد'; name = $sup; amount = 20000; date = $today }).id
            "رقم $($ids.pay)"
        }
        & $step 'مصروف (1,500)' {
            $ids.exp = (Write-As $mgr 'savePayment' @{ cls = 'مصاريف متفرقة'; name = ''; amount = 1500; note = $t; date = $today }).id
            "رقم $($ids.exp)"
        }
        & $step 'تغيير اسم الزبون ينتقل لقوائمه ووصولاته' {
            Write-As $mgr 'saveCustomer' @{ id = $ids.cust; name = $cust2; mobile = '07711111111'; opening = 2000; type = 'جملة' } | Out-Null
            Need ((Read-Count "SELECT Count(*) FROM MasterOut WHERE TOname=$(Q $cust2)") -eq 1) 'القائمة بقت بالاسم القديم'
            Need ((Read-Count "SELECT Count(*) FROM mablakIn WHERE nameFrom=$(Q $cust2)") -eq 1) 'الوصل بقى بالاسم القديم'
            Need ((Read-Count "SELECT Count(*) FROM MasterOut WHERE TOname=$(Q $cust)") -eq 0) 'بقى شي بالاسم القديم'
            'تمام'
        }

        # a cashier with the default permissions (cash sale and print)
        $cashier = @{ user = $script:FT.user; admin = $false; perms = [string[]]$DefaultPerms }
        $refused = {
            param([string]$op, [hashtable]$d, [string]$expect)
            try { Write-As $cashier $op $d | Out-Null } catch {
                Need ($_.Exception.Message -match $expect) "انرفض بس بسبب ثاني: $($_.Exception.Message)"
                return 'انرفض ✔'
            }
            throw 'انحفظ وهو ما لازم ينحفظ!'
        }
        & $step 'صلاحيات: الكاشير يبيع نقدي بالسعر' {
            $ids.cashier = (Write-As $cashier 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 1; price = 1100 }) }).id
            "رقم $($ids.cashier)"
        }
        & $step 'صلاحيات: الكاشير ما يبيع آجل' { & $refused 'saveSale' @{ type = 'اجل'; customer = $cust2; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 1; price = 1100 }) } 'صلاحية' }
        & $step 'صلاحيات: الكاشير ما يبيع جملة (كارتون)' { & $refused 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'كارتون'; qty = 1; price = 12000 }) } 'الجملة' }
        & $step 'صلاحيات: الكاشير ما يغيّر السعر' { & $refused 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 1; price = 500 }) } 'السعر' }
        & $step 'صلاحيات: الكاشير ما يمسح قائمة' { & $refused 'deleteSale' @{ id = $ids.cash } 'صلاحية' }
        & $step 'صلاحيات: الكاشير ما يشتري' { & $refused 'savePurchase' @{ type = 'اجل'; supplier = $sup; date = $today; lines = @(@{ item = $item; unit = 'كارتون'; qty = 1; price = 8500 }) } 'صلاحية' }
        & $step 'صلاحيات: الكاشير ما يغيّر المواد' { & $refused 'saveItem' @{ id = $ids.item; name = $item; unitL1 = 'كارتون' } 'صلاحية' }
        & $step 'ما يصير تمسح مادة عليها حركة' {
            try { Write-As $mgr 'deleteItem' @{ id = $ids.item } | Out-Null } catch { return 'انرفض ✔' }
            throw 'انمسحت المادة وعليها قوائم!'
        }
    }
    # what the app should see when it reads the copy back
    $expect = @{
        user = $script:FT.user; tag = $script:FT.tag; customer = $script:FT.names.customer; supplier = $script:FT.names.supplier; item = $script:FT.names.item
        customerBalance = 12000; supplierBalance = 31000; stockPcs = 41; stockK = 4; stockS = 1
        salesCount = 3; salesTotal = 21900; salesCash = 4400; salesCredit = 17500
        cashIn = 11900; cashOut = 21500; cashNet = -9600; gross = 5750
    }
    return @{ steps = $S.list.ToArray(); expect = $expect }
}

function Invoke-FullTestClean {
    $S = New-StepList
    $step = $S.step
    Use-TestCopy {
        $ids = $script:FT.ids
        $mgr = @{ user = $script:FT.user; admin = $true; perms = [string[]]$AllPerms }
        foreach ($k in 'cash', 'credit', 'cashier') {
            if ($ids[$k]) { & $step "مسح قائمة البيع رقم $($ids[$k])" { Write-As $mgr 'deleteSale' @{ id = $ids[$k] } | Out-Null; Need ((Read-Count "SELECT Count(*) FROM subOut WHERE idOut=$($ids[$k])") -eq 0) 'بقت أسطر'; 'تمام' } }
        }
        if ($ids.pur) { & $step 'مسح قائمة الشراء' { Write-As $mgr 'deletePurchase' @{ id = $ids.pur } | Out-Null; Need ((Read-Count "SELECT Count(*) FROM subIN WHERE IdIn=$($ids.pur)") -eq 0) 'بقت أسطر'; 'تمام' } }
        if ($ids.rec) { & $step 'مسح وصل القبض' { Write-As $mgr 'deleteReceipt' @{ id = $ids.rec } | Out-Null; 'تمام' } }
        foreach ($k in 'pay', 'exp') { if ($ids[$k]) { & $step "مسح وصل الدفع رقم $($ids[$k])" { Write-As $mgr 'deletePayment' @{ id = $ids[$k] } | Out-Null; 'تمام' } } }
        if ($ids.item) { & $step 'مسح المادة' { Write-As $mgr 'deleteItem' @{ id = $ids.item } | Out-Null; 'تمام' } }
        if ($ids.cust) { & $step 'مسح الزبون' { Write-As $mgr 'deleteCustomer' @{ id = $ids.cust } | Out-Null; 'تمام' } }
        if ($ids.sup) { & $step 'مسح المورد' { Write-As $mgr 'deleteSupplier' @{ id = $ids.sup } | Out-Null; 'تمام' } }
        & $step 'ما بقى أي شي من الفحص' {
            $n = $script:FT.names
            $left = (Read-Count "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $n.customer)") + (Read-Count "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q ($script:FT.tag + ' زبون'))") +
                (Read-Count "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $n.supplier)") +
                (Read-Count "SELECT Count(*) FROM madaCode WHERE madaName=$(Q $n.item)") + (Read-Count "SELECT Count(*) FROM MasterOut WHERE strUserName=$(Q $script:FT.user)") +
                (Read-Count "SELECT Count(*) FROM mablakIn WHERE strUserName=$(Q $script:FT.user)") + (Read-Count "SELECT Count(*) FROM mablakOut WHERE strUserName=$(Q $script:FT.user)")
            Need ($left -eq 0) "بقى $left سجل"
            'تمام'
        }
    }
    return @{ steps = $S.list.ToArray() }
}

# ---------------------------------------------------------------- data for other devices
# A device that connects to this computer over the network (or a VPN) gets
# the data from here as compact JSON, read by DAO from the file on this
# computer, instead of copying the whole 15 MB file across the network after
# every save: only the columns the app uses, rows as arrays, gzip-compressed
# (about 150 KB). Kept until the file changes.
$DataTables = [ordered]@{
    madaCode   = 'ID,IDcode,MadaClass,madaName,harig,price,priceSeeat,Fill,BpriceL1,BpriceL2,UnitL1,UnitL2,Pr,Pru'
    MasterOut  = 'idOut,InvoiceNo,TOname,note,OutDate,timeS,OutType,Paid,strUserName,Mandob'
    subOut     = 'id,idOut,madaNameOut,QuntOut,Price,unit,BpriceL1,BpriceL2,note'
    MasterIn   = 'IdIn,InvoiceNo,fromname,note,InvoiceDate,timeS,InType,strUserName'
    subIN      = 'id,IdIn,madaNameIn,QuntIn,Price,unit,expireDate'
    bayeeCode  = 'id,bayeeCode,MB,CMobile,Cadress,Ctype,Group,Mandob,RegDate,Cdate'
    shiraCode  = 'ID,shiraCode,MB,CMobile,Cadress,RegDate,Cdate'
    mablakIn   = 'idS,dataS,mostandNO,nameFrom,classS,mablak,note,timeS,strUserName'
    mablakOut  = 'idS,dataS,mostandNO,nameto,classS,mablak,note,timeS,strUserName'
    quodCodeIn = 'quodCode'
    quodCodeOut = 'quodCode'
    # names only: passwords never leave this computer
    tblUsers   = 'UserName'
}
$script:DataCache = $null

function Add-JsonValue([Text.StringBuilder]$sb, $v) {
    if ($null -eq $v -or $v -is [DBNull]) { [void]$sb.Append('null'); return }
    if ($v -is [string]) {
        $t = $v
        if ($t -match '[\\"\x00-\x1f  ]') {
            $t = [regex]::Replace($t, '[\\"\x00-\x1f  ]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
        }
        [void]$sb.Append('"').Append($t).Append('"')
        return
    }
    if ($v -is [datetime]) { [void]$sb.Append('"').Append($v.ToString('yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)).Append('"'); return }
    if ($v -is [bool]) { [void]$sb.Append($(if ($v) { 'true' } else { 'false' })); return }
    if ($v -is [IFormattable]) { [void]$sb.Append($v.ToString($null, [Globalization.CultureInfo]::InvariantCulture)); return }
    Add-JsonValue $sb ([string]$v)
}

function Export-Data {
    $p = Get-DbPath
    Need ($p -ne '') 'ما محدد ملف البيانات'
    $fi = Get-Item -LiteralPath $p
    $key = "$($fi.Length)|$($fi.LastWriteTimeUtc.Ticks)"
    # at most 20 seconds old: حساباتي may have saved without the file's time changing yet
    if ($script:DataCache -and $script:DataCache.key -eq $key -and $script:DataCache.path -eq $p -and
        ((Get-Date) - $script:DataCache.at).TotalSeconds -lt 20) { return , $script:DataCache.bytes }
    $json = Use-Database -ReadOnly { param($db)
        $have = @{}
        foreach ($td in $db.TableDefs) {
            $n = [string]$td.Name
            if ($DataTables.Contains($n)) { $have[$n] = @(foreach ($f in $td.Fields) { [string]$f.Name }) }
        }
        $sb = New-Object Text.StringBuilder 1048576
        [void]$sb.Append('{"ok":true,"tables":{')
        $firstTable = $true
        foreach ($t in $DataTables.Keys) {
            if (-not $have.ContainsKey($t)) { continue }
            $cols = @($DataTables[$t].Split(',') | Where-Object { $have[$t] -contains $_ })
            if (-not $cols.Count) { continue }
            if (-not $firstTable) { [void]$sb.Append(',') }
            $firstTable = $false
            [void]$sb.Append('"').Append($t).Append('":{"cols":[')
            [void]$sb.Append((($cols | ForEach-Object { '"' + $_ + '"' }) -join ','))
            [void]$sb.Append('],"rows":[')
            $rs = $db.OpenRecordset('SELECT ' + (($cols | ForEach-Object { "[$_]" }) -join ',') + " FROM [$t]", $dbOpenSnapshot)
            try {
                $firstRow = $true
                while (-not $rs.EOF) {
                    $a = $rs.GetRows(5000)
                    $nc = $a.GetLength(0)
                    $nr = $a.GetLength(1)
                    for ($r = 0; $r -lt $nr; $r++) {
                        if (-not $firstRow) { [void]$sb.Append(',') }
                        $firstRow = $false
                        [void]$sb.Append('[')
                        for ($c = 0; $c -lt $nc; $c++) {
                            if ($c) { [void]$sb.Append(',') }
                            Add-JsonValue $sb $a[$c, $r]
                        }
                        [void]$sb.Append(']')
                    }
                    if ($nr -eq 0) { break }
                }
            } finally { $rs.Close() }
            [void]$sb.Append(']}')
        }
        [void]$sb.Append('}}')
        return $sb.ToString()
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $script:DataCache = @{ key = $key; path = $p; bytes = $bytes; at = Get-Date }
    # the comma keeps it one byte[] (not 250,000 separate bytes)
    return , $bytes
}

# Big answers go out gzip-compressed when the browser accepts it.
function Send-Compressed($ctx, [byte[]]$bytes, [string]$type) {
    $req = $ctx.Request
    if ([string]$req.Headers['Accept-Encoding'] -notmatch 'gzip') { return Send $ctx 200 $bytes $type }
    $ms = New-Object IO.MemoryStream
    $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionLevel]::Fastest, $true)
    $gz.Write($bytes, 0, $bytes.Length)
    $gz.Close()
    $res = $ctx.Response
    $res.Headers['Content-Encoding'] = 'gzip'
    Send $ctx 200 $ms.ToArray() $type
}

# ---------------------------------------------------------------- other devices
# On the main computer (where the data file is), a manager can let other
# devices connect: the helper then listens on the network as well. Windows
# allows that only after a one-time approval (UAC): a URL reservation for
# this user and a firewall rule for the port.
function Enable-RemoteAccess {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $cmd = "netsh http delete urlacl url=http://+:$Port/ | Out-Null; " +
        "netsh http add urlacl url=http://+:$Port/ sddl=D:(A;;GX;;;$sid); " +
        "netsh advfirewall firewall delete rule name='Lawhat Al-Mahal' | Out-Null; " +
        "netsh advfirewall firewall add rule name='Lawhat Al-Mahal' dir=in action=allow protocol=TCP localport=$Port"
    try {
        $p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd)
    } catch {
        throw 'ويندوز ما وافق. لازم توافق على رسالة "هل تسمح لهذا التطبيق…" (تحتاج حساب مدير ويندوز).'
    }
    Need ($p.ExitCode -eq 0) "ما انفتح الاتصال (رمز $($p.ExitCode))"
}

# The addresses other devices can use to reach this computer.
function Get-MyAddresses {
    $out = New-Object System.Collections.Generic.List[object]
    $out.Add(@{ kind = 'name'; value = $env:COMPUTERNAME })
    foreach ($ni in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($ni.OperationalStatus -ne 'Up' -or $ni.NetworkInterfaceType -eq 'Loopback') { continue }
        foreach ($a in $ni.GetIPProperties().UnicastAddresses) {
            if ($a.Address.AddressFamily -eq 'InterNetwork' -and -not $a.Address.ToString().StartsWith('169.254.')) {
                $out.Add(@{ kind = 'ip'; value = $a.Address.ToString(); via = [string]$ni.Description })
            }
        }
    }
    return , $out.ToArray()
}

# A second device: check that the main computer's program answers, and
# remember it, so this device opens it from now on.
function Connect-Remote([string]$target) {
    $t = $target.Trim() -replace '^https?://', '' -replace '/.*$', '' -replace '^\\\\', ''
    Need ($t -ne '') 'اكتب اسم الحاسبة الرئيسية أو رقم الـ IP مالها'
    if ($t -notmatch ':\d+$') { $t = "${t}:$Port" }
    $url = "http://$t/"
    try {
        $wc = New-Object Net.WebClient
        $wc.Proxy = $null
        $wc.Encoding = [Text.Encoding]::UTF8
        $j = $wc.DownloadString($url + 'api/ping') | ConvertFrom-Json
    } catch {
        throw "ما ردّت الحاسبة $t. تأكد إنها شغّالة وبيها البرنامج مفتوح، وإن المدير فعّل (السماح للأجهزة الثانية بالاتصال) بإعداداتها، وإن الـ VPN أو الشبكة توصل بينكم."
    }
    Need ($j.ok -and $j.configured) "الحاسبة $t ردّت، بس ما محدد عليها ملف البيانات."
    $script:Config.remoteUrl = $url
    Save-Config
    Write-LawhaLog "linked to main computer $url"
    return @{ url = $url; version = [string]$j.version; shopName = [string]$j.shopName }
}

# ---------------------------------------------------------------- empty rows
# Versions before 1.1.1 wrote rows whose values all ended up empty on some
# Access installs. These rules match only rows with every key value empty,
# which حساباتي itself never writes (its own lines without an invoice still
# carry an item name, so they are left alone).
$BrokenRules = @(
    @{ table = 'MasterOut'; where = '[TOname] IS NULL AND [OutDate] IS NULL AND [OutType] IS NULL'; label = 'قوائم بيع فارغة' },
    @{ table = 'subOut'; where = '[idOut] IS NULL AND [madaNameOut] IS NULL'; label = 'أسطر بيع فارغة' },
    @{ table = 'MasterIn'; where = '[fromname] IS NULL AND [InvoiceDate] IS NULL AND [InType] IS NULL'; label = 'قوائم شراء فارغة' },
    @{ table = 'subIN'; where = '[madaNameIn] IS NULL'; label = 'أسطر شراء فارغة' },
    @{ table = 'mablakIn'; where = '[mablak] IS NULL AND [dataS] IS NULL AND [classS] IS NULL'; label = 'وصولات قبض فارغة' },
    @{ table = 'mablakOut'; where = '[mablak] IS NULL AND [dataS] IS NULL AND [classS] IS NULL'; label = 'وصولات دفع فارغة' },
    @{ table = 'bayeeCode'; where = '[bayeeCode] IS NULL'; label = 'زبائن بدون اسم' },
    @{ table = 'shiraCode'; where = '[shiraCode] IS NULL'; label = 'موردين بدون اسم' },
    @{ table = 'madaCode'; where = '[madaName] IS NULL'; label = 'مواد بدون اسم' }
)

function Get-BrokenRows([switch]$Clean) {
    # deleting: today's copy must be finished first
    if ($Clean) { Start-Backup; Wait-Backup 600 }
    $body = { param($db)
        $out = @()
        foreach ($r in $BrokenRules) {
            $n = Count $db "SELECT Count(*) FROM [$($r.table)] WHERE $($r.where)"
            if ($n -gt 0 -and $Clean) { $db.Execute("DELETE FROM [$($r.table)] WHERE $($r.where)", $dbFailOnError) }
            $out += @{ table = $r.table; label = $r.label; count = $n }
        }
        return , $out
    }
    if ($Clean) { return Use-Database $body }
    return Use-Database -ReadOnly $body
}

# ---------------------------------------------------------------- self-test

# Runs every kind of save inside one transaction, checks each result, then
# rolls everything back, so the data file is left exactly as it was.
function Invoke-SelfTest {
    $steps = New-Object System.Collections.Generic.List[object]
    function Step([string]$name, [scriptblock]$body) {
        try {
            $msg = & $body
            $steps.Add(@{ name = $name; ok = $true; msg = [string]$msg })
            return $true
        } catch {
            $steps.Add(@{ name = $name; ok = $false; msg = $_.Exception.Message })
            return $false
        }
    }
    $today = Get-Date -Format 'yyyy-MM-dd'

    if (-not (Step 'ملف البيانات محدد وموجود' { $p = Get-DbPath; Need ($p -ne '') 'ما محدد ملف البيانات'; $p })) { return , $steps.ToArray() }
    if (-not (Step 'محرك Access' { [void](Get-Engine); $script:EngineName })) { return , $steps.ToArray() }
    Step 'فولدر النسخ الاحتياطي' {
        $dir = Join-Path (Split-Path (Get-DbPath) -Parent) 'backups-lawha'
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $probe = Join-Path $dir 'lawha-write-test.tmp'
        Set-Content -LiteralPath $probe 'ok'
        Remove-Item -LiteralPath $probe -Force
        $dir
    } | Out-Null

    $tag = 'فحص-لوحة-' + (Get-Random -Maximum 99999)
    $u = 'فحص النظام'
    $script:st = @{}
    try {
        Use-Database -Rollback { param($db)
            Step 'قراءة المواد والموردين' {
                $script:st.item = [string](Get-Value $db 'SELECT TOP 1 madaName FROM madaCode ORDER BY ID')
                $script:st.supplier = [string](Get-Value $db 'SELECT TOP 1 shiraCode FROM shiraCode ORDER BY ID')
                Need ($script:st.item -ne '') 'ماكو مواد'
                "$($script:st.item) / $($script:st.supplier)"
            } | Out-Null
            $it = Get-MadaItem $db $script:st.item
            $small = if ($it.UnitL2) { [string]$it.UnitL2 } else { [string]$it.UnitL1 }
            $big = [string]$it.UnitL1
            $item = $script:st.item

            Step 'إضافة زبون' {
                $script:st.cust = (Op-SaveCustomer $db @{ name = $tag; mobile = '07700000000'; opening = 1000; type = 'جملة'; user = $u }).id
                Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $tag)") -eq 1) 'الزبون ما انضاف'
                Need ([string](Get-Value $db "SELECT CMobile FROM bayeeCode WHERE id=$($script:st.cust)") -eq '07700000000') 'الموبايل ما انحفظ'
                Need ([int](Get-Value $db "SELECT MB FROM bayeeCode WHERE id=$($script:st.cust)") -eq 1000) 'الرصيد الافتتاحي ما انحفظ'
                "رقم $($script:st.cust)"
            } | Out-Null
            Step 'قائمة بيع آجل' {
                $script:st.sale = (Op-SaveSale $db @{ type = 'اجل'; customer = $tag; date = $today; paid = 500; user = $u
                        lines = @(@{ item = $item; unit = $small; qty = 2; price = 1500 }) }).id
                Need ((Count $db "SELECT Count(*) FROM subOut WHERE idOut=$($script:st.sale)") -eq 1) 'سطر القائمة ما انضاف'
                Need ([string](Get-Value $db "SELECT TOname FROM MasterOut WHERE idOut=$($script:st.sale)") -eq $tag) 'اسم الزبون ما انحفظ بالقائمة'
                Need ([string](Get-Value $db "SELECT OutType FROM MasterOut WHERE idOut=$($script:st.sale)") -eq 'اجل') 'نوع القائمة ما انحفظ'
                Need ($null -ne (Get-Value $db "SELECT OutDate FROM MasterOut WHERE idOut=$($script:st.sale)")) 'تاريخ القائمة ما انحفظ'
                Need ([int](Get-Value $db "SELECT Paid FROM MasterOut WHERE idOut=$($script:st.sale)") -eq 500) 'المدفوع ما انحفظ'
                Need ([double](Get-Value $db "SELECT QuntOut FROM subOut WHERE idOut=$($script:st.sale)") -eq 2) 'الكمية ما انحفظت'
                Need ([double](Get-Value $db "SELECT Price FROM subOut WHERE idOut=$($script:st.sale)") -eq 1500) 'السعر ما انحفظ'
                "رقم $($script:st.sale)"
            } | Out-Null
            Step 'تعديل قائمة البيع' {
                Op-SaveSale $db @{ id = $script:st.sale; type = 'اجل'; customer = $tag; date = $today; paid = 0; user = $u
                    lines = @(@{ item = $item; unit = $small; qty = 3; price = 1500 }, @{ item = $item; unit = $big; qty = 1; price = 1000 }) } | Out-Null
                Need ((Count $db "SELECT Count(*) FROM subOut WHERE idOut=$($script:st.sale)") -eq 2) 'التعديل ما انحفظ'
                'تمام'
            } | Out-Null
            Step 'قائمة بيع نقدي' {
                $script:st.cash = (Op-SaveSale $db @{ type = 'نقدي'; date = $today; user = $u; lines = @(@{ item = $item; unit = $small; qty = 1; price = 1000 }) }).id
                "رقم $($script:st.cash)"
            } | Out-Null
            Step 'وصل قبض' {
                $script:st.rec = (Op-SaveReceipt $db @{ cls = 'تسديد'; name = $tag; amount = 2500; date = $today; user = $u }).id
                "رقم $($script:st.rec)"
            } | Out-Null
            Step 'وصل دفع (مصروف)' {
                $script:st.pay = (Op-SavePayment $db @{ cls = 'مصاريف متفرقة'; name = ''; amount = 100; note = $tag; date = $today; user = $u }).id
                Need ([double](Get-Value $db "SELECT mablak FROM mablakOut WHERE idS=$($script:st.pay)") -eq 100) 'المبلغ ما انحفظ'
                Need ([string](Get-Value $db "SELECT classS FROM mablakOut WHERE idS=$($script:st.pay)") -eq 'مصاريف متفرقة') 'نوع المصروف ما انحفظ'
                "رقم $($script:st.pay)"
            } | Out-Null
            if ($script:st.supplier) {
                Step 'قائمة شراء وتحديث سعر الشراء' {
                    $script:st.pur = (Op-SavePurchase $db @{ type = 'اجل'; supplier = $script:st.supplier; date = $today; user = $u; updatePrices = $true
                            lines = @(@{ item = $item; unit = $big; qty = 1; price = 1 }) }).id
                    "رقم $($script:st.pur)"
                } | Out-Null
            }
            Step 'إضافة وتعديل ومسح مادة' {
                $iid = (Op-SaveItem $db @{ name = $tag; code = ''; cls = 'فحص'; unitL1 = 'كارتون'; unitL2 = 'قطعة'; fill = 10; priceL1 = 10000; priceL2 = 1000; buyL1 = 9000; buyL2 = 900 }).id
                Op-SaveItem $db @{ id = $iid; name = "$tag-2"; code = ''; cls = 'فحص'; unitL1 = 'كارتون'; unitL2 = 'قطعة'; fill = 10; priceL1 = 11000; priceL2 = 1100; buyL1 = 9000; buyL2 = 900 } | Out-Null
                Op-DeleteItem $db @{ id = $iid } | Out-Null
                'تمام'
            } | Out-Null
            Step 'مسح القوائم والوصولات' {
                Op-DeleteSale $db @{ id = $script:st.sale } | Out-Null
                Op-DeleteSale $db @{ id = $script:st.cash } | Out-Null
                Op-DeleteReceipt $db @{ id = $script:st.rec } | Out-Null
                Op-DeletePayment $db @{ id = $script:st.pay } | Out-Null
                if ($script:st.pur) { Op-DeletePurchase $db @{ id = $script:st.pur } | Out-Null }
                Op-DeleteCustomer $db @{ id = $script:st.cust } | Out-Null
                Need ((Count $db "SELECT Count(*) FROM MasterOut WHERE idOut=$($script:st.sale)") -eq 0) 'القائمة ما انمسحت'
                'تمام'
            } | Out-Null
        }
    } catch {
        $steps.Add(@{ name = 'فتح الملف للكتابة'; ok = $false; msg = $_.Exception.Message })
    }
    Step 'الملف رجع مثل ما جان (التجربة انلغت)' {
        $left = Use-Database -ReadOnly { param($db) Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $tag)" }
        Need ($left -eq 0) 'بقت بيانات تجربة بالملف!'
        'تمام'
    } | Out-Null
    return , $steps.ToArray()
}

# ---------------------------------------------------------------- http

function Send($ctx, [int]$status, [byte[]]$bytes, [string]$type) {
    $res = $ctx.Response
    $res.StatusCode = $status
    $res.ContentType = $type
    $res.Headers['Cache-Control'] = 'no-store'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Send-Json($ctx, [int]$status, $obj) {
    $json = $obj | ConvertTo-Json -Depth 6 -Compress
    # Windows PowerShell 5.1 writes some arrays as {"value":[...],"Count":n}
    $json = [regex]::Replace($json, '\{"value":(\[[^\[\]{}]*\]),"Count":\d+\}', '$1')
    Send $ctx $status ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
}

function Read-Body($req) {
    $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
    if (-not $body) { return [pscustomobject]@{} }
    return $body | ConvertFrom-Json
}

# Windows' own file dialog. A hidden background process cannot bring it to the
# front, so the app offers its own browser first and this only as a fallback.
# Windows keeps a hidden background program from putting a window in front
# of the one being used; attaching to the front window's input (or, failing
# that, an Alt tap) lifts that, so the file dialog really comes up on top.
$ForegroundCode = @'
using System;
using System.Runtime.InteropServices;
public static class LawhaForeground {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static void Bring(IntPtr h) {
        uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        uint me = GetCurrentThreadId();
        if (fg != 0 && fg != me) AttachThreadInput(fg, me, true);
        BringWindowToTop(h);
        SetForegroundWindow(h);
        if (fg != 0 && fg != me) AttachThreadInput(fg, me, false);
        if (GetForegroundWindow() != h) {
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, 2, UIntPtr.Zero);
            SetForegroundWindow(h);
        }
    }
}
'@

function Choose-File {
    Add-Type -AssemblyName System.Windows.Forms
    # an invisible owner that sits on top of everything and has a taskbar
    # button, so the dialog can't end up hidden behind the program
    $owner = New-Object System.Windows.Forms.Form -Property @{
        TopMost = $true; ShowInTaskbar = $true; Opacity = 0; StartPosition = 'CenterScreen'; Size = (New-Object System.Drawing.Size 1, 1)
        Text = 'اختيار ملف البيانات — لوحة المحل'; FormBorderStyle = 'None'
    }
    $owner.Show()
    try {
        if (-not ('LawhaForeground' -as [type])) { Add-Type -TypeDefinition $ForegroundCode }
        [LawhaForeground]::Bring($owner.Handle)
    } catch { }
    $owner.Activate()
    $dlg = New-Object System.Windows.Forms.OpenFileDialog -Property @{
        Title  = 'اختار ملف حساباتي (Units2026.accdb)'
        Filter = 'Access (*.accdb;*.mdb)|*.accdb;*.mdb'
    }
    $cur = Get-DbPath
    if ($cur) { $dlg.InitialDirectory = Split-Path $cur -Parent }
    try {
        if ($dlg.ShowDialog($owner) -ne 'OK') { return '' }
        return $dlg.FileName
    } finally { $owner.Close(); $owner.Dispose() }
}

# Places to start browsing from: drives and the usual user folders.
function Get-Places {
    $out = New-Object System.Collections.Generic.List[object]
    $cur = Get-DbPath
    if ($cur) { $out.Add(@{ name = 'فولدر الملف الحالي'; path = (Split-Path $cur -Parent); kind = 'folder' }) }
    $out.Add(@{ name = 'الشبكة (الحاسبات الثانية)'; path = 'net:'; kind = 'network' })
    $userHome = $env:USERPROFILE
    foreach ($f in @(
            @{ name = 'سطح المكتب'; path = [Environment]::GetFolderPath('Desktop') },
            @{ name = 'المستندات'; path = [Environment]::GetFolderPath('MyDocuments') },
            @{ name = 'التنزيلات'; path = $(if ($userHome) { Join-Path $userHome 'Downloads' } else { '' }) })) {
        if ($f.path -and (Test-Path -LiteralPath $f.path)) { $out.Add(@{ name = $f.name; path = $f.path; kind = 'folder' }) }
    }
    foreach ($d in [IO.DriveInfo]::GetDrives()) {
        try {
            if (-not $d.IsReady -or [string]$d.DriveType -notin 'Fixed', 'Removable', 'Network') { continue }
            $label = if ($d.VolumeLabel) { "$($d.Name) ($($d.VolumeLabel))" } else { $d.Name }
            $out.Add(@{ name = $label; path = $d.RootDirectory.FullName; kind = [string]$d.DriveType })
        } catch { }
    }
    return , $out.ToArray()
}

# One folder: its sub-folders and Access files.
# ---------------------------------------------------------------- network
# The picker's "الشبكة": computers Windows sees on the network (like
# Explorer's Network), then a computer's shared folders, then normal
# folders inside a share. Network calls can hang, so they run on the side
# with a time limit and never hold up the cashiers' requests for long.
function Invoke-Limited([scriptblock]$sb, $arg, [int]$ms) {
    $rs = [runspacefactory]::CreateRunspace()
    try { $rs.ApartmentState = 'STA' } catch { }
    $rs.Open()
    $ps = [PowerShell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($sb.ToString()).AddArgument($arg)
    $h = $ps.BeginInvoke()
    if (-not $h.AsyncWaitHandle.WaitOne($ms)) {
        # left to finish on its own; Stop() could block as long as the call
        $script:Abandoned += , @($ps, $rs)
        throw 'timeout'
    }
    try {
        $r = $ps.EndInvoke($h)
        if ($ps.Streams.Error.Count -and -not $r) { throw $ps.Streams.Error[0].Exception }
        return , @($r)
    } catch {
        $e = $_.Exception
        while ($e.InnerException) { $e = $e.InnerException }
        throw $e.Message
    } finally { $ps.Dispose(); $rs.Dispose() }
}
$script:Abandoned = @()

# test hook: LAWHA_FAKENET='{"PC":{"Share":"/local/folder"}}'
function Get-FakeNet { if ($env:LAWHA_FAKENET) { return ($env:LAWHA_FAKENET | ConvertFrom-Json) } }
function ConvertFrom-NetPath([string]$p) {
    $net = Get-FakeNet
    if ($net -and $p -match '^\\\\([^\\]+)\\([^\\]+)(.*)$') {
        $pc = $net.PSObject.Properties[$Matches[1]]
        if ($pc -and $pc.Value.PSObject.Properties[$Matches[2]]) { return [string]$pc.Value.($Matches[2]) + ($Matches[3] -replace '\\', '/') }
    }
    return $p
}

function Get-NetComputers {
    $net = Get-FakeNet
    if ($net) { return , @($net.PSObject.Properties.Name) }
    $names = @{}
    try {
        $found = Invoke-Limited {
            $sh = New-Object -ComObject Shell.Application
            $ns = $sh.NameSpace(0x12)
            if ($ns) { foreach ($it in $ns.Items()) { [string]$it.Path } }
        } $null 12000
        foreach ($p in $found) { if ($p -match '^\\\\([^\\]+)$') { $names[$Matches[1].ToUpper()] = $Matches[1] } }
    } catch { }
    # servers behind mapped drives and the current data file
    try {
        foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=4' -ErrorAction Stop)) {
            if ([string]$d.ProviderName -match '^\\\\([^\\]+)') { $names[$Matches[1].ToUpper()] = $Matches[1] }
        }
    } catch { }
    if ((Get-DbPath) -match '^\\\\([^\\]+)') { $names[$Matches[1].ToUpper()] = $Matches[1] }
    return , @($names.Values | Sort-Object)
}

$NetShareCode = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class LawhaNetShares {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHARE_INFO_1 { public string netname; public uint type; public string remark; }
    [DllImport("Netapi32.dll", CharSet = CharSet.Unicode)]
    static extern int NetShareEnum(string server, int level, out IntPtr buf, int prefmaxlen, out int entriesread, out int totalentries, ref int resume);
    [DllImport("Netapi32.dll")]
    static extern int NetApiBufferFree(IntPtr buf);
    public static string[] List(string server) {
        IntPtr buf;
        int read, total, resume = 0;
        int rc = NetShareEnum(server, 1, out buf, -1, out read, out total, ref resume);
        if (rc != 0) throw new Exception("code " + rc);
        List<string> list = new List<string>();
        try {
            int size = Marshal.SizeOf(typeof(SHARE_INFO_1));
            for (int i = 0; i < read; i++) {
                SHARE_INFO_1 s = (SHARE_INFO_1)Marshal.PtrToStructure(new IntPtr(buf.ToInt64() + i * size), typeof(SHARE_INFO_1));
                // folders only (not printers), no hidden admin shares like C$
                if ((s.type & 0xFF) == 0 && !s.netname.EndsWith("$")) list.Add(s.netname);
            }
        } finally { NetApiBufferFree(buf); }
        return list.ToArray();
    }
}
'@

function Get-NetShares([string]$pc) {
    $net = Get-FakeNet
    if ($net) {
        $p = $net.PSObject.Properties[$pc]
        Need ($null -ne $p) "ما لكيت الحاسبة $pc"
        return , @($p.Value.PSObject.Properties.Name)
    }
    if (-not ('LawhaNetShares' -as [type])) { Add-Type -TypeDefinition $NetShareCode }
    try {
        return , @(Invoke-Limited { param($s) [LawhaNetShares]::List($s) } "\\$pc" 15000)
    } catch {
        $m = [string]$_
        if ($m -eq 'timeout' -or $m -match 'code (53|51|1231|1232|2114)\b') { throw "ما وصلت للحاسبة $pc. تأكد إنها شغّالة وعلى نفس الشبكة، أو جرّب رقم الـ IP مالها." }
        if ($m -match 'code (5|1326|1327|1331)\b') { throw "الحاسبة $pc تحتاج اسم مستخدم وكلمة سر. افتحها مرة من File Explorer (اكتب \\$pc بشريط العنوان) واحفظ كلمة السر، وبعدين ارجع هنا." }
        throw "ما كدرت أقرا الفولدرات المشاركة على $pc ($m)"
    }
}

function Get-FolderListing([string]$dir) {
    $dir = $dir.Trim()
    if ($dir -eq 'net:') {
        return @{ dir = 'net:'; title = 'الشبكة'; parent = ''; computers = (Get-NetComputers) }
    }
    if ($dir -match '^\\\\([^\\]+)\\?$') {
        $pc = $Matches[1]
        return @{ dir = "\\$pc"; title = $pc; parent = 'net:'; shares = (Get-NetShares $pc) }
    }
    $real = ConvertFrom-NetPath $dir
    if ($real -ne $dir) { return (Get-RealFolderListing $real $dir) }
    return (Get-RealFolderListing $dir $null)
}

# $shown: the network path to show for a test folder (see ConvertFrom-NetPath)
function Get-RealFolderListing([string]$dir, [string]$shown) {
    Need (Test-Path -LiteralPath $dir -PathType Container) "الفولدر مو موجود: $(if ($shown) { $shown } else { $dir })"
    $folders = New-Object System.Collections.Generic.List[string]
    $files = New-Object System.Collections.Generic.List[object]
    $full = if ($shown) { $shown.TrimEnd('\') } else { (Resolve-Path -LiteralPath $dir).ProviderPath }
    foreach ($i in (Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue)) {
        $hidden = ($i.Attributes -band [IO.FileAttributes]::Hidden) -or ($i.Attributes -band [IO.FileAttributes]::System)
        if ($hidden) { continue }
        if ($i.PSIsContainer) { $folders.Add($i.Name) }
        elseif ($i.Extension -in '.accdb', '.mdb') {
            $fp = if ($shown) { $full + '\' + $i.Name } else { $i.FullName }
            $files.Add(@{ name = $i.Name; path = $fp; size = $i.Length; modified = $i.LastWriteTime.ToString('yyyy-MM-dd HH:mm') })
        }
    }
    # up from a share's top folder: the computer's shares
    $parent = if ($full -match '^(\\\\[^\\]+)\\[^\\]+\\?$') { $Matches[1] }
    elseif ($full -match '^\\\\') { $full.Substring(0, $full.TrimEnd('\').LastIndexOf('\')) }
    else { Split-Path $full -Parent }
    return @{
        dir = $full; parent = $(if ($parent) { $parent } else { '' })
        folders = @($folders | Sort-Object); files = @($files | Sort-Object { $_.name })
    }
}

# Likely حساباتي files: next to the program, in the user's folders and near
# the top of each local drive. Bounded in depth and time.
function Find-Candidates {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $roots = New-Object System.Collections.Generic.List[object]
    $roots.Add(@{ p = $Here; d = 0 })
    $roots.Add(@{ p = (Split-Path $Here -Parent); d = 1 })
    foreach ($sf in 'Desktop', 'MyDocuments') { $roots.Add(@{ p = [Environment]::GetFolderPath($sf); d = 3 }) }
    if ($env:USERPROFILE) { $roots.Add(@{ p = (Join-Path $env:USERPROFILE 'Downloads'); d = 3 }) }
    foreach ($d in [IO.DriveInfo]::GetDrives()) {
        try { if ($d.IsReady -and [string]$d.DriveType -eq 'Fixed') { $roots.Add(@{ p = $d.RootDirectory.FullName; d = 2 }) } } catch { }
    }
    $seen = @{}
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($r in $roots) {
        if ($clock.Elapsed.TotalSeconds -gt 8) { break }
        if (-not $r.p -or -not (Test-Path -LiteralPath $r.p)) { continue }
        $items = Get-ChildItem -LiteralPath $r.p -Filter '*.accdb' -File -Recurse -Depth $r.d -ErrorAction SilentlyContinue
        foreach ($f in $items) {
            if ($f.FullName -match '\\(backups-lawha|Windows|Program Files[^\\]*|ProgramData|AppData|\$Recycle\.Bin)\\') { continue }
            if ($seen.ContainsKey($f.FullName)) { continue }
            $seen[$f.FullName] = $true
            $found.Add(@{ name = $f.Name; path = $f.FullName; size = $f.Length; modified = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm'); t = $f.LastWriteTime })
        }
    }
    $sorted = $found | Sort-Object @{ Expression = { $_.name -notlike 'Units*' } }, @{ Expression = { $_.t }; Descending = $true } | Select-Object -First 25
    return , @($sorted | ForEach-Object { @{ name = $_.name; path = $_.path; size = $_.size; modified = $_.modified } })
}

function Set-Database([string]$file) {
    Need (Test-DbFile $file) "هذا مو ملف Access (accdb): $file"
    # ProviderPath: a plain path also for \\PC\share (Path would add "FileSystem::")
    Close-Db
    $script:Config.dbPath = (Resolve-Path -LiteralPath $file).ProviderPath
    Save-Config
    Close-Engine
    $script:BackupDay = ''
    # every other sign-in on this computer was for the old file
    $script:Sessions.Clear()
    Write-LawhaLog "database set to $($script:Config.dbPath)"
}

$script:Stop = $false

# Refuse requests not addressed to this computer (DNS rebinding): localhost,
# and, when other devices may connect, this computer's name or an IP.
function Test-HostAllowed($req) {
    $h = [string]$req.Headers['Host']
    if ($h -eq "localhost:$Port" -or $h -eq "127.0.0.1:$Port") { return $true }
    if (-not $script:Config.allowRemote) { return $false }
    if ($h -notmatch "^(.+):$Port$") { return $false }
    $name = $Matches[1].Trim('[', ']')
    $ip = $null
    if ([Net.IPAddress]::TryParse($name, [ref]$ip)) { return $true }
    $mine = @($env:COMPUTERNAME, [Net.Dns]::GetHostName()) | Where-Object { $_ }
    return [bool]($mine | Where-Object { $name -ieq $_ -or $name -like "$_.*" })
}

# A request from another device (not this computer itself). LAWHA_FAKEREMOTE
# lets the tests pretend, with the test engine only.
function Test-RemoteRequest($req) {
    if ($env:LAWHA_FAKEDAO -and $env:LAWHA_FAKEREMOTE -and $req.Headers['X-Test-Remote'] -eq '1') { return $true }
    return -not $req.IsLocal
}

# What only someone sitting at this computer may do.
$LocalOnly = @('/api/choose-file', '/api/candidates', '/api/browse', '/api/shutdown', '/api/open-backups',
    '/api/remote', '/api/remote-access', '/api/fulltest', '/api/fulltest-file', '/api/selftest', '/api/speedtest')

function Handle($ctx) {
    $req = $ctx.Request
    if (-not (Test-HostAllowed $req)) {
        return Send-Json $ctx 403 @{ ok = $false; error = 'forbidden host' }
    }
    $path = $req.Url.AbsolutePath
    if ((Test-RemoteRequest $req) -and $LocalOnly -contains $path) {
        return Send-Json $ctx 200 @{ ok = $false; error = 'هاي تنسوى من الحاسبة الرئيسية نفسها، مو من جهاز ثاني.' }
    }
    if ($path -eq '/') {
        return Send $ctx 200 ([IO.File]::ReadAllBytes($AppFile)) 'text/html; charset=utf-8'
    }
    if ($path -eq '/api/ping') {
        $p = Get-DbPath
        return Send-Json $ctx 200 @{
            ok = $true; version = $Version; configured = ($p -ne '')
            file = $(if ($p) { [IO.Path]::GetFileName($p) } else { '' }); path = $(if (Test-RemoteRequest $req) { '' } else { $p }); local = (Test-DbLocal $p)
            remoteUrl = $(if (Test-RemoteRequest $req) { '' } else { $script:Config.remoteUrl }); allowRemote = [bool]$script:Config.allowRemote
            shopName = $script:Config.shopName; test = [bool]$env:LAWHA_FAKEDAO
        }
    }
    # Everything else must come from the app itself: a custom header forces a
    # CORS preflight, which this server never approves.
    if ($req.Headers['X-Lawha'] -ne '1') { return Send-Json $ctx 403 @{ ok = $false; error = 'forbidden' } }

    try {
        switch ($path) {
            '/api/users' {
                return Send-Json $ctx 200 @{ ok = $true; users = @(Get-UserNames) }
            }
            '/api/login' {
                $b = Read-Body $req
                $user = [string]$b.user
                Need ($user -ne '') 'اختار المستخدم'
                if (-not (Test-Login $user ([string]$b.password))) {
                    Write-LawhaLog "login FAILED $user"
                    return Send-Json $ctx 200 @{ ok = $false; error = 'كلمة السر غلط' }
                }
                $t = New-Token
                $permText = Get-PermText $user
                $script:Sessions[$t] = @{ user = $user; admin = (Test-Admin $user); perms = [string[]](Get-Perms $user) }
                Write-LawhaLog "login $user ($(if (Test-Admin $user) { 'manager' } else { $permText }))"
                return Send-Json $ctx 200 @{ ok = $true; token = $t; user = $user; admin = (Test-Admin $user); perms = $permText }
            }
            # Choosing the data file is this computer's connection setting:
            # anyone at it may set it, signed in or not (the shop asked for
            # this, e.g. a new laptop before any manager has signed in).
            { $_ -in '/api/choose-file', '/api/candidates', '/api/browse' } {
                $s = Get-Session $req
                $b = Read-Body $req
                if ($path -eq '/api/candidates') {
                    $files = Find-Candidates
                    return Send-Json $ctx 200 @{ ok = $true; files = $files; current = (Get-DbPath) }
                }
                if ($path -eq '/api/browse') {
                    if (-not $b.dir) { $places = Get-Places; return Send-Json $ctx 200 @{ ok = $true; places = $places } }
                    return Send-Json $ctx 200 (@{ ok = $true } + (Get-FolderListing ([string]$b.dir)))
                }
                $file = if ($b.path) { [string]$b.path } elseif ($env:LAWHA_FAKEDAO) { '' } else { Choose-File }
                if (-not $file) { return Send-Json $ctx 200 @{ ok = $false; error = 'ما اخترت ملف' } }
                Set-Database $file
                return Send-Json $ctx 200 @{ ok = $true; file = [IO.Path]::GetFileName($file); path = $script:Config.dbPath }
            }
            '/api/remote' {
                $b = Read-Body $req
                if (-not [string]$b.target) {
                    $script:Config.remoteUrl = ''
                    Save-Config
                    Write-LawhaLog 'unlinked from the main computer'
                    return Send-Json $ctx 200 @{ ok = $true; url = '' }
                }
                return Send-Json $ctx 200 (@{ ok = $true } + (Connect-Remote ([string]$b.target)))
            }
            '/api/shutdown' {
                $script:Stop = $true
                return Send-Json $ctx 200 @{ ok = $true }
            }
        }

        $s = Get-Session $req
        if (-not $s) { return Send-Json $ctx 401 @{ ok = $false; error = 'سجّل دخول'; login = $true } }

        switch ($path) {
            '/api/me' {
                return Send-Json $ctx 200 @{ ok = $true; user = $s.user; admin = $s.admin; perms = (Get-PermText $s.user) }
            }
            '/api/logout' {
                $script:Sessions.Remove([string]$req.Headers['X-Token'])
                return Send-Json $ctx 200 @{ ok = $true }
            }
            '/api/file' {
                $p = Get-DbPath
                Need ($p -ne '') 'ما محدد ملف البيانات'
                if ($env:LAWHA_FAKEDAO) {
                    # test engine: the data lives in memory, send its tables
                    $null = Use-Database -ReadOnly { param($db) 0 }
                    return Send-Json $ctx 200 @{ ok = $true; fake = $true; tables = (Get-FakeFileTables $script:Engine $p) }
                }
                $fs = [IO.File]::Open($p, 'Open', 'Read', 'ReadWrite')
                try {
                    $res = $ctx.Response
                    $res.StatusCode = 200
                    $res.ContentType = 'application/octet-stream'
                    $res.Headers['Cache-Control'] = 'no-store'
                    $res.Headers['X-File-Name'] = [Uri]::EscapeDataString([IO.Path]::GetFileName($p))
                    $res.ContentLength64 = $fs.Length
                    $fs.CopyTo($res.OutputStream)
                    $res.OutputStream.Close()
                } finally { $fs.Close() }
                return
            }
            '/api/write' {
                $msg = Read-Body $req
                $op = [string]$msg.op
                $data = $msg.data
                if ($null -eq $data) { $data = [pscustomobject]@{} }
                try {
                    $clock = [Diagnostics.Stopwatch]::StartNew()
                    Test-Allowed $op $data $s
                    $data | Add-Member -NotePropertyName user -NotePropertyValue $s.user -Force
                    $r = Invoke-Write $op $data $s
                    Write-LawhaLog "$($s.user)  $op OK $($r.id) ($($clock.ElapsedMilliseconds) ms, $($script:EngineName))"
                    return Send-Json $ctx 200 @{ ok = $true; result = $r }
                } catch {
                    Write-LawhaLog "$($s.user)  $op FAILED: $($_.Exception.Message)"
                    return Send-Json $ctx 200 @{ ok = $false; error = $_.Exception.Message }
                }
            }
            '/api/settings' {
                if ($req.HttpMethod -eq 'POST') {
                    Need $s.admin 'الإعدادات تحتاج صلاحية مدير'
                    $b = Read-Body $req
                    if ($null -ne $b.shopName) { $script:Config.shopName = (Text ([string]$b.shopName) 60 'اسم المحل') }
                    if ($null -ne $b.admins) {
                        $list = @($b.admins | ForEach-Object { [string]$_ } | Where-Object { $_ })
                        Need ($list.Count -eq 0 -or $list -contains $s.user) 'لازم تبقى أنت من المدراء'
                        $script:Config.admins = $list
                    }
                    if ($null -ne $b.perms) {
                        $perms = @{}
                        foreach ($p in $b.perms.PSObject.Properties) {
                            $t = ConvertTo-PermText $p.Value
                            $perms[$p.Name] = if ($null -eq $t) { '' } else { $t }
                        }
                        $script:Config.perms = $perms
                        Write-LawhaLog "$($s.user)  permissions: $(($perms.Keys | ForEach-Object { "$_=[$($perms[$_])]" }) -join ' ')"
                    }
                    Save-Config
                    Write-LawhaLog "$($s.user)  settings saved"
                }
                return Send-Json $ctx 200 @{
                    ok = $true; shopName = $script:Config.shopName; admins = @($script:Config.admins)
                    perms = $script:Config.perms; allPerms = ($AllPerms -join ','); defaultPerms = ($DefaultPerms -join ',')
                    dbPath = (Get-DbPath); dbLocal = (Test-DbLocal (Get-DbPath)); dataDir = $DataDir; version = $Version; engine = $script:EngineName
                }
            }
            '/api/selftest' {
                Need $s.admin 'فحص النظام يحتاج صلاحية مدير'
                $steps = Invoke-SelfTest
                $ok = -not ($steps | Where-Object { -not $_.ok })
                Write-LawhaLog "$($s.user)  selftest $(if ($ok) { 'PASSED' } else { 'FAILED' })"
                return Send-Json $ctx 200 @{ ok = $true; passed = $ok; steps = $steps; engine = $script:EngineName }
            }
            '/api/fulltest' {
                Need $s.admin 'الفحص الشامل يحتاج صلاحية مدير'
                $b = Read-Body $req
                $phase = [string]$b.phase
                $r = switch ($phase) {
                    'start' { Start-FullTest }
                    'run' { Invoke-FullTestRun }
                    'clean' { Invoke-FullTestClean }
                    'stop' { Stop-FullTest; @{} }
                    default { throw "مرحلة مو معروفة: $phase" }
                }
                Write-LawhaLog "$($s.user)  fulltest $phase$(if ($r.steps) { ' ' + (@($r.steps | Where-Object { -not $_.ok }).Count) + ' failed' })"
                return Send-Json $ctx 200 (@{ ok = $true } + $r)
            }
            '/api/fulltest-file' {
                Need $s.admin 'الفحص الشامل يحتاج صلاحية مدير'
                Need ($script:FT -and (Test-Path -LiteralPath $script:FT.path)) 'ابدأ الفحص الشامل من جديد'
                if ($env:LAWHA_FAKEDAO) {
                    # test engine: the copy lives in memory, send its tables
                    $tables = Get-FakeFileTables $script:Engine $script:FT.path
                    return Send-Json $ctx 200 @{ ok = $true; fake = $true; tables = $tables }
                }
                $fs = [IO.File]::Open($script:FT.path, 'Open', 'Read', 'ReadWrite')
                try {
                    $res = $ctx.Response
                    $res.StatusCode = 200
                    $res.ContentType = 'application/octet-stream'
                    $res.Headers['Cache-Control'] = 'no-store'
                    $res.ContentLength64 = $fs.Length
                    $fs.CopyTo($res.OutputStream)
                    $res.OutputStream.Close()
                } finally { $fs.Close() }
                return
            }
            '/api/data' {
                return Send-Compressed $ctx (Export-Data) 'application/json; charset=utf-8'
            }
            '/api/remote-access' {
                Need $s.admin 'تحتاج صلاحية مدير'
                $b = Read-Body $req
                if ($b.enable) {
                    if (-not $env:LAWHA_FAKEDAO) { Enable-RemoteAccess }
                    $script:Config.allowRemote = $true
                } else {
                    $script:Config.allowRemote = $false
                }
                Save-Config
                $script:RestartListener = $true
                Write-LawhaLog "$($s.user)  other devices $(if ($b.enable) { 'allowed' } else { 'not allowed' })"
                return Send-Json $ctx 200 @{ ok = $true; allowRemote = [bool]$script:Config.allowRemote; addresses = (Get-MyAddresses); port = $Port }
            }
            '/api/addresses' {
                Need $s.admin 'تحتاج صلاحية مدير'
                return Send-Json $ctx 200 @{ ok = $true; allowRemote = [bool]$script:Config.allowRemote; listening = $script:ListenMode; addresses = (Get-MyAddresses); port = $Port }
            }
            '/api/broken' {
                Need $s.admin 'تحتاج صلاحية مدير'
                $b = Read-Body $req
                $rows = if ($b.clean) { Get-BrokenRows -Clean } else { Get-BrokenRows }
                if ($b.clean) { Write-LawhaLog "$($s.user)  cleaned empty rows: $((@($rows) | ForEach-Object { "$($_.table)=$($_.count)" }) -join ' ')" }
                return Send-Json $ctx 200 @{ ok = $true; rows = @($rows); cleaned = [bool]$b.clean }
            }
            '/api/open-backups' {
                Need $s.admin 'تحتاج صلاحية مدير'
                $dir = Join-Path (Split-Path (Get-DbPath) -Parent) 'backups-lawha'
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
                if (-not $env:LAWHA_FAKEDAO) { Start-Process explorer.exe $dir }
                return Send-Json $ctx 200 @{ ok = $true; dir = $dir }
            }
            default {
                return Send-Json $ctx 404 @{ ok = $false; error = 'not found' }
            }
        }
    } catch {
        return Send-Json $ctx 200 @{ ok = $false; error = $_.Exception.Message }
    }
}

# Dot-sourcing (tests) loads the functions without starting the server.
if ($MyInvocation.InvocationName -eq '.') { return }

# Listens on this computer only, or on the network too when other devices
# may connect. Without Windows' approval for the network the start is
# refused (access denied); then this computer alone, and Settings says so.
function Start-Listener {
    $script:ListenMode = 'local'
    if ($script:Config.allowRemote) {
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add("http://+:$Port/")
        try {
            $l.Start()
            $script:ListenMode = 'network'
            return $l
        } catch {
            $code = $_.Exception.InnerException.ErrorCode
            if (-not $code) { $code = $_.Exception.ErrorCode }
            Write-LawhaLog "network listening refused ($code): $($_.Exception.Message)"
            try { $l.Close() } catch { }
            if ($code -ne 5) { throw }
            $script:ListenMode = 'network-refused'
        }
    }
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$Port/")
    $l.Start()
    return $l
}
$script:RestartListener = $false

try {
    $listener = Start-Listener
} catch {
    # Already running: just open the page.
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }
    exit
}

Write-LawhaLog "server $Version started on port $Port"
if (-not $Hidden) {
    Write-Host "  Lawhat Al-Mahal $Version  http://localhost:$Port/" -ForegroundColor Cyan
    Write-Host '  Keep this window open while you use the program. Press Ctrl+C to stop.'
}
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
    while ($listener.IsListening -and -not $script:Stop) {
        $async = $listener.BeginGetContext($null, $null)
        while (-not $async.AsyncWaitHandle.WaitOne(1000)) {
            # Let an idle Access instance go after two minutes.
            if ($script:AccessApp -and ((Get-Date) - $script:LastUse).TotalSeconds -gt 120) { Close-Engine }
            # don't hold the data file open while nobody is saving
            if ($script:Db -and ((Get-Date) - $script:DbLastUse).TotalSeconds -gt $DbIdleSeconds) { Close-Db }
            # today's backup, on the side
            Start-Backup
        }
        $ctx = $listener.EndGetContext($async)
        try {
            Handle $ctx
        } catch {
            try { Send-Json $ctx 500 @{ ok = $false; error = $_.Exception.Message } } catch { }
        }
        if ($script:RestartListener) {
            $script:RestartListener = $false
            try { $listener.Close() } catch { }
            $listener = Start-Listener
            Write-LawhaLog "listening: $($script:ListenMode)"
        }
    }
} finally {
    Write-LawhaLog 'server stopped'
    Close-Engine
    $listener.Close()
}
