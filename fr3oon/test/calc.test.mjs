// Runs every report against a real Units2026.accdb and checks the totals add
// up. Usage: node test/calc.test.mjs path/to/Units2026.accdb
import fs from 'node:fs';
import assert from 'node:assert/strict';
import MDBReader from 'mdb-reader';
import { loadDatabase } from '../src/load.js';
import * as C from '../src/calc.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node test/calc.test.mjs <Units2026.accdb>');
  process.exit(2);
}

const P = C.prepare(loadDatabase(new MDBReader(fs.readFileSync(file))));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.5, `${msg}: ${a} != ${b}`);

console.log(`items ${P.items.length}, sales ${P.sales.length}, lines ${P.saleLines.length}, dates ${P.firstDate} .. ${P.lastDate}`);

// Karton/seeat match the VBA functions.
assert.equal(C.karton(2, 25, 12), 4);
assert.equal(C.seeat(2, 25, 12), 1);
assert.equal(C.karton(2, -5, 12), 1);
assert.equal(C.seeat(2, -5, 12), 7);
assert.equal(C.karton(0, -5, 12), -1);
assert.equal(C.seeat(0, -5, 12), 0);
assert.equal(C.karton(3, 5, 0), 3);

// Sales split.
const all = C.salesSummary(P);
near(all.total, all.cash + all.credit, 'cash + credit');
near(all.total, all.byItem.reduce((a, x) => a + x.total, 0), 'by item');
console.log(`sales ${fmt(all.total)} = cash ${fmt(all.cash)} + credit ${fmt(all.credit)} (${all.count} invoices)`);

// Customer balances: opening + credit sales − paid − receipts.
const cb = C.customerBalances(P);
const credit = P.sales.filter((s) => s.type === C.CREDIT);
const expect =
  P.customers.reduce((a, c) => a + c.opening, 0) +
  credit.reduce((a, s) => a + s.total - s.paid, 0) -
  P.receipts.filter((r) => r.cls === C.SETTLE).reduce((a, r) => a + r.amount, 0);
near(cb.reduce((a, c) => a + c.balance, 0), expect, 'customer balances');
for (const c of cb.slice(0, 5)) {
  const st = C.customerStatement(P, c.name);
  near(st.closing, c.balance, `statement closing for ${c.name}`);
  console.log(`  customer ${c.name}: ${fmt(c.balance)}`);
}
// Statement with a start date carries the earlier balance forward.
const top = cb[0];
const mid = C.customerStatement(P, top.name, { from: '2026-09-25' });
near(mid.closing, top.balance, 'statement from date');

// Supplier balances.
const sb = C.supplierBalances(P);
for (const s of sb) console.log(`  supplier ${s.name}: ${fmt(s.balance)}`);
for (const s of sb) near(C.supplierStatement(P, s.name).closing, s.balance, `supplier statement ${s.name}`);

// Stock.
const st = C.stock(P);
console.log(`stock value ${fmt(st.reduce((a, x) => a + x.value, 0))}, out ${st.filter((x) => x.status === 'نافد').length} negative ${st.filter((x) => x.status === 'بالسالب').length}`);
for (const x of st.slice(0, 6)) console.log(`  ${x.name}: ${x.k} ${x.unitL1} + ${x.s} ${x.unitL2}`);

// Cash box over everything.
const box = C.cashBox(P);
near(box.net, box.cashSales + box.paidWithInvoices + box.receipts - box.cashPurchases - box.payments, 'cash box net');
near(box.cashSales, all.cash, 'cash box cash sales');
console.log(`cash box: in ${fmt(box.totalIn)} out ${fmt(box.totalOut)} net ${fmt(box.net)}`);

// Profit.
const pr = C.profit(P);
console.log(`profit: revenue ${fmt(pr.revenue)} cost ${fmt(pr.cost)} gross ${fmt(pr.gross)} expenses ${fmt(pr.expenseTotal)} net ${fmt(pr.net)} unknown ${fmt(pr.unknown)}`);
near(pr.revenue + pr.unknown, all.total + P.sales.filter((s) => s.lines.length === 0).length * 0, 'profit revenue covers sales');

console.log('OK');
