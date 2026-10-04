# لوحة المحل — local helper for writing to the حساباتي file.
#
# Serves the app at http://localhost:8765/, hands the browser the .accdb bytes
# for reading, and performs writes (invoices, vouchers, customers, items)
# through Microsoft's own Access engine (DAO), inside a transaction. Field
# values follow what حساباتي itself stores, so entries show up there as usual.
#
# Only answers requests from this computer (localhost). Makes a backup copy of
# the file before the first write of each day.
#
# Set $env:LAWHA_MOCK = '1' to run without Access (writes are logged, not
# saved) — used for testing on machines without Office.

param(
    [int]$Port = 8765,
    [string]$DbPath = '',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
# start.bat runs this minimised, so show startup failures in a message box.
trap {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show("ما اشتغل لوحة المحل:`n`n$($_.Exception.Message)", 'لوحة المحل')
    } catch { Write-Host $_ }
    break
}
$Here = $PSScriptRoot
$AppFile = Join-Path $Here 'lawha.html'
if (-not (Test-Path $AppFile)) { $AppFile = Join-Path $Here '..\release\hisabati-reader.html' }
$ConfigFile = Join-Path $Here 'lawha-config.json'
$Mock = $env:LAWHA_MOCK -eq '1'

# DAO constants
$dbOpenDynaset = 2
$dbOpenSnapshot = 4
$dbAppendOnly = 8
$dbFailOnError = 128

# ---------------------------------------------------------------- file path

function Find-Database {
    if ($DbPath -and (Test-Path $DbPath)) { return (Resolve-Path $DbPath).Path }
    if (Test-Path $ConfigFile) {
        try {
            $p = (Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json).dbPath
            if ($p -and (Test-Path $p)) { return $p }
        } catch { }
    }
    foreach ($c in @((Join-Path $Here 'Units2026.accdb'), 'C:\Units2026\Units2026.accdb', 'D:\Units2026\Units2026.accdb')) {
        if (Test-Path $c) { return $c }
    }
    if ($Mock) { throw 'LAWHA_MOCK needs -DbPath' }
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.OpenFileDialog -Property @{
        Title  = 'اختار ملف حساباتي (Units2026.accdb)'
        Filter = 'Access (*.accdb;*.mdb)|*.accdb;*.mdb'
    }
    if ($dlg.ShowDialog() -ne 'OK') { throw 'No database file chosen' }
    return $dlg.FileName
}

$DbPath = Find-Database
@{ dbPath = $DbPath } | ConvertTo-Json | Set-Content $ConfigFile -Encoding UTF8

# ---------------------------------------------------------------- engine

$script:Engine = $null
$script:AccessApp = $null
$script:LastUse = Get-Date

function Get-Engine {
    $script:LastUse = Get-Date
    if ($script:Engine) { return $script:Engine }
    # In-process DAO is quickest; it only loads when its bitness matches this
    # PowerShell. Otherwise drive DAO through an invisible Access instance.
    try {
        $script:Engine = New-Object -ComObject DAO.DBEngine.120
        return $script:Engine
    } catch { }
    try {
        $script:AccessApp = New-Object -ComObject Access.Application
        $script:Engine = $script:AccessApp.DBEngine
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
    $script:Engine = $null
    [GC]::Collect()
}

# ---------------------------------------------------------------- backup

$script:BackupDay = ''
function Backup-Database {
    $today = Get-Date -Format 'yyyy-MM-dd'
    if ($script:BackupDay -eq $today) { return }
    $dir = Join-Path (Split-Path $DbPath -Parent) 'backups-lawha'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $name = [IO.Path]::GetFileNameWithoutExtension($DbPath)
    $target = Join-Path $dir ("$name-" + (Get-Date -Format 'yyyy-MM-dd_HH-mm') + '.accdb')
    $src = [IO.File]::Open($DbPath, 'Open', 'Read', 'ReadWrite')
    try {
        $dst = [IO.File]::Create($target)
        try { $src.CopyTo($dst) } finally { $dst.Close() }
    } finally { $src.Close() }
    # keep the 30 newest
    Get-ChildItem $dir -Filter "$name-*.accdb" | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Force
    $script:BackupDay = $today
}

# ---------------------------------------------------------------- helpers

function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }

