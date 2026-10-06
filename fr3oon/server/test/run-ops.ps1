# Runs the helper's work against a new Fr3oon database on the test engine
# (FakeDao): the license, creating the database, users and passwords, every
# write operation (the rows each one leaves behind, the validation errors,
# the rollback on failure, the cashier/manager rules), the data for other
# devices, the full test, backups and restore, online updates and the
# self-test.
#
# Usage: pwsh server/test/run-ops.ps1        (KEEP_TMP=1 keeps the temp folder
# for test/fulltest.test.mjs and test/data-export.test.mjs)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('fr3oon-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$env:LAWHA_FAKEDAO = 'new'
$env:LAWHA_TESTKEY = Join-Path $PSScriptRoot 'test-vendor-key.json'
$env:LAWHA_FAKEMACHINE = 'RUN-OPS-PC'
$env:LAWHA_FAKEUPDATE = '1'

. (Join-Path (Split-Path $PSScriptRoot -Parent) 'server.ps1') -DataDir (Join-Path $tmp 'data')

$script:pass = 0
function Assert([bool]$cond, [string]$msg) {
    if (-not $cond) { throw "FAIL: $msg" }
    $script:pass++
    Write-Host "  ok  $msg"
}
function Assert-Throws([scriptblock]$body, [string]$pattern, [string]$msg) {
    try { & $body } catch {
        if ($_.Exception.Message -match $pattern) { $script:pass++; Write-Host "  ok  $msg  ($($_.Exception.Message))"; return }
        throw "FAIL: $msg — wrong error: $($_.Exception.Message)"
    }
    throw "FAIL: $msg — no error"
}
function Rows([string]$t) { return , (Get-FakeRows $script:Engine $t) }
function Row([string]$t, [string]$col, $val) { return (Rows $t) | Where-Object { $_[$col] -eq $val } | Select-Object -First 1 }
function W([string]$op, [hashtable]$d) { $d.user = 'نور'; return Invoke-Write $op ([pscustomobject]$d) }
function Sign([string[]]$a) {
    $out = & node (Join-Path $root 'test/sign.mjs') @a
    if ($LASTEXITCODE) { throw "sign.mjs failed: $out" }
    return ($out -join "`n")
}
$key = $env:LAWHA_TESTKEY
$today = Get-Date -Format 'yyyy-MM-dd'

Write-Host "`n== license"
$machine = Get-MachineCode
Assert ($machine -match '^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$') "machine code $machine"
Assert (-not (Get-License).ok) 'not activated at first'
Assert-Throws { Set-License 'abc' } 'غير صحيح' 'not a key'
Assert-Throws { Set-License (Sign 'license', $key, 'ABCD-EFGH-JKLM-NPQR', 'محل آخر') } 'لجهاز آخر' 'key for another computer'
Assert-Throws { Set-License (Sign 'license', $key, $machine, 'محل', '2020-01-01') } 'انتهت' 'expired key'
$good = Sign 'license', $key, $machine, 'محل الاختبار', '2099-12-31'
$p = $good.Split('.')
$bad = (ConvertTo-Json -Compress @{ p = 'Fr3oon'; m = $machine; n = 'محل الاختبار'; e = ''; i = $today })
$badB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bad)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
Assert-Throws { Set-License "$badB64.$($p[1])" } 'غير صحيح' 'expiry removed from a signed key: signature fails'
Set-License $good | Out-Null
$l = Get-License
Assert ($l.ok -and $l.name -eq 'محل الاختبار' -and $l.expiry -eq '2099-12-31') 'valid key activates'
Assert (Test-Path -LiteralPath $LicenseFile) 'license kept on disk'
$script:LicenseCache = $null
Assert ((Get-License).ok) 'read back from disk'

Write-Host "`n== new database"
$dbFile = Join-Path $tmp 'db/fr3oon.accdb'
New-ShopDatabase $dbFile 'محل الاختبار' 'نور' 'test'
$script:Config.dbPath = $dbFile
$script:Config.backupDir = Join-Path $tmp 'backups'
$script:Config.keepBackups = 3
Assert (Test-ShopDatabase $dbFile) 'a Fr3oon database'
$names = @(Use-Database -ReadOnly { param($db) Get-TableNames $db })
foreach ($t in $Schema.Keys) { Assert ($names -contains $t) "table $t" }
Assert ((Get-Shop).shopName -eq 'محل الاختبار') 'shop name kept in the database'
Assert ((Rows 'quodCodeIn').Count -eq $DefaultClassesIn.Count -and (Rows 'quodCodeOut').Count -eq $DefaultClassesOut.Count) 'default receipt and payment classes'
Assert-Throws { New-ShopDatabase $dbFile 'x' 'y' 'zzzz' } 'مسبقاً' 'never over an existing file'
Set-Content -LiteralPath (Join-Path $tmp 'other.accdb') -Value '{"something":"else"}'
Assert (-not (Test-ShopDatabase (Join-Path $tmp 'other.accdb'))) 'another file is not taken for a Fr3oon database'

Write-Host "`n== users"
Assert (((Get-UserNames) -join ',') -eq 'نور') 'the first manager'
Assert ((Test-Login 'نور' 'test') -and (Test-Admin 'نور')) 'manager signs in'
Assert (-not (Test-Login 'نور' 'TEST')) 'password is case-sensitive'
Assert (-not (Test-Login 'نور' '')) 'empty password refused'
Assert (-not (Test-Login 'غير موجود' 'test')) 'unknown user refused'
$u = Row 'Users' 'UserName' 'نور'
Assert ($u.PassHash -and $u.PassHash -notmatch 'test' -and $u.Salt) 'password kept salted and hashed'
Use-Database { param($db) Save-User $db @{ name = 'كاشير1'; password = '1111'; isAdmin = $false; perms = 'pos,sale_cash,print' } } | Out-Null
Assert ((Test-Login 'كاشير1' '1111') -and -not (Test-Admin 'كاشير1')) 'cashier added'
Assert ((Row 'Users' 'UserName' 'كاشير1').Salt -ne $u.Salt) 'each user has their own salt'
Assert-Throws { Use-Database { param($db) Save-User $db @{ name = 'كاشير1'; password = '2222' } } } 'يوجد مستخدم' 'duplicate user'
Assert-Throws { Use-Database { param($db) Save-User $db @{ name = 'جديد' } } } 'كلمة المرور مطلوبة' 'a new user needs a password'
Assert-Throws { Use-Database { param($db) Save-User $db @{ name = 'جديد'; password = '12' } } } '4 أحرف' 'short password'
Use-Database { param($db) Save-User $db @{ oldName = 'كاشير1'; name = 'كاشير 1'; isAdmin = $false; active = $false } } | Out-Null
Assert (-not (Test-Login 'كاشير1' '1111') -and -not (Test-Login 'كاشير 1' '1111')) 'renamed and stopped: no sign-in'
Assert ((Get-PermText 'كاشير 1') -eq 'pos,sale_cash,print') 'permissions kept through the rename'
Use-Database { param($db) Save-User $db @{ oldName = 'كاشير 1'; name = 'كاشير1'; active = $true } } | Out-Null
Assert (Test-Login 'كاشير1' '1111') 'active again, same password'
Assert ((Get-AdminCount) -eq 1) 'one manager'

