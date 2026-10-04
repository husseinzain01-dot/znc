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
$Version = '1.1.1'
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

function Read-Config {
    $c = @{ dbPath = ''; shopName = ''; admins = @(); perms = @{} }
    if (Test-Path $ConfigFile) {
        try {
            $j = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($j.dbPath) { $c.dbPath = [string]$j.dbPath }
            if ($j.shopName) { $c.shopName = [string]$j.shopName }
            if ($j.admins) { $c.admins = @($j.admins | ForEach-Object { [string]$_ }) }
            if ($j.perms) {
                foreach ($p in $j.perms.PSObject.Properties) { $c.perms[$p.Name] = @($p.Value | ForEach-Object { [string]$_ }) }
            }
        } catch { }
    }
    return $c
}

function Save-Config {
    $script:Config | ConvertTo-Json -Depth 4 | Set-Content $ConfigFile -Encoding UTF8
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

function Get-DbPath {
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
function Use-Database([scriptblock]$body, [switch]$Rollback, [switch]$ReadOnly) {
    $path = Get-DbPath
    Need ($path -ne '') 'ما محدد ملف البيانات. اختاره من الإعدادات.'
    $engine = Get-Engine
    $ws = $engine.Workspaces.Item(0)
    try {
        $db = $ws.OpenDatabase($path, $false, [bool]$ReadOnly)
    } catch {
        throw "ما كدرت أفتح ملف البيانات. إذا حساباتي فاتحه بشكل حصري سدّه وجرّب مرة ثانية. ($($_.Exception.Message))"
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
    } finally {
        try { $db.Close() } catch { }
    }
}

# ---------------------------------------------------------------- backup

$script:BackupDay = ''
function Backup-Database {
    $today = Get-Date -Format 'yyyy-MM-dd'
    if ($script:BackupDay -eq $today) { return }
    $path = Get-DbPath
    Need ($path -ne '') 'ما محدد ملف البيانات'
    $dir = Join-Path (Split-Path $path -Parent) 'backups-lawha'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $name = [IO.Path]::GetFileNameWithoutExtension($path)
    $target = Join-Path $dir ("$name-" + (Get-Date -Format 'yyyy-MM-dd_HH-mm') + '.accdb')
    $src = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
        $dst = [IO.File]::Create($target)
        try { $src.CopyTo($dst) } finally { $dst.Close() }
    } finally { $src.Close() }
    Get-ChildItem $dir -Filter "$name-*.accdb" | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Force
    $script:BackupDay = $today
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

function Get-MadaItem($db, [string]$name) {
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
$AllPerms = @(
    'pos', 'home', 'sales', 'purchases', 'customers', 'suppliers', 'stock', 'cash', 'profit', 'checks',
    'sale_cash', 'sale_credit', 'sale_wholesale', 'edit_price', 'print', 'sale_edit', 'sale_delete',
    'purchase', 'purchase_edit', 'receipt', 'payment', 'voucher_edit',
    'customer_add', 'customer_edit', 'supplier_manage', 'item_manage'
)
$DefaultPerms = @('pos', 'sale_cash', 'print')

function Get-Perms([string]$user) {
    if (Test-Admin $user) { return , $AllPerms }
    if ($script:Config.perms.ContainsKey($user)) { return , @($script:Config.perms[$user]) }
    return , $DefaultPerms
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
    return Use-Database { param($db)
        if ($session -and $op -eq 'saveSale') { Test-SaleLines $db $data $session }
        & $fn $db $data
    }
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
        $s.perms = Get-Perms $s.user
        return $s
    }
    return $null
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
    if ($Clean) { Backup-Database }
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
    Send $ctx $status ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
}

function Read-Body($req) {
    $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
    if (-not $body) { return [pscustomobject]@{} }
    return $body | ConvertFrom-Json
}

# Windows' own file dialog. A hidden background process cannot bring it to the
# front, so the app offers its own browser first and this only as a fallback.
function Choose-File {
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form -Property @{
        TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = 'CenterScreen'; Size = (New-Object System.Drawing.Size 1, 1)
    }
    $owner.Show()
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
function Get-FolderListing([string]$dir) {
    Need (Test-Path -LiteralPath $dir -PathType Container) "الفولدر مو موجود: $dir"
    $folders = New-Object System.Collections.Generic.List[string]
    $files = New-Object System.Collections.Generic.List[object]
    foreach ($i in (Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue)) {
        $hidden = ($i.Attributes -band [IO.FileAttributes]::Hidden) -or ($i.Attributes -band [IO.FileAttributes]::System)
        if ($hidden) { continue }
        if ($i.PSIsContainer) { $folders.Add($i.Name) }
        elseif ($i.Extension -in '.accdb', '.mdb') {
            $files.Add(@{ name = $i.Name; path = $i.FullName; size = $i.Length; modified = $i.LastWriteTime.ToString('yyyy-MM-dd HH:mm') })
        }
    }
    $parent = Split-Path $dir -Parent
    return @{
        dir = (Resolve-Path -LiteralPath $dir).Path; parent = $(if ($parent) { $parent } else { '' })
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
    $script:Config.dbPath = (Resolve-Path -LiteralPath $file).Path
    Save-Config
    Close-Engine
    $script:BackupDay = ''
    Write-LawhaLog "database set to $($script:Config.dbPath)"
}

$script:Stop = $false

function Handle($ctx) {
    $req = $ctx.Request
    # Refuse anything not addressed to this machine (DNS rebinding).
    $hostHeader = [string]$req.Headers['Host']
    if ($hostHeader -ne "localhost:$Port" -and $hostHeader -ne "127.0.0.1:$Port") {
        return Send-Json $ctx 403 @{ ok = $false; error = 'forbidden host' }
    }
    $path = $req.Url.AbsolutePath
    if ($path -eq '/') {
        return Send $ctx 200 ([IO.File]::ReadAllBytes($AppFile)) 'text/html; charset=utf-8'
    }
    if ($path -eq '/api/ping') {
        $p = Get-DbPath
        return Send-Json $ctx 200 @{
            ok = $true; version = $Version; configured = ($p -ne '')
            file = $(if ($p) { [IO.Path]::GetFileName($p) } else { '' })
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
                $script:Sessions[$t] = @{ user = $user; admin = (Test-Admin $user); perms = (Get-Perms $user) }
                Write-LawhaLog "login $user"
                return Send-Json $ctx 200 @{ ok = $true; token = $t; user = $user; admin = (Test-Admin $user); perms = (Get-Perms $user) }
            }
            # Choosing the data file: open to anyone before it is set, then managers only.
            { $_ -in '/api/choose-file', '/api/candidates', '/api/browse' } {
                $s = Get-Session $req
                Need ((Get-DbPath) -eq '' -or ($s -and $s.admin)) 'تغيير ملف البيانات يحتاج صلاحية مدير'
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
            '/api/shutdown' {
                $script:Stop = $true
                return Send-Json $ctx 200 @{ ok = $true }
            }
        }

        $s = Get-Session $req
        if (-not $s) { return Send-Json $ctx 401 @{ ok = $false; error = 'سجّل دخول'; login = $true } }

        switch ($path) {
            '/api/me' {
                return Send-Json $ctx 200 @{ ok = $true; user = $s.user; admin = $s.admin; perms = $s.perms }
            }
            '/api/logout' {
                $script:Sessions.Remove([string]$req.Headers['X-Token'])
                return Send-Json $ctx 200 @{ ok = $true }
            }
            '/api/file' {
                $p = Get-DbPath
                Need ($p -ne '') 'ما محدد ملف البيانات'
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
                    Test-Allowed $op $data $s
                    $data | Add-Member -NotePropertyName user -NotePropertyValue $s.user -Force
                    $r = Invoke-Write $op $data $s
                    Write-LawhaLog "$($s.user)  $op OK $($r.id)"
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
                            $perms[$p.Name] = @($p.Value | ForEach-Object { [string]$_ } | Where-Object { $AllPerms -contains $_ })
                        }
                        $script:Config.perms = $perms
                    }
                    Save-Config
                    Write-LawhaLog "$($s.user)  settings saved"
                }
                return Send-Json $ctx 200 @{
                    ok = $true; shopName = $script:Config.shopName; admins = @($script:Config.admins)
                    perms = $script:Config.perms; allPerms = $AllPerms; defaultPerms = $DefaultPerms
                    dbPath = (Get-DbPath); dataDir = $DataDir; version = $Version; engine = $script:EngineName
                }
            }
            '/api/selftest' {
                Need $s.admin 'فحص النظام يحتاج صلاحية مدير'
                $steps = Invoke-SelfTest
                $ok = -not ($steps | Where-Object { -not $_.ok })
                Write-LawhaLog "$($s.user)  selftest $(if ($ok) { 'PASSED' } else { 'FAILED' })"
                return Send-Json $ctx 200 @{ ok = $true; passed = $ok; steps = $steps; engine = $script:EngineName }
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

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
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
        }
        $ctx = $listener.EndGetContext($async)
        try {
            Handle $ctx
        } catch {
            try { Send-Json $ctx 500 @{ ok = $false; error = $_.Exception.Message } } catch { }
        }
    }
} finally {
    Write-LawhaLog 'server stopped'
    Close-Engine
    $listener.Close()
}
