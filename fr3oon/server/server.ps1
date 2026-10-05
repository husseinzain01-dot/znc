# Fr3oon — local helper.
#
# Serves the app at http://localhost:8770/, keeps the shop's own Access
# database (created by the program at setup), signs users in against its
# Users table (salted PBKDF2 hashes), and performs every read and write
# through Microsoft's Access engine (DAO), one transaction per save.
#
# Machine settings (database and backup folders, link to a main computer)
# live in %APPDATA%\Fr3oon\config.json; the shop's own settings (name, users,
# permissions) live in the database itself. The program works only once
# activated with a key made for this computer by the vendor.
#
# Testing without Access: set $env:LAWHA_FAKEDAO to a JSON export of the
# tables (test/export-tables.mjs); writes then go to an in-memory copy.

param(
    [int]$Port = 8770,
    [string]$DataDir = '',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Version = '2.0.1'
$Product = 'Fr3oon'
$Here = $PSScriptRoot
# The launcher runs this without a window; then there is no console to print to.
$Hidden = $env:LAWHA_HIDDEN -eq '1'

# Startup failures in a hidden window would go unseen; show them.
trap {
    try {
        $logDir = if ($env:APPDATA) { Join-Path $env:APPDATA 'Fr3oon\logs' } else { Join-Path $PSScriptRoot '.data' }
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        Add-Content -LiteralPath (Join-Path $logDir 'startup-errors.log') -Encoding UTF8 -Value ((Get-Date -Format 's') + '  ' + $_.Exception.Message + '  ' + $_.InvocationInfo.PositionMessage)
    } catch { }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show("تعذّر تشغيل Fr3oon:`n`n$($_.Exception.Message)", 'Fr3oon')
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
    $DataDir = if ($env:APPDATA) { Join-Path $env:APPDATA 'Fr3oon' } else { Join-Path $Here '.data' }
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$ConfigFile = Join-Path $DataDir 'config.json'
$LogDir = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$AppFile = Join-Path $Here 'fr3oon.html'
if (-not (Test-Path $AppFile)) { $AppFile = Join-Path (Join-Path (Split-Path $Here -Parent) 'release') 'fr3oon.html' }

# Where a new shop's database and backups go unless chosen otherwise: on
# drive C, easy to find and to copy.
$DefaultDbDir = 'C:\Fr3oon\Data'
$DefaultBackupDir = 'C:\Fr3oon\Backups'
if ($env:LAWHA_FAKEDAO -or -not (Test-Path 'C:\')) {
    $DefaultDbDir = Join-Path $DataDir 'db'
    $DefaultBackupDir = Join-Path $DataDir 'backups'
}
# Signed list of the latest version (see Get-UpdateInfo).
$DefaultUpdateUrl = 'https://raw.githubusercontent.com/husseinzain01-dot/fr3oon-updates/main/latest.json'

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

# This computer's settings. The shop's own (name, users, permissions) are
# kept in the database, so every device sees the same.
function Read-Config {
    $c = @{ dbPath = ''; backupDir = ''; keepBackups = 30; allowRemote = $false; remoteUrl = ''; updateUrl = '' }
    if (Test-Path $ConfigFile) {
        try {
            $j = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($j.dbPath) { $c.dbPath = [string]$j.dbPath }
            if ($j.backupDir) { $c.backupDir = [string]$j.backupDir }
            if ($j.keepBackups) { $c.keepBackups = [int]$j.keepBackups }
            if ($j.allowRemote) { $c.allowRemote = $true }
            if ($j.remoteUrl) { $c.remoteUrl = [string]$j.remoteUrl }
            if ($j.updateUrl) { $c.updateUrl = [string]$j.updateUrl }
        } catch { }
    }
    return $c
}

function Save-Config {
    $json = $script:Config | ConvertTo-Json -Depth 4
    $json = [regex]::Replace($json, '\{\s*"value":\s*(\[[^\[\]{}]*\]),\s*"Count":\s*\d+\s*\}', '$1')
    $json | Set-Content $ConfigFile -Encoding UTF8
}

$script:Config = Read-Config

function Test-DbFile([string]$p) {
    return ($p -and (Test-Path -LiteralPath $p -PathType Leaf) -and ([IO.Path]::GetExtension($p) -in '.accdb', '.mdb'))
}


function Get-DbPath {
    # the full test works on a copy while it runs
    if ($script:DbOverride) { return $script:DbOverride }
    $p = $script:Config.dbPath
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    return ''
}

function Write-LawhaLog([string]$line) {
    $file = Join-Path $LogDir ('fr3oon-' + (Get-Date -Format 'yyyy-MM') + '.log')
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
        throw 'لم يُعثر على Microsoft Access على هذا الجهاز. يتطلّب الحفظ تثبيت Access أو Access Runtime.'
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
        throw "تعذّر فتح قاعدة البيانات. إذا كان برنامج آخر يفتحها فتحاً حصرياً فأغلقه وأعد المحاولة. ($($_.Exception.Message))"
    }
    $script:DbOpenPath = $path
    return $script:Db
}

function Use-Database([scriptblock]$body, [switch]$Rollback, [switch]$ReadOnly) {
    $path = Get-DbPath
    Need ($path -ne '') 'لم تُحدَّد قاعدة البيانات. اخترها من الإعدادات.'
    $engine = Get-Engine
    $ws = $engine.Workspaces.Item(0)
    $script:DbLastUse = Get-Date
    try {
        $db = Open-Db $path
    } catch {
        # a file that can only be read (read-only share) still opens for reading
        if (-not $ReadOnly) { throw }
        try { $db = $ws.OpenDatabase($path, $false, $true) } catch { throw "تعذّر فتح قاعدة البيانات. ($($_.Exception.Message))" }
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

# ---------------------------------------------------------------- the database
# Fr3oon's own database, created by the program at setup. Defined once
# here: CREATE TABLE for Access (DAO), and the same columns for the test
# engine. Prices are CURRENCY (exact), quantities DOUBLE.
$SchemaVersion = 1
$Schema = [ordered]@{
    madaCode    = 'ID COUNTER', 'IDcode TEXT(15)', 'MadaClass TEXT(100)', 'madaName TEXT(150)', 'harig LONG', 'price CURRENCY',
                  'priceSeeat CURRENCY', 'Fill LONG', 'BpriceL1 CURRENCY', 'BpriceL2 CURRENCY', 'UnitL1 TEXT(10)', 'UnitL2 TEXT(10)',
                  'Pr DOUBLE', 'Pru DOUBLE'
    MasterOut   = 'idOut COUNTER', 'InvoiceNo TEXT(20)', 'TOname TEXT(50)', 'note TEXT(255)', 'OutDate DATETIME', 'timeS DATETIME',
                  'OutType TEXT(10)', 'Paid CURRENCY', 'strUserName TEXT(45)', 'Mandob TEXT(50)'
    subOut      = 'id COUNTER', 'idOut LONG', 'madaNameOut TEXT(150)', 'QuntOut DOUBLE', 'Price CURRENCY', 'unit TEXT(10)',
                  'IDcode TEXT(15)', 'BpriceL1 CURRENCY', 'BpriceL2 CURRENCY', 'UnitFactor LONG', 'note TEXT(255)'
    MasterIn    = 'IdIn COUNTER', 'InvoiceNo LONG', 'fromname TEXT(50)', 'InvoiceDate DATETIME', 'InType TEXT(10)',
                  'strUserName TEXT(45)', 'note TEXT(255)', 'timeS DATETIME'
    subIN       = 'id COUNTER', 'IdIn LONG', 'madaNameIn TEXT(150)', 'QuntIn DOUBLE', 'Price CURRENCY', 'IDcode TEXT(15)',
                  'unit TEXT(10)', 'UnitFactor LONG', 'note TEXT(255)', 'expireDate DATETIME'
    bayeeCode   = 'id COUNTER', 'bayeeCode TEXT(35)', 'MB CURRENCY', 'CMobile TEXT(20)', 'Cadress TEXT(255)', 'Ctype TEXT(30)',
                  'credit CURRENCY', 'RegDate DATETIME', 'Cdate DATETIME', 'Ctime DATETIME', 'Mandob TEXT(50)', 'Group TEXT(50)'
    shiraCode   = 'ID COUNTER', 'shiraCode TEXT(35)', 'MB CURRENCY', 'CMobile TEXT(20)', 'Cadress TEXT(255)', 'RegDate DATETIME',
                  'Cdate DATETIME', 'Ctime DATETIME'
    mablakIn    = 'idS COUNTER', 'dataS DATETIME', 'mostandNO LONG', 'nameFrom TEXT(35)', 'classS TEXT(35)', 'mablak CURRENCY',
                  'note TEXT(255)', 'timeS DATETIME', 'strUserName TEXT(45)'
    mablakOut   = 'idS COUNTER', 'dataS DATETIME', 'mostandNO LONG', 'nameto TEXT(35)', 'classS TEXT(35)', 'mablak CURRENCY',
                  'note TEXT(255)', 'timeS DATETIME', 'strUserName TEXT(45)'
    quodCodeIn  = 'ID COUNTER', 'quodCode TEXT(35)'
    quodCodeOut = 'ID COUNTER', 'quodCode TEXT(35)'
    Users       = 'ID COUNTER', 'UserName TEXT(45)', 'PassHash TEXT(100)', 'Salt TEXT(50)', 'IsAdmin BIT', 'Perms MEMO',
                  'Active BIT', 'Created DATETIME'
    Settings    = 'ID COUNTER', 'Name TEXT(50)', 'Val TEXT(255)'
}
# Lookups the program does all the time.
$SchemaIndexes = @(
    'subOut(idOut)', 'subOut(madaNameOut)', 'subIN(IdIn)', 'subIN(madaNameIn)', 'MasterOut(TOname)', 'MasterOut(OutDate)',
    'MasterIn(fromname)', 'mablakIn(nameFrom)', 'mablakOut(nameto)', 'madaCode(madaName)', 'madaCode(IDcode)',
    'bayeeCode(bayeeCode)', 'shiraCode(shiraCode)', 'Users(UserName)', 'Settings(Name)'
)
$DefaultClassesIn = @('تسديد', 'إيراد آخر', 'رأس مال')
$DefaultClassesOut = @('تسديد', 'مصاريف متفرقة', 'رواتب', 'إيجار', 'كهرباء وماء', 'نقل', 'سحب شخصي')

function Get-SchemaColumns([string]$table) {
    foreach ($c in $Schema[$table]) {
        $name, $type = $c -split ' ', 2
        $size = 0
        if ($type -match '^TEXT\((\d+)\)$') { $size = [int]$Matches[1]; $type = 'TEXT' }
        [pscustomobject]@{ name = $name; sqlType = $type; size = $size }
    }
}

function Get-SchemaSql {
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($t in $Schema.Keys) {
        $cols = foreach ($c in (Get-SchemaColumns $t)) {
            if ($c.sqlType -eq 'COUNTER') { "[$($c.name)] COUNTER CONSTRAINT [PK_$t] PRIMARY KEY" }
            elseif ($c.sqlType -eq 'TEXT') { "[$($c.name)] TEXT($($c.size))" }
            else { "[$($c.name)] $($c.sqlType)" }
        }
        $out.Add("CREATE TABLE [$t] (" + ($cols -join ', ') + ')')
    }
    $i = 0
    foreach ($x in $SchemaIndexes) {
        if ($x -match '^(\w+)\((\w+)\)$') { $i++; $out.Add("CREATE INDEX [IX$i] ON [$($Matches[1])] ([$($Matches[2])])") }
    }
    return , $out.ToArray()
}

# Creates the database file with every table, the default voucher kinds,
# the shop's name and its first manager.
function New-ShopDatabase([string]$path, [string]$shopName, [string]$admin, [string]$password) {
    Need (-not (Test-Path -LiteralPath $path)) "يوجد ملف بهذا الاسم مسبقاً: $path"
    New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
    $engine = Get-Engine
    if ($env:LAWHA_FAKEDAO) {
        New-FakeDatabase $engine $path (Get-FakeSchema)
    } else {
        # dbLangGeneral, dbVersion120 (.accdb)
        $db = $engine.CreateDatabase($path, ';LANGID=0x0409;CP=1252;COUNTRY=0', 128)
        try { foreach ($sql in (Get-SchemaSql)) { $db.Execute($sql, $dbFailOnError) } } finally { $db.Close() }
    }
    $script:DbOverride = $path
    try {
        Use-Database { param($db)
            foreach ($c in $DefaultClassesIn) { Add-Row $db 'quodCodeIn' @{ quodCode = $c } '' | Out-Null }
            foreach ($c in $DefaultClassesOut) { Add-Row $db 'quodCodeOut' @{ quodCode = $c } '' | Out-Null }
            Set-ShopSetting $db 'schema' ([string]$SchemaVersion)
            Set-ShopSetting $db 'shopName' $shopName
            Set-ShopSetting $db 'created' (Get-Date -Format 'yyyy-MM-dd HH:mm')
            Save-User $db @{ name = $admin; password = $password; isAdmin = $true; active = $true }
        } | Out-Null
    } finally {
        Close-Db
        $script:DbOverride = $null
    }
}

# The test engine's tables, from the same definitions.
function Get-FakeSchema {
    $map = @{ COUNTER = 'long'; LONG = 'long'; TEXT = 'text'; CURRENCY = 'currency'; DOUBLE = 'double'; DATETIME = 'datetime'; BIT = 'boolean'; MEMO = 'memo' }
    $out = [ordered]@{}
    foreach ($t in $Schema.Keys) {
        $out[$t] = @(foreach ($c in (Get-SchemaColumns $t)) {
                @{ name = $c.name; type = $map[$c.sqlType]; size = $c.size; auto = ($c.sqlType -eq 'COUNTER'); nullable = $true }
            })
    }
    return $out
}

# Is this a Fr3oon database (and not some other Access file)?
function Test-ShopDatabase([string]$path) {
    $script:DbOverride = $path
    try {
        return [bool](Use-Database -ReadOnly { param($db)
                $names = Get-TableNames $db
                if ($names -notcontains 'Settings' -or $names -notcontains 'Users') { return $false }
                return [bool](Get-Value $db "SELECT Val FROM Settings WHERE Name='schema'")
            })
    } catch { return $false } finally {
        Close-Db
        $script:DbOverride = $null
    }
}

function Get-TableNames($db) {
    $names = @()
    foreach ($t in $db.TableDefs) { $names += [string]$t.Name }
    return , $names
}

# ---------------------------------------------------------------- shop settings (in the database)
function Get-ShopSetting($db, [string]$name) {
    $v = Get-Value $db "SELECT Val FROM Settings WHERE Name=$(Q $name)"
    if ($null -eq $v -or $v -is [DBNull]) { return '' }
    return [string]$v
}
function Set-ShopSetting($db, [string]$name, [string]$value) {
    if ((Count $db "SELECT Count(*) FROM Settings WHERE Name=$(Q $name)") -gt 0) {
        $db.Execute("UPDATE Settings SET Val=$(Q $value) WHERE Name=$(Q $name)", $dbFailOnError)
    } else {
        Add-Row $db 'Settings' @{ Name = $name; Val = $value } '' | Out-Null
    }
}
# Read often (every page and request): kept a few seconds.
$script:ShopCache = $null
function Get-Shop {
    if ($script:ShopCache -and ((Get-Date) - $script:ShopCache.at).TotalSeconds -lt 5 -and $script:ShopCache.path -eq (Get-DbPath)) { return $script:ShopCache }
    $p = Get-DbPath
    if (-not $p) { return @{ shopName = ''; users = @{}; at = Get-Date; path = '' } }
    $c = Use-Database -ReadOnly { param($db)
        $users = @{}
        $rs = $db.OpenRecordset('SELECT UserName, IsAdmin, Perms, Active FROM Users', $dbOpenSnapshot)
        try {
            while (-not $rs.EOF) {
                $n = [string]$rs.Fields.Item('UserName').Value
                $perm = $rs.Fields.Item('Perms').Value
                $users[$n] = @{
                    name = $n; admin = [bool]$rs.Fields.Item('IsAdmin').Value; active = [bool]$rs.Fields.Item('Active').Value
                    perms = $(if ($perm -is [DBNull] -or $null -eq $perm) { $null } elseif ([string]$perm -eq '-') { '' } else { [string]$perm })
                }
                $rs.MoveNext()
            }
        } finally { $rs.Close() }
        return @{ shopName = (Get-ShopSetting $db 'shopName'); users = $users }
    }
    $c.at = Get-Date
    $c.path = $p
    $script:ShopCache = $c
    return $c
}

# ---------------------------------------------------------------- users (in the database)
# Passwords are kept as salted PBKDF2-SHA256 hashes, never as text.
function Get-PasswordHash([string]$password, [string]$salt) {
    $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($password, [Convert]::FromBase64String($salt), 20000, [Security.Cryptography.HashAlgorithmName]::SHA256)
    try { return [Convert]::ToBase64String($kdf.GetBytes(32)) } finally { $kdf.Dispose() }
}

function New-Salt {
    $b = New-Object byte[] 16
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return [Convert]::ToBase64String($b)
}

# Adds or changes a user. $u: name, oldName (rename), password (empty =
# keep), isAdmin, perms (text, $null = defaults), active.
function Save-User($db, $u) {
    $name = Text ([string]$u.name) 45 'اسم المستخدم'
    Need ($name -ne '') 'اسم المستخدم مطلوب'
    $old = if ($u.oldName) { [string]$u.oldName } else { '' }
    $exists = (Count $db "SELECT Count(*) FROM Users WHERE UserName=$(Q $(if ($old) { $old } else { $name }))") -gt 0
    if ($old -and $old -ne $name) { Need ((Count $db "SELECT Count(*) FROM Users WHERE UserName=$(Q $name)") -eq 0) "يوجد مستخدم بالاسم: $name" }
    if (-not $old) { Need (-not $exists) "يوجد مستخدم بالاسم: $name" }
    $values = @{ UserName = $name; IsAdmin = [bool]$u.isAdmin; Active = ($null -eq $u.active -or [bool]$u.active) }
    # '-' is "no permissions at all": Access may keep an empty text as Null,
    # which would read back as "never set" (the defaults)
    if ($null -ne $u.perms) { $t = ConvertTo-PermText $u.perms; $values.Perms = $(if (-not $t) { '-' } else { $t }) }
    if ([string]$u.password) {
        Need (([string]$u.password).Length -ge 4) 'كلمة المرور يجب أن تكون 4 أحرف على الأقل'
        $values.Salt = New-Salt
        $values.PassHash = Get-PasswordHash ([string]$u.password) $values.Salt
    } else {
        Need $exists 'كلمة المرور مطلوبة للمستخدم الجديد'
    }
    if ($old) {
        $id = [int](Get-Value $db "SELECT ID FROM Users WHERE UserName=$(Q $old)")
        Need ($id -gt 0) "المستخدم غير موجود: $old"
        Edit-Row $db 'Users' 'ID' $id $values
    } else {
        $values.Created = Get-Date
        Add-Row $db 'Users' $values 'ID' | Out-Null
    }
    $script:ShopCache = $null
}

function Get-UserNames {
    $u = (Get-Shop).users
    return , [string[]]@($u.Keys | Where-Object { $u[$_].active } | Sort-Object)
}

function Test-Login([string]$user, [string]$password) {
    return Use-Database -ReadOnly { param($db)
        $rs = $db.OpenRecordset("SELECT PassHash, Salt, Active FROM Users WHERE UserName=$(Q $user)", $dbOpenSnapshot)
        try {
            if ($rs.EOF -or -not [bool]$rs.Fields.Item('Active').Value) { return $false }
            $salt = [string]$rs.Fields.Item('Salt').Value
            $hash = [string]$rs.Fields.Item('PassHash').Value
            return ($salt -and (Get-PasswordHash $password $salt) -ceq $hash)
        } finally { $rs.Close() }
    }
}

function Test-Admin([string]$user) {
    $u = (Get-Shop).users[$user]
    return [bool]($u -and $u.active -and $u.admin)
}

# ---------------------------------------------------------------- backup

$script:BackupDay = ''
# The daily copy of the database, into the folder chosen at setup (or in
# Settings), keeping the newest N. It runs on the side, started with the
# program and again after midnight, so no save waits for it.
function Get-BackupDir { if ($script:Config.backupDir) { return $script:Config.backupDir } return $DefaultBackupDir }

$BackupScript = {
    param($path, $dir, $keep, $label)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $target = Join-Path $dir ("fr3oon-" + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + $label + '.accdb')
    # a half-written copy never looks like a finished one
    $part = $target + '.part'
    $src = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
        $dst = [IO.File]::Create($part)
        try { $src.CopyTo($dst, 1048576) } finally { $dst.Close() }
    } finally { $src.Close() }
    Move-Item -LiteralPath $part -Destination $target -Force
    # only the daily copies count towards the limit; copies made before a
    # restore are kept
    Get-ChildItem -LiteralPath $dir -Filter 'fr3oon-*.accdb' | Where-Object { $_.Name -notmatch '-before-restore' } |
        Sort-Object Name -Descending | Select-Object -Skip $keep | Remove-Item -Force
    $target
}
$script:BackupJob = $null
$script:BackupFailedAt = [datetime]::MinValue
$script:BackupError = ''

# Collect a finished copy (called from the main loop and before saves).
function Update-Backup {
    $j = $script:BackupJob
    if (-not $j -or -not $j.h.IsCompleted) { return }
    try {
        $r = $j.ps.EndInvoke($j.h)
        if ($j.ps.Streams.Error.Count) { throw $j.ps.Streams.Error[0].Exception }
        $script:BackupDay = $j.day
        $script:BackupError = ''
        Write-LawhaLog "backup done: $r"
    } catch {
        $script:BackupFailedAt = Get-Date
        $script:BackupError = $_.Exception.Message
        Write-LawhaLog "backup FAILED: $($_.Exception.Message)"
    } finally {
        $j.ps.Dispose(); $j.rs.Dispose()
        $script:BackupJob = $null
    }
}

function Start-Backup([switch]$Now, [string]$Label = '') {
    Update-Backup
    $today = Get-Date -Format 'yyyy-MM-dd'
    if ($script:BackupJob -or $script:DbOverride) { return }
    if (-not $Now) {
        if ($script:BackupDay -eq $today) { return }
        # after a failure, try again in half an hour, not at every save
        if (((Get-Date) - $script:BackupFailedAt).TotalMinutes -lt 30) { return }
    }
    $path = Get-DbPath
    if (-not $path) { return }
    $rs = [runspacefactory]::CreateRunspace()
    $rs.Open()
    $ps = [PowerShell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($BackupScript.ToString()).AddArgument($path).AddArgument((Get-BackupDir)).AddArgument([int]$script:Config.keepBackups).AddArgument($Label)
    $script:BackupJob = @{ ps = $ps; rs = $rs; h = $ps.BeginInvoke(); day = $today }
}

# Before a save: make sure today's copy is on its way; never wait for it.
function Backup-Database { Start-Backup }

# The copies in the backup folder, newest first.
function Get-Backups {
    $dir = Get-BackupDir
    if (-not (Test-Path -LiteralPath $dir)) { return , @() }
    return , @(Get-ChildItem -LiteralPath $dir -Filter 'fr3oon-*.accdb' | Sort-Object Name -Descending | ForEach-Object {
            @{ name = $_.Name; size = $_.Length; date = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'); beforeRestore = ($_.Name -match '-before-restore') }
        })
}

# Puts a backup in place of the database. The database as it is now is
# copied first ("-before-restore"), so a restore can itself be undone.
function Restore-Backup([string]$name) {
    Need ($name -match '^fr3oon-[\w\-]+\.accdb$') 'اسم النسخة غير صحيح'
    $src = Join-Path (Get-BackupDir) $name
    Need (Test-Path -LiteralPath $src) "النسخة غير موجودة: $name"
    Need (Test-ShopDatabase $src) 'هذا الملف ليس قاعدة بيانات Fr3oon سليمة، لن يُستعاد.'
    $db = Get-DbPath
    Need ($db -ne '') 'لا توجد قاعدة بيانات حالية'
    Wait-Backup 600
    Close-Db
    $script:BackupJob = $null
    # never the name of an existing copy (above all, the one being restored)
    $stamp = 'fr3oon-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '-before-restore'
    $safety = Join-Path (Get-BackupDir) ($stamp + '.accdb')
    for ($i = 2; Test-Path -LiteralPath $safety; $i++) { $safety = Join-Path (Get-BackupDir) ($stamp + "-$i.accdb") }
    Copy-Item -LiteralPath $db -Destination $safety -Force
    Copy-Item -LiteralPath $src -Destination $db -Force
    $script:ShopCache = $null
    $script:DataCache = $null
    $script:Sessions.Clear()
    Write-LawhaLog "restored $name (previous database kept as $(Split-Path $safety -Leaf))"
    return @{ restored = $name; safety = (Split-Path $safety -Leaf) }
}

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
    } catch { throw "التاريخ غير صحيح: $iso" }
}

function Text([string]$s, [int]$max, [string]$label) {
    $s = if ($null -eq $s) { '' } else { $s.Trim() }
    if ($s.Length -gt $max) { throw "$label طويل: الحد الأقصى لعدد الأحرف $max" }
    return $s
}

function Num($v, [string]$label) {
    if ($null -eq $v -or "$v".Trim() -eq '') { return 0.0 }
    if ($v -is [double] -or $v -is [int] -or $v -is [long] -or $v -is [decimal]) { return [double]$v }
    $d = 0.0
    if (-not [double]::TryParse("$v".Replace(',', ''), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) {
        throw "$label يجب أن يكون رقماً"
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
    Need ($null -ne $id -and [int]$id -gt 0) "لم يُرجع الحفظ في الجدول $table رقم السجل"
    return [int]$id
}

function Edit-Row($db, [string]$table, [string]$idField, $id, [hashtable]$values) {
    $id = [int]$id
    Need ((Count $db "SELECT Count(*) FROM [$table] WHERE [$idField]=$id") -gt 0) 'السجل غير موجود (ربما حُذف من جهاز آخر)'
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
        Need (-not $rs.EOF) "الصنف غير موجود: $name"
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
    Need ($lines.Count -gt 0) 'الفاتورة لا تحتوي على أصناف'
    foreach ($l in $lines) {
        $name = Text $l.item 150 'اسم الصنف'
        $it = Get-MadaItem $db $name
        $unit = Text $l.unit 10 'الوحدة'
        Need ($unit -eq $it.UnitL1 -or $unit -eq $it.UnitL2) "وحدة غير صحيحة للصنف $name"
        $qty = Num $l.qty 'الكمية'
        Need ($qty -gt 0) "يجب أن تكون الكمية أكبر من صفر ($name)"
        $price = Num $l.price 'السعر'
        Need ($price -ge 0) "السعر غير صحيح ($name)"
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
    Need ($type -eq 'نقدي' -or $type -eq 'اجل') 'نوع الفاتورة غير صحيح'
    $customer = Text $d.customer 50 'اسم العميل'
    if ($type -eq 'اجل') {
        Need ($customer -ne '') 'فاتورة البيع الآجل تتطلّب اسم العميل'
        Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $customer)") -gt 0) "العميل غير موجود: $customer"
    } elseif (-not $customer) {
        $customer = 'عميل نقدي'
    }
    $paid = Num $d.paid 'المدفوع'
    Need ($paid -ge 0) 'المبلغ المدفوع غير صحيح'
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
        $id = [int](Add-Row $db 'MasterOut' $values 'idOut')
    }
    Save-Lines $db 'sale' $id $d.lines
    return @{ id = $id }
}

function Op-DeleteSale($db, $d) {
    $id = [int]$d.id
    Need ((Count $db "SELECT Count(*) FROM MasterOut WHERE idOut=$id") -gt 0) 'الفاتورة غير موجودة'
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
    Need ($type -eq 'نقدي' -or $type -eq 'اجل') 'نوع الفاتورة غير صحيح'
    $supplier = Text $d.supplier 50 'اسم المورد'
    Need ($supplier -ne '') 'اختر المورد'
    Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $supplier)") -gt 0) "المورد غير موجود: $supplier"
    $no = $null
    if ("$($d.no)".Trim()) {
        $n = 0
        Need ([int]::TryParse("$($d.no)".Trim(), [ref]$n)) 'رقم فاتورة المورد يجب أن يكون رقماً'
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
    Need ((Count $db "SELECT Count(*) FROM MasterIn WHERE IdIn=$id") -gt 0) 'الفاتورة غير موجودة'
    $db.Execute("DELETE FROM subIN WHERE IdIn=$id", $dbFailOnError)
    $db.Execute("DELETE FROM MasterIn WHERE IdIn=$id", $dbFailOnError)
    return @{ id = $id }
}

function Save-Voucher($db, $d, [string]$table, [string]$nameField) {
    $amount = Num $d.amount 'المبلغ'
    Need ($amount -gt 0) 'يجب أن يكون المبلغ أكبر من صفر'
    $cls = Text $d.cls 35 'النوع'
    Need ($cls -ne '') 'اختر النوع'
    $name = Text $d.name 35 'الاسم'
    if ($cls -eq 'تسديد') { Need ($name -ne '') 'التسديد يتطلّب اسماً' }
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
        Need ("$($d.name)".Trim() -ne '') 'التسديد يتطلّب اسماً'
        Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $d.name)") -gt 0) "العميل غير موجود: $($d.name)"
    }
    return Save-Voucher $db $d 'mablakIn' 'nameFrom'
}

function Op-SavePayment($db, $d) {
    if ($d.cls -eq 'تسديد') {
        Need ("$($d.name)".Trim() -ne '') 'التسديد يتطلّب اسماً'
        Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $d.name)") -gt 0) "المورد غير موجود: $($d.name)"
    }
    return Save-Voucher $db $d 'mablakOut' 'nameto'
}

function Delete-Voucher($db, [string]$table, $d) {
    $id = [int]$d.id
    Need ((Count $db "SELECT Count(*) FROM [$table] WHERE idS=$id") -gt 0) 'السند غير موجود'
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
    $name = Text $d.name 35 'اسم العميل'
    Need ($name -ne '') 'اكتب اسم العميل'
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $name) AND id<>$id") -eq 0) "يوجد عميل آخر بنفس الاسم: $name"
    $values = @{
        bayeeCode = $name; MB = [int](Num $d.opening 'الرصيد الافتتاحي'); CMobile = (Text $d.mobile 12 'الموبايل')
        Cadress = (Text $d.address 255 'العنوان'); Ctype = (Text $d.type 30 'النوع')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT bayeeCode FROM bayeeCode WHERE id=$id")
        Need ($old -ne '') 'العميل غير موجود'
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
    Need ($name -ne '') 'اكتب اسم المورد'
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $name) AND ID<>$id") -eq 0) "يوجد مورد آخر بنفس الاسم: $name"
    $values = @{
        shiraCode = $name; MB = (Num $d.opening 'الرصيد الافتتاحي'); CMobile = (Text $d.mobile 12 'الموبايل')
        Cadress = (Text $d.address 255 'العنوان')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT shiraCode FROM shiraCode WHERE ID=$id")
        Need ($old -ne '') 'المورد غير موجود'
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
    $name = Text $d.name 150 'اسم الصنف'
    Need ($name -ne '') 'اكتب اسم الصنف'
    # subOut.IDcode holds 15 characters
    $code = Text $d.code 15 'الرمز'
    $u1 = Text $d.unitL1 10 'الوحدة الكبيرة'
    $u2 = Text $d.unitL2 10 'الوحدة الصغيرة'
    Need ($u1 -ne '') 'اكتب الوحدة الكبيرة'
    if (-not $u2) { $u2 = $u1 }
    $id = if ($d.id) { [int]$d.id } else { 0 }
    Need ((Count $db "SELECT Count(*) FROM madaCode WHERE madaName=$(Q $name) AND ID<>$id") -eq 0) "يوجد صنف آخر بنفس الاسم: $name"
    if ($code) { Need ((Count $db "SELECT Count(*) FROM madaCode WHERE IDcode=$(Q $code) AND ID<>$id") -eq 0) "يوجد صنف آخر بنفس الرمز: $code" }
    $price = [int](Num $d.priceL1 'سعر البيع')
    $values = @{
        madaName = $name; IDcode = $code; MadaClass = (Text $d.cls 255 'التصنيف')
        price = $price; priceSeeat = [int](Num $d.priceL2 'سعر البيع')
        Fill = [int](Num $d.fill 'التعبئة'); BpriceL1 = (Num $d.buyL1 'سعر الشراء'); BpriceL2 = (Num $d.buyL2 'سعر الشراء')
        UnitL1 = $u1; UnitL2 = $u2; harig = [int](Num $d.harig 'حد الطلب')
        Pr = (Num $d.openL1 'الرصيد الافتتاحي'); Pru = (Num $d.openL2 'الرصيد الافتتاحي')
    }
    if ($id) {
        $old = [string](Get-Value $db "SELECT madaName FROM madaCode WHERE ID=$id")
        Need ($old -ne '') 'الصنف غير موجود'
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
    Need ($name -ne '') 'السجل غير موجود'
    $n = Uses $db $kind $name
    Need ($n -eq 0) "لا يمكن الحذف: توجد عليه $n حركة. احذف حركاته أولاً."
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
    $u = (Get-Shop).users[$user]
    if ($u -and $null -ne $u.perms) { $t = ConvertTo-PermText $u.perms }
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
    edit_price = 'تغيير السعر'; sale_edit = 'تعديل فواتير البيع'; sale_delete = 'حذف فواتير البيع'
    purchase = 'فواتير الشراء'; purchase_edit = 'تعديل وحذف فواتير الشراء'; receipt = 'سند القبض'
    payment = 'سند الصرف والمصاريف'; voucher_edit = 'تعديل وحذف السندات'; customer_add = 'إضافة عميل'
    customer_edit = 'تعديل وحذف العملاء'; supplier_manage = 'إدارة الموردين'; item_manage = 'الأصناف والأسعار'
}

function Need-Perm($session, [string]$perm) {
    $name = if ($PermNames.ContainsKey($perm)) { $PermNames[$perm] } else { $perm }
    Need ($session.admin -or ($session.perms -contains $perm)) "ليست لديك صلاحية: $name. اطلبها من المدير."
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
        default { Need $false 'هذه العملية تتطلّب صلاحية المدير' }
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
        Need $ok "ليست لديك صلاحية: تغيير السعر ($($l.item)). اطلبها من المدير."
    }
}

function Invoke-Write([string]$op, $data, $session = $null) {
    Need ($Ops.ContainsKey($op)) "عملية غير معروفة: $op"
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

# ---------------------------------------------------------------- license
# Fr3oon works only once activated with a key made for this computer. The
# vendor's tool signs {product, machine code, customer, expiry} with the
# vendor's private key (ECDSA P-256); only the public key is here, so a key
# cannot be made from this program. (Anyone can still edit this script; the
# key stops copying the program as is, not a determined programmer.)
$VendorKey = @{ x = 'MUsling1wiVjg7EmUEz2iBXVY6IdPwDlK0exjnfn-NQ'; y = 'EcYr6IWTh2FPbj1YcU8jF3EHpY0f_Gm5wxNbSkBIklM' }

function ConvertFrom-B64Url([string]$s) {
    $t = $s.Trim().Replace('-', '+').Replace('_', '/')
    switch ($t.Length % 4) { 2 { $t += '==' } 3 { $t += '=' } }
    return [Convert]::FromBase64String($t)
}

# $context keeps a license signature from passing as an update's, and back.
function Test-VendorSignature([string]$context, [string]$data, [string]$signature) {
    try {
        $p = New-Object System.Security.Cryptography.ECParameters
        $p.Curve = [System.Security.Cryptography.ECCurve]::CreateFromValue('1.2.840.10045.3.1.7')
        $q = New-Object System.Security.Cryptography.ECPoint
        # tests sign with their own key pair; honoured only by the test engine
        $key = if ($env:LAWHA_FAKEDAO -and $env:LAWHA_TESTKEY) { Get-Content -LiteralPath $env:LAWHA_TESTKEY -Raw | ConvertFrom-Json } else { $VendorKey }
        $q.X = ConvertFrom-B64Url $key.x
        $q.Y = ConvertFrom-B64Url $key.y
        $p.Q = $q
        $ec = [System.Security.Cryptography.ECDsa]::Create($p)
        try {
            return $ec.VerifyData([Text.Encoding]::UTF8.GetBytes("$context`n$data"), (ConvertFrom-B64Url $signature), [System.Security.Cryptography.HashAlgorithmName]::SHA256)
        } finally { $ec.Dispose() }
    } catch { return $false }
}

# This computer's code: from Windows' machine id and drive C's serial,
# hashed, as 16 letters/digits (no 0/O/1/I to misread).
function Get-MachineCode {
    if ($script:MachineCode) { return $script:MachineCode }
    $raw = ''
    if ($env:LAWHA_FAKEMACHINE) { $raw = $env:LAWHA_FAKEMACHINE } else {
        try {
            $k = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
            $raw = [string]$k.OpenSubKey('SOFTWARE\Microsoft\Cryptography').GetValue('MachineGuid')
        } catch { }
        try { $raw += '|' + [string](Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop).VolumeSerialNumber } catch { }
        if (-not $raw.Trim('|')) { $raw = [string]$env:COMPUTERNAME }
    }
    $h = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes("Fr3oon|$raw"))
    $abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    $code = -join (0..15 | ForEach-Object { $abc[$h[$_] % 32] })
    $script:MachineCode = $code.Substring(0, 4) + '-' + $code.Substring(4, 4) + '-' + $code.Substring(8, 4) + '-' + $code.Substring(12, 4)
    return $script:MachineCode
}

$LicenseFile = Join-Path $DataDir 'license.key'

# What a key says, and whether it opens this program on this computer.
function Test-LicenseKey([string]$key) {
    $k = ($key -replace '\s', '')
    $parts = $k.Split('.')
    if ($parts.Count -ne 2) { return @{ ok = $false; error = 'المفتاح غير صحيح. انسخه كاملاً كما وصلك.' } }
    if (-not (Test-VendorSignature 'FR3OON-LICENSE' $parts[0] $parts[1])) { return @{ ok = $false; error = 'المفتاح غير صحيح أو ناقص.' } }
    try { $j = [Text.Encoding]::UTF8.GetString((ConvertFrom-B64Url $parts[0])) | ConvertFrom-Json } catch { return @{ ok = $false; error = 'المفتاح غير صحيح.' } }
    if ([string]$j.p -ne 'Fr3oon') { return @{ ok = $false; error = 'هذا المفتاح ليس لبرنامج Fr3oon.' } }
    if (([string]$j.m).ToUpper() -ne (Get-MachineCode)) { return @{ ok = $false; error = "هذا المفتاح لجهاز آخر ($($j.m)). رمز هذا الجهاز: $(Get-MachineCode)" } }
    $exp = [string]$j.e
    $r = @{ ok = $true; name = [string]$j.n; expiry = $exp; issued = [string]$j.i; key = $k }
    if ($exp -and (Get-Date -Format 'yyyy-MM-dd') -gt $exp) { $r.ok = $false; $r.expired = $true; $r.error = "انتهت صلاحية الترخيص في $exp. اطلب مفتاحاً جديداً." }
    return $r
}

# Checked at most once an hour (and right after activating).
$script:License = $null
function Get-License {
    if ($script:License -and ((Get-Date) - $script:License.at).TotalMinutes -lt 60) { return $script:License }
    $l = @{ ok = $false; error = 'البرنامج غير مفعّل على هذا الجهاز.' }
    if (Test-Path -LiteralPath $LicenseFile) { $l = Test-LicenseKey (Get-Content -LiteralPath $LicenseFile -Raw) }
    $l.at = Get-Date
    $script:License = $l
    return $l
}

function Set-License([string]$key) {
    $l = Test-LicenseKey $key
    Need $l.ok $l.error
    Set-Content -LiteralPath $LicenseFile -Value $l.key -Encoding ASCII
    $script:License = $null
    Write-LawhaLog "activated: $($l.name) $(if ($l.expiry) { "until $($l.expiry)" } else { 'no expiry' })"
    return (Get-License)
}

# ---------------------------------------------------------------- updates
# The vendor publishes latest.json next to the new installer:
#   {product, version, url, sha256, size, notes, date, sig}
# sig signs "version`nurl`nsha256" with the vendor's key. An installer is
# run only when the list is signed and the file's SHA-256 matches, so a
# changed file or a forged list is refused.
function Get-UpdateUrl { if ($script:Config.updateUrl) { return $script:Config.updateUrl } return $DefaultUpdateUrl }

function Get-WebText([string]$url, [int]$ms = 8000) {
    if ($env:LAWHA_FAKEUPDATE -and $url -notmatch '^https?://') { return [IO.File]::ReadAllText($url) }
    $rq = [Net.HttpWebRequest]::Create($url)
    $rq.Timeout = $ms
    $rq.ReadWriteTimeout = $ms
    $rq.UserAgent = "Fr3oon/$Version"
    $rq.Headers['Cache-Control'] = 'no-cache'
    $rs = $rq.GetResponse()
    try {
        $sr = New-Object IO.StreamReader($rs.GetResponseStream(), [Text.Encoding]::UTF8)
        return $sr.ReadToEnd()
    } finally { $rs.Close() }
}

function Get-UpdateInfo {
    $url = Get-UpdateUrl
    try { $j = (Get-WebText ($url + $(if ($url -match '^https?://') { '?t=' + [DateTime]::UtcNow.Ticks } else { '' }))) | ConvertFrom-Json }
    catch {
        # nothing published yet: the feed URL answers 404
        $e = $_.Exception
        while ($e -and -not ($e -is [Net.WebException])) { $e = $e.InnerException }
        if ($e -and $e.Response -and [int]$e.Response.StatusCode -eq 404) { throw 'لا توجد تحديثات منشورة بعد.' }
        throw "تعذّر الاتصال بخادم التحديثات. تحقّق من اتصال الإنترنت. ($($_.Exception.Message))"
    }
    Need ([string]$j.product -eq 'Fr3oon') 'ملف التحديثات غير صالح.'
    Need (Test-VendorSignature 'FR3OON-UPDATE' "$($j.version)`n$($j.url)`n$($j.sha256)" ([string]$j.sig)) 'ملف التحديثات غير موقّع من الناشر، لن يُستخدم.'
    $newer = ([version][string]$j.version) -gt ([version]$Version)
    return @{ current = $Version; latest = [string]$j.version; available = $newer; notes = [string]$j.notes; date = [string]$j.date; url = [string]$j.url; sha256 = ([string]$j.sha256).ToLower(); size = [long]$j.size }
}

function Install-Update {
    $u = Get-UpdateInfo
    Need $u.available "أنت تستخدم آخر إصدار ($Version)."
    $dir = Join-Path ([IO.Path]::GetTempPath()) 'fr3oon-update'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir "Fr3oon-Setup-$($u.latest).exe"
    try {
        if ($env:LAWHA_FAKEUPDATE -and $u.url -notmatch '^https?://') { Copy-Item -LiteralPath $u.url -Destination $file -Force }
        else {
            $wc = New-Object Net.WebClient
            $wc.Headers['User-Agent'] = "Fr3oon/$Version"
            $wc.DownloadFile($u.url, $file)
        }
    } catch { throw "تعذّر تنزيل التحديث. ($($_.Exception.Message))" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $u.sha256) {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        throw 'ملف التحديث الذي نُزّل لا يطابق الملف المنشور، لن يُثبَّت.'
    }
    Write-LawhaLog "update $Version -> $($u.latest): installing $file"
    if (-not $env:LAWHA_FAKEUPDATE) {
        # silent install; the installer stops this helper and opens the program again
        Start-Process -FilePath $file -ArgumentList '/S', '/RELAUNCH'
    }
    $script:Stop = $true
    return @{ version = $u.latest; file = $file }
}

# ---------------------------------------------------------------- sessions

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
    Need ($script:FT -and (Test-Path -LiteralPath $script:FT.path)) 'ابدأ الفحص الشامل من جديد.'
    $script:DbOverride = $script:FT.path
    try { return (& $body) } finally { $script:DbOverride = $null }
}