Write-Host "`n== items, customers, suppliers"
$r = W 'saveItem' @{ name = 'بيض أحمر كبير'; code = '6281000000011'; cls = 'ألبان وبيض'; unitL1 = 'كرتونة'; unitL2 = 'طبقة'; fill = 12; priceL1 = 84000; priceL2 = 7500; buyL1 = 80000; buyL2 = 6667 }
$egg = Row 'madaCode' 'ID' $r.id
Assert ($egg.madaName -eq 'بيض أحمر كبير' -and $egg.IDcode -eq '6281000000011' -and $egg.price -eq 84000 -and $egg.priceSeeat -eq 7500 -and $egg.Fill -eq 12 -and $egg.BpriceL1 -eq 80000 -and $egg.UnitL2 -eq 'طبقة') 'item fields'
W 'saveItem' @{ name = 'برغر لحم'; code = '6281000000028'; cls = 'مجمدات'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 24; priceL1 = 120000; priceL2 = 5500; buyL1 = 100000; buyL2 = 4167 } | Out-Null
W 'saveItem' @{ name = 'كبد دجاج'; code = '6281000000035'; cls = 'مجمدات'; unitL1 = 'كرتونة'; unitL2 = 'كيس'; fill = 10; priceL1 = 30000; priceL2 = 3500; buyL1 = 25000; buyL2 = 2500 } | Out-Null
W 'saveItem' @{ name = 'صدر دجاج'; code = '6281000000042'; cls = 'مجمدات'; unitL1 = 'كرتونة'; unitL2 = 'كيس'; fill = 8; priceL1 = 64000; priceL2 = 8500; buyL1 = 60000; buyL2 = 7500 } | Out-Null
W 'saveItem' @{ name = 'ماء صغير'; code = '6281000000059'; cls = 'مشروبات'; unitL1 = 'قنينة'; priceL1 = 250; buyL1 = 180 } | Out-Null
Assert ((Row 'madaCode' 'madaName' 'ماء صغير').UnitL2 -eq 'قنينة') 'one unit: small unit = big unit'
W 'saveCustomer' @{ name = 'أبو علي'; mobile = '07701234567'; opening = 0; type = 'مفرد' } | Out-Null
W 'saveSupplier' @{ name = 'شركة الدواجن'; opening = 0 } | Out-Null
$burger = Row 'madaCode' 'madaName' 'برغر لحم'
$liver = Row 'madaCode' 'madaName' 'كبد دجاج'
$counts = @{}
foreach ($t in 'MasterOut', 'subOut', 'MasterIn', 'subIN', 'mablakIn', 'mablakOut', 'bayeeCode', 'shiraCode', 'madaCode') { $counts[$t] = (Rows $t).Count }

Write-Host "`n== sale (credit)"
$r = W 'saveSale' @{ type = 'اجل'; customer = 'أبو علي'; date = $today; paid = '10000'; note = 'تجربة'
    lines = @(@{ item = 'بيض أحمر كبير'; unit = 'كرتونة'; qty = 3; price = 84000 }, @{ item = 'برغر لحم'; unit = 'قطعة'; qty = 1.5; price = 5500 }) }
$sale = Row 'MasterOut' 'idOut' $r.id
Assert ($r.id -gt 0) "new invoice id $($r.id)"
Assert ($sale.TOname -eq 'أبو علي' -and $sale.OutType -eq 'اجل' -and $sale.Paid -eq 10000) 'master: customer, type, paid'
Assert ($sale.strUserName -eq 'نور' -and $sale.note -eq 'تجربة') 'master: user, note'
Assert ($sale.OutDate.ToString('yyyy-MM-dd') -eq $today -and $sale.timeS -is [datetime]) 'master: dates'
$lines = @((Rows 'subOut') | Where-Object { $_.idOut -eq $r.id })
Assert ($lines.Count -eq 2) '2 lines'
$l1 = $lines | Where-Object { $_.madaNameOut -eq 'بيض أحمر كبير' }
Assert ($l1.QuntOut -eq 3 -and $l1.Price -eq 84000 -and $l1.unit -eq 'كرتونة' -and $l1.UnitFactor -eq 0) 'line 1 qty/price/unit/factor'
Assert ($l1.BpriceL1 -eq $egg.BpriceL1 -and $l1.BpriceL2 -eq $egg.BpriceL2 -and $l1.IDcode -eq $egg.IDcode) 'line 1 buy prices + code from the item card'
$l2 = $lines | Where-Object { $_.madaNameOut -eq 'برغر لحم' }
Assert ($l2.QuntOut -eq 1.5 -and $l2.UnitFactor -eq 1 -and $l2.BpriceL2 -eq $burger.BpriceL2) 'line 2 fractional qty, small unit factor'
$creditSaleId = $r.id

Write-Host "`n== sale edit"
$before = $sale.timeS
W 'saveSale' @{ id = $creditSaleId; type = 'اجل'; customer = 'أبو علي'; date = $today; paid = 0
    lines = @(@{ item = 'بيض أحمر كبير'; unit = 'طبقة'; qty = 2; price = 7000 }) } | Out-Null
$sale = Row 'MasterOut' 'idOut' $creditSaleId
$lines = @((Rows 'subOut') | Where-Object { $_.idOut -eq $creditSaleId })
Assert ($lines.Count -eq 1 -and $lines[0].unit -eq 'طبقة' -and $sale.Paid -eq 0) 'lines replaced, paid updated'
Assert ($sale.timeS -eq $before) 'entry time kept on edit'

Write-Host "`n== sale (cash)"
$r = W 'saveSale' @{ type = 'نقدي'; date = $today; paid = 999; lines = @(@{ item = 'كبد دجاج'; unit = 'كيس'; qty = 1; price = 3500 }) }
$cash = Row 'MasterOut' 'idOut' $r.id
Assert ($cash.TOname -eq 'عميل نقدي' -and $cash.Paid -eq 0 -and $cash.OutType -eq 'نقدي') 'cash invoice to عميل نقدي, paid ignored'

Write-Host "`n== validation and rollback"
$n = (Rows 'MasterOut').Count
$one = @{ item = 'كبد دجاج'; unit = 'كرتونة'; qty = 1; price = 1 }
Assert-Throws { W 'saveSale' @{ type = 'اجل'; customer = ''; lines = @($one) } } 'اسم العميل' 'credit sale needs a customer'
Assert-Throws { W 'saveSale' @{ type = 'اجل'; customer = 'عميل غير مسجّل'; lines = @($one) } } 'العميل غير موجود' 'unknown customer'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @() } } 'لا تحتوي على أصناف' 'empty invoice'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'صنف وهمي'; unit = 'كرتونة'; qty = 1; price = 1 }) } } 'الصنف غير موجود' 'unknown item'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'لتر'; qty = 1; price = 1 }) } } 'وحدة غير صحيحة' 'wrong unit'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كرتونة'; qty = 0; price = 1 }) } } 'الكمية' 'zero qty'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كرتونة'; qty = 'abc'; price = 1 }) } } 'رقم' 'non-numeric qty'
Assert-Throws { W 'saveSale' @{ type = 'x'; lines = @() } } 'نوع الفاتورة' 'bad type'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; date = '2026-13-45'; lines = @($one) } } 'التاريخ' 'bad date'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; customer = ('س' * 51); lines = @($one) } } 'طويل' 'customer name over 50'
# the second line fails after the master row and first line were written: all of it must roll back
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @($one, @{ item = 'صنف وهمي'; unit = 'كرتونة'; qty = 1; price = 1 }) } } 'الصنف غير موجود' 'failure on line 2'
Assert ((Rows 'MasterOut').Count -eq $n) 'failed saves left no invoice behind (rollback)'
Assert-Throws { W 'nope' @{} } 'غير معروفة' 'unknown operation'

