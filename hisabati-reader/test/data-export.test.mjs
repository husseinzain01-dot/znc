// What another device gets from /api/data must give the same reports as
// reading the tables themselves. Usage (after run-ops.ps1 with KEEP_TMP=1):
//   node test/data-export.test.mjs <run-ops temp folder>
import fs from 'node:fs';
import path from 'node:path';
import { loadDatabase } from '../src/load.js';
import * as C from '../src/calc.js';
import { readerFromTables } from '../src/fulltest.js';

const dir = process.argv[2];
const json = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
const P = (tables) => C.prepare(loadDatabase(readerFromTables(tables)));
const A = P(json('data-tables.json'));
const B = P(json('data-export.json').tables);
let bad = 0;
const eq = (label, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(ok ? '  ok ' : '  BAD', label);
  if (!ok) { bad++; console.log('     tables:', JSON.stringify(a).slice(0, 300), '\n     export:', JSON.stringify(b).slice(0, 300)); }
};
for (const k of ['items', 'sales', 'saleLines', 'purchases', 'purchaseLines', 'customers', 'suppliers', 'receipts', 'payments', 'classesIn', 'classesOut', 'userNames']) {
  eq(`${k}: ${A[k].length} rows the same`, A[k], B[k]);
}
eq('customer balances', C.customerBalances(A), C.customerBalances(B));
eq('supplier balances', C.supplierBalances(A), C.supplierBalances(B));
eq('stock', C.stock(A).map((s) => [s.name, s.totalPcs]), C.stock(B).map((s) => [s.name, s.totalPcs]));
eq('cash box (all time)', C.cashBox(A, {}).net, C.cashBox(B, {}).net);
eq('profit (all time)', C.profit(A, {}).gross, C.profit(B, {}).gross);
console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
process.exit(bad ? 1 : 0);
