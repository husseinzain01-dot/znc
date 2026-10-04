// The fast Numeric reader (src/stubs/numeric-fast.js) must give exactly
// what mdb-reader's own gives, for every Numeric value in a real file and
// for edge cases. Usage: node test/numeric.test.mjs <Units2026.accdb>
import fs from 'node:fs';
import { readNumeric as slow } from '../node_modules/mdb-reader/lib/node/data/numeric.js';
import { readNumeric as fast } from '../src/stubs/numeric-fast.js';
import MDBReader from 'mdb-reader';

let n = 0;
let bad = 0;
const same = (buf, column, where) => {
  n++;
  const a = slow(buf, column);
  const b = fast(buf, column);
  if (a !== b && bad++ < 10) console.log('DIFF', where, a, b);
};
// edge cases: zero, negative, large, every scale
const raw = (sign, bytes) => Buffer.from([sign, ...bytes]);
for (const scale of [0, 1, 2, 4, 8, 18, 28]) {
  for (const b of [[], [1], [5], [255], [0, 0, 0, 0, 1], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], Array(16).fill(255), Array(16).fill(0)]) {
    const bytes = [...b, ...Array(16).fill(0)].slice(0, 16);
    same(raw(0, bytes), { scale }, `scale ${scale} ${b}`);
    same(raw(0x80, bytes), { scale }, `-scale ${scale} ${b}`);
  }
}
for (let i = 0; i < 20000; i++) {
  const bytes = Array.from({ length: 16 }, () => (Math.random() < 0.6 ? 0 : Math.floor(Math.random() * 256)));
  same(raw(Math.random() < 0.5 ? 0 : 0x80, bytes), { scale: Math.floor(Math.random() * 10) }, 'random');
}
// every Numeric value in the file: a copy of mdb-reader with the fast one
// swapped in, against the original
if (process.argv[2]) {
  const path = await import('node:path');
  const lib = path.resolve('node_modules/mdb-reader/lib/node');
  // next to the original, so its own dependencies resolve
  const copy = lib + '-fast-test';
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(lib, copy, { recursive: true });
  fs.copyFileSync(path.resolve('src/stubs/numeric-fast.js'), path.join(copy, 'data/numeric.js'));
  const Fast = (await import(path.join(copy, 'index.js'))).default;
  const buf = fs.readFileSync(process.argv[2]);
  const a = new MDBReader(buf);
  const b = new Fast(buf);
  let t0 = 0;
  let t1 = 0;
  for (const t of a.getTableNames()) {
    const cols = a.getTable(t).getColumns().filter((c) => c.type === 'numeric').map((c) => c.name);
    if (!cols.length) continue;
    let s = performance.now();
    const ra = a.getTable(t).getData({ columns: cols });
    t0 += performance.now() - s;
    s = performance.now();
    const rb = b.getTable(t).getData({ columns: cols });
    t1 += performance.now() - s;
    ra.forEach((row, i) => cols.forEach((c) => {
      n++;
      if (row[c] !== rb[i][c] && bad++ < 10) console.log('DIFF', t, c, i, row[c], rb[i][c]);
    }));
  }
  fs.rmSync(copy, { recursive: true, force: true });
  console.log(`file: original ${t0.toFixed(0)} ms, fast ${t1.toFixed(0)} ms`);
}
console.log(bad ? `${bad} DIFFERENT of ${n}` : `ALL SAME (${n} values)`);
process.exit(bad ? 1 : 0);