function Start-FullTest {
    Stop-FullTest
    $src = Get-DbPath
    Need ($src -ne '') 'لم تُحدَّد قاعدة البيانات'
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
        $cust = "$t عميل"; $cust2 = "$t عميل2"; $sup = "$t مورد"; $item = "$t صنف"
        $script:FT.names = @{ customer = $cust2; supplier = $sup; item = $item }

        & $step 'إضافة مورد' {
            $ids.sup = (Write-As $mgr 'saveSupplier' @{ name = $sup; mobile = '07800000000'; opening = 0 }).id
            Need ((Read-One "SELECT shiraCode FROM shiraCode WHERE ID=$($ids.sup)") -eq $sup) 'لم يُحفظ المورد'
            "رقم $($ids.sup)"
        }
        & $step 'إضافة عميل' {
            $ids.cust = (Write-As $mgr 'saveCustomer' @{ name = $cust; mobile = '07700000000'; opening = 1000; type = 'جملة' }).id
            Need ((Read-One "SELECT bayeeCode FROM bayeeCode WHERE id=$($ids.cust)") -eq $cust) 'لم يُحفظ العميل'
            "رقم $($ids.cust)"
        }
        & $step 'تعديل العميل (الموبايل والرصيد الافتتاحي)' {
            Write-As $mgr 'saveCustomer' @{ id = $ids.cust; name = $cust; mobile = '07711111111'; opening = 2000; type = 'جملة' } | Out-Null
            Need ([string](Read-One "SELECT CMobile FROM bayeeCode WHERE id=$($ids.cust)") -eq '07711111111') 'لم يتغيّر رقم الموبايل'
            Need ([double](Read-One "SELECT MB FROM bayeeCode WHERE id=$($ids.cust)") -eq 2000) 'لم يتغيّر الرصيد الافتتاحي'
            'تمّ بنجاح'
        }
        & $step 'إضافة صنف (الكرتونة = 10 قطع)' {
            $ids.item = (Write-As $mgr 'saveItem' @{ name = $item; code = ''; cls = 'فحص'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 10
                    priceL1 = 10000; priceL2 = 1100; buyL1 = 8000; buyL2 = 800 }).id
            Need ([double](Read-One "SELECT priceSeeat FROM madaCode WHERE ID=$($ids.item)") -eq 1100) 'لم يُحفظ سعر القطعة'
            "رقم $($ids.item)"
        }
        & $step 'تعديل سعر الصنف' {
            Write-As $mgr 'saveItem' @{ id = $ids.item; name = $item; code = ''; cls = 'فحص'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 10
                priceL1 = 12000; priceL2 = 1100; buyL1 = 8000; buyL2 = 800 } | Out-Null
            Need ([double](Read-One "SELECT price FROM madaCode WHERE ID=$($ids.item)") -eq 12000) 'لم يتغيّر السعر'
            '12,000 للكرتونة'
        }
        & $step 'فاتورة شراء آجلة (5 كرتونات × 8,000)' {
            $ids.pur = (Write-As $mgr 'savePurchase' @{ type = 'اجل'; supplier = $sup; date = $today; updatePrices = $true
                    lines = @(@{ item = $item; unit = 'كرتونة'; qty = 5; price = 8000 }) }).id
            Need ((Read-Count "SELECT Count(*) FROM subIN WHERE IdIn=$($ids.pur)") -eq 1) 'لم يُحفظ سطر الشراء'
            Need ([string](Read-One "SELECT fromname FROM MasterIn WHERE IdIn=$($ids.pur)") -eq $sup) 'لم يُحفظ اسم المورد'
            "رقم $($ids.pur)"
        }
        & $step 'تعديل فاتورة الشراء (6 كرتونات × 8,500) وتحديث سعر الشراء' {
            Write-As $mgr 'savePurchase' @{ id = $ids.pur; type = 'اجل'; supplier = $sup; date = $today; updatePrices = $true
                lines = @(@{ item = $item; unit = 'كرتونة'; qty = 6; price = 8500 }) } | Out-Null
            Need ([double](Read-One "SELECT QuntIn FROM subIN WHERE IdIn=$($ids.pur)") -eq 6) 'لم تتغيّر الكمية'
            Need ([double](Read-One "SELECT BpriceL1 FROM madaCode WHERE ID=$($ids.item)") -eq 8500) 'لم يُحدَّث سعر الشراء في بطاقة الصنف'
            Need ([double](Read-One "SELECT BpriceL2 FROM madaCode WHERE ID=$($ids.item)") -eq 850) 'لم يُحدَّث سعر شراء القطعة'
            'تمّ بنجاح'
        }
        & $step 'بيع نقدي (3 قطع × 1,100)' {
            $ids.cash = (Write-As $mgr 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 3; price = 1100 }) }).id
            Need ([string](Read-One "SELECT OutType FROM MasterOut WHERE idOut=$($ids.cash)") -eq 'نقدي') 'لم يُحفظ نوع الفاتورة'
            "رقم $($ids.cash)"
        }
        & $step 'بيع آجل (كرتونتان × 12,000، المدفوع 4,000)' {
            $ids.credit = (Write-As $mgr 'saveSale' @{ type = 'اجل'; customer = $cust; paid = 4000; date = $today
                    lines = @(@{ item = $item; unit = 'كرتونة'; qty = 2; price = 12000 }) }).id
            Need ([string](Read-One "SELECT TOname FROM MasterOut WHERE idOut=$($ids.credit)") -eq $cust) 'لم يُحفظ اسم العميل'
            Need ([double](Read-One "SELECT Paid FROM MasterOut WHERE idOut=$($ids.credit)") -eq 4000) 'لم يُحفظ المبلغ المدفوع'
            "رقم $($ids.credit)"
        }
        & $step 'تعديل البيع الآجل (كرتونة + 5 قطع)' {
            Write-As $mgr 'saveSale' @{ id = $ids.credit; type = 'اجل'; customer = $cust; paid = 4000; date = $today
                lines = @(@{ item = $item; unit = 'كرتونة'; qty = 1; price = 12000 }, @{ item = $item; unit = 'قطعة'; qty = 5; price = 1100 }) } | Out-Null
            Need ((Read-Count "SELECT Count(*) FROM subOut WHERE idOut=$($ids.credit)") -eq 2) 'لم تُحفظ أسطر التعديل'
            Need ((Read-Count "SELECT Count(*) FROM MasterOut WHERE idOut=$($ids.credit)") -eq 1) 'تكرّرت الفاتورة'
            'المبلغ 17,500'
        }
        & $step 'سند قبض من العميل (3,000)' {
            $ids.rec = (Write-As $mgr 'saveReceipt' @{ cls = 'تسديد'; name = $cust; amount = 3000; date = $today }).id
            "رقم $($ids.rec)"
        }
        & $step 'تعديل سند القبض (3,500)' {
            Write-As $mgr 'saveReceipt' @{ id = $ids.rec; cls = 'تسديد'; name = $cust; amount = 3500; date = $today } | Out-Null
            Need ([double](Read-One "SELECT mablak FROM mablakIn WHERE idS=$($ids.rec)") -eq 3500) 'لم يتغيّر المبلغ'
            'تمّ بنجاح'
        }
        & $step 'سند صرف للمورد (20,000)' {
            $ids.pay = (Write-As $mgr 'savePayment' @{ cls = 'تسديد'; name = $sup; amount = 20000; date = $today }).id
            "رقم $($ids.pay)"
        }
        & $step 'مصروف (1,500)' {
            $ids.exp = (Write-As $mgr 'savePayment' @{ cls = 'مصاريف متفرقة'; name = ''; amount = 1500; note = $t; date = $today }).id
            "رقم $($ids.exp)"
        }
        & $step 'تغيير اسم العميل ينتقل إلى فواتيره وسنداته' {
            Write-As $mgr 'saveCustomer' @{ id = $ids.cust; name = $cust2; mobile = '07711111111'; opening = 2000; type = 'جملة' } | Out-Null
            Need ((Read-Count "SELECT Count(*) FROM MasterOut WHERE TOname=$(Q $cust2)") -eq 1) 'ما زالت الفاتورة بالاسم القديم'
            Need ((Read-Count "SELECT Count(*) FROM mablakIn WHERE nameFrom=$(Q $cust2)") -eq 1) 'ما زال السند بالاسم القديم'
            Need ((Read-Count "SELECT Count(*) FROM MasterOut WHERE TOname=$(Q $cust)") -eq 0) 'ما زال هناك سجل بالاسم القديم'
            'تمّ بنجاح'
        }

        # a cashier with the default permissions (cash sale and print)
        $cashier = @{ user = $script:FT.user; admin = $false; perms = [string[]]$DefaultPerms }
        $refused = {
            param([string]$op, [hashtable]$d, [string]$expect)
            try { Write-As $cashier $op $d | Out-Null } catch {
                Need ($_.Exception.Message -match $expect) "رُفضت العملية لكن لسبب آخر: $($_.Exception.Message)"
                return 'رُفضت ✔'
            }
            throw 'حُفظت العملية مع أنه كان يجب رفضها!'
        }
        & $step 'الصلاحيات: الكاشير يبيع نقداً بالسعر المحدد' {
            $ids.cashier = (Write-As $cashier 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 1; price = 1100 }) }).id
            "رقم $($ids.cashier)"
        }
        & $step 'الصلاحيات: الكاشير لا يبيع بالآجل' { & $refused 'saveSale' @{ type = 'اجل'; customer = $cust2; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 1; price = 1100 }) } 'صلاحية' }
        & $step 'الصلاحيات: الكاشير لا يبيع بالجملة (كرتونة)' { & $refused 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'كرتونة'; qty = 1; price = 12000 }) } 'الجملة' }
        & $step 'الصلاحيات: الكاشير لا يغيّر السعر' { & $refused 'saveSale' @{ type = 'نقدي'; date = $today; lines = @(@{ item = $item; unit = 'قطعة'; qty = 1; price = 500 }) } 'السعر' }
        & $step 'الصلاحيات: الكاشير لا يحذف فاتورة' { & $refused 'deleteSale' @{ id = $ids.cash } 'صلاحية' }
        & $step 'الصلاحيات: الكاشير لا يشتري' { & $refused 'savePurchase' @{ type = 'اجل'; supplier = $sup; date = $today; lines = @(@{ item = $item; unit = 'كرتونة'; qty = 1; price = 8500 }) } 'صلاحية' }
        & $step 'الصلاحيات: الكاشير لا يعدّل الأصناف' { & $refused 'saveItem' @{ id = $ids.item; name = $item; unitL1 = 'كرتونة' } 'صلاحية' }
        & $step 'لا يمكن حذف صنف عليه حركات' {
            try { Write-As $mgr 'deleteItem' @{ id = $ids.item } | Out-Null } catch { return 'رُفضت ✔' }
            throw 'حُذف الصنف مع أن عليه فواتير!'
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
            if ($ids[$k]) { & $step "حذف فاتورة البيع رقم $($ids[$k])" { Write-As $mgr 'deleteSale' @{ id = $ids[$k] } | Out-Null; Need ((Read-Count "SELECT Count(*) FROM subOut WHERE idOut=$($ids[$k])") -eq 0) 'ما زالت هناك أسطر'; 'تمّ بنجاح' } }
        }
        if ($ids.pur) { & $step 'حذف فاتورة الشراء' { Write-As $mgr 'deletePurchase' @{ id = $ids.pur } | Out-Null; Need ((Read-Count "SELECT Count(*) FROM subIN WHERE IdIn=$($ids.pur)") -eq 0) 'ما زالت هناك أسطر'; 'تمّ بنجاح' } }
        if ($ids.rec) { & $step 'حذف سند القبض' { Write-As $mgr 'deleteReceipt' @{ id = $ids.rec } | Out-Null; 'تمّ بنجاح' } }
        foreach ($k in 'pay', 'exp') { if ($ids[$k]) { & $step "حذف سند الصرف رقم $($ids[$k])" { Write-As $mgr 'deletePayment' @{ id = $ids[$k] } | Out-Null; 'تمّ بنجاح' } } }
        if ($ids.item) { & $step 'حذف الصنف' { Write-As $mgr 'deleteItem' @{ id = $ids.item } | Out-Null; 'تمّ بنجاح' } }
        if ($ids.cust) { & $step 'حذف العميل' { Write-As $mgr 'deleteCustomer' @{ id = $ids.cust } | Out-Null; 'تمّ بنجاح' } }
        if ($ids.sup) { & $step 'حذف المورد' { Write-As $mgr 'deleteSupplier' @{ id = $ids.sup } | Out-Null; 'تمّ بنجاح' } }
        & $step 'لم يبقَ أي أثر للفحص' {
            $n = $script:FT.names
            $left = (Read-Count "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $n.customer)") + (Read-Count "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q ($script:FT.tag + ' عميل'))") +
                (Read-Count "SELECT Count(*) FROM shiraCode WHERE shiraCode=$(Q $n.supplier)") +
                (Read-Count "SELECT Count(*) FROM madaCode WHERE madaName=$(Q $n.item)") + (Read-Count "SELECT Count(*) FROM MasterOut WHERE strUserName=$(Q $script:FT.user)") +
                (Read-Count "SELECT Count(*) FROM mablakIn WHERE strUserName=$(Q $script:FT.user)") + (Read-Count "SELECT Count(*) FROM mablakOut WHERE strUserName=$(Q $script:FT.user)")
            Need ($left -eq 0) "ما زال هناك $left سجل"
            'تمّ بنجاح'
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
    # names only: password hashes never leave this computer
    Users      = 'UserName,Active'
}
$script:DataCache = $null

