// Exports the tables server.ps1 touches, with their schema, to JSON for
// FakeDao.ps1. Passwords are replaced by "test", so the export can be used
// in tests without carrying real credentials.
// Usage: node server/test/export-tables.mjs Units2026.accdb out.json
import fs from 'node:fs';
import MDBReader from 'mdb-reader';

const [src, out] = process.argv.slice(2);
const r = new MDBReader(fs.readFileSync(src));
const tables = ['MasterOut', 'subOut', 'MasterIn', 'subIN', 'mablakIn', 'mablakOut', 'bayeeCode', 'shiraCode', 'madaCode', 'tblUsers', 'quodCodeIn', 'quodCodeOut'];
const result = {};
for (const name of tables) {
  const t = r.getTable(name);
  const cols = t.getColumns().map((c) => ({
    name: c.name,
    type: c.type,
    // text sizes are stored in bytes (UTF-16)
    size: c.type === 'text' ? c.size / 2 : c.size,
    auto: !!c.autoLong,
    nullable: c.nullable !== false,
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