Write-Host "`n== purchase"
$chest = Row 'madaCode' 'madaName' 'صدر دجاج'
$r = W 'savePurchase' @{ type = 'اجل'; supplier = 'شركة الدواجن'; no = '9001'; date = $today; updatePrices = $true
    lines = @(@{ item = 'صدر دجاج'; unit = 'كرتونة'; qty = 20; price = 56000 }) }
$pur = Row 'MasterIn' 'IdIn' $r.id
Assert ($pur.fromname -eq 'شركة الدواجن' -and $pur.InvoiceNo -eq 9001 -and $pur.InType -eq 'اجل') 'purchase master'
$pl = @((Rows 'subIN') | Where-Object { $_.IdIn -eq $r.id })
Assert ($pl.Count -eq 1 -and $pl[0].QuntIn -eq 20 -and $pl[0].Price -eq 56000 -and $pl[0].IDcode -eq $chest.IDcode) 'purchase line'
$chest2 = Row 'madaCode' 'madaName' 'صدر دجاج'
Assert ($chest2.BpriceL1 -eq 56000 -and $chest2.BpriceL2 -eq [math]::Round(56000 / 8)) 'buy price updated to 56000 / 7000'
$purId = $r.id
Assert-Throws { W 'savePurchase' @{ type = 'اجل'; supplier = 'شركة الدواجن'; no = 'x1'; lines = @($one) } } 'رقم' 'supplier invoice no must be a number'
Assert-Throws { W 'savePurchase' @{ type = 'اجل'; supplier = ''; lines = @() } } 'المورد' 'purchase needs a supplier'

Write-Host "`n== vouchers"
$r = W 'saveReceipt' @{ cls = 'تسديد'; name = 'أبو علي'; amount = '250000'; date = $today; note = 'دفعة' }
$rec = Row 'mablakIn' 'idS' $r.id
Assert ($rec.mablak -eq 250000 -and $rec.nameFrom -eq 'أبو علي' -and $rec.classS -eq 'تسديد' -and $rec.mostandNO -eq '1') "receipt, voucher no $($rec.mostandNO)"
$recId = $r.id
W 'saveReceipt' @{ id = $recId; cls = 'تسديد'; name = 'أبو علي'; amount = 300000; date = $today } | Out-Null
Assert ((Row 'mablakIn' 'idS' $recId).mablak -eq 300000 -and (Row 'mablakIn' 'idS' $recId).mostandNO -eq '1') 'receipt edit keeps its number'
Assert ((Row 'mablakIn' 'idS' (W 'saveReceipt' @{ cls = 'إيراد آخر'; name = ''; amount = 5 }).id).mostandNO -eq '2') 'next receipt number'
$r = W 'savePayment' @{ cls = 'كهرباء وماء'; name = ''; amount = 50000; date = $today; note = 'مولدة' }
$pay = Row 'mablakOut' 'idS' $r.id
Assert ($pay.classS -eq 'كهرباء وماء' -and $null -eq $pay.nameto -and $pay.note -eq 'مولدة') 'expense with no name'
$payId = $r.id
$r = W 'savePayment' @{ cls = 'تسديد'; name = 'شركة الدواجن'; amount = 1000000; date = $today }
Assert ((Row 'mablakOut' 'idS' $r.id).nameto -eq 'شركة الدواجن') 'supplier payment'
Assert-Throws { W 'saveReceipt' @{ cls = 'تسديد'; name = ''; amount = 5 } } 'اسم' 'settlement needs a name'
Assert-Throws { W 'saveReceipt' @{ cls = 'تسديد'; name = 'أحد'; amount = 5 } } 'العميل غير موجود' 'receipt from an unknown customer'
Assert-Throws { W 'saveReceipt' @{ cls = 'تسديد'; name = 'أبو علي'; amount = 0 } } 'المبلغ' 'zero amount'
Assert-Throws { W 'savePayment' @{ cls = 'تسديد'; name = 'أحد'; amount = 5 } } 'المورد غير موجود' 'payment to an unknown supplier'

Write-Host "`n== customers"
$r = W 'saveCustomer' @{ name = 'عميل تجربة'; mobile = '07700000000'; opening = '15000'; type = 'مفرد'; address = 'المحمودية' }
$c = Row 'bayeeCode' 'id' $r.id
Assert ($c.bayeeCode -eq 'عميل تجربة' -and $c.MB -eq 15000 -and $c.Ctype -eq 'مفرد' -and $c.credit -eq 0) 'new customer fields'
$custId = $r.id
Assert-Throws { W 'saveCustomer' @{ name = 'عميل تجربة' } } 'بنفس الاسم' 'duplicate customer'
Assert-Throws { W 'saveCustomer' @{ name = 'عميل'; mobile = '0770000000000' } } 'طويل|الهاتف' 'mobile over 12'
W 'saveSale' @{ type = 'اجل'; customer = 'عميل تجربة'; lines = @($one) } | Out-Null
W 'saveReceipt' @{ cls = 'تسديد'; name = 'عميل تجربة'; amount = 1 } | Out-Null
W 'saveCustomer' @{ id = $custId; name = 'عميل تجربة 2'; mobile = '07700000000'; opening = 15000; type = 'مفرد' } | Out-Null
Assert (@((Rows 'MasterOut') | Where-Object { $_.TOname -eq 'عميل تجربة 2' }).Count -eq 1) 'rename carried into invoices'
Assert (@((Rows 'mablakIn') | Where-Object { $_.nameFrom -eq 'عميل تجربة 2' }).Count -eq 1) 'rename carried into receipts'
Assert (@((Rows 'MasterOut') | Where-Object { $_.TOname -eq 'عميل تجربة' }).Count -eq 0) 'old name gone'
Assert-Throws { W 'deleteCustomer' @{ id = $custId } } 'حركة' 'customer with movements cannot be deleted'

Write-Host "`n== suppliers"
$r = W 'saveSupplier' @{ name = 'مورد تجربة'; opening = 100.5; mobile = '' }
Assert ((Row 'shiraCode' 'ID' $r.id).MB -eq 100.5) 'new supplier, fractional opening'
$supId = $r.id
W 'savePayment' @{ cls = 'تسديد'; name = 'مورد تجربة'; amount = 5 } | Out-Null
W 'saveSupplier' @{ id = $supId; name = 'مورد تجربة 2' } | Out-Null
Assert (@((Rows 'mablakOut') | Where-Object { $_.nameto -eq 'مورد تجربة 2' }).Count -eq 1) 'supplier rename carried into payments'

