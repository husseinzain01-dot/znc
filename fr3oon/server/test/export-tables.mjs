// Exports the tables server.ps1 touches, with their schema, to JSON for
// FakeDao.ps1. Passwords are replaced by "test", so the export can be used
// in tests without carrying real credentials.
// Usage: node server/test/export-tables.mjs Units2026.accdb out.json
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import MDBReader from 'mdb-reader';

const [src, out] = process.argv.slice(2);
const r = new MDBReader(fs.readFileSync(src));
const tables = ['MasterOut', 'subOut', 'MasterIn', 'subIN', 'mablakIn', 'mablakOut', 'bayeeCode', 'shiraCode', 'madaCode', 'tblUsers', 'quodCodeIn', 'quodCodeOut'];
// mdb-reader does not expose Access's "Required" property; mdb-schema does
// (as NOT NULL). Without mdbtools every column counts as optional.
function requiredColumns(table) {
  try {
    const sql = execFileSync('mdb-schema', ['--not-null', src, '-T', table], { encoding: 'utf8' });
    return new Set([...sql.matchAll(/\[([^\]]+)\][^\n]*NOT NULL/g)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}

const result = {};
for (const name of tables) {
  const t = r.getTable(name);
  const required = requiredColumns(name);
  const cols = t.getColumns().map((c) => ({
    name: c.name,
    type: c.type,
    // text sizes are stored in bytes (UTF-16)
    size: c.type === 'text' ? c.size / 2 : c.size,
    auto: !!c.autoLong,
    nullable: !required.has(c.name),
  }));
  const keep = name === 'tblUsers' ? ['LoginID', 'UserName', 'UserPWD'] : null;
  const rows = t.getData().map((row) => {
    const o = {};
    for (const c of cols) {
      if (keep && !keep.includes(c.name)) continue;
      let v = row[c.name];
      if (v instanceof Date) v = v.toISOString().slice(0, 19);
      if (name === 'tblUsers' && c.name === 'UserPWD') v = 'test';
      o[c.name] = v ?? null;
    }
    return o;
  });
  result[name] = { columns: keep ? cols.filter((c) => keep.includes(c.name)) : cols, rows };
}
fs.writeFileSync(out, JSON.stringify(result));
console.log(Object.entries(result).map(([k, v]) => `${k}:${v.rows.length}`).join(' '));
