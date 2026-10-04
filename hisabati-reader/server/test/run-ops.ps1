# Runs every write operation of server.ps1 against a real data export through
# FakeDao, checking the rows each one leaves behind, the validation errors,
# the rollback on failure, the cashier/manager rules and the self-test.
#
# Usage: pwsh test/run-ops.ps1 -Tables tables.json -DbFile Units2026.accdb
# (-DbFile only needs to exist: backups are copied from it; data comes from -Tables.)

param(
    [Parameter(Mandatory)] [string]$Tables,
    [Parameter(Mandatory)] [string]$DbFile
)

$ErrorActionPreference = 'Stop'
$env:LAWHA_FAKEDAO = (Resolve-Path $Tables).Path
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('lawha-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$dbCopy = Join-Path $tmp 'Units2026.accdb'
Copy-Item $DbFile $dbCopy

. (Join-Path (Split-Path $PSScriptRoot -Parent) 'server.ps1') -DataDir (Join-Path $tmp 'data')
$script:Config.dbPath = $dbCopy

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

$engine = Get-Engine
Write-Host "engine: $script:EngineName"
$today = Get-Date -Format 'yyyy-MM-dd'
$counts = @{}
foreach ($t in 'MasterOut', 'subOut', 'MasterIn', 'subIN', 'mablakIn', 'mablakOut', 'bayeeCode', 'shiraCode', 'madaCode') { $counts[$t] = (Rows $t).Count }

Write-Host "`n== users"
$users = @(Get-UserNames)
Assert ($users.Count -eq 3) "3 users: $($users -join ', ')"
Assert (Test-Login 'نور' 'test') 'right password signs in'
Assert (-not (Test-Login 'نور' 'TEST')) 'password is case-sensitive'
Assert (-not (Test-Login 'نور' '')) 'empty password refused'
Assert (-not (Test-Login 'مو موجود' 'test')) 'unknown user refused'

Write-Host "`n== sale (credit)"
$egg = Row 'madaCode' 'madaName' 'بيض احمر كبير'
$burger = Row 'madaCode' 'madaName' 'بركر العطار جامبو لحم'
$r = W 'saveSale' @{ type = 'اجل'; customer = 'أبو علي الجزيرة'; date = $today; paid = '10000'; note = 'تجربة'
    lines = @(@{ item = 'بيض احمر كبير'; unit = 'كارتون'; qty = 3; price = 84000 }, @{ item = 'بركر العطار جامبو لحم'; unit = 'قطعة'; qty = 1.5; price = 5500 }) }
$sale = Row 'MasterOut' 'idOut' $r.id
Assert ($r.id -eq $counts.MasterOut -or $r.id -gt 1000) "new invoice id $($r.id)"
Assert ($sale.TOname -eq 'أبو علي الجزيرة' -and $sale.OutType -eq 'اجل' -and $sale.Paid -eq 10000) 'master: customer, type, paid'
Assert ($sale.Mandob -eq 'مباشر' -and $sale.Tagheez -eq $false -and $sale.strUserName -eq 'نور' -and $sale.note -eq 'تجربة') 'master: rep, flag, user, note'
Assert ($sale.OutDate.ToString('yyyy-MM-dd') -eq $today -and $sale.timeS -is [datetime]) 'master: dates'
$lines = @((Rows 'subOut') | Where-Object { $_.idOut -eq $r.id })
Assert ($lines.Count -eq 2) '2 lines'
$l1 = $lines | Where-Object { $_.madaNameOut -eq 'بيض احمر كبير' }
Assert ($l1.QuntOut -eq 3 -and $l1.Price -eq 84000 -and $l1.unit -eq 'كارتون' -and $l1.UnitFactor -eq 0) 'line 1 qty/price/unit/factor'
Assert ($l1.BpriceL1 -eq $egg.BpriceL1 -and $l1.BpriceL2 -eq $egg.BpriceL2 -and $l1.IDcode -eq $egg.IDcode) 'line 1 buy prices + code from item card'
$l2 = $lines | Where-Object { $_.madaNameOut -eq 'بركر العطار جامبو لحم' }
Assert ($l2.QuntOut -eq 1.5 -and $l2.UnitFactor -eq 1 -and $l2.BpriceL2 -eq $burger.BpriceL2) 'line 2 fractional qty, small unit factor'
$creditSaleId = $r.id

Write-Host "`n== sale edit"
$before = $sale.timeS
W 'saveSale' @{ id = $creditSaleId; type = 'اجل'; customer = 'أبو علي الجزيرة'; date = $today; paid = 0
    lines = @(@{ item = 'بيض احمر كبير'; unit = 'طبقة'; qty = 2; price = 7000 }) } | Out-Null
$sale = Row 'MasterOut' 'idOut' $creditSaleId
$lines = @((Rows 'subOut') | Where-Object { $_.idOut -eq $creditSaleId })
Assert ($lines.Count -eq 1 -and $lines[0].unit -eq 'طبقة' -and $sale.Paid -eq 0) 'lines replaced, paid updated'
Assert ($sale.timeS -eq $before) 'entry time kept on edit'

Write-Host "`n== sale (cash)"
$r = W 'saveSale' @{ type = 'نقدي'; date = $today; paid = 999; lines = @(@{ item = 'كبد'; unit = (Row 'madaCode' 'madaName' 'كبد').UnitL2; qty = 1; price = 1000 }) }
$cash = Row 'MasterOut' 'idOut' $r.id
Assert ($cash.TOname -eq 'قائمة نقدي' -and $cash.Paid -eq 0 -and $cash.OutType -eq 'نقدي') 'cash invoice named قائمة نقدي, paid ignored'
$cashId = $r.id

Write-Host "`n== validation and rollback"
$n = (Rows 'MasterOut').Count
Assert-Throws { W 'saveSale' @{ type = 'اجل'; customer = ''; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 1; price = 1 }) } } 'تحتاج اسم زبون' 'credit sale needs customer'
Assert-Throws { W 'saveSale' @{ type = 'اجل'; customer = 'زبون مو موجود'; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 1; price = 1 }) } } 'الزبون مو موجود' 'unknown customer'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @() } } 'ما بيها مواد' 'empty invoice'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'مادة وهمية'; unit = 'كارتون'; qty = 1; price = 1 }) } } 'المادة مو موجودة' 'unknown item'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = 'لتر'; qty = 1; price = 1 }) } } 'وحدة غلط' 'wrong unit'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 0; price = 1 }) } } 'الكمية' 'zero qty'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 'abc'; price = 1 }) } } 'رقم' 'non-numeric qty'
Assert-Throws { W 'saveSale' @{ type = 'x'; lines = @() } } 'نوع القائمة' 'bad type'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; date = '2026-13-45'; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 1; price = 1 }) } } 'التاريخ' 'bad date'
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; customer = ('س' * 51); lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 1; price = 1 }) } } 'طويل' 'customer name over 50'
# second line fails after the master row and first line were written: all of it must roll back
Assert-Throws { W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 1; price = 1 }, @{ item = 'مادة وهمية'; unit = 'كارتون'; qty = 1; price = 1 }) } } 'المادة مو موجودة' 'failure on line 2'
Assert ((Rows 'MasterOut').Count -eq $n) 'failed saves left no invoice behind (rollback)'
Assert-Throws { W 'nope' @{} } 'مو معروفة' 'unknown operation'