# Numbers inside SQL text must not follow the Windows regional format.
function N([double]$n) { return $n.ToString([Globalization.CultureInfo]::InvariantCulture) }

function Nullable($v) {
    if ($null -eq $v -or ($v -is [string] -and $v.Trim() -eq '')) { return [DBNull]::Value }
    return $v
}

function Day([string]$iso) {
    if (-not $iso) { return (Get-Date).Date }
    return [datetime]::ParseExact($iso, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
}

function Text([string]$s, [int]$max, [string]$label) {
    $s = if ($null -eq $s) { '' } else { $s.Trim() }
    if ($s.Length -gt $max) { throw "$label طويل: الحد $max حرف" }
    return $s
}

function Need([bool]$cond, [string]$msg) { if (-not $cond) { throw $msg } }

function Set-Fields($rs, [hashtable]$values) {
    foreach ($k in $values.Keys) { $rs.Fields.Item($k).Value = (Nullable $values[$k]) }
}

function Add-Row($db, [string]$table, [hashtable]$values, [string]$idField) {
    $rs = $db.OpenRecordset($table, $dbOpenDynaset, $dbAppendOnly)
    try {
        $rs.AddNew()
        Set-Fields $rs $values
        $id = if ($idField) { $rs.Fields.Item($idField).Value } else { $null }
        $rs.Update()
        return $id
    } finally { $rs.Close() }
}

function Edit-Row($db, [string]$table, [string]$idField, $id, [hashtable]$values) {
    $rs = $db.OpenRecordset("SELECT * FROM [$table] WHERE [$idField]=$([int]$id)", $dbOpenDynaset)
    try {
        Need (-not $rs.EOF) 'السجل مو موجود (يمكن انمسح من حساباتي)'
        $rs.Edit()
        Set-Fields $rs $values
        $rs.Update()
    } finally { $rs.Close() }
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

function Get-MadaItem($db, [string]$name) {
    $rs = $db.OpenRecordset("SELECT IDcode, BpriceL1, BpriceL2, UnitL1, UnitL2, Fill FROM madaCode WHERE madaName=$(Q $name)", $dbOpenSnapshot)
    try {
        Need (-not $rs.EOF) "المادة مو موجودة: $name"
        $o = @{}
        foreach ($f in 'IDcode', 'BpriceL1', 'BpriceL2', 'UnitL1', 'UnitL2', 'Fill') {
            $v = $rs.Fields.Item($f).Value
            $o[$f] = if ($v -is [DBNull]) { $null } else { $v }
        }
        return $o
    } finally { $rs.Close() }
}

function Next-VoucherNo($db, [string]$table) {
    $rs = $db.OpenRecordset("SELECT mostandNO FROM [$table]", $dbOpenSnapshot)
    $max = 0
    try {
        while (-not $rs.EOF) {
            $n = 0
            if ([int]::TryParse([string]$rs.Fields.Item(0).Value, [ref]$n) -and $n -gt $max) { $max = $n }
            $rs.MoveNext()
        }
    } finally { $rs.Close() }
    return [string]($max + 1)
}

function Count($db, [string]$sql) { return [int](Get-Value $db $sql) }

# ---------------------------------------------------------------- operations
# Each takes ($db, $d) where $d is the JSON payload, and returns a hashtable.

function Save-Lines($db, [string]$kind, [int]$masterId, $lines) {
    Need ($lines.Count -gt 0) 'القائمة ما بيها مواد'
    foreach ($l in $lines) {
        $name = Text $l.item 150 'اسم المادة'
        $it = Get-MadaItem $db $name
        $unit = Text $l.unit 10 'الوحدة'
        Need ($unit -eq $it.UnitL1 -or $unit -eq $it.UnitL2) "وحدة غلط للمادة $name"
        $qty = [double]$l.qty
        Need ($qty -gt 0) "الكمية لازم أكثر من صفر ($name)"
        $price = [double]$l.price
        Need ($price -ge 0) "السعر غلط ($name)"
        $small = ($unit -eq $it.UnitL2 -and $it.UnitL1 -ne $it.UnitL2)
        if ($kind -eq 'sale') {
            Add-Row $db 'subOut' @{
                idOut = $masterId; madaNameOut = $name; QuntOut = $qty; Price = $price
                IDcode = $it.IDcode; unit = $unit
                BpriceL1 = $it.BpriceL1; BpriceL2 = $it.BpriceL2
                UnitFactor = $(if ($small) { 1 } else { 0 }); note = $l.note
            } $null | Out-Null
        } else {
            Add-Row $db 'subIN' @{
                IdIn = $masterId; madaNameIn = $name; QuntIn = $qty; Price = $price
                IDcode = $it.IDcode; unit = $unit
                UnitFactor = $(if ($small) { 1 } else { 0 }); note = $l.note
                expireDate = $(if ($l.expire) { Day $l.expire } else { $null })
            } $null | Out-Null
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
    } else {
        if (-not $customer) { $customer = 'قائمة نقدي' }
    }
    $values = @{
        TOname = $customer; OutDate = (Day $d.date); OutType = $type
        Paid = [int]([double]$d.paid); strUserName = (Text $d.user 45 'اسم المستخدم')
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
        $id = Add-Row $db 'MasterOut' $values 'idOut'
    }
    Save-Lines $db 'sale' $id $d.lines
    return @{ id = $id }
}

function Op-DeleteSale($db, $d) {
    $id = [int]$d.id
    $db.Execute("DELETE FROM subOut WHERE idOut=$id", $dbFailOnError)
    $db.Execute("DELETE FROM MasterOut WHERE idOut=$id", $dbFailOnError)
    return @{ id = $id }
}

function Update-BuyPrices($db, $lines) {
    foreach ($l in $lines) {
        $it = Get-MadaItem $db $l.item
        $price = [double]$l.price
        $fill = [double]$(if ($it.Fill) { $it.Fill } else { 0 })
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
    if ("$($d.no)".Trim()) { $n = 0; Need ([int]::TryParse("$($d.no)", [ref]$n)) 'رقم قائمة المورد لازم يكون رقم'; $no = $n }
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
        $id = Add-Row $db 'MasterIn' $values 'IdIn'
    }
    Save-Lines $db 'purchase' $id $d.lines
    if ($d.updatePrices) { Update-BuyPrices $db $d.lines }
    return @{ id = $id }
}

function Op-DeletePurchase($db, $d) {
    $id = [int]$d.id
    $db.Execute("DELETE FROM subIN WHERE IdIn=$id", $dbFailOnError)
    $db.Execute("DELETE FROM MasterIn WHERE IdIn=$id", $dbFailOnError)
    return @{ id = $id }
}

function Save-Voucher($db, $d, [string]$table, [string]$nameField) {
    $amount = [double]$d.amount
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
        $id = Add-Row $db $table $values 'idS'
    }
    return @{ id = $id }
}

function Op-SaveReceipt($db, $d) {
    if ($d.cls -eq 'تسديد') {
        Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $d.name)") -gt 0) "الزبون مو موجود: $($d.name)"
    }
    return Save-Voucher $db $d 'mablakIn' 'nameFrom'
}
function Op-SavePayment($db, $d) {
    if ($d.cls -eq 'تسديد') {
        Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $d.name)") -gt 0) "المورد مو موجود: $($d.name)"
    }
    return Save-Voucher $db $d 'mablakOut' 'nameto'
}
function Op-DeleteReceipt($db, $d) { $db.Execute("DELETE FROM mablakIn WHERE idS=$([int]$d.id)", $dbFailOnError); return @{ id = $d.id } }
function Op-DeletePayment($db, $d) { $db.Execute("DELETE FROM mablakOut WHERE idS=$([int]$d.id)", $dbFailOnError); return @{ id = $d.id } }

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
        bayeeCode = $name; MB = [int]([double]$d.opening); CMobile = (Text $d.mobile 12 'الموبايل')
        Cadress = (Text $d.address 255 'العنوان'); Ctype = (Text $d.type 30 'النوع')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT bayeeCode FROM bayeeCode WHERE id=$id")
        Edit-Row $db 'bayeeCode' 'id' $id $values
        Rename-Links $db 'customer' $old $name
    } else {
        $now = Get-Date
        $values += @{ credit = 0; RegDate = $now.Date; Cdate = $now.Date; Ctime = $now; Mandob = 'مباشر'; Group = 'المجموعة العامة' }
        $id = Add-Row $db 'bayeeCode' $values 'id'
    }
    return @{ id = $id }
}

