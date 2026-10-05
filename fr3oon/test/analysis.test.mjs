// Unit tests for src/analysis.js on a small hand-made data set.
// Usage: node test/analysis.test.mjs
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import * as A from '../src/analysis.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const item = (id, name, cls, o = {}) => ({
  id, code: String(id), cls, name, harig: 0, priceL1: 0, priceL2: 0, fill: 12, buyL1: 0, buyL2: 0, unitL1: 'كرتونة', unitL2: 'قطعة', openL1: 0, openL2: 0, ...o,
});

const TODAY = '2026-10-05';
let lineId = 0;
const sales = [];
const saleLines = [];
const sale = (id, date, hh, type, customer, lines, user = 'أحمد') => {
  sales.push({ id, no: '', customer, note: '', date, time: `${date} ${hh}:15:00`, type, paid: 0, user, rep: '' });
  for (const [itemName, qty, price, unit, buyL1 = 0, buyL2 = 0] of lines) {
    saleLines.push({ id: ++lineId, saleId: id, item: itemName, qty, price, unit, buyL1, buyL2, note: '' });
  }
};

const db = {
  items: [
    // two units, 12 pieces a carton, reorder level 5 cartons
    item(1, 'شاي', 'مشروبات', { harig: 5, priceL1: 12000, priceL2: 1100, buyL1: 9600, buyL2: 800 }),
    // one unit (same name twice), no reorder level
    item(2, 'رز', 'غذائية', { fill: 1, unitL1: 'كيس', unitL2: 'كيس', priceL1: 14000, buyL1: 11000, buyL2: 11000 }),
    // in stock, never sold
    item(3, 'صابون', 'منظفات', { buyL1: 6000, buyL2: 500 }),
    // in stock, last sold long ago
    item(4, 'زيت', 'غذائية', { fill: 6, buyL1: 30000, buyL2: 5000 }),
  ],
  sales,
  saleLines,
  purchases: [
    { id: 1, no: '', supplier: 'مورد قديم', note: '', date: '2026-01-10', time: '', type: 'اجل', user: 'أحمد' },
    { id: 2, no: '', supplier: 'شركة النور', note: '', date: '2026-09-01', time: '', type: 'اجل', user: 'أحمد' },
    { id: 3, no: '', supplier: 'مخازن الرافدين', note: '', date: '2026-09-02', time: '', type: 'نقدي', user: 'أحمد' },
  ],
  purchaseLines: [
    { id: 1, purchaseId: 1, item: 'شاي', qty: 10, price: 9000, unit: 'كرتونة', expire: '' },
    { id: 2, purchaseId: 2, item: 'شاي', qty: 10, price: 9600, unit: 'كرتونة', expire: '' },
    { id: 3, purchaseId: 3, item: 'رز', qty: 3, price: 11000, unit: 'كيس', expire: '' },
    { id: 4, purchaseId: 2, item: 'صابون', qty: 4, price: 6000, unit: 'كرتونة', expire: '' },
    { id: 5, purchaseId: 1, item: 'زيت', qty: 12, price: 5000, unit: 'قطعة', expire: '' },
  ],
  customers: [{ id: 1, name: 'أبو علي', opening: 0 }, { id: 2, name: 'أم سارة', opening: 0 }],
  suppliers: [],
  receipts: [],
  payments: [
    { id: 1, date: '2026-10-02', no: '', name: '', cls: 'كهرباء', amount: 5000, note: '', time: '', user: 'أحمد' },
    { id: 2, date: '2026-10-03', name: 'شركة النور', cls: C.SETTLE, amount: 50000, note: '', time: '', user: 'أحمد' },
    { id: 3, date: '2026-09-20', name: '', cls: 'إيجار', amount: 20000, note: '', time: '', user: 'أحمد' },
  ],
  stockCounts: [],
  stockCountLines: [],
};

// Saturday 2026-10-03, Sunday 10-04, Monday 10-05; September for the comparison
sale(1, '2026-10-03', '09', C.CASH, A.CASH_CUSTOMER, [['شاي', 2, 12000, 'كرتونة', 9600, 800], ['شاي', 5, 1100, 'قطعة', 9600, 800]]);
sale(2, '2026-10-04', '18', C.CREDIT, 'أبو علي', [['رز', 3, 14000, 'كيس', 11000, 11000]]);
sale(3, '2026-10-05', '18', C.CREDIT, 'أم سارة', [['شاي', 1, 12000, 'كرتونة'], ['رز', 1, 15000, 'كيس']], 'سارة');
// a line whose unit the item does not have: no cost, counted as unknown
sale(4, '2026-10-05', '20', C.CASH, A.CASH_CUSTOMER, [['شاي', 1, 50000, 'صندوق']]);
sale(5, '2026-09-03', '10', C.CASH, A.CASH_CUSTOMER, [['شاي', 4, 12000, 'كرتونة', 9000, 750]]);
sale(6, '2026-09-04', '11', C.CREDIT, 'أبو علي', [['رز', 2, 14000, 'كيس', 10000, 10000]]);
sale(7, '2026-06-01', '12', C.CASH, A.CASH_CUSTOMER, [['زيت', 2, 6000, 'قطعة', 0, 5000]]);
// empty invoice: never counted as a sale
sale(8, '2026-10-05', '21', C.CASH, A.CASH_CUSTOMER, []);