Write-Host "`n== items"
$r = W 'saveItem' @{ name = 'صنف تجربة'; code = '9999'; cls = 'مصنعات'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 12; priceL1 = 60000; priceL2 = 5500; buyL1 = 50000; buyL2 = 4167; harig = 1 }
$it = Row 'madaCode' 'ID' $r.id
Assert ($it.IDcode -eq '9999' -and $it.price -eq 60000 -and $it.priceSeeat -eq 5500 -and $it.Fill -eq 12 -and $it.Pr -eq 0) 'new item fields'
$itemId = $r.id
Assert-Throws { W 'saveItem' @{ name = 'صنف ثانٍ'; code = '9999'; unitL1 = 'كرتونة' } } 'بنفس الرمز' 'duplicate code'
Assert-Throws { W 'saveItem' @{ name = 'صنف تجربة'; unitL1 = 'كرتونة' } } 'بنفس الاسم' 'duplicate name'
Assert-Throws { W 'saveItem' @{ name = 'صنف ثالث'; code = '1234567890123456'; unitL1 = 'كرتونة' } } 'الرمز' 'code over 15'
Assert-Throws { W 'saveItem' @{ name = 'صنف رابع'; unitL1 = '' } } 'الوحدة الكبيرة' 'item needs a big unit'
W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'صنف تجربة'; unit = 'قطعة'; qty = 2; price = 5500 }) } | Out-Null
W 'saveItem' @{ id = $itemId; name = 'صنف تجربة 2'; code = '9999'; unitL1 = 'كرتونة'; unitL2 = 'قطعة'; fill = 12; priceL1 = 61000; priceL2 = 5600 } | Out-Null
Assert (@((Rows 'subOut') | Where-Object { $_.madaNameOut -eq 'صنف تجربة 2' }).Count -eq 1) 'item rename carried into sale lines'
Assert-Throws { W 'deleteItem' @{ id = $itemId } } 'حركة' 'item with movements cannot be deleted'
$r = W 'saveItem' @{ name = 'صنف للحذف'; unitL1 = 'كيس' }
W 'deleteItem' @{ id = $r.id } | Out-Null
Assert ($null -eq (Row 'madaCode' 'ID' $r.id)) 'unused item deleted'

Write-Host "`n== deletes"
W 'deleteSale' @{ id = $creditSaleId } | Out-Null
Assert ($null -eq (Row 'MasterOut' 'idOut' $creditSaleId) -and @((Rows 'subOut') | Where-Object { $_.idOut -eq $creditSaleId }).Count -eq 0) 'sale and its lines deleted'
W 'deletePurchase' @{ id = $purId } | Out-Null
Assert ($null -eq (Row 'MasterIn' 'IdIn' $purId) -and @((Rows 'subIN') | Where-Object { $_.IdIn -eq $purId }).Count -eq 0) 'purchase and its lines deleted'
W 'deleteReceipt' @{ id = $recId } | Out-Null
W 'deletePayment' @{ id = $payId } | Out-Null
Assert ($null -eq (Row 'mablakIn' 'idS' $recId) -and $null -eq (Row 'mablakOut' 'idS' $payId)) 'vouchers deleted'
Assert-Throws { W 'deleteSale' @{ id = $creditSaleId } } 'غير موجودة' 'deleting twice'