function Op-SaveSupplier($db, $d) {
    $name = Text $d.name 35 'اسم المورد'
    Need ($name -ne '') 'لازم تكتب اسم المورد'
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $name) AND ID<>$id") -eq 0) "أكو مورد بنفس الاسم: $name"
    $values = @{
        shiraCode = $name; MB = [double]$d.opening; CMobile = (Text $d.mobile 12 'الموبايل')
        Cadress = (Text $d.address 255 'العنوان')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT shiraCode FROM shiraCode WHERE ID=$id")
        Edit-Row $db 'shiraCode' 'ID' $id $values
        Rename-Links $db 'supplier' $old $name
    } else {
        $now = Get-Date
        $values += @{ RegDate = $now.Date; Cdate = $now.Date; Ctime = $now }
        $id = Add-Row $db 'shiraCode' $values 'ID'
    }
    return @{ id = $id }
}

function Op-SaveItem($db, $d) {
    $name = Text $d.name 150 'اسم المادة'
    Need ($name -ne '') 'لازم تكتب اسم المادة'
    $code = Text $d.code 255 'الرمز'
    $u1 = Text $d.unitL1 10 'الوحدة الكبيرة'
    $u2 = Text $d.unitL2 10 'الوحدة الصغيرة'
    Need ($u1 -ne '') 'لازم تكتب الوحدة الكبيرة'
    if (-not $u2) { $u2 = $u1 }
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM madaCode WHERE madaName=$(Q $name) AND ID<>$id") -eq 0) "أكو مادة بنفس الاسم: $name"
    if ($code) { Need ((Count $db "SELECT Count(*) FROM madaCode WHERE IDcode=$(Q $code) AND ID<>$id") -eq 0) "أكو مادة بنفس الرمز: $code" }
    $price = [int]([double]$d.priceL1)
    $values = @{
        madaName = $name; IDcode = $code; MadaClass = (Text $d.cls 255 'الصنف')
        price = $price; 'price$' = $price; priceSeeat = [int]([double]$d.priceL2)
        Fill = [int]([double]$d.fill); BpriceL1 = [double]$d.buyL1; BpriceL2 = [double]$d.buyL2
        UnitL1 = $u1; UnitL2 = $u2; harig = [int]([double]$d.harig)
        Pr = [double]$d.openL1; Pru = [double]$d.openL2
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT madaName FROM madaCode WHERE ID=$id")
        Edit-Row $db 'madaCode' 'ID' $id $values
        Rename-Links $db 'item' $old $name
    } else {
        $id = Add-Row $db 'madaCode' $values 'ID'
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
function Op-DeleteCustomer($db, $d) { Delete-Named $db 'customer' 'bayeeCode' 'id' 'bayeeCode' $d }
function Op-DeleteSupplier($db, $d) { Delete-Named $db 'supplier' 'shiraCode' 'ID' 'shiraCode' $d }
function Op-DeleteItem($db, $d) { Delete-Named $db 'item' 'madaCode' 'ID' 'madaName' $d }

$Ops = @{
    saveSale = 'Op-SaveSale'; deleteSale = 'Op-DeleteSale'
    savePurchase = 'Op-SavePurchase'; deletePurchase = 'Op-DeletePurchase'
    saveReceipt = 'Op-SaveReceipt'; deleteReceipt = 'Op-DeleteReceipt'
    savePayment = 'Op-SavePayment'; deletePayment = 'Op-DeletePayment'
    saveCustomer = 'Op-SaveCustomer'; deleteCustomer = 'Op-DeleteCustomer'
    saveSupplier = 'Op-SaveSupplier'; deleteSupplier = 'Op-DeleteSupplier'
    saveItem = 'Op-SaveItem'; deleteItem = 'Op-DeleteItem'
}

function Invoke-Write([string]$op, $data) {
    Need ($Ops.ContainsKey($op)) "عملية مو معروفة: $op"
    if ($Mock) {
        Add-Content (Join-Path $Here 'mock-writes.log') -Encoding UTF8 -Value (@{ op = $op; data = $data } | ConvertTo-Json -Depth 6 -Compress)
        return @{ id = 999999; mock = $true }
    }
    Backup-Database
    $engine = Get-Engine
    $ws = $engine.Workspaces.Item(0)
    try {
        $db = $ws.OpenDatabase($DbPath, $false, $false)
    } catch {
        throw "ما كدرت أفتح الملف للكتابة. إذا حساباتي فاتحه بشكل حصري سدّه وجرّب مرة ثانية. ($($_.Exception.Message))"
    }
    try {
        $ws.BeginTrans()
        try {
            $result = & $Ops[$op] $db $data
            $ws.CommitTrans()
            return $result
        } catch {
            try { $ws.Rollback() } catch { }
            throw
        }
    } finally {
        try { $db.Close() } catch { }
    }
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

function Handle($ctx) {
    $req = $ctx.Request
    # Refuse anything not addressed to this machine (DNS rebinding).
    $hostHeader = [string]$req.Headers['Host']
    if ($hostHeader -ne "localhost:$Port" -and $hostHeader -ne "127.0.0.1:$Port") {
        return Send-Json $ctx 403 @{ ok = $false; error = 'forbidden host' }
    }
    $path = $req.Url.AbsolutePath
    switch ($path) {
        '/' {
            return Send $ctx 200 ([IO.File]::ReadAllBytes($AppFile)) 'text/html; charset=utf-8'
        }
        '/api/ping' {
            return Send-Json $ctx 200 @{ ok = $true; file = [IO.Path]::GetFileName($DbPath); writable = $true; mock = $Mock }
        }
        '/api/file' {
            $fs = [IO.File]::Open($DbPath, 'Open', 'Read', 'ReadWrite')
            try {
                $res = $ctx.Response
                $res.StatusCode = 200
                $res.ContentType = 'application/octet-stream'
                $res.Headers['Cache-Control'] = 'no-store'
                $res.Headers['X-File-Name'] = [Uri]::EscapeDataString([IO.Path]::GetFileName($DbPath))
                $res.ContentLength64 = $fs.Length
                $fs.CopyTo($res.OutputStream)
                $res.OutputStream.Close()
            } finally { $fs.Close() }
            return
        }
        '/api/write' {
            # A custom header forces a CORS preflight, which this server never
            # approves, so other web pages cannot post here.
            if ($req.HttpMethod -ne 'POST' -or $req.Headers['X-Lawha'] -ne '1') {
                return Send-Json $ctx 403 @{ ok = $false; error = 'forbidden' }
            }
            $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
            $msg = $body | ConvertFrom-Json
            try {
                $r = Invoke-Write ([string]$msg.op) $msg.data
                Write-Host ("{0:HH:mm:ss}  {1} OK {2}" -f (Get-Date), $msg.op, $r.id) -ForegroundColor Green
                return Send-Json $ctx 200 @{ ok = $true; result = $r }
            } catch {
                Write-Host ("{0:HH:mm:ss}  {1} FAILED: {2}" -f (Get-Date), $msg.op, $_.Exception.Message) -ForegroundColor Red
                return Send-Json $ctx 200 @{ ok = $false; error = $_.Exception.Message }
            }
        }
        default {
            return Send-Json $ctx 404 @{ ok = $false; error = 'not found' }
        }
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    # Already running: just open the page.
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }
    exit
}

Write-Host ''
Write-Host "  Lawhat Al-Mahal is running:  http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "  Database: $DbPath"
Write-Host '  Keep this window open while you use the program. Press Ctrl+C to stop.'
Write-Host ''
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
    while ($listener.IsListening) {
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
    Close-Engine
    $listener.Close()
}