# Writing rows as JSON value by value in PowerShell gets slow with years
# of invoices; this small compiled part does it fast.
$JsonCode = @'
using System;
using System.Globalization;
using System.Text;
public static class LawhaJson {
    public static void Value(StringBuilder sb, object v) {
        if (v == null || v is DBNull) { sb.Append("null"); return; }
        string s = v as string;
        if (s != null) {
            sb.Append('"');
            foreach (char c in s) {
                if (c == '"' || c == '\\') { sb.Append('\\').Append(c); }
                else if (c < ' ' || c == (char)0x2028 || c == (char)0x2029) { sb.Append("\\u").Append(((int)c).ToString("x4")); }
                else { sb.Append(c); }
            }
            sb.Append('"');
            return;
        }
        if (v is DateTime) { sb.Append('"').Append(((DateTime)v).ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture)).Append('"'); return; }
        if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
        if (v is double || v is float) {
            double d = Convert.ToDouble(v, CultureInfo.InvariantCulture);
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); return;
        }
        IFormattable f = v as IFormattable;
        if (f != null) { sb.Append(f.ToString(null, CultureInfo.InvariantCulture)); return; }
        Value(sb, v.ToString());
    }
    // rows of a DAO GetRows array ([field, row]); true when one was written
    public static bool Rows(StringBuilder sb, object[,] a, bool comma) {
        int nc = a.GetLength(0), nr = a.GetLength(1);
        for (int r = 0; r < nr; r++) {
            if (comma) sb.Append(',');
            comma = true;
            sb.Append('[');
            for (int c = 0; c < nc; c++) { if (c > 0) sb.Append(','); Value(sb, a[c, r]); }
            sb.Append(']');
        }
        return comma;
    }
}
'@

