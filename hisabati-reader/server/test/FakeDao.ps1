# Test double for the slice of DAO that server.ps1 uses, so every write
# operation can run against a real data export on a machine without Access.
#
# Loaded from a JSON export (export-tables.mjs) carrying each table's columns
# (type, text size, autonumber) and rows. It is strict where Access is: an
# unknown column, text longer than the field, a non-number in a number
# field, a value outside the Long/Integer range or a bad date all throw, as
# do writes on a read-only database or after Close, and a required (NOT
# NULL) column left empty. SQL is limited to what server.ps1 sends:
# SELECT [TOP n] cols|*|Count(*) FROM t [WHERE a=x AND b<>y AND c IS NULL]
# [ORDER BY c], SELECT @@IDENTITY, INSERT INTO t (a, b) VALUES (x, y),
# DELETE FROM t WHERE ..., UPDATE t SET a=x, ... WHERE ...; literals are
# 'text', numbers, #yyyy-MM-dd HH:mm:ss#, Null, True, False.

function New-FakeEngine([string]$jsonPath) {
    $j = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $tables = @{}
    foreach ($p in $j.PSObject.Properties) {
        $cols = @($p.Value.columns)
        $rows = New-Object System.Collections.Generic.List[hashtable]
        foreach ($r in $p.Value.rows) {
            $h = @{}
            foreach ($c in $cols) { $h[$c.name] = ConvertTo-FakeValue $c $r.($c.name) $p.Name }
            $rows.Add($h)
        }
        $auto = ($cols | Where-Object { $_.auto } | Select-Object -First 1).name
        $next = 1
        if ($auto -and $rows.Count) { $next = [int](($rows | ForEach-Object { [int]$_[$auto] } | Measure-Object -Maximum).Maximum) + 1 }
        $tables[$p.Name] = @{ name = $p.Name; columns = $cols; rows = $rows; auto = $auto; next = $next }
    }
    $state = @{ tables = $tables; snapshot = $null; inTrans = $false; identity = 0; statements = New-Object System.Collections.Generic.List[string] }

    $ws = [pscustomobject]@{ State = $state }
    $ws | Add-Member ScriptMethod BeginTrans {
        if ($this.State.inTrans) { throw 'FakeDao: nested transaction' }
        $this.State.snapshot = Copy-FakeTables $this.State.tables
        $this.State.inTrans = $true
    }
    $ws | Add-Member ScriptMethod CommitTrans {
        if (-not $this.State.inTrans) { throw 'FakeDao: CommitTrans without BeginTrans' }
        $this.State.inTrans = $false
        $this.State.snapshot = $null
    }
    $ws | Add-Member ScriptMethod Rollback {
        if (-not $this.State.inTrans) { throw 'FakeDao: Rollback without BeginTrans' }
        $this.State.tables = $this.State.snapshot
        $this.State.inTrans = $false
        $this.State.snapshot = $null
    }
    $ws | Add-Member ScriptMethod OpenDatabase {
        param($path, $exclusive, $readOnly)
        if (-not (Test-Path -LiteralPath $path)) { throw "FakeDao: file not found $path" }
        return New-FakeDb $this.State ([bool]$readOnly)
    }
    $wsList = [pscustomobject]@{ Ws = $ws }
    $wsList | Add-Member ScriptMethod Item { param($i) if ($i -ne 0) { throw 'FakeDao: only workspace 0' }; return $this.Ws }
    return [pscustomobject]@{ Workspaces = $wsList; State = $state }
}

function Copy-FakeTables($tables) {
    $copy = @{}
    foreach ($k in $tables.Keys) {
        $t = $tables[$k]
        $rows = New-Object System.Collections.Generic.List[hashtable]
        foreach ($r in $t.rows) { $rows.Add($r.Clone()) }
        $copy[$k] = @{ name = $t.name; columns = $t.columns; rows = $rows; auto = $t.auto; next = $t.next }
    }
    return $copy
}