Write-Host "`n== purchase"
$chest = Row 'madaCode' 'madaName' 'صدر مسحب مجمد'
$r = W 'savePurchase' @{ type = 'اجل'; supplier = 'مشروع دواجن الديوانية'; no = '9001'; date = $today; updatePrices = $true
    lines = @(@{ item = 'صدر مسحب مجمد'; unit = $chest.UnitL1; qty = 20; price = 55000 }) }
$pur = Row 'MasterIn' 'IdIn' $r.id
Assert ($pur.fromname -eq 'مشروع دواجن الديوانية' -and $pur.InvoiceNo -eq 9001 -and $pur.InType -eq 'اجل') 'purchase master'
$pl = @((Rows 'subIN') | Where-Object { $_.IdIn -eq $r.id })
Assert ($pl.Count -eq 1 -and $pl[0].QuntIn -eq 20 -and $pl[0].Price -eq 55000 -and $pl[0].IDcode -eq $chest.IDcode) 'purchase line'
$chest2 = Row 'madaCode' 'madaName' 'صدر مسحب مجمد'
Assert ($chest2.BpriceL1 -eq 55000 -and $chest2.BpriceL2 -eq [math]::Round(55000 / $chest.Fill)) "buy price updated to 55000 / $([math]::Round(55000 / $chest.Fill))"
$purId = $r.id
Assert-Throws { W 'savePurchase' @{ type = 'اجل'; supplier = 'مشروع دواجن الديوانية'; no = 'x1'; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 1; price = 1 }) } } 'رقم' 'supplier invoice no must be a number'
Assert-Throws { W 'savePurchase' @{ type = 'اجل'; supplier = ''; lines = @() } } 'المورد' 'purchase needs supplier'