function Export-Data {
    if (-not ('LawhaJson' -as [type])) { Add-Type -TypeDefinition $JsonCode }
    $p = Get-DbPath
    Need ($p -ne '') 'لم تُحدَّد قاعدة البيانات'
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
                $any = $false
                while (-not $rs.EOF) {
                    $a = $rs.GetRows(5000)
                    if ($a.GetLength(1) -eq 0) { break }
                    $any = [LawhaJson]::Rows($sb, $a, $any)
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
        "netsh advfirewall firewall delete rule name='Fr3oon' | Out-Null; " +
        "netsh advfirewall firewall add rule name='Fr3oon' dir=in action=allow protocol=TCP localport=$Port"
    try {
        $p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd)
    } catch {
        throw 'لم يوافق Windows. يجب الموافقة على رسالة "هل تسمح لهذا التطبيق…" (يتطلّب ذلك حساب مدير في Windows).'
    }
    Need ($p.ExitCode -eq 0) "تعذّر فتح الاتصال (الرمز $($p.ExitCode))"
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
    Need ($t -ne '') 'اكتب اسم الجهاز الرئيسي أو عنوان IP الخاص به'
    if ($t -notmatch ':\d+$') { $t = "${t}:$Port" }
    $url = "http://$t/"
    try {
        $wc = New-Object Net.WebClient
        $wc.Proxy = $null
        $wc.Encoding = [Text.Encoding]::UTF8
        $j = $wc.DownloadString($url + 'api/ping') | ConvertFrom-Json
    } catch {
        throw "لم يستجب الجهاز $t. تأكّد من أنه يعمل وأن البرنامج مفتوح عليه، وأن المدير فعّل «السماح للأجهزة الأخرى بالاتصال» في إعداداته، وأن الشبكة أو الـ VPN تصل بين الجهازين."
    }
    Need ($j.ok -and [string]$j.product -eq 'Fr3oon') "الجهاز $t ردّ، لكنه لا يشغّل Fr3oon."
    Need $j.licensed "Fr3oon غير مفعّل على الجهاز $t."
    Need $j.configured "لم تُعدّ قاعدة البيانات على الجهاز $t بعد."
    $script:Config.remoteUrl = $url
    Save-Config
    Write-LawhaLog "linked to main computer $url"
    return @{ url = $url; version = [string]$j.version; shopName = [string]$j.shopName }
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

    if (-not (Step 'قاعدة البيانات محددة وموجودة' { $p = Get-DbPath; Need ($p -ne '') 'لم تُحدَّد قاعدة البيانات'; $p })) { return , $steps.ToArray() }
    if (-not (Step 'محرك Access' { [void](Get-Engine); $script:EngineName })) { return , $steps.ToArray() }
    Step 'مجلد النسخ الاحتياطي' {
        $dir = Get-BackupDir
        Need ([string]$dir -ne '') 'لم يُحدَّد مجلد النسخ الاحتياطي'
        try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch { throw "تعذّر إنشاء مجلد النسخ الاحتياطي: $dir" }
        $probe = Join-Path $dir 'fr3oon-write-test.tmp'
        Set-Content -LiteralPath $probe 'ok'
        Remove-Item -LiteralPath $probe -Force
        $dir
    } | Out-Null

    $tag = 'فحص-النظام-' + (Get-Random -Maximum 99999)
    $u = 'فحص النظام'
    $script:st = @{}
    try {
        Use-Database -Rollback { param($db)
            Step 'إضافة صنف ومورد للفحص' {
                Op-SaveItem $db @{ name = "$tag صنف"; code = ''; cls = 'فحص'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 10; priceL1 = 10000; priceL2 = 1000; buyL1 = 9000; buyL2 = 900 } | Out-Null
                Op-SaveSupplier $db @{ name = "$tag مورد"; opening = 0 } | Out-Null
                $script:st.item = "$tag صنف"
                $script:st.supplier = "$tag مورد"
                "$($script:st.item) / $($script:st.supplier)"
            } | Out-Null
            $it = Get-MadaItem $db $script:st.item
            $small = if ($it.UnitL2) { [string]$it.UnitL2 } else { [string]$it.UnitL1 }
            $big = [string]$it.UnitL1
            $item = $script:st.item

            Step 'إضافة عميل' {
                $script:st.cust = (Op-SaveCustomer $db @{ name = $tag; mobile = '07700000000'; opening = 1000; type = 'جملة'; user = $u }).id
                Need ((Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $tag)") -eq 1) 'لم يُضف العميل'
                Need ([string](Get-Value $db "SELECT CMobile FROM bayeeCode WHERE id=$($script:st.cust)") -eq '07700000000') 'لم يُحفظ رقم الموبايل'
                Need ([int](Get-Value $db "SELECT MB FROM bayeeCode WHERE id=$($script:st.cust)") -eq 1000) 'لم يُحفظ الرصيد الافتتاحي'
                "رقم $($script:st.cust)"
            } | Out-Null
            Step 'فاتورة بيع آجلة' {
                $script:st.sale = (Op-SaveSale $db @{ type = 'اجل'; customer = $tag; date = $today; paid = 500; user = $u
                        lines = @(@{ item = $item; unit = $small; qty = 2; price = 1500 }) }).id
                Need ((Count $db "SELECT Count(*) FROM subOut WHERE idOut=$($script:st.sale)") -eq 1) 'لم يُضف سطر الفاتورة'
                Need ([string](Get-Value $db "SELECT TOname FROM MasterOut WHERE idOut=$($script:st.sale)") -eq $tag) 'لم يُحفظ اسم العميل في الفاتورة'
                Need ([string](Get-Value $db "SELECT OutType FROM MasterOut WHERE idOut=$($script:st.sale)") -eq 'اجل') 'لم يُحفظ نوع الفاتورة'
                Need ($null -ne (Get-Value $db "SELECT OutDate FROM MasterOut WHERE idOut=$($script:st.sale)")) 'لم يُحفظ تاريخ الفاتورة'
                Need ([int](Get-Value $db "SELECT Paid FROM MasterOut WHERE idOut=$($script:st.sale)") -eq 500) 'لم يُحفظ المبلغ المدفوع'
                Need ([double](Get-Value $db "SELECT QuntOut FROM subOut WHERE idOut=$($script:st.sale)") -eq 2) 'لم تُحفظ الكمية'
                Need ([double](Get-Value $db "SELECT Price FROM subOut WHERE idOut=$($script:st.sale)") -eq 1500) 'لم يُحفظ السعر'
                "رقم $($script:st.sale)"
            } | Out-Null
            Step 'تعديل فاتورة البيع' {
                Op-SaveSale $db @{ id = $script:st.sale; type = 'اجل'; customer = $tag; date = $today; paid = 0; user = $u
                    lines = @(@{ item = $item; unit = $small; qty = 3; price = 1500 }, @{ item = $item; unit = $big; qty = 1; price = 1000 }) } | Out-Null
                Need ((Count $db "SELECT Count(*) FROM subOut WHERE idOut=$($script:st.sale)") -eq 2) 'لم يُحفظ التعديل'
                'تمّ بنجاح'
            } | Out-Null
            Step 'فاتورة بيع نقدية' {
                $script:st.cash = (Op-SaveSale $db @{ type = 'نقدي'; date = $today; user = $u; lines = @(@{ item = $item; unit = $small; qty = 1; price = 1000 }) }).id
                "رقم $($script:st.cash)"
            } | Out-Null
            Step 'سند قبض' {
                $script:st.rec = (Op-SaveReceipt $db @{ cls = 'تسديد'; name = $tag; amount = 2500; date = $today; user = $u }).id
                "رقم $($script:st.rec)"
            } | Out-Null
            Step 'سند صرف (مصروف)' {
                $script:st.pay = (Op-SavePayment $db @{ cls = 'مصاريف متفرقة'; name = ''; amount = 100; note = $tag; date = $today; user = $u }).id
                Need ([double](Get-Value $db "SELECT mablak FROM mablakOut WHERE idS=$($script:st.pay)") -eq 100) 'لم يُحفظ المبلغ'
                Need ([string](Get-Value $db "SELECT classS FROM mablakOut WHERE idS=$($script:st.pay)") -eq 'مصاريف متفرقة') 'لم يُحفظ نوع المصروف'
                "رقم $($script:st.pay)"
            } | Out-Null
            if ($script:st.supplier) {
                Step 'فاتورة شراء وتحديث سعر الشراء' {
                    $script:st.pur = (Op-SavePurchase $db @{ type = 'اجل'; supplier = $script:st.supplier; date = $today; user = $u; updatePrices = $true
                            lines = @(@{ item = $item; unit = $big; qty = 1; price = 1 }) }).id
                    "رقم $($script:st.pur)"
                } | Out-Null
            }
            Step 'إضافة صنف وتعديله وحذفه' {
                $iid = (Op-SaveItem $db @{ name = $tag; code = ''; cls = 'فحص'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 10; priceL1 = 10000; priceL2 = 1000; buyL1 = 9000; buyL2 = 900 }).id
                Op-SaveItem $db @{ id = $iid; name = "$tag-2"; code = ''; cls = 'فحص'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 10; priceL1 = 11000; priceL2 = 1100; buyL1 = 9000; buyL2 = 900 } | Out-Null
                Op-DeleteItem $db @{ id = $iid } | Out-Null
                'تمّ بنجاح'
            } | Out-Null
            Step 'حذف الفواتير والسندات' {
                Op-DeleteSale $db @{ id = $script:st.sale } | Out-Null
                Op-DeleteSale $db @{ id = $script:st.cash } | Out-Null
                Op-DeleteReceipt $db @{ id = $script:st.rec } | Out-Null
                Op-DeletePayment $db @{ id = $script:st.pay } | Out-Null
                if ($script:st.pur) { Op-DeletePurchase $db @{ id = $script:st.pur } | Out-Null }
                Op-DeleteCustomer $db @{ id = $script:st.cust } | Out-Null
                Need ((Count $db "SELECT Count(*) FROM MasterOut WHERE idOut=$($script:st.sale)") -eq 0) 'لم تُحذف الفاتورة'
                'تمّ بنجاح'
            } | Out-Null
        }
    } catch {
        $steps.Add(@{ name = 'فتح قاعدة البيانات للكتابة'; ok = $false; msg = $_.Exception.Message })
    }
    Step 'عادت قاعدة البيانات كما كانت (أُلغيت التجربة)' {
        $left = Use-Database -ReadOnly { param($db) Count $db "SELECT Count(*) FROM bayeeCode WHERE bayeeCode=$(Q $tag)" }
        Need ($left -eq 0) 'ما زالت بيانات التجربة في قاعدة البيانات!'
        'تمّ بنجاح'
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

# Windows' folder window, in front of everything (as Choose-File).
function Choose-Folder {
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form -Property @{
        TopMost = $true; ShowInTaskbar = $true; Opacity = 0; StartPosition = 'CenterScreen'; Size = (New-Object System.Drawing.Size 1, 1)
        Text = 'اختيار مجلد — Fr3oon'; FormBorderStyle = 'None'
    }
    $owner.Show()
    try {
        if (-not ('LawhaForeground' -as [type])) { Add-Type -TypeDefinition $ForegroundCode }
        [LawhaForeground]::Bring($owner.Handle)
    } catch { }
    $owner.Activate()
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog -Property @{ Description = 'اختر المجلد'; ShowNewFolderButton = $true }
    try {
        if ($dlg.ShowDialog($owner) -ne 'OK') { return '' }
        return $dlg.SelectedPath
    } finally { $owner.Close(); $owner.Dispose() }
}

function Choose-File {
    Add-Type -AssemblyName System.Windows.Forms
    # an invisible owner that sits on top of everything and has a taskbar
    # button, so the dialog can't end up hidden behind the program
    $owner = New-Object System.Windows.Forms.Form -Property @{
        TopMost = $true; ShowInTaskbar = $true; Opacity = 0; StartPosition = 'CenterScreen'; Size = (New-Object System.Drawing.Size 1, 1)
        Text = 'اختيار قاعدة البيانات — Fr3oon'; FormBorderStyle = 'None'
    }
    $owner.Show()
    try {
        if (-not ('LawhaForeground' -as [type])) { Add-Type -TypeDefinition $ForegroundCode }
        [LawhaForeground]::Bring($owner.Handle)
    } catch { }
    $owner.Activate()
    $dlg = New-Object System.Windows.Forms.OpenFileDialog -Property @{
        Title  = 'اختر قاعدة بيانات Fr3oon (fr3oon.accdb)'
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
    if ($cur) { $out.Add(@{ name = 'مجلد قاعدة البيانات الحالية'; path = (Split-Path $cur -Parent); kind = 'folder' }) }
    $out.Add(@{ name = 'الشبكة (الأجهزة الأخرى)'; path = 'net:'; kind = 'network' })
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
        Need ($null -ne $p) "لم يُعثر على الجهاز $pc"
        return , @($p.Value.PSObject.Properties.Name)
    }
    if (-not ('LawhaNetShares' -as [type])) { Add-Type -TypeDefinition $NetShareCode }
    try {
        return , @(Invoke-Limited { param($s) [LawhaNetShares]::List($s) } "\\$pc" 15000)
    } catch {
        $m = [string]$_
        if ($m -eq 'timeout' -or $m -match 'code (53|51|1231|1232|2114)\b') { throw "تعذّر الوصول إلى الجهاز $pc. تأكّد من أنه يعمل وعلى الشبكة نفسها، أو جرّب عنوان IP الخاص به." }
        if ($m -match 'code (5|1326|1327|1331)\b') { throw "الجهاز $pc يتطلّب اسم مستخدم وكلمة مرور. افتحه مرة من File Explorer (اكتب \\$pc في شريط العنوان) واحفظ كلمة المرور، ثم عُد إلى هنا." }
        throw "تعذّرت قراءة المجلدات المشتركة على الجهاز $pc ($m)"
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
    Need (Test-Path -LiteralPath $dir -PathType Container) "المجلد غير موجود: $(if ($shown) { $shown } else { $dir })"
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
    $roots.Add(@{ p = $DefaultDbDir; d = 0 })
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
        $items = Get-ChildItem -LiteralPath $r.p -Filter 'fr3oon*.accdb' -File -Recurse -Depth $r.d -ErrorAction SilentlyContinue
        foreach ($f in $items) {
            if ($f.FullName -match '\\(Backups|Windows|Program Files[^\\]*|ProgramData|AppData|\$Recycle\.Bin)\\') { continue }
            if ($seen.ContainsKey($f.FullName)) { continue }
            $seen[$f.FullName] = $true
            $found.Add(@{ name = $f.Name; path = $f.FullName; size = $f.Length; modified = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm'); t = $f.LastWriteTime })
        }
    }
    $sorted = $found | Sort-Object @{ Expression = { $_.name -ne 'fr3oon.accdb' } }, @{ Expression = { $_.t }; Descending = $true } | Select-Object -First 25
    return , @($sorted | ForEach-Object { @{ name = $_.name; path = $_.path; size = $_.size; modified = $_.modified } })
}

function Set-Database([string]$file) {
    Need (Test-DbFile $file) "هذا ليس ملف Access ‏(accdb): $file"
    Need (Test-ShopDatabase $file) 'هذا الملف ليس قاعدة بيانات Fr3oon.'
    # ProviderPath: a plain path also for \\PC\share (Path would add "FileSystem::")
    Close-Db
    $script:Config.dbPath = (Resolve-Path -LiteralPath $file).ProviderPath
    Save-Config
    Close-Engine
    $script:BackupDay = ''
    $script:ShopCache = $null
    $script:DataCache = $null
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
$LocalOnly = @('/api/choose-file', '/api/candidates', '/api/browse', '/api/choose-folder', '/api/shutdown', '/api/open-backups',
    '/api/remote', '/api/remote-access', '/api/fulltest', '/api/fulltest-data', '/api/selftest', '/api/activate', '/api/setup',
    '/api/backups', '/api/backup-now', '/api/restore', '/api/update-install')

function Get-State($req) {
    $remote = Test-RemoteRequest $req
    $lic = Get-License
    $p = Get-DbPath
    $shop = ''
    if ($p) { try { $shop = (Get-Shop).shopName } catch { } }
    $st = @{
        ok = $true; product = $Product; version = $Version; test = [bool]$env:LAWHA_FAKEDAO
        licensed = [bool]$lic.ok; licenseName = [string]$lic.name; licenseExpiry = [string]$lic.expiry
        licenseError = $(if ($lic.ok) { '' } else { [string]$lic.error }); licenseExpired = [bool]$lic.expired
        configured = ($p -ne ''); shopName = $shop; allowRemote = [bool]$script:Config.allowRemote
    }
    if (-not $remote) {
        $st.machine = Get-MachineCode
        $st.remoteUrl = $script:Config.remoteUrl
        $st.dbPath = $p
        $st.defaultDbDir = $DefaultDbDir
        $st.defaultBackupDir = $DefaultBackupDir
    }
    return $st
}

function Get-AdminCount { $u = (Get-Shop).users; return @($u.Keys | Where-Object { $u[$_].admin -and $u[$_].active }).Count }

function Remove-UserSessions([string]$user) {
    foreach ($t in @($script:Sessions.Keys)) { if ($script:Sessions[$t].user -eq $user) { $script:Sessions.Remove($t) } }
}

# Requests allowed before the program is activated.
$NoLicense = @('/api/activate', '/api/remote', '/api/shutdown')

function Handle($ctx) {
    $req = $ctx.Request
    if (-not (Test-HostAllowed $req)) {
        return Send-Json $ctx 403 @{ ok = $false; error = 'forbidden host' }
    }
    $path = $req.Url.AbsolutePath
    if ((Test-RemoteRequest $req) -and $LocalOnly -contains $path) {
        return Send-Json $ctx 200 @{ ok = $false; error = 'هذه العملية تُجرى من الجهاز الرئيسي نفسه، لا من جهاز آخر.' }
    }
    if ($path -eq '/') {
        return Send $ctx 200 ([IO.File]::ReadAllBytes($AppFile)) 'text/html; charset=utf-8'
    }
    if ($path -eq '/api/ping' -or $path -eq '/api/state') { return Send-Json $ctx 200 (Get-State $req) }
    # Everything else must come from the app itself: a custom header forces a
    # CORS preflight, which this server never approves.
    if ($req.Headers['X-Lawha'] -ne '1') { return Send-Json $ctx 403 @{ ok = $false; error = 'forbidden' } }

    try {
        if (-not (Get-License).ok -and $NoLicense -notcontains $path) {
            return Send-Json $ctx 200 @{ ok = $false; license = $true; error = (Get-License).error }
        }
        switch ($path) {
            '/api/activate' {
                $b = Read-Body $req
                $l = Set-License ([string]$b.key)
                return Send-Json $ctx 200 @{ ok = $true; name = $l.name; expiry = $l.expiry }
            }
            '/api/setup' {
                Need ((Get-DbPath) -eq '') 'قاعدة البيانات مُعدّة مسبقاً على هذا الجهاز.'
                $b = Read-Body $req
                $shop = Text ([string]$b.shopName) 60 'اسم المحل'
                Need ($shop -ne '') 'اسم المحل مطلوب'
                $admin = Text ([string]$b.admin) 45 'اسم المستخدم'
                Need ($admin -ne '') 'اسم المدير مطلوب'
                Need (([string]$b.password).Length -ge 4) 'كلمة المرور يجب أن تكون 4 أحرف على الأقل'
                $dbDir = if ([string]$b.dbDir) { ([string]$b.dbDir).Trim() } else { $DefaultDbDir }
                $bkDir = if ([string]$b.backupDir) { ([string]$b.backupDir).Trim() } else { $DefaultBackupDir }
                $file = Join-Path $dbDir 'fr3oon.accdb'
                Need (-not (Test-Path -LiteralPath $file)) "يوجد ملف قاعدة بيانات في هذا المجلد ($file). لاستخدامه اختر «فتح قاعدة بيانات موجودة»."
                try { New-Item -ItemType Directory -Force -Path $bkDir | Out-Null } catch { throw "تعذّر إنشاء مجلد النسخ الاحتياطي: $bkDir" }
                New-ShopDatabase $file $shop $admin ([string]$b.password)
                $script:Config.dbPath = $file
                $script:Config.backupDir = $bkDir
                Save-Config
                $script:ShopCache = $null
                Write-LawhaLog "new shop database: $file (backups: $bkDir)"
                Start-Backup -Now
                return Send-Json $ctx 200 @{ ok = $true; dbPath = $file; backupDir = $bkDir }
            }
            '/api/choose-folder' {
                $dir = if ($env:LAWHA_FAKEDAO) { '' } else { Choose-Folder }
                if (-not $dir) { return Send-Json $ctx 200 @{ ok = $false; error = 'لم يُختر مجلد' } }
                return Send-Json $ctx 200 @{ ok = $true; dir = $dir }
            }
            # Opening an existing Fr3oon database (another computer's, or after
            # reinstalling): this computer's setting, for anyone at it.
            { $_ -in '/api/choose-file', '/api/candidates', '/api/browse' } {
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
                if (-not $file) { return Send-Json $ctx 200 @{ ok = $false; error = 'لم يُختر ملف' } }
                Set-Database $file
                return Send-Json $ctx 200 @{ ok = $true; file = [IO.Path]::GetFileName($file); path = $script:Config.dbPath }
            }
            '/api/users' {
                Need ((Get-DbPath) -ne '') 'لم تُعدّ قاعدة البيانات بعد'
                return Send-Json $ctx 200 @{ ok = $true; users = (Get-UserNames) }
            }
            '/api/login' {
                $b = Read-Body $req
                $user = [string]$b.user
                Need ($user -ne '') 'اختر المستخدم'
                if (-not (Test-Login $user ([string]$b.password))) {
                    Write-LawhaLog "login FAILED $user"
                    return Send-Json $ctx 200 @{ ok = $false; error = 'كلمة المرور غير صحيحة' }
                }
                $t = New-Token
                $permText = Get-PermText $user
                $script:Sessions[$t] = @{ user = $user; admin = (Test-Admin $user); perms = [string[]](Get-Perms $user) }
                Write-LawhaLog "login $user ($(if (Test-Admin $user) { 'manager' } else { $permText }))"
                return Send-Json $ctx 200 @{ ok = $true; token = $t; user = $user; admin = (Test-Admin $user); perms = $permText }
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
        if (-not $s) { return Send-Json $ctx 401 @{ ok = $false; error = 'سجّل الدخول أولاً'; login = $true } }

        switch ($path) {
            '/api/me' {
                return Send-Json $ctx 200 @{ ok = $true; user = $s.user; admin = $s.admin; perms = (Get-PermText $s.user) }
            }
            '/api/logout' {
                $script:Sessions.Remove([string]$req.Headers['X-Token'])
                return Send-Json $ctx 200 @{ ok = $true }
            }
            '/api/data' {
                return Send-Compressed $ctx (Export-Data) 'application/json; charset=utf-8'
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
            '/api/password' {
                $b = Read-Body $req
                Need (Test-Login $s.user ([string]$b.old)) 'كلمة المرور الحالية غير صحيحة'
                Use-Database { param($db) Save-User $db @{ oldName = $s.user; name = $s.user; password = [string]$b.new; isAdmin = (Test-Admin $s.user); active = $true } } | Out-Null
                Write-LawhaLog "$($s.user)  changed own password"
                return Send-Json $ctx 200 @{ ok = $true }
            }
            '/api/settings' {
                $remote = Test-RemoteRequest $req
                if ($req.HttpMethod -eq 'POST') {
                    Need $s.admin 'الإعدادات تحتاج صلاحية المدير'
                    $b = Read-Body $req
                    if ($null -ne $b.shopName) {
                        $name = Text ([string]$b.shopName) 60 'اسم المحل'
                        Need ($name -ne '') 'اسم المحل مطلوب'
                        Use-Database { param($db) Set-ShopSetting $db 'shopName' $name } | Out-Null
                        $script:ShopCache = $null
                    }
                    if (($null -ne $b.backupDir -or $null -ne $b.keepBackups) -and -not $remote) {
                        if ($null -ne $b.backupDir) {
                            $dir = ([string]$b.backupDir).Trim()
                            Need ($dir -ne '') 'اختر مجلد النسخ الاحتياطي'
                            try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch { throw "تعذّر إنشاء المجلد: $dir" }
                            $script:Config.backupDir = $dir
                            $script:BackupDay = ''
                        }
                        if ($null -ne $b.keepBackups) { $script:Config.keepBackups = [math]::Max(3, [math]::Min(365, [int]$b.keepBackups)) }
                        Save-Config
                    }
                    Write-LawhaLog "$($s.user)  settings saved"
                }
                $lic = Get-License
                $r = @{
                    ok = $true; shopName = (Get-Shop).shopName; version = $Version; product = $Product; engine = $script:EngineName
                    allPerms = ($AllPerms -join ','); defaultPerms = ($DefaultPerms -join ',')
                    licenseName = [string]$lic.name; licenseExpiry = [string]$lic.expiry
                }
                if ($s.admin -and -not $remote) {
                    $r.dbPath = Get-DbPath; $r.dataDir = $DataDir; $r.machine = Get-MachineCode
                    $r.backupDir = Get-BackupDir; $r.keepBackups = [int]$script:Config.keepBackups
                    $r.backupError = $script:BackupError; $r.lastBackup = [string]$script:BackupDay; $r.updateUrl = Get-UpdateUrl
                }
                return Send-Json $ctx 200 $r
            }
            '/api/users-list' {
                Need $s.admin 'إدارة المستخدمين تحتاج صلاحية المدير'
                $u = (Get-Shop).users
                $list = @($u.Keys | Sort-Object | ForEach-Object { @{ name = $_; admin = $u[$_].admin; active = $u[$_].active; perms = $u[$_].perms } })
                return Send-Json $ctx 200 @{ ok = $true; users = $list; allPerms = ($AllPerms -join ','); defaultPerms = ($DefaultPerms -join ','); me = $s.user }
            }
            '/api/user-save' {
                Need $s.admin 'إدارة المستخدمين تحتاج صلاحية المدير'
                $b = Read-Body $req
                $old = [string]$b.oldName
                $isAdmin = [bool]$b.isAdmin
                $active = ($null -eq $b.active -or [bool]$b.active)
                if ($old -eq $s.user) { Need ($isAdmin -and $active) 'لا يمكنك إلغاء صلاحية المدير أو إيقاف حسابك أنت.' }
                $u = (Get-Shop).users
                if ($old -and $u[$old] -and $u[$old].admin -and $u[$old].active -and -not ($isAdmin -and $active)) {
                    Need ((Get-AdminCount) -gt 1) 'يجب أن يبقى مدير واحد على الأقل.'
                }
                $perms = if ($null -ne $b.perms) { [string]$b.perms } else { $null }
                Use-Database { param($db) Save-User $db @{ oldName = $old; name = [string]$b.name; password = [string]$b.password; isAdmin = $isAdmin; perms = $perms; active = $active } } | Out-Null
                if ($old -and ($old -ne [string]$b.name -or -not $active)) { Remove-UserSessions $old }
                Write-LawhaLog "$($s.user)  user saved: $([string]$b.name)$(if ($old -and $old -ne [string]$b.name) { " (was $old)" })"
                return Send-Json $ctx 200 @{ ok = $true }
            }
            '/api/user-delete' {
                Need $s.admin 'إدارة المستخدمين تحتاج صلاحية المدير'
                $b = Read-Body $req
                $name = [string]$b.name
                Need ($name -ne $s.user) 'لا يمكنك حذف حسابك أنت.'
                $u = (Get-Shop).users[$name]
                Need ($null -ne $u) "المستخدم غير موجود: $name"
                if ($u.admin -and $u.active) { Need ((Get-AdminCount) -gt 1) 'يجب أن يبقى مدير واحد على الأقل.' }
                Use-Database { param($db) $db.Execute("DELETE FROM Users WHERE UserName=$(Q $name)", $dbFailOnError) } | Out-Null
                $script:ShopCache = $null
                Remove-UserSessions $name
                Write-LawhaLog "$($s.user)  user deleted: $name"
                return Send-Json $ctx 200 @{ ok = $true }
            }
            '/api/backups' {
                Need $s.admin 'النسخ الاحتياطي يحتاج صلاحية المدير'
                Update-Backup
                return Send-Json $ctx 200 @{ ok = $true; dir = (Get-BackupDir); backups = (Get-Backups); running = [bool]$script:BackupJob; error = $script:BackupError; keep = [int]$script:Config.keepBackups }
            }
            '/api/backup-now' {
                Need $s.admin 'النسخ الاحتياطي يحتاج صلاحية المدير'
                Wait-Backup 600
                Start-Backup -Now
                Wait-Backup 600
                Need (-not $script:BackupError) "تعذّر النسخ: $($script:BackupError)"
                Write-LawhaLog "$($s.user)  backup now"
                return Send-Json $ctx 200 @{ ok = $true; backups = (Get-Backups) }
            }
            '/api/restore' {
                Need $s.admin 'الاستعادة تحتاج صلاحية المدير'
                $b = Read-Body $req
                $r = Restore-Backup ([string]$b.name)
                return Send-Json $ctx 200 (@{ ok = $true } + $r)
            }
            '/api/open-backups' {
                Need $s.admin 'تحتاج صلاحية المدير'
                $dir = Get-BackupDir
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
                if (-not $env:LAWHA_FAKEDAO) { Start-Process explorer.exe $dir }
                return Send-Json $ctx 200 @{ ok = $true; dir = $dir }
            }
            '/api/update-check' {
                Need $s.admin 'التحديث يحتاج صلاحية المدير'
                return Send-Json $ctx 200 (@{ ok = $true } + (Get-UpdateInfo))
            }
            '/api/update-install' {
                Need $s.admin 'التحديث يحتاج صلاحية المدير'
                Wait-Backup 600
                Start-Backup -Now -Label '-before-update'
                Wait-Backup 600
                $r = Install-Update
                return Send-Json $ctx 200 (@{ ok = $true } + $r)
            }
            '/api/selftest' {
                Need $s.admin 'فحص النظام يحتاج صلاحية المدير'
                $steps = Invoke-SelfTest
                $ok = -not ($steps | Where-Object { -not $_.ok })
                Write-LawhaLog "$($s.user)  selftest $(if ($ok) { 'PASSED' } else { 'FAILED' })"
                return Send-Json $ctx 200 @{ ok = $true; passed = $ok; steps = $steps; engine = $script:EngineName }
            }
            '/api/fulltest' {
                Need $s.admin 'الفحص الشامل يحتاج صلاحية المدير'
                $b = Read-Body $req
                $phase = [string]$b.phase
                $r = switch ($phase) {
                    'start' { Start-FullTest }
                    'run' { Invoke-FullTestRun }
                    'clean' { Invoke-FullTestClean }
                    'stop' { Stop-FullTest; @{} }
                    default { throw "مرحلة غير معروفة: $phase" }
                }
                Write-LawhaLog "$($s.user)  fulltest $phase$(if ($r.steps) { ' ' + (@($r.steps | Where-Object { -not $_.ok }).Count) + ' failed' })"
                return Send-Json $ctx 200 (@{ ok = $true } + $r)
            }
            '/api/fulltest-data' {
                Need $s.admin 'الفحص الشامل يحتاج صلاحية المدير'
                $bytes = Use-TestCopy { Export-Data }
                return Send-Compressed $ctx $bytes 'application/json; charset=utf-8'
            }
            '/api/remote-access' {
                Need $s.admin 'تحتاج صلاحية المدير'
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
                Need $s.admin 'تحتاج صلاحية المدير'
                return Send-Json $ctx 200 @{ ok = $true; allowRemote = [bool]$script:Config.allowRemote; listening = $script:ListenMode; addresses = (Get-MyAddresses); port = $Port }
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
    Write-Host "  Fr3oon $Version  http://localhost:$Port/" -ForegroundColor Cyan
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