const P = C.prepare(db);
const OCT = { from: '2026-10-01', to: '2026-10-05', user: '' };

// ---- dates
assert.equal(A.addDays('2026-03-01', -1), '2026-02-28');
assert.equal(A.daysBetween('2026-09-30', '2026-10-05'), 5);
assert.equal(A.addMonths('2026-01', -1), '2025-12');
assert.equal(A.WEEKDAYS[A.weekdayIndex('2026-10-03')], 'السبت');
assert.equal(A.WEEKDAYS[A.weekdayIndex('2026-10-09')], 'الجمعة');
assert.deepEqual(A.previousPeriod('2026-10-01', '2026-10-05'), { from: '2026-09-01', to: '2026-09-05' });
assert.deepEqual(A.previousPeriod('2026-03-01', '2026-03-31'), { from: '2026-02-01', to: '2026-02-28' });
assert.deepEqual(A.previousPeriod('2026-03-01', '2026-03-30'), { from: '2026-02-01', to: '2026-02-28' });
assert.deepEqual(A.previousPeriod('2026-09-29', '2026-10-05'), { from: '2026-09-22', to: '2026-09-28' });
assert.deepEqual(A.previousPeriod('2026-10-05', '2026-10-05'), { from: '2026-10-04', to: '2026-10-04' });
assert.equal(A.previousPeriod('', ''), null);
assert.equal(A.previousPeriod('2026-10-01', ''), null);
assert.equal(A.pctChange(150, 100), 0.5);
assert.equal(A.pctChange(5, 0), null);

// ---- units
const tea = P.itemByName.get('شاي');
assert.equal(A.toPieces(tea, 'كرتونة', 2), 24);
assert.equal(A.toPieces(tea, 'قطعة', 5), 5);
assert.equal(A.toPieces(tea, 'صندوق', 1), null);
assert.deepEqual(A.splitPieces(tea, 29), { big: 2, small: 5 });
assert.deepEqual(A.splitPieces(P.itemByName.get('رز'), 4), { big: 4, small: 0 });

// ---- item profit: identical to C.profit
const ip = A.itemProfit(P, OCT);
const pr = C.profit(P, OCT);
near(ip.revenue, pr.revenue, 'revenue matches C.profit');
near(ip.cost, pr.cost, 'cost matches C.profit');
near(ip.gross, pr.gross, 'gross matches C.profit');
near(ip.unknown, pr.unknown, 'unknown matches C.profit');
near(ip.unknown, 50000, 'unknown unit line');
for (const e of pr.items) {
  const mine = ip.items.find((x) => x.item === e.item);
  near(mine.revenue, e.revenue, `${e.item} revenue`);
  near(mine.cost, e.cost, `${e.item} cost`);
}
const teaRow = ip.items.find((x) => x.item === 'شاي');
// 2 cartons + 5 pieces + 1 carton = 41 pieces = 3 cartons + 5 pieces
assert.equal(teaRow.pcs, 41);
assert.deepEqual([teaRow.big, teaRow.small], [3, 5]);
near(teaRow.revenue, 24000 + 5500 + 12000, 'tea revenue');
// line 3 has no stored buy price: falls back to the item's current one
near(teaRow.cost, 2 * 9600 + 5 * 800 + 9600, 'tea cost');
assert.equal(teaRow.invoices, 2);
// per-user filter
near(A.itemProfit(P, { ...OCT, user: 'سارة' }).revenue, 27000, 'user filter');

// ---- category profit
const cp = A.categoryProfit(P, OCT);
near(C.sum(cp.cats, (c) => c.share), 1, 'shares add up to 1');
near(C.sum(cp.cats, (c) => c.profit), ip.gross, 'category profit adds up');
assert.equal(cp.cats.find((c) => c.cls === 'غذائية').items, 1);

// ---- period stats & comparison
const st = A.periodStats(P, OCT);
assert.equal(st.invoices, 4); // the empty invoice is left out
near(st.sales, 24000 + 5500 + 42000 + 27000 + 50000, 'sales');
near(st.cash + st.credit, st.sales, 'cash + credit');
near(st.sales, C.salesSummary(P, OCT).total, 'sales match salesSummary');
const cmp = A.comparePeriods(P, OCT);
assert.deepEqual(cmp.range, { from: '2026-09-01', to: '2026-09-05' });
near(cmp.prev.sales, 48000 + 28000, 'previous sales');
near(cmp.change.sales, (st.sales - 76000) / 76000, 'sales change');
assert.equal(A.comparePeriods(P, { from: '', to: '' }).prev, null);