Write-Host "`n== vouchers"
$maxNo = ((Rows 'mablakIn') | ForEach-Object { $x = 0; [void][int]::TryParse([string]$_.mostandNO, [ref]$x); $x } | Measure-Object -Maximum).Maximum
$r = W 'saveReceipt' @{ cls = 'تسديد'; name = 'مكتب العراق - علي فرات'; amount = '250000'; date = $today; note = 'دفعة' }
$rec = Row 'mablakIn' 'idS' $r.id
Assert ($rec.mablak -eq 250000 -and $rec.nameFrom -eq 'مكتب العراق - علي فرات' -and $rec.classS -eq 'تسديد' -and $rec.mostandNO -eq [string]($maxNo + 1)) "receipt, voucher no $($rec.mostandNO)"
$recId = $r.id
W 'saveReceipt' @{ id = $recId; cls = 'تسديد'; name = 'مكتب العراق - علي فرات'; amount = 300000; date = $today } | Out-Null
Assert ((Row 'mablakIn' 'idS' $recId).mablak -eq 300000 -and (Row 'mablakIn' 'idS' $recId).mostandNO -eq $rec.mostandNO) 'receipt edit keeps number'
$r = W 'savePayment' @{ cls = 'كهرباء'; name = ''; amount = 50000; date = $today; note = 'مولدة' }
$pay = Row 'mablakOut' 'idS' $r.id
Assert ($pay.classS -eq 'كهرباء' -and $null -eq $pay.nameto -and $pay.note -eq 'مولدة') 'expense with no name'
$payId = $r.id
$r = W 'savePayment' @{ cls = 'تسديد'; name = 'مشروع دواجن الديوانية'; amount = 1000000; date = $today }
Assert ((Row 'mablakOut' 'idS' $r.id).nameto -eq 'مشروع دواجن الديوانية') 'supplier payment'
$pay2Id = $r.id
Assert-Throws { W 'saveReceipt' @{ cls = 'تسديد'; name = ''; amount = 5 } } 'يحتاج اسم' 'settlement needs a name'
Assert-Throws { W 'saveReceipt' @{ cls = 'تسديد'; name = 'أحد'; amount = 5 } } 'الزبون مو موجود' 'receipt from unknown customer'
Assert-Throws { W 'saveReceipt' @{ cls = 'تسديد'; name = 'أبو علي الجزيرة'; amount = 0 } } 'المبلغ' 'zero amount'
Assert-Throws { W 'savePayment' @{ cls = 'تسديد'; name = 'أحد'; amount = 5 } } 'المورد مو موجود' 'payment to unknown supplier'