Write-Host "`n== permissions"
function Set-Perms([string]$user, [string]$perms) { Use-Database { param($db) Save-User $db @{ oldName = $user; name = $user; perms = $perms } } | Out-Null }
function Wc([string]$op, [hashtable]$d, $session) { $d.user = $session.user; $x = [pscustomobject]$d; Test-Allowed $op $x $session; return Invoke-Write $op $x $session }
function Session([string]$user) { return @{ user = $user; admin = (Test-Admin $user); perms = (Get-Perms $user) } }
Assert (((Get-Perms 'كاشير1') -join ',') -eq 'pos,sale_cash,print') 'cashier: cash sale + print'
$cashier = Session 'كاشير1'
$small = @{ item = 'كبد دجاج'; unit = 'كيس'; qty = 1; price = 3500 }
$r = Wc 'saveSale' @{ type = 'نقدي'; lines = @($small) } $cashier
Assert ($r.id -gt 0) 'cashier: cash sale at list price saved'
Assert-Throws { Wc 'saveSale' @{ type = 'اجل'; customer = 'أبو علي'; lines = @($small) } $cashier } 'صلاحية' 'cashier: no credit sale'
Assert-Throws { Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كيس'; qty = 1; price = 1 }) } $cashier } 'تغيير السعر' 'cashier: no price change'
Assert-Throws { Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'بيض أحمر كبير'; unit = 'كرتونة'; qty = 1; price = 84000 }) } $cashier } 'الجملة' 'cashier: no wholesale (big unit)'
Assert ((Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'ماء صغير'; unit = 'قنينة'; qty = 1; price = 250 }) } $cashier).id -gt 0) 'cashier: a single-unit item is not wholesale'
Assert-Throws { Wc 'saveSale' @{ id = $r.id; type = 'نقدي'; lines = @($small) } $cashier } 'صلاحية' 'cashier: cannot edit a sale'
Assert-Throws { Wc 'deleteSale' @{ id = $r.id } $cashier } 'صلاحية' 'cashier: cannot delete'
Assert-Throws { Wc 'saveReceipt' @{ cls = 'تسديد'; name = 'أبو علي'; amount = 5 } $cashier } 'صلاحية' 'cashier: no receipts'
Assert-Throws { Wc 'savePurchase' @{ type = 'اجل'; supplier = 'شركة الدواجن'; lines = @($small) } $cashier } 'صلاحية' 'cashier: cannot buy'
Assert-Throws { Wc 'saveItem' @{ name = 'x'; unitL1 = 'كيس' } $cashier } 'صلاحية' 'cashier: cannot change items'
Set-Perms 'كاشير1' 'pos,sale_cash,sale_credit,sale_wholesale,edit_price,receipt,sale_delete'
$seller = Session 'كاشير1'
$r2 = Wc 'saveSale' @{ type = 'اجل'; customer = 'أبو علي'; lines = @(@{ item = 'بيض أحمر كبير'; unit = 'كرتونة'; qty = 2; price = 80000 }) } $seller
Assert ($r2.id -gt 0) 'with permissions: credit + wholesale + own price saved'
Assert ((Wc 'saveReceipt' @{ cls = 'تسديد'; name = 'أبو علي'; amount = 5 } $seller).id -gt 0) 'with permission: receipt saved'
Wc 'deleteSale' @{ id = $r2.id } $seller | Out-Null
Assert ($null -eq (Row 'MasterOut' 'idOut' $r2.id)) 'with permission: delete'
Assert-Throws { Wc 'saveSale' @{ id = $r.id; type = 'نقدي'; lines = @($small) } $seller } 'صلاحية' 'delete permission does not include edit'
Set-Perms 'كاشير1' 'pos,sale_cash,sale_edit'
$editor = Session 'كاشير1'
$admin = Session 'نور'
$r3 = Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كيس'; qty = 1; price = 777 }, @{ item = 'بيض أحمر كبير'; unit = 'كرتونة'; qty = 1; price = 84000 }) } $admin
Assert ((Wc 'saveSale' @{ id = $r3.id; type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كيس'; qty = 3; price = 777 }, @{ item = 'بيض أحمر كبير'; unit = 'كرتونة'; qty = 2; price = 84000 }) } $editor).id -eq $r3.id) 'edit permission: change quantities, keeping the invoice prices and units'
Assert-Throws { Wc 'saveSale' @{ id = $r3.id; type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كيس'; qty = 3; price = 1 }) } $editor } 'تغيير السعر' 'edit permission does not include a new price'
Assert-Throws { Wc 'saveSale' @{ id = $r3.id; type = 'اجل'; customer = 'أبو علي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كيس'; qty = 3; price = 777 }) } $editor } 'الآجل' 'edit permission cannot turn it into credit'
Set-Perms 'كاشير1' 'sale_credit,receipt,sale_edit'
$imp = [string[]](Get-Perms 'كاشير1')
Assert ($imp -contains 'pos' -and $imp -contains 'customers' -and $imp -contains 'sales' -and $imp -notcontains 'cash') "screens come with their actions: $($imp -join ',')"
Set-Perms 'كاشير1' 'pos,bogus,print'
Assert (((Get-Perms 'كاشير1') -join ',') -eq 'pos,print') 'unknown permission names are dropped'
Set-Perms 'كاشير1' ''
Assert ((Get-PermText 'كاشير1') -eq '') 'an empty list stays empty'
foreach ($sh in @(@('"pos,sale_credit,print"', 'pos,sale_credit,print'), @('["pos","sale_credit"]', 'pos,sale_credit'), @('[]', ''), @('["bogus"]', $null))) {
    $got = ConvertTo-PermText ($sh[0] | ConvertFrom-Json)
    Assert ($got -ceq $sh[1]) "permissions sent as $($sh[0]) -> [$got]"
}
Assert ((Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد دجاج'; unit = 'كرتونة'; qty = 1; price = 1 }) } $admin).id -gt 0) 'manager: anything'
Set-Perms 'كاشير1' 'pos,sale_cash,print'

Write-Host "`n== activity log"
$log = Get-Activity '' '' 5000
$labelsOf = { param($a) @($log | Where-Object { $_.action -eq $a }) }
Assert ((& $labelsOf 'saveSale_new').Count -ge 3 -and (& $labelsOf 'saveSale_new')[0].label -eq 'فاتورة بيع') "every sale logged ($((& $labelsOf 'saveSale_new').Count))"
$pc = & $labelsOf 'price_change'
Assert ($pc.Count -ge 1 -and $pc[0].warn -and $pc[0].details -match 'سعر البطاقة') "a price other than the card's logged on its own: $($pc[0].details)"
$ds = & $labelsOf 'deleteSale'
Assert ($ds.Count -ge 1 -and $ds[-1].details -match 'أبو علي' -and $ds[-1].warn) "a deleted invoice keeps what it was: $($ds[-1].details -replace "`n", ' | ')"
$ie = @(& $labelsOf 'saveItem_edit' | Where-Object { $_.details -match 'سعر البيع \(الكبيرة\): من 60000 إلى 61000' })
Assert ($ie.Count -eq 1) 'item edit: old and new price'
$se = & $labelsOf 'saveSale_edit'
Assert ($se.Count -ge 1 -and $se[-1].details -match '^قبل: ' -and $se[-1].details -match 'بعد: ') 'invoice edit: before and after'
Assert (@($log | Where-Object { -not $_.user }).Count -eq 0) 'every line says who'
Write-Activity 'نور' 'login' '' 'من هذا الجهاز'
Write-Activity 'مجهول' 'login_failed'
$log2 = Get-Activity $today $today 5000
Assert ($log2[0].action -eq 'login_failed' -and $log2[0].warn -and $log2[1].action -eq 'login') 'sign-ins logged, newest first'
Assert ((Get-Activity '2000-01-01' '2000-01-02' 10).Count -eq 0) 'a day range with nothing'
Assert ((Get-Activity '' '' 3).Count -eq 3) 'the limit is kept'

Write-Host "`n== stock count"
$cnt = Session 'كاشير1'
Assert-Throws { Wc 'saveStockCount' @{ lines = @(@{ item = 'كبد دجاج'; expected = 10; counted = 8 }) } $cnt } 'صلاحية' 'cashier: no stock count'
Set-Perms 'كاشير1' 'pos,sale_cash,print,stock_count'
$cnt = Session 'كاشير1'
$r = Wc 'saveStockCount' @{ note = 'جرد الثلاجة'; scope = 'مجمدات'; lines = @(@{ item = 'كبد دجاج'; expected = 10; counted = 8 }, @{ item = 'برغر لحم'; expected = 30; counted = 33 }, @{ item = 'صدر دجاج'; expected = 5; counted = 5 }) } $cnt
$sc = Row 'StockCount' 'ID' $r.id
$lines = @((Rows 'StockCountLine') | Where-Object { $_.CountID -eq $r.id })
Assert ($sc.UserName -eq 'كاشير1' -and $sc.Note -eq 'جرد الثلاجة' -and $sc.Scope -eq 'مجمدات' -and $lines.Count -eq 3) 'count and its lines saved'
$lv = $lines | Where-Object { $_.Item -eq 'كبد دجاج' }
Assert ($lv.Expected -eq 10 -and $lv.Counted -eq 8 -and $lv.Cost -eq 2500) 'expected, counted, cost per small unit'
Assert ($r.changed -eq 2 -and $r.minus -eq 5000 -and $r.plus -eq 3 * 4167) "differences valued: +$($r.plus) / -$($r.minus)"
$logc = @(Get-Activity '' '' 5)
Assert ($logc[0].action -eq 'saveStockCount_new' -and $logc[0].details -match 'بفرق 2') "count logged: $($logc[0].details)"
Assert-Throws { Wc 'saveStockCount' @{ lines = @(@{ item = 'كبد دجاج'; expected = 1; counted = -1 }) } $cnt } 'سالبة' 'negative count refused'
Assert-Throws { Wc 'saveStockCount' @{ lines = @(@{ item = 'كبد دجاج'; expected = 1; counted = 1 }, @{ item = 'كبد دجاج'; expected = 1; counted = 2 }) } $cnt } 'مكرر' 'an item twice refused'
Assert-Throws { Wc 'saveStockCount' @{ lines = @() } $cnt } 'لم يُعَدّ' 'empty count refused'
Assert-Throws { Wc 'deleteStockCount' @{ id = $r.id } $cnt } 'المدير' 'only a manager cancels a count'
W 'saveItem' @{ id = (Row 'madaCode' 'madaName' 'كبد دجاج').ID; name = 'كبد دجاج طازج'; code = '6281000000035'; cls = 'مجمدات'; unitL1 = 'كرتونة'; unitL2 = 'كيس'; fill = 10; priceL1 = 30000; priceL2 = 3500; buyL1 = 25000; buyL2 = 2500 } | Out-Null
Assert ((@((Rows 'StockCountLine') | Where-Object { $_.Item -eq 'كبد دجاج طازج' })).Count -eq 1) 'item rename carried into counts'
Assert-Throws { W 'deleteItem' @{ id = (Row 'madaCode' 'madaName' 'كبد دجاج طازج').ID } } 'حركة' 'a counted item is not deleted'
W 'saveItem' @{ id = (Row 'madaCode' 'madaName' 'كبد دجاج طازج').ID; name = 'كبد دجاج'; code = '6281000000035'; cls = 'مجمدات'; unitL1 = 'كرتونة'; unitL2 = 'كيس'; fill = 10; priceL1 = 30000; priceL2 = 3500; buyL1 = 25000; buyL2 = 2500 } | Out-Null
$keepCount = $r.id
$r2 = W 'saveStockCount' @{ lines = @(@{ item = 'ماء صغير'; expected = 0; counted = 12 }) }
W 'deleteStockCount' @{ id = $r2.id } | Out-Null
Assert ($null -eq (Row 'StockCount' 'ID' $r2.id) -and @((Rows 'StockCountLine') | Where-Object { $_.CountID -eq $r2.id }).Count -eq 0) 'manager cancels a count'
Set-Perms 'كاشير1' 'pos,sale_cash,print'

Write-Host "`n== barcodes for items without one"
$noCode = W 'saveItem' @{ name = 'خبز صمون'; unitL1 = 'كيس'; priceL1 = 1000 }
$noCode2 = W 'saveItem' @{ name = 'كعك'; unitL1 = 'كيس'; priceL1 = 1500 }
Assert-Throws { Wc 'setItemCodes' @{ codes = @(@{ id = $noCode.id; code = '2000000000015' }) } (Session 'كاشير1') } 'صلاحية' 'cashier: cannot set codes'
Set-Perms 'كاشير1' 'pos,sale_cash,print,labels'
Wc 'setItemCodes' @{ codes = @(@{ id = $noCode.id; code = '2000000000015' }, @{ id = $noCode2.id; code = '2000000000022' }) } (Session 'كاشير1') | Out-Null
Assert ((Row 'madaCode' 'ID' $noCode.id).IDcode -eq '2000000000015' -and (Row 'madaCode' 'ID' $noCode2.id).IDcode -eq '2000000000022') 'whoever prints labels may make codes'
Assert-Throws { W 'setItemCodes' @{ codes = @(@{ id = $noCode.id; code = '6281000000028' }) } } 'بنفس الرمز' 'a code in use refused'
Assert-Throws { W 'setItemCodes' @{ codes = @(@{ id = $noCode.id; code = '1' }, @{ id = $noCode2.id; code = '1' }) } } 'مكرر' 'the same code twice refused'
Assert ((Get-Activity '' '' 1)[0].action -eq 'setItemCodes') 'codes logged'
Set-Perms 'كاشير1' 'pos,sale_cash,print'

Write-Host "`n== an older database is upgraded when opened"
$old = Join-Path $tmp 'old/fr3oon.accdb'
New-Item -ItemType Directory -Force -Path (Split-Path $old) | Out-Null
$v1 = [ordered]@{}
$fs = Get-FakeSchema
foreach ($k in $fs.Keys) { if ($k -notin 'ActivityLog', 'StockCount', 'StockCountLine') { $v1[$k] = $fs[$k] } }
New-FakeDatabase $script:Engine $old $v1
$script:DbOverride = $old
Use-Database { param($db) Add-Row $db 'Settings' @{ Name = 'schema'; Val = '1' } '' | Out-Null } | Out-Null
Close-Db
$script:DbOverride = $null
Assert (-not (Test-ShopDatabase $old) -or $true) 'checked'
$st = Read-FakeFile $old
Assert (-not $st.ContainsKey('ActivityLog')) 'checking a file (before a restore) does not change it'
$script:DbOverride = $old
$tn = @(Use-Database -ReadOnly { param($db) Get-TableNames $db })
$ver = Use-Database -ReadOnly { param($db) Get-ShopSetting $db 'schema' }
Close-Db
$script:DbOverride = $null
Assert ($tn -contains 'ActivityLog' -and $tn -contains 'StockCount' -and $tn -contains 'StockCountLine' -and $ver -eq '2') 'new tables added, version 2'
Assert ((Read-FakeFile $old).ContainsKey('StockCountLine')) 'and kept in the file'

Write-Host "`n== the database stays open between saves"
Close-Db
$o0 = [int]$script:Engine.State.opens
Invoke-Write 'saveCustomer' ([pscustomobject]@{ name = 'فتح-1'; user = 'x' }) | Out-Null
Invoke-Write 'saveCustomer' ([pscustomobject]@{ name = 'فتح-2'; user = 'x' }) | Out-Null
Use-Database -ReadOnly { param($db) Count $db 'SELECT Count(*) FROM bayeeCode' } | Out-Null
Assert (([int]$script:Engine.State.opens - $o0) -eq 1) "two saves and a read opened it once ($([int]$script:Engine.State.opens - $o0))"
try { Invoke-Write 'saveCustomer' ([pscustomobject]@{ name = 'فتح-1'; user = 'x' }) | Out-Null } catch { }
Assert ($null -eq $script:Db) 'a refused save closes it (the next one opens fresh)'
Assert (@((Rows 'bayeeCode') | Where-Object { $_['bayeeCode'] -like 'فتح-*' }).Count -eq 2) 'nothing half-saved by the refused one'

Write-Host "`n== a database on another computer faltering"
$script:flaky = 0
$v = Use-Database -ReadOnly { param($db) $script:flaky++; if ($script:flaky -lt 3) { throw 'Disk or network error.' }; Count $db 'SELECT Count(*) FROM bayeeCode' }
Assert ($script:flaky -eq 3 -and $v -gt 0) 'a network error is tried again (third time worked)'
$script:flaky = 0
Assert-Throws { Use-Database { param($db) $script:flaky++; throw 'اسم العميل مطلوب' } } 'اسم العميل' 'a refused save is not tried again'
Assert ($script:flaky -eq 1) 'tried once only'
$n0 = (Rows 'bayeeCode').Count
$script:flaky = 0
Invoke-Write 'saveCustomer' ([pscustomobject]@{ name = 'بعد انقطاع'; user = 'x' }) | Out-Null
Assert ((Rows 'bayeeCode').Count -eq $n0 + 1) 'saves still work'

Write-Host "`n== data for other devices"
$bytes = Export-Data
$exp = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
Assert ($exp.ok -and $exp.tables.MasterOut.rows.Count -eq (Rows 'MasterOut').Count) "all invoices exported ($($exp.tables.MasterOut.rows.Count)), $([math]::Round($bytes.Length / 1024)) KB"
Assert ((@($exp.tables.Users.cols) -join ',') -eq 'UserName,Active') 'user names only, never password hashes'
Assert ($null -eq $exp.tables.Settings) 'settings not sent'
Assert ($exp.tables.StockCountLine.rows.Count -ge 3 -and $null -eq $exp.tables.ActivityLog) 'stock counts sent, the activity log not'
Assert ([object]::ReferenceEquals($bytes, (Export-Data))) 'second request served from the cache'
Invoke-Write 'saveCustomer' ([pscustomobject]@{ name = 'تصدير-1'; user = 'x' }) | Out-Null
$exp2 = [Text.Encoding]::UTF8.GetString((Export-Data)) | ConvertFrom-Json
$ci = [array]::IndexOf(@($exp2.tables.bayeeCode.cols), 'bayeeCode')
Assert (@($exp2.tables.bayeeCode.rows | Where-Object { $_[$ci] -eq 'تصدير-1' }).Count -eq 1) 'a save shows in the next export'
[Text.Encoding]::UTF8.GetString((Export-Data)) | Set-Content -LiteralPath (Join-Path $tmp 'data-export.json') -Encoding UTF8
Get-FakeFileTables $script:Engine (Get-DbPath) | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath (Join-Path $tmp 'data-tables.json') -Encoding UTF8

Write-Host "`n== full test (on a copy)"
$counts0 = @{}; foreach ($tb in $counts.Keys) { $counts0[$tb] = (Rows $tb).Count }
$st0 = Start-FullTest
Assert (Test-Path -LiteralPath $script:FT.path) "copy made: $($st0.file)"
Get-FakeFileTables $script:Engine $script:FT.path | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath (Join-Path $tmp 'fulltest-start.json') -Encoding UTF8
$run = Invoke-FullTestRun
foreach ($x in $run.steps) { Assert $x.ok "run: $($x.name): $($x.msg)" }
Assert (@($run.steps).Count -ge 20) "run has $(@($run.steps).Count) steps"
$copyTables = Get-FakeFileTables $script:Engine $script:FT.path
Assert (@($copyTables['bayeeCode'].rows | Where-Object { $_.bayeeCode -eq $run.expect.customer }).Count -eq 1) 'the copy has the test customer'
foreach ($tb in $counts0.Keys) { Assert ((Rows $tb).Count -eq $counts0[$tb]) "real data untouched by the test: $tb" }
$copyTables | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath (Join-Path $tmp 'fulltest-run.json') -Encoding UTF8
$run.expect | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $tmp 'fulltest-expect.json') -Encoding UTF8
$cl = Invoke-FullTestClean
foreach ($x in $cl.steps) { Assert $x.ok "clean: $($x.name): $($x.msg)" }
$copyTables2 = Get-FakeFileTables $script:Engine $script:FT.path
foreach ($tb in $counts0.Keys) { Assert (@($copyTables2[$tb].rows).Count -eq $counts0[$tb]) "copy back to the start after clean: $tb" }
$copyTables2 | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath (Join-Path $tmp 'fulltest-clean.json') -Encoding UTF8
$copyPath = $script:FT.path
Stop-FullTest
Assert (-not (Test-Path -LiteralPath $copyPath)) 'copy removed'
Assert ($null -eq $script:DbOverride) 'the real database in use again'

Write-Host "`n== backups and restore"
Wait-Backup 60
Start-Backup -Now
Wait-Backup 60
Update-Backup
$b = Get-Backups
Assert ($b.Count -ge 1 -and -not $script:BackupError) "backup in the chosen folder: $($b[0].name)"
Assert ((Get-Item (Join-Path (Get-BackupDir) $b[0].name)).Length -eq (Get-Item $dbFile).Length) 'same size as the database'
Assert (Test-ShopDatabase (Join-Path (Get-BackupDir) $b[0].name)) 'the copy is a Fr3oon database'
$keepName = $b[0].name
Invoke-Write 'saveCustomer' ([pscustomobject]@{ name = 'بعد النسخة'; user = 'x' }) | Out-Null
Assert ($null -ne (Row 'bayeeCode' 'bayeeCode' 'بعد النسخة')) 'a customer added after the backup'
Start-Sleep -Milliseconds 1100
$rr = Restore-Backup $keepName
function Reopen { Use-Database -ReadOnly { param($db) Count $db 'SELECT Count(*) FROM Users' } | Out-Null }
Reopen
Assert ($null -eq (Row 'bayeeCode' 'bayeeCode' 'بعد النسخة')) 'restore: back as it was in the backup'
Assert (Test-Path -LiteralPath (Join-Path (Get-BackupDir) $rr.safety)) "the database before the restore was kept: $($rr.safety)"
Restore-Backup $rr.safety | Out-Null
Reopen
Assert ($null -ne (Row 'bayeeCode' 'bayeeCode' 'بعد النسخة')) 'and the restore can be undone'
Assert-Throws { Restore-Backup '..\..\x.accdb' } 'غير صحيح' 'only names of copies in the folder'
Copy-Item (Join-Path $tmp 'other.accdb') (Join-Path (Get-BackupDir) 'fr3oon-2000-01-01_00-00-00.accdb')
Assert-Throws { Restore-Backup 'fr3oon-2000-01-01_00-00-00.accdb' } 'ليس قاعدة بيانات' 'a broken copy is never restored'
Remove-Item (Join-Path (Get-BackupDir) 'fr3oon-2000-01-01_00-00-00.accdb')
for ($i = 0; $i -lt 4; $i++) { Start-Sleep -Milliseconds 1100; Start-Backup -Now; Wait-Backup 60; Update-Backup }
$b = Get-Backups
Assert (@($b | Where-Object { -not $_.beforeRestore }).Count -eq 3) 'only the last 3 daily copies kept'
Assert (@($b | Where-Object { $_.beforeRestore }).Count -eq 2) 'copies made before a restore are kept'

Write-Host "`n== backup schedule"
$todayStr = Get-Date -Format 'yyyy-MM-dd'
Assert ((Get-BackupDay) -eq $todayStr) "today's copy noted: $(Get-BackupDay)"
$saved = Get-Content $ConfigFile -Raw | ConvertFrom-Json
Assert ($saved.backupDay -eq $todayStr -and $saved.backupFor -eq $dbFile) 'and kept in the settings file'
# a fresh helper (the window was closed and opened again) must not copy again
$script:BackupDay = ''
$script:Config = Read-Config
Assert (-not (Test-BackupDue)) 'a new helper the same day: no second copy'
$n0 = @(Get-Backups).Count
Start-Backup; Wait-Backup 60; Update-Backup
Assert (@(Get-Backups).Count -eq $n0) 'Start-Backup on a new helper copies nothing'
# the next day
$script:BackupDay = ''; $script:Config.backupDay = '2000-01-01'
$script:Config.backupMode = 'start'
Assert (Test-BackupDue) 'first run of a new day: due'
$script:Config.backupMode = 'off'
Assert (-not (Test-BackupDue)) 'by hand only: never due by itself'
$script:Config.backupMode = 'time'
$script:Config.backupTime = '23:59'
$late = (Get-Date -Format 'HH:mm') -ge '23:59'
Assert ($late -or -not (Test-BackupDue)) 'at a set time: not due before it'
$script:Config.backupTime = '00:00'
Assert (Test-BackupDue) 'at a set time: due after it'
Start-Backup; Wait-Backup 60; Update-Backup
Assert ((Get-BackupDay) -eq $todayStr) 'the timed copy made'
Assert (-not (Test-BackupDue)) 'and only once that day'
# another database: its own first copy
$script:BackupDay = ''; $script:Config.backupFor = 'C:\other.accdb'
Assert (Test-BackupDue) 'another database file: its copy is due'
$script:Config.backupFor = $dbFile; $script:Config.backupDay = $todayStr
$script:Config.backupMode = 'start'; $script:Config.backupTime = '14:00'
Save-Config

Write-Host "`n== online updates"
$feed = Join-Path $tmp 'latest.json'
$setup = Join-Path $tmp 'Fr3oon-Setup-9.9.9.exe'
[IO.File]::WriteAllBytes($setup, [byte[]](1..200))
$script:Config.updateUrl = $feed
Sign 'update', $key, '9.9.9', $setup, $setup, 'ما الجديد' | Set-Content -LiteralPath $feed -Encoding UTF8
$u = Get-UpdateInfo
Assert ($u.available -and $u.latest -eq '9.9.9' -and $u.notes -eq 'ما الجديد') 'a newer signed version is found'
$j = Get-Content $feed -Raw | ConvertFrom-Json
$j.url = $setup + '.other'
$j | ConvertTo-Json | Set-Content -LiteralPath $feed -Encoding UTF8
Assert-Throws { Get-UpdateInfo } 'غير موقّع' 'a changed download link fails the signature'
Sign 'update', $key, '1.0.0', $setup, $setup | Set-Content -LiteralPath $feed -Encoding UTF8
Assert (-not (Get-UpdateInfo).available) 'an older version is not offered'
Assert-Throws { Install-Update } 'آخر إصدار' 'nothing to install'
Sign 'update', $key, '9.9.9', $setup, $setup | Set-Content -LiteralPath $feed -Encoding UTF8
[IO.File]::WriteAllBytes($setup, [byte[]](1..201))
Assert-Throws { Install-Update } 'لا يطابق' 'a different file than the signed one is not installed'
Assert (-not $script:Stop) 'still running'
Sign 'update', $key, '9.9.9', $setup, $setup | Set-Content -LiteralPath $feed -Encoding UTF8
$inst = Install-Update
Assert ($inst.version -eq '9.9.9' -and (Test-Path -LiteralPath $inst.file) -and $script:Stop) 'downloaded, checked, and the helper stops for the installer'
$script:Stop = $false
# from Settings: in steps, with progress
$script:UpdateRun = $null
Start-UpdateInstall 'نور' | Out-Null
for ($i = 0; $i -lt 200 -and $script:UpdateRun.state.phase -notin 'install', 'error'; $i++) { Start-Sleep -Milliseconds 100; Step-UpdateRun }
$st = $script:UpdateRun.state
Assert ($st.phase -eq 'install' -and $st.received -eq $st.total -and $st.total -gt 0 -and $script:StopAt) "steps: backup, download ($($st.received) bytes), verify, install"
Assert (@(Get-Backups | Where-Object { $_.name -like '*-before-update*' }).Count -ge 1) 'a backup before the update'
$st.phase = 'download'
Assert-Throws { Start-UpdateInstall 'نور' } 'جارٍ' 'not a second one while one is under way'
$script:StopAt = $null; $script:UpdateRun = $null
[IO.File]::WriteAllBytes($setup, [byte[]](1..202))
Sign 'update', $key, '9.9.9', $setup, $setup | Set-Content -LiteralPath $feed -Encoding UTF8
[IO.File]::WriteAllBytes($setup, [byte[]](1..203))
Start-UpdateInstall 'نور' | Out-Null
for ($i = 0; $i -lt 200 -and $script:UpdateRun.state.phase -notin 'install', 'error'; $i++) { Start-Sleep -Milliseconds 100; Step-UpdateRun }
Assert ($script:UpdateRun.state.phase -eq 'error' -and $script:UpdateRun.state.error -match 'لا يطابق' -and -not $script:StopAt) 'a changed file stops at the check, nothing installed'
$script:UpdateRun = $null
$script:Config.updateUrl = Join-Path $tmp 'missing.json'
Assert-Throws { Get-UpdateInfo } 'تعذّر|لا توجد' 'no feed: a clear message'
$script:Config.updateUrl = ''

Write-Host "`n== an existing حساباتي database"
$hjson = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'hisabati-sample.json') -Raw -Encoding UTF8
$hfile = Join-Path $tmp 'hisabati/Units2026.accdb'
New-Item -ItemType Directory -Force -Path (Split-Path $hfile) | Out-Null
[IO.File]::WriteAllText($hfile, '{"FR3OON-FAKE-ACCDB":1,"tables":' + $hjson + '}')
$keepDb = $script:Config.dbPath
Assert (-not (Test-ShopDatabase $hfile) -and (Test-HisabatiDatabase $hfile)) 'recognised as حساباتي, not Fr3oon'
Assert (-not (Test-HisabatiDatabase $dbFile)) 'a Fr3oon database is not taken for حساباتي'
$hi = Get-HisabatiInfo $hfile
Assert ((@($hi.users) -join ',') -eq 'نور,كاشير1,بلا كلمة' -and $hi.items -eq 2 -and $hi.sales -eq 2) "its users and counts: $(@($hi.users) -join ', ')"
$before = [IO.File]::ReadAllText($hfile)
Assert-Throws { Connect-HisabatiDatabase $hfile 'محل حساباتي' 'نور' 'wrong' } 'كلمة المرور غير صحيحة' 'the manager proves the حساباتي password'
Assert-Throws { Connect-HisabatiDatabase $hfile 'محل حساباتي' 'أحد' '123' } 'غير موجود' 'only a حساباتي user can be the manager'
Assert ([IO.File]::ReadAllText($hfile) -eq $before) 'a refused link changes nothing'
$lk = Connect-HisabatiDatabase $hfile 'محل حساباتي' 'نور' '123'
Assert ((Test-Path -LiteralPath $lk.copy) -and ([IO.File]::ReadAllText($lk.copy) -eq $before)) "a copy taken before linking: $(Split-Path $lk.copy -Leaf)"
Assert ((Get-DbPath) -eq $lk.path -and (Test-ShopDatabase $hfile)) 'now the database in use, a Fr3oon database too'
Assert ((@($lk.skipped) -join ',') -eq 'بلا كلمة') 'a user without a password is not brought over'
Assert ((Test-Login 'نور' '123') -and (Test-Admin 'نور')) 'the manager signs in with the حساباتي password'
Assert ((Test-Login 'كاشير1' '11') -and -not (Test-Admin 'كاشير1') -and ((Get-PermText 'كاشير1') -eq 'pos,sale_cash,print')) 'others: their password, the default permissions'
Assert ((Get-Shop).shopName -eq 'محل حساباتي') 'shop name kept'
$rowsH = { param($t) , @((Get-FakeFileTables $script:Engine $hfile)[$t].rows) }
Assert ((& $rowsH 'tblUsers').Count -eq 3 -and (& $rowsH 'tblUsers')[0].UserPWD -eq '123') 'حساباتي users untouched'
Assert ((& $rowsH 'MasterOut').Count -eq 2 -and (& $rowsH 'madaCode').Count -eq 2) 'حساباتي data untouched'
$r = Invoke-Write 'saveSale' ([pscustomobject]@{ type = 'نقدي'; user = 'نور'; lines = @(@{ item = 'كبة'; unit = 'كيس'; qty = 2; price = 3000 }) })
$hs = (& $rowsH 'MasterOut') | Where-Object { $_.idOut -eq $r.id }
Assert ($hs.TOname -eq 'قائمة نقدي' -and $hs.Tagheez -eq $false -and $hs.Mandob -eq 'مباشر') 'a sale saved the way حساباتي does (قائمة نقدي, Tagheez)'
$ri = Invoke-Write 'saveItem' ([pscustomobject]@{ user = 'نور'; name = 'سمبوسة'; unitL1 = 'كارتون'; unitL2 = 'كيس'; fill = 20; priceL1 = 40000; priceL2 = 2000 })
Assert (((& $rowsH 'madaCode') | Where-Object { $_.ID -eq $ri.id })['price$'] -eq 40000) 'a new item fills حساباتي''s price$ too'
$exp = [Text.Encoding]::UTF8.GetString((Export-Data)) | ConvertFrom-Json
Assert ($exp.tables.MasterOut.rows.Count -eq 3 -and (@($exp.tables.Users.cols) -join ',') -eq 'UserName,Active' -and $null -eq $exp.tables.tblUsers) 'the app reads it (Fr3oon users, never حساباتي passwords)'
$stH = Invoke-SelfTest
Assert (-not ($stH | Where-Object { -not $_.ok })) "self-test on the linked حساباتي database: $(@($stH).Count) steps pass"
Assert-Throws { Connect-HisabatiDatabase $hfile 'x' 'نور' '123' } 'ليس قاعدة بيانات حساباتي' 'linked once'
Set-Database $keepDb

Write-Host "`n== self-test"
$snap = @{}
foreach ($t in $counts.Keys) { $snap[$t] = (Rows $t).Count }
$steps = Invoke-SelfTest
foreach ($s in $steps) { Write-Host ("     {0} {1}: {2}" -f $(if ($s.ok) { '✔' } else { '✘' }), $s.name, $s.msg) }
Assert (-not ($steps | Where-Object { -not $_.ok })) "self-test: all $($steps.Count) steps pass"
foreach ($t in $counts.Keys) { Assert ((Rows $t).Count -eq $snap[$t]) "self-test left $t unchanged" }
Assert ($script:Engine.State.inTrans -eq $false) 'no transaction left open'

if ($env:KEEP_TMP) { Write-Host "`n(temp folder kept: $tmp)" } else { Remove-Item $tmp -Recurse -Force }
Write-Host "`nALL PASSED ($script:pass checks)" -ForegroundColor Green