// ---- hour, weekday, day, trend
const hours = A.salesByHour(P, OCT);
assert.equal(hours.length, 24);
near(hours[18].total, 42000 + 27000, '18:00');
assert.equal(hours[18].count, 2);
near(C.sum(hours, (h) => h.total), st.sales, 'hours add up');
const wd = A.salesByWeekday(P, OCT);
near(wd[0].total, 29500, 'Saturday');
near(wd[1].total, 42000, 'Sunday');
near(C.sum(wd, (d) => d.total), st.sales, 'weekdays add up');
const days = A.salesByDay(P, {}, '2026-10-01', '2026-10-05');
assert.equal(days.length, 5);
assert.equal(days[0].total, 0);
const tr = A.salesTrend(P, OCT);
assert.equal(tr.mode, 'day');
assert.equal(tr.points.length, 5);
near(tr.points[2].prev, 48000, 'previous period aligned by day');
assert.equal(tr.points[2].prevLabel, '2026-09-03');
assert.equal(A.salesTrend(P, { from: '2026-10-05', to: '2026-10-05' }).mode, 'hour');
assert.equal(A.salesTrend(P, { from: '', to: '' }).mode, 'month');

// ---- customers & cashiers
const tc = A.topCustomers(P, OCT);
assert.deepEqual(tc.list.map((c) => c.name), ['أبو علي', 'أم سارة']);
near(tc.cashTotal, 29500 + 50000, 'cash customer apart');
near(tc.cashTotal + C.sum(tc.list, (c) => c.total), st.sales, 'customers add up');
const bu = A.salesByUser(P, OCT);
assert.equal(bu[0].user, 'أحمد');
near(C.sum(bu, (u) => u.total), st.sales, 'users add up');

// ---- slow-moving (stock: soap 4 cartons never sold, oil 10 pieces last sold June)
const slow30 = A.slowMoving(P, 30, TODAY);
assert.deepEqual(slow30.map((x) => x.name).sort(), ['زيت', 'صابون']);
assert.equal(slow30.find((x) => x.name === 'صابون').last, '');
assert.equal(slow30.find((x) => x.name === 'زيت').since, A.daysBetween('2026-06-01', TODAY));
assert.deepEqual(A.slowMoving(P, 180, TODAY).map((x) => x.name), ['صابون']);

// ---- low stock & suggested order
// tea: bought 20 cartons, sold 2c+5p, 1c, 4c (+1 unknown unit) → 12c+7p... below 5? no.
const stock = C.stock(P);
const teaStock = stock.find((x) => x.name === 'شاي');
assert.equal(teaStock.k, 12);
// rice: bought 3, sold 3+1+2 → −3: out of stock and sold recently
const low = A.lowStock(P, TODAY);
assert.deepEqual(low.map((x) => x.name), ['رز']);
const rice = low[0];
assert.equal(rice.reason, 'نافد');
assert.equal(rice.supplier, 'مخازن الرافدين');
assert.equal(rice.price, 11000);
assert.equal(rice.qty, 4); // no reorder level: what sold in the last 30 days (3 + 1)
assert.equal(rice.est, 44000);
assert.equal(A.lowStockCount(P, TODAY), 1);
// With a reorder level of 15 cartons tea is below it: order up to 30.
const P2 = C.prepare({ ...db, items: db.items.map((i) => (i.name === 'شاي' ? { ...i, harig: 15 } : i)) });
const low2 = A.lowStock(P2, TODAY);
const tea2 = low2.find((x) => x.name === 'شاي');
assert.equal(tea2.reason, 'تحت حد الطلب');
assert.equal(tea2.qty, Math.ceil(30 - (12 * 12 + 7) / 12)); // 30 − 12.58 → 18
assert.equal(tea2.supplier, 'شركة النور'); // the latest purchase, not the first
assert.equal(tea2.price, 9600);
// last purchase in small units → price per big unit
assert.equal(A.lastPurchases(P).get('زيت').price, 5000 * 6);
const groups = A.groupBySupplier(low2);
assert.deepEqual(groups.map((g) => g.supplier), ['شركة النور', 'مخازن الرافدين']);
near(C.sum(groups, (g) => g.total), C.sum(low2, (r) => r.est), 'groups add up');

// ---- monthly comparison
const mc = A.monthlyComparison(P, 12, TODAY);
assert.equal(mc.length, 12);
assert.equal(mc.at(-1).month, '2026-10');
assert.equal(mc[0].month, '2025-11');
const oct = mc.at(-1), sep = mc.at(-2);
near(oct.sales, st.sales, 'October sales');
assert.equal(oct.invoices, 4);
near(oct.expenses, 5000, 'expenses leave out تسديد');
near(oct.net, oct.gross - 5000, 'net');
near(sep.expenses, 20000, 'September expenses');
near(oct.change, (oct.sales - sep.sales) / sep.sales, 'change vs September');
assert.equal(mc.find((m) => m.month === '2026-08').change, null); // July had no sales
near(oct.avg, oct.sales / 4, 'average invoice');

console.log('analysis OK');