Write-Host "`n== customers"
$r = W 'saveCustomer' @{ name = 'زبون تجربة'; mobile = '07700000000'; opening = '15000'; type = 'مفرد'; address = 'المحمودية' }
$c = Row 'bayeeCode' 'id' $r.id
Assert ($c.bayeeCode -eq 'زبون تجربة' -and $c.MB -eq 15000 -and $c.Ctype -eq 'مفرد' -and $c.Group -eq 'المجموعة العامة' -and $c.Mandob -eq 'مباشر' -and $c.credit -eq 0) 'new customer fields'
$custId = $r.id
Assert-Throws { W 'saveCustomer' @{ name = 'زبون تجربة' } } 'بنفس الاسم' 'duplicate customer'
Assert-Throws { W 'saveCustomer' @{ name = 'زبون'; mobile = '0770000000000' } } 'الموبايل' 'mobile over 12'
W 'saveSale' @{ type = 'اجل'; customer = 'زبون تجربة'; lines = @(@{ item = 'كبد'; unit = 'كارتون'; qty = 1; price = 1 }) } | Out-Null
W 'saveReceipt' @{ cls = 'تسديد'; name = 'زبون تجربة'; amount = 1 } | Out-Null
W 'saveCustomer' @{ id = $custId; name = 'زبون تجربة 2'; mobile = '07700000000'; opening = 15000; type = 'مفرد' } | Out-Null
Assert (@((Rows 'MasterOut') | Where-Object { $_.TOname -eq 'زبون تجربة 2' }).Count -eq 1) 'rename carried into invoices'
Assert (@((Rows 'mablakIn') | Where-Object { $_.nameFrom -eq 'زبون تجربة 2' }).Count -eq 1) 'rename carried into receipts'
Assert (@((Rows 'MasterOut') | Where-Object { $_.TOname -eq 'زبون تجربة' }).Count -eq 0) 'old name gone'
Assert-Throws { W 'deleteCustomer' @{ id = $custId } } 'حركة' 'customer with movements cannot be deleted'

Write-Host "`n== suppliers"
$r = W 'saveSupplier' @{ name = 'مورد تجربة'; opening = 100.5; mobile = '' }
Assert ((Row 'shiraCode' 'ID' $r.id).MB -eq 100.5) 'new supplier, fractional opening'
$supId = $r.id
W 'savePayment' @{ cls = 'تسديد'; name = 'مورد تجربة'; amount = 5 } | Out-Null
W 'saveSupplier' @{ id = $supId; name = 'مورد تجربة 2' } | Out-Null
Assert (@((Rows 'mablakOut') | Where-Object { $_.nameto -eq 'مورد تجربة 2' }).Count -eq 1) 'supplier rename carried into payments'

Write-Host "`n== items"
$r = W 'saveItem' @{ name = 'مادة تجربة'; code = '9999'; cls = 'مصنعات'; unitL1 = 'كارتون'; unitL2 = 'قطعة'; fill = 12; priceL1 = 60000; priceL2 = 5500; buyL1 = 50000; buyL2 = 4167; harig = 1 }
$it = Row 'madaCode' 'ID' $r.id
Assert ($it.IDcode -eq '9999' -and $it.price -eq 60000 -and $it.'price$' -eq 60000 -and $it.priceSeeat -eq 5500 -and $it.Fill -eq 12 -and $it.Pr -eq 0) 'new item fields'
$itemId = $r.id
Assert-Throws { W 'saveItem' @{ name = 'مادة ثانية'; code = '9999'; unitL1 = 'كارتون' } } 'بنفس الرمز' 'duplicate code'
Assert-Throws { W 'saveItem' @{ name = 'مادة تجربة'; unitL1 = 'كارتون' } } 'بنفس الاسم' 'duplicate name'
Assert-Throws { W 'saveItem' @{ name = 'مادة ثالثة'; code = '1234567890123456'; unitL1 = 'كارتون' } } 'الرمز' 'code over 15'
Assert-Throws { W 'saveItem' @{ name = 'مادة رابعة'; unitL1 = '' } } 'الوحدة الكبيرة' 'item needs big unit'
W 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'مادة تجربة'; unit = 'قطعة'; qty = 2; price = 5500 }) } | Out-Null
W 'saveItem' @{ id = $itemId; name = 'مادة تجربة 2'; code = '9999'; unitL1 = 'كارتون'; unitL2 = 'قطعة'; fill = 12; priceL1 = 61000; priceL2 = 5600 } | Out-Null
Assert (@((Rows 'subOut') | Where-Object { $_.madaNameOut -eq 'مادة تجربة 2' }).Count -eq 1) 'item rename carried into sale lines'
Assert-Throws { W 'deleteItem' @{ id = $itemId } } 'حركة' 'item with movements cannot be deleted'
$r = W 'saveItem' @{ name = 'مادة للمسح'; unitL1 = 'كيس' }
Assert ((Row 'madaCode' 'ID' $r.id).UnitL2 -eq 'كيس') 'small unit defaults to big unit'
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
Assert-Throws { W 'deleteSale' @{ id = $creditSaleId } } 'مو موجودة' 'deleting twice'