function Get-FakeTable($state, [string]$name) {
    $name = $name.Trim('[', ']')
    foreach ($k in $state.tables.Keys) { if ($k -ieq $name) { return $state.tables[$k] } }
    throw "FakeDao: table not found: $name"
}

function Get-FakeColumn($table, [string]$name) {
    $name = $name.Trim('[', ']')
    foreach ($c in $table.columns) { if ($c.name -ieq $name) { return $c } }
    throw "FakeDao: Item not found in this collection: $($table.name).$name"
}

# Converts and checks a value the way Access would store it in column $c.
function ConvertTo-FakeValue($c, $v, [string]$table) {
    if ($null -eq $v -or $v -is [DBNull]) { return $null }
    $where = "$table.$($c.name)"
    switch ($c.type) {
        'text' {
            $s = [string]$v
            if ($s.Length -gt [int]$c.size) { throw "FakeDao: text too long for $where ($($s.Length) > $($c.size))" }
            return $s
        }
        'memo' { return [string]$v }
        { $_ -in 'long', 'integer', 'byte' } {
            $d = 0.0
            if (-not [double]::TryParse("$v", [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) {
                throw "FakeDao: Data type conversion error for $where ($v)"
            }
            $limit = switch ($c.type) { 'long' { 2147483647 } 'integer' { 32767 } default { 255 } }
            if ([math]::Abs($d) -gt $limit) { throw "FakeDao: Overflow in $where ($v)" }
            return [int][math]::Round($d)
        }
        { $_ -in 'float', 'double', 'numeric', 'currency' } {
            if ($v -is [bool]) { throw "FakeDao: Data type conversion error for $where (bool)" }
            $d = 0.0
            if (-not [double]::TryParse("$v", [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) {
                throw "FakeDao: Data type conversion error for $where ($v)"
            }
            return $d
        }
        'datetime' {
            if ($v -is [datetime]) { return $v }
            $dt = [datetime]::MinValue
            if (-not [datetime]::TryParse("$v", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$dt)) {
                throw "FakeDao: Data type conversion error for $where ($v)"
            }
            return $dt
        }
        'boolean' { return [bool]$v }
        default { return $v }
    }
}

# ---------------------------------------------------------------- SQL

function Split-FakeSql([string]$sql) {
    $tokens = New-Object System.Collections.Generic.List[object]
    $i = 0
    while ($i -lt $sql.Length) {
        $ch = $sql[$i]
        if ([char]::IsWhiteSpace($ch)) { $i++; continue }
        if ($ch -eq "'") {
            $sb = New-Object System.Text.StringBuilder
            $i++
            while ($true) {
                if ($i -ge $sql.Length) { throw "FakeDao: unterminated string in: $sql" }
                if ($sql[$i] -eq "'") {
                    if ($i + 1 -lt $sql.Length -and $sql[$i + 1] -eq "'") { [void]$sb.Append("'"); $i += 2; continue }
                    $i++; break
                }
                [void]$sb.Append($sql[$i]); $i++
            }
            $tokens.Add(@{ k = 'str'; v = $sb.ToString() }); continue
        }
        if ($ch -eq '#') {
            $end = $sql.IndexOf('#', $i + 1)
            $tokens.Add(@{ k = 'date'; v = [datetime]::ParseExact($sql.Substring($i + 1, $end - $i - 1), 'yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture) }); $i = $end + 1; continue
        }
        if ($ch -eq '[') {
            $end = $sql.IndexOf(']', $i)
            $tokens.Add(@{ k = 'id'; v = $sql.Substring($i + 1, $end - $i - 1) }); $i = $end + 1; continue
        }
        if ($ch -eq '<' -and $i + 1 -lt $sql.Length -and $sql[$i + 1] -eq '>') { $tokens.Add(@{ k = 'op'; v = '<>' }); $i += 2; continue }
        if ('=,*();'.Contains([string]$ch)) { $tokens.Add(@{ k = 'op'; v = [string]$ch }); $i++; continue }
        if ($ch -eq '@' -and $sql.Substring($i).StartsWith('@@IDENTITY')) { $tokens.Add(@{ k = 'identity'; v = '@@IDENTITY' }); $i += 10; continue }
        if ([char]::IsDigit($ch) -or ($ch -eq '-' -and $i + 1 -lt $sql.Length -and [char]::IsDigit($sql[$i + 1]))) {
            $j = $i + 1
            while ($j -lt $sql.Length -and ([char]::IsDigit($sql[$j]) -or $sql[$j] -eq '.')) { $j++ }
            $tokens.Add(@{ k = 'num'; v = [double]::Parse($sql.Substring($i, $j - $i), [Globalization.CultureInfo]::InvariantCulture) }); $i = $j; continue
        }
        $j = $i
        while ($j -lt $sql.Length -and -not [char]::IsWhiteSpace($sql[$j]) -and -not '=,*();<>'.Contains([string]$sql[$j])) { $j++ }
        if ($j -eq $i) { throw "FakeDao: cannot parse at '$($sql.Substring($i))'" }
        $tokens.Add(@{ k = 'id'; v = $sql.Substring($i, $j - $i) }); $i = $j
    }
    return , $tokens.ToArray()
}

# A literal token as a value: 'text', number, #date#, Null, True, False.
function Get-FakeLiteral($tok) {
    switch ($tok.k) {
        'str' { return @{ ok = $true; v = $tok.v } }
        'num' { return @{ ok = $true; v = $tok.v } }
        'date' { return @{ ok = $true; v = $tok.v } }
        'id' {
            if ($tok.v -ieq 'Null') { return @{ ok = $true; v = $null } }
            if ($tok.v -ieq 'True') { return @{ ok = $true; v = $true } }
            if ($tok.v -ieq 'False') { return @{ ok = $true; v = $false } }
        }
    }
    return @{ ok = $false }
}

function Read-FakeWhere($t, [ref]$pos) {
    $conds = @()
    while ($pos.Value -lt $t.Count) {
        $col = $t[$pos.Value]; $op = $t[$pos.Value + 1]; $val = $t[$pos.Value + 2]
        if ($col.k -eq 'id' -and $op.v -ieq 'IS' -and $val.v -ieq 'NULL') {
            $conds += @{ col = $col.v; op = 'isnull' }
            $pos.Value += 3
        } else {
            if ($col.k -ne 'id' -or $op.k -ne 'op' -or $op.v -notin '=', '<>' -or $val.k -notin 'str', 'num') {
                throw 'FakeDao: unsupported WHERE clause'
            }
            $conds += @{ col = $col.v; op = $op.v; val = $val.v }
            $pos.Value += 3
        }
        if ($pos.Value -lt $t.Count -and $t[$pos.Value].v -ieq 'AND') { $pos.Value++; continue }
        break
    }
    return , $conds
}

function Test-FakeRow($row, $conds, $table) {
    foreach ($c in $conds) {
        [void](Get-FakeColumn $table $c.col)
        $v = $row[$c.col]
        if ($c.op -eq 'isnull') { if ($null -ne $v) { return $false } else { continue } }
        if ($null -eq $v) { return $false }
        $eq = if ($c.val -is [string]) { ([string]$v).TrimEnd() -ieq $c.val.TrimEnd() } else { [double]$v -eq [double]$c.val }
        if ($c.op -eq '=' -and -not $eq) { return $false }
        if ($c.op -eq '<>' -and $eq) { return $false }
    }
    return $true
}

function Select-FakeRows($state, [string]$sql) {
    $t = Split-FakeSql $sql
    $p = 0
    if ($t[$p].v -ine 'SELECT') { throw "FakeDao: expected SELECT: $sql" }
    $p++
    $top = 0
    if ($t[$p].v -ieq 'TOP') { $top = [int]$t[$p + 1].v; $p += 2 }
    $cols = @(); $count = $false; $star = $false
    while ($t[$p].v -ine 'FROM') {
        $tok = $t[$p]
        if ($tok.k -eq 'op' -and $tok.v -eq '*') { $star = $true; $p++ }
        elseif ($tok.v -ieq 'Count' -and $t[$p + 1].v -eq '(') { $count = $true; $p += 4 }
        elseif ($tok.k -eq 'op' -and $tok.v -eq ',') { $p++ }
        elseif ($tok.k -eq 'id') { $cols += $tok.v; $p++ }
        else { throw "FakeDao: unsupported select list: $sql" }
    }
    $p++
    $table = Get-FakeTable $state $t[$p].v
    $p++
    $conds = @()
    $order = $null; $desc = $false
    while ($p -lt $t.Count) {
        if ($t[$p].v -ieq 'WHERE') { $p++; $pp = $p; $conds = Read-FakeWhere $t ([ref]$pp); $p = $pp; continue }
        if ($t[$p].v -ieq 'ORDER') { $order = $t[$p + 2].v; $p += 3; if ($p -lt $t.Count -and $t[$p].v -ieq 'DESC') { $desc = $true; $p++ }; continue }
        if ($t[$p].v -eq ';') { $p++; continue }
        throw "FakeDao: unsupported SQL near '$($t[$p].v)': $sql"
    }
    foreach ($c in $cols) { [void](Get-FakeColumn $table $c) }
    $rows = @($table.rows | Where-Object { Test-FakeRow $_ $conds $table })
    if ($order) {
        [void](Get-FakeColumn $table $order)
        $rows = @($rows | Sort-Object -Property @{ Expression = { $_[$order] }; Descending = $desc })
    }
    if ($top -gt 0) { $rows = @($rows | Select-Object -First $top) }
    return @{ table = $table; rows = $rows; cols = $cols; count = $count; star = $star }
}

# ---------------------------------------------------------------- database

function New-FakeDb($state, [bool]$readOnly) {
    $db = [pscustomobject]@{ State = $state; ReadOnly = $readOnly; Closed = $false }
    $db | Add-Member ScriptProperty TableDefs { @($this.State.tables.Keys | ForEach-Object { [pscustomobject]@{ Name = $_ } }) }
    $db | Add-Member ScriptMethod Close { $this.Closed = $true }
    $db | Add-Member ScriptMethod OpenRecordset {
        param([string]$source, $type, $options)
        if ($this.Closed) { throw 'FakeDao: database is closed' }
        $this.State.statements.Add($source)
        if ($source -match '^\s*SELECT\s+@@IDENTITY\s*$') {
            return New-FakeRecordset $this @{ name = '@@IDENTITY'; columns = @(); auto = $null } @(@{ Expr1000 = $this.State.identity }) @('Expr1000') $true $false
        }
        if ($source -notmatch '^\s*SELECT\s') {
            $table = Get-FakeTable $this.State $source
            $rows = if ($options -eq 8) { @() } else { @($table.rows) }
            return New-FakeRecordset $this $table $rows @() $false $true
        }
        $sel = Select-FakeRows $this.State $source
        if ($sel.count) {
            $row = @{ Expr1000 = $sel.rows.Count }
            return New-FakeRecordset $this $sel.table @($row) @('Expr1000') $true $false
        }
        $cols = if ($sel.star) { @($sel.table.columns | ForEach-Object { $_.name }) } else { $sel.cols }
        # Snapshots (type 4) copy; dynasets edit the table rows in place.
        $rows = if ($type -eq 4) { @($sel.rows | ForEach-Object { $_.Clone() }) } else { $sel.rows }
        return New-FakeRecordset $this $sel.table $rows $cols ($type -eq 4) $false
    }
    $db | Add-Member ScriptMethod Execute {
        param([string]$sql, $options)
        if ($this.Closed) { throw 'FakeDao: database is closed' }
        if ($this.ReadOnly) { throw 'FakeDao: database is read-only' }
        $this.State.statements.Add($sql)
        $t = Split-FakeSql $sql
        if ($t[0].v -ieq 'DELETE') {
            if ($t[1].v -ine 'FROM' -or $t[3].v -ine 'WHERE') { throw "FakeDao: unsupported DELETE: $sql" }
            $table = Get-FakeTable $this.State $t[2].v
            $p = 4
            $conds = Read-FakeWhere $t ([ref]$p)
            $doomed = @($table.rows | Where-Object { Test-FakeRow $_ $conds $table })
            foreach ($r in $doomed) { [void]$table.rows.Remove($r) }
            return
        }
        if ($t[0].v -ieq 'UPDATE') {
            $table = Get-FakeTable $this.State $t[1].v
            if ($t[2].v -ine 'SET') { throw "FakeDao: unsupported UPDATE: $sql" }
            $p = 3
            $sets = @()
            while ($t[$p].v -ine 'WHERE') {
                if ($t[$p].k -eq 'op' -and $t[$p].v -eq ',') { $p++; continue }
                $col = Get-FakeColumn $table $t[$p].v
                $lit = Get-FakeLiteral $t[$p + 2]
                if ($t[$p + 1].v -ne '=' -or -not $lit.ok) { throw "FakeDao: unsupported SET: $sql" }
                if ($col.auto) { throw "FakeDao: cannot update autonumber $($col.name)" }
                if ($null -eq $lit.v -and -not $col.nullable) { throw "FakeDao: You must enter a value in the '$($table.name).$($col.name)' field." }
                $sets += @{ col = $col; val = (ConvertTo-FakeValue $col $lit.v $table.name) }
                $p += 3
            }
            $p++
            $conds = Read-FakeWhere $t ([ref]$p)
            foreach ($r in @($table.rows | Where-Object { Test-FakeRow $_ $conds $table })) {
                foreach ($s in $sets) { $r[$s.col.name] = $s.val }
            }
            return
        }
        if ($t[0].v -ieq 'INSERT') {
            if ($t[1].v -ine 'INTO' -or $t[3].v -ne '(') { throw "FakeDao: unsupported INSERT: $sql" }
            $table = Get-FakeTable $this.State $t[2].v
            $p = 4
            $cols = @()
            while ($t[$p].v -ne ')') { if ($t[$p].v -ne ',') { $cols += (Get-FakeColumn $table $t[$p].v) }; $p++ }
            $p++
            if ($t[$p].v -ine 'VALUES' -or $t[$p + 1].v -ne '(') { throw "FakeDao: unsupported INSERT: $sql" }
            $p += 2
            $vals = @()
            while ($t[$p].v -ne ')' -or $t[$p].k -ne 'op') {
                if ($t[$p].k -eq 'op' -and $t[$p].v -eq ',') { $p++; continue }
                $lit = Get-FakeLiteral $t[$p]
                if (-not $lit.ok) { throw "FakeDao: unsupported value '$($t[$p].v)' in: $sql" }
                $vals += , $lit.v
                $p++
            }
            if ($cols.Count -ne $vals.Count) { throw "FakeDao: $($cols.Count) columns but $($vals.Count) values" }
            $row = @{}
            foreach ($c in $table.columns) { $row[$c.name] = $null }
            for ($i = 0; $i -lt $cols.Count; $i++) {
                if ($cols[$i].auto) { throw "FakeDao: cannot insert into autonumber $($cols[$i].name)" }
                $row[$cols[$i].name] = ConvertTo-FakeValue $cols[$i] $vals[$i] $table.name
            }
            foreach ($c in $table.columns) {
                if (-not $c.nullable -and -not $c.auto -and $null -eq $row[$c.name] -and $c.type -ne 'boolean') {
                    throw "FakeDao: You must enter a value in the '$($table.name).$($c.name)' field."
                }
                if ($c.type -eq 'boolean' -and $null -eq $row[$c.name]) { $row[$c.name] = $false }
            }
            if ($table.auto) { $row[$table.auto] = $table.next; $this.State.identity = $table.next; $table.next++ }
            $table.rows.Add($row)
            return
        }
        throw "FakeDao: unsupported statement: $sql"
    }
    return $db
}

function New-FakeRecordset($db, $table, $rows, $cols, [bool]$snapshot, [bool]$tableMode) {
    $rs = [pscustomobject]@{
        Db = $db; Table = $table; Rows = @($rows | Where-Object { $null -ne $_ }); Cols = @($cols | Where-Object { $_ }); Snapshot = $snapshot
        Pos = 0; Mode = ''; Pending = $null; Target = $null; Closed = $false
    }
    $rs | Add-Member ScriptProperty EOF { $this.Pos -ge $this.Rows.Count }
    $rs | Add-Member ScriptMethod MoveNext { if ($this.Pos -ge $this.Rows.Count) { throw 'FakeDao: No current record' }; $this.Pos++ }
    $rs | Add-Member ScriptMethod Close { $this.Closed = $true }
    $rs | Add-Member ScriptMethod AddNew {
        if ($this.Snapshot -or $this.Db.ReadOnly) { throw 'FakeDao: Operation is not supported for this type of object (AddNew)' }
        $p = @{}
        foreach ($c in $this.Table.columns) { $p[$c.name] = $null }
        if ($this.Table.auto) { $p[$this.Table.auto] = $this.Table.next; $this.Table.next++ }
        $this.Pending = $p; $this.Mode = 'add'
    }
    $rs | Add-Member ScriptMethod Edit {
        if ($this.Snapshot -or $this.Db.ReadOnly) { throw 'FakeDao: Operation is not supported for this type of object (Edit)' }
        if ($this.Pos -ge $this.Rows.Count) { throw 'FakeDao: No current record' }
        $this.Target = $this.Rows[$this.Pos]
        $this.Pending = $this.Target.Clone(); $this.Mode = 'edit'
    }
    $rs | Add-Member ScriptMethod Update {
        if (-not $this.Mode) { throw 'FakeDao: Update or CancelUpdate without AddNew or Edit' }
        if ($this.Db.Closed) { throw 'FakeDao: database is closed' }
        if ($this.Mode -eq 'add') { $this.Table.rows.Add($this.Pending) }
        else { foreach ($k in @($this.Pending.Keys)) { $this.Target[$k] = $this.Pending[$k] } }
        $this.Mode = ''; $this.Pending = $null; $this.Target = $null
    }
    $fields = [pscustomobject]@{ Rs = $rs }
    $fields | Add-Member ScriptMethod Item {
        param($key)
        $rs = $this.Rs
        if ($rs.Closed) { throw 'FakeDao: recordset is closed' }
        if ($key -is [int]) {
            $cols = @(if ($rs.Cols.Count) { $rs.Cols } else { $rs.Table.columns | ForEach-Object { $_.name } })
            $name = $cols[$key]
        } else {
            $name = [string]$key
            if ($rs.Cols.Count -and -not ($rs.Cols | Where-Object { $_ -ieq $name })) { throw "FakeDao: Item not found in this collection: $name" }
            if ($name -ne 'Expr1000') { $name = (Get-FakeColumn $rs.Table $name).name }
        }
        $f = [pscustomobject]@{ Rs = $rs; Name = $name }
        $f | Add-Member ScriptProperty Value {
            $r = $this.Rs
            if ($r.Mode) { $v = $r.Pending[$this.Name] }
            else {
                if ($r.Pos -ge $r.Rows.Count) { throw 'FakeDao: No current record' }
                $v = $r.Rows[$r.Pos][$this.Name]
            }
            if ($null -eq $v) { return [DBNull]::Value }
            return $v
        } {
            param($v)
            $r = $this.Rs
            if (-not $r.Mode) { throw 'FakeDao: Update or CancelUpdate without AddNew or Edit' }
            $col = Get-FakeColumn $r.Table $this.Name
            if ($col.auto -and $r.Mode -eq 'edit') { throw "FakeDao: cannot update autonumber $($this.Name)" }
            $r.Pending[$this.Name] = ConvertTo-FakeValue $col $v $r.Table.name
        }
        return $f
    }
    $rs | Add-Member NoteProperty Fields $fields
    return $rs
}

# Test helper: current rows of a table.
function Get-FakeRows($engine, [string]$table) { return , @((Get-FakeTable $engine.State $table).rows) }