Write-Host "`n== permissions"
$script:Config.admins = @()
Assert (Test-Admin 'كاشير1') 'no managers set: everyone is manager'
$script:Config.admins = @('نور')
Assert ((Test-Admin 'نور') -and -not (Test-Admin 'كاشير1')) 'managers list respected'
Assert (((Get-Perms 'كاشير1') -join ',') -eq 'pos,sale_cash,print') 'default for a non-manager: cash sale + print'
$cashier = @{ user = 'كاشير1'; admin = $false; perms = (Get-Perms 'كاشير1') }
$liver = Row 'madaCode' 'madaName' 'كبد'
$small = @{ item = 'كبد'; unit = $liver.UnitL2; qty = 1; price = $liver.priceSeeat }
function Wc([string]$op, [hashtable]$d, $session) { $d.user = $session.user; $x = [pscustomobject]$d; Test-Allowed $op $x $session; return Invoke-Write $op $x $session }
$r = Wc 'saveSale' @{ type = 'نقدي'; lines = @($small) } $cashier
Assert ($r.id -gt 0) 'cashier: cash sale at list price saved'
Assert-Throws { Wc 'saveSale' @{ type = 'اجل'; customer = 'أبو علي الجزيرة'; lines = @($small) } $cashier } 'صلاحية' 'cashier: no credit sale'
Assert-Throws { Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = $liver.UnitL2; qty = 1; price = 1 }) } $cashier } 'تغيير السعر' 'cashier: no price change'
$egg = Row 'madaCode' 'madaName' 'بيض احمر كبير'
Assert-Throws { Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'بيض احمر كبير'; unit = $egg.UnitL1; qty = 1; price = $egg.price }) } $cashier } 'الجملة' 'cashier: no wholesale (big unit)'
$one = @((Rows 'madaCode') | Where-Object { -not $_['UnitL2'] })[0]
Assert ((Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = $one['madaName']; unit = $one['UnitL1']; qty = 1; price = $(if ($null -eq $one['price']) { 0 } else { $one['price'] }) }) } $cashier).id -gt 0) "cashier: single-unit item ($($one['madaName'])) is not wholesale"
Assert-Throws { Wc 'saveSale' @{ id = $r.id; type = 'نقدي'; lines = @($small) } $cashier } 'صلاحية' 'cashier: cannot edit a sale'
Assert-Throws { Wc 'deleteSale' @{ id = $r.id } $cashier } 'صلاحية' 'cashier: cannot delete'
Assert-Throws { Wc 'saveReceipt' @{ cls = 'تسديد'; name = 'أبو علي الجزيرة'; amount = 5 } $cashier } 'صلاحية' 'cashier: no receipts by default'
Assert-Throws { Wc 'savePurchase' @{ type = 'اجل'; supplier = 'مشروع دواجن الديوانية'; lines = @($small) } $cashier } 'صلاحية' 'cashier: cannot buy'
Assert-Throws { Wc 'saveItem' @{ name = 'x'; unitL1 = 'كيس' } $cashier } 'صلاحية' 'cashier: cannot change items'
$script:Config.perms = @{ 'كاشير1' = @('pos', 'sale_cash', 'sale_credit', 'sale_wholesale', 'edit_price', 'receipt', 'sale_delete') }
$seller = @{ user = 'كاشير1'; admin = $false; perms = (Get-Perms 'كاشير1') }
$r2 = Wc 'saveSale' @{ type = 'اجل'; customer = 'أبو علي الجزيرة'; lines = @(@{ item = 'بيض احمر كبير'; unit = $egg.UnitL1; qty = 2; price = 70000 }) } $seller
Assert ($r2.id -gt 0) 'with permissions: credit + wholesale + own price saved'
Assert ((Wc 'saveReceipt' @{ cls = 'تسديد'; name = 'أبو علي الجزيرة'; amount = 5 } $seller).id -gt 0) 'with permission: receipt saved'
Wc 'deleteSale' @{ id = $r2.id } $seller | Out-Null
Assert ($null -eq (Row 'MasterOut' 'idOut' $r2.id)) 'with permission: delete'
Assert-Throws { Wc 'saveSale' @{ id = $r.id; type = 'نقدي'; lines = @($small) } $seller } 'صلاحية' 'delete permission does not include edit'
$script:Config.perms = @{ 'كاشير1' = @('pos', 'sale_cash', 'sale_edit') }
$editor = @{ user = 'كاشير1'; admin = $false; perms = (Get-Perms 'كاشير1') }
$admin0 = @{ user = 'نور'; admin = $true; perms = @() }
$r3 = Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = $liver.UnitL2; qty = 1; price = 777 }, @{ item = 'بيض احمر كبير'; unit = $egg.UnitL1; qty = 1; price = $egg.price }) } $admin0
Assert ((Wc 'saveSale' @{ id = $r3.id; type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = $liver.UnitL2; qty = 3; price = 777 }, @{ item = 'بيض احمر كبير'; unit = $egg.UnitL1; qty = 2; price = $egg.price }) } $editor).id -eq $r3.id) 'edit permission: change quantities, keeping the invoice prices and units'
Assert-Throws { Wc 'saveSale' @{ id = $r3.id; type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = $liver.UnitL2; qty = 3; price = 1 }) } $editor } 'تغيير السعر' 'edit permission does not include a new price'
Assert-Throws { Wc 'saveSale' @{ id = $r3.id; type = 'اجل'; customer = 'أبو علي الجزيرة'; lines = @(@{ item = 'كبد'; unit = $liver.UnitL2; qty = 3; price = 777 }) } $editor } 'الآجل' 'edit permission cannot turn it into credit'
$script:Config.perms = @{ 'كاشير1' = [string[]]@('sale_credit', 'receipt', 'sale_edit') }
$imp = [string[]](Get-Perms 'كاشير1')
Assert ($imp -is [string[]] -and $imp -contains 'pos' -and $imp -contains 'customers' -and $imp -contains 'sales' -and $imp -notcontains 'cash') "screens come with their actions: $($imp -join ',')"
$js = @{ perms = [string[]](Get-Perms 'كاشير1'); one = [string[]]@('pos') } | ConvertTo-Json -Compress
Assert ($js -match '"perms":\["' -and $js -match '"one":\["pos"\]') "permissions go out as a JSON list: $js"
$script:Config.perms = @{ 'كاشير1' = [string[]]@('pos', 'bogus', 'print') }
Assert ((([string[]](Get-Perms 'كاشير1')) -join ',') -eq 'pos,print') 'unknown permission names are dropped'
# every shape an older version or Windows PowerShell 5.1 may have saved
$shapes = @(
    @('"pos,sale_credit,print"', 'pos,sale_credit,print'),
    @('["pos","sale_credit"]', 'pos,sale_credit'),
    @('{"value":["sale_credit","receipt"],"Count":2}', 'sale_credit,receipt'),
    @('[{"value":"print"}]', 'print'),
    @('[]', ''),
    @('""', ''),
    @('"@{value=System.Object[]; Count=3}"', $null),
    @('["bogus"]', $null)
)
foreach ($sh in $shapes) {
    $got = ConvertTo-PermText ($sh[0] | ConvertFrom-Json)
    Assert ($got -ceq $sh[1]) "saved as $($sh[0]) -> [$got]"
}
$oldCfg = $ConfigFile
$oldConfig = $script:Config
$script:ConfigFile = Join-Path $tmp 'config-test.json'
Set-Content $script:ConfigFile -Encoding UTF8 -Value '{"dbPath":"x","admins":["نور"],"perms":{"كاشير1":{"value":["sale_credit"],"Count":1},"كاشير 2":"@{value=System.Object[]; Count=3}","ض":[]}}'
$script:Config = Read-Config
Assert ((Get-PermText 'كاشير1') -eq 'sale_credit,pos') "old 5.1 save read back: $(Get-PermText 'كاشير1')"
Assert ((Get-PermText 'كاشير 2') -eq 'pos,sale_cash,print') 'unreadable old save falls back to the default'
Assert ((Get-PermText 'ض') -eq '') 'an empty list stays empty'
Save-Config
$saved = Get-Content $script:ConfigFile -Raw -Encoding UTF8
Assert ($saved -match '"كاشير1":\s*"sale_credit"' -and $saved -notmatch '"value"') "saved as text: $($saved -replace '\s+', ' ')"
$script:Config = Read-Config
Assert ((Get-PermText 'كاشير1') -eq 'sale_credit,pos') 'text save reads back'
$script:ConfigFile = $oldCfg
$script:Config = $oldConfig
$script:Config.perms = @{}
$admin = @{ user = 'نور'; admin = $true; perms = (Get-Perms 'نور') }
Assert ((Wc 'saveSale' @{ type = 'نقدي'; lines = @(@{ item = 'كبد'; unit = $liver.UnitL1; qty = 1; price = 1 }) } $admin).id -gt 0) 'manager: anything'
$script:Config.perms = @{}

Write-Host "`n== empty rows"
$b0 = @(Get-BrokenRows)
Assert (-not ($b0 | Where-Object { $_.count -gt 0 })) 'real data: no empty rows found'
Use-Database { param($db) $db.Execute('INSERT INTO [MasterOut] ([Paid]) VALUES (0)', $dbFailOnError); $db.Execute('INSERT INTO [subOut] ([QuntOut]) VALUES (1)', $dbFailOnError) } | Out-Null
$b1 = @(Get-BrokenRows)
Assert ((($b1 | Where-Object { $_.table -eq 'MasterOut' }).count -eq 1) -and (($b1 | Where-Object { $_.table -eq 'subOut' }).count -eq 1)) 'finds an empty invoice and an empty line'
$before = (Rows 'MasterOut').Count
Get-BrokenRows -Clean | Out-Null
Assert ((Rows 'MasterOut').Count -eq $before - 1 -and -not (@(Get-BrokenRows) | Where-Object { $_.count -gt 0 })) 'clean removes only those'

Write-Host "`n== full test (on a copy)"
$counts0 = @{}; foreach ($tb in 'MasterOut', 'subOut', 'MasterIn', 'subIN', 'mablakIn', 'mablakOut', 'bayeeCode', 'shiraCode', 'madaCode') { $counts0[$tb] = (Rows $tb).Count }
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
Assert ($null -eq $script:DbOverride) 'real file in use again'
Write-Host "   (JSON for the app check: $tmp)"

Write-Host "`n== backup"
$backups = @(Get-ChildItem (Join-Path $tmp 'backups-lawha') -Filter '*.accdb')
Assert ($backups.Count -eq 1 -and $backups[0].Length -eq (Get-Item $dbCopy).Length) "one daily backup: $($backups[0].Name)"

Write-Host "`n== self-test"
$snap = @{}
foreach ($t in $counts.Keys) { $snap[$t] = (Rows $t).Count }
$steps = Invoke-SelfTest
foreach ($s in $steps) { Write-Host ("     {0} {1}: {2}" -f $(if ($s.ok) { '✔' } else { '✘' }), $s.name, $s.msg) }
Assert (-not ($steps | Where-Object { -not $_.ok })) "self-test: all $($steps.Count) steps pass"
foreach ($t in $counts.Keys) { Assert ((Rows $t).Count -eq $snap[$t]) "self-test left $t unchanged" }
Assert ($script:Engine.State.inTrans -eq $false) 'no transaction left open'

if (-not $env:KEEP_TMP) { Remove-Item $tmp -Recurse -Force }
Write-Host "`nALL PASSED ($script:pass checks)" -ForegroundColor Green
