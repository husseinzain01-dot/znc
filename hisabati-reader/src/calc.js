// Report calculations. Each one follows the query حساباتي itself uses, so the
// numbers match what the cashier sees in the Access program:
//   customer balance  M1Qcust/M2Qmadeen : opening (MB) + credit sales − paid on
//                                          credit invoices − receipts (تسديد)
//   supplier balance  D1Qprov/D2Qdaeen  : opening (MB) + credit purchases − payments (تسديد)
//   stock             RaseedT1..T3      : opening + purchases − sales, per unit level,
//                                          folded into cartons/pieces by Karton()/seeat()
//   cash box          sandokMovement2   : cash sales + receipts − cash purchases − payments
// One deliberate difference: when an item's two units have the same name
// (e.g. كارتون/كارتون), RaseedT1 counts each line twice; here it counts once.

export const CREDIT = 'اجل';
export const CASH = 'نقدي';
export const SETTLE = 'تسديد';

export const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
const userMatch = (u, user) => !user || u === user;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

function groupSum(arr, keyFn, valFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    m.set(k, (m.get(k) || 0) + valFn(x));
  }
  return m;
}

// Index tables once per load; every report reads from this.
export function prepare(db) {
  const linesBySale = new Map();
  for (const l of db.saleLines) {
    if (!linesBySale.has(l.saleId)) linesBySale.set(l.saleId, []);
    linesBySale.get(l.saleId).push(l);
  }
  const linesByPurchase = new Map();
  for (const l of db.purchaseLines) {
    if (!linesByPurchase.has(l.purchaseId)) linesByPurchase.set(l.purchaseId, []);
    linesByPurchase.get(l.purchaseId).push(l);
  }
  const sales = db.sales.map((s) => {
    const lines = linesBySale.get(s.id) || [];
    return { ...s, lines, total: sum(lines, (l) => l.qty * l.price) };
  });
  const purchases = db.purchases.map((p) => {
    const lines = linesByPurchase.get(p.id) || [];
    return { ...p, lines, total: sum(lines, (l) => l.qty * l.price) };
  });
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const itemByName = new Map(db.items.map((i) => [i.name, i]));
  const users = [...new Set(sales.map((s) => s.user).filter(Boolean))].sort();
  const dates = sales.map((s) => s.date).filter(Boolean).sort();
  return { ...db, sales, purchases, saleById, itemByName, users, firstDate: dates[0] || '', lastDate: dates.at(-1) || '' };
}

// ---------- sales ----------

export function salesInRange(P, { from, to, user, type } = {}) {
  return P.sales.filter((s) => inRange(s.date, from, to) && userMatch(s.user, user) && (!type || s.type === type));
}

export function salesSummary(P, filter = {}) {
  const list = salesInRange(P, filter).filter((s) => s.lines.length > 0);
  const lines = list.flatMap((s) => s.lines.map((l) => ({ ...l, sale: s })));
  const cash = sum(list.filter((s) => s.type === CASH), (s) => s.total);
  const credit = sum(list.filter((s) => s.type === CREDIT), (s) => s.total);
  const byItem = [...groupSum(lines, (l) => l.item, (l) => l.qty * l.price)].map(([item, total]) => ({
    item,
    total,
    qty: sum(lines.filter((l) => l.item === item), (l) => l.qty),
  }));
  byItem.sort((a, b) => b.total - a.total);
  const byDay = [...groupSum(list, (s) => s.date, (s) => s.total)].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const byUser = [...groupSum(list, (s) => s.user || '—', (s) => s.total)].sort((a, b) => b[1] - a[1]);
  const byCustomer = [...groupSum(list.filter((s) => s.type === CREDIT), (s) => s.customer, (s) => s.total)].sort((a, b) => b[1] - a[1]);
  return { list, count: list.length, total: cash + credit, cash, credit, byItem, byDay, byUser, byCustomer };
}

// ---------- customers & suppliers ----------

function balanceTable(people, movements) {
  const m = new Map();
  const get = (name) => {
    if (!m.has(name)) m.set(name, { name, opening: 0, debit: 0, credit: 0, last: '', info: null });
    return m.get(name);
  };
  for (const p of people) Object.assign(get(p.name), { opening: get(p.name).opening + p.opening, info: p });
  for (const mv of movements) {
    const e = get(mv.name);
    e.debit += mv.debit || 0;
    e.credit += mv.credit || 0;
    if (mv.date > e.last) e.last = mv.date;
  }
  return [...m.values()]
    .map((e) => ({ ...e, balance: e.opening + e.debit - e.credit }))
    .sort((a, b) => b.balance - a.balance);
}

function customerMovements(P) {
  const out = [];
  for (const s of P.sales) {
    if (s.type !== CREDIT) continue;
    out.push({ name: s.customer, date: s.date, time: s.time, kind: 'sale', ref: s.id, debit: s.total, desc: `قائمة بيع آجل رقم ${s.id}` });
    if (s.paid) out.push({ name: s.customer, date: s.date, time: s.time, kind: 'paid', ref: s.id, credit: s.paid, desc: `مدفوع مع القائمة رقم ${s.id}` });
  }
  for (const r of P.receipts) {
    if (r.cls !== SETTLE) continue;
    out.push({ name: r.name, date: r.date, time: r.time, kind: 'receipt', ref: r.id, credit: r.amount, desc: `تسديد${r.no ? ' وصل رقم ' + r.no : ''}${r.note ? ' — ' + r.note : ''}` });
  }
  return out;
}

function supplierMovements(P) {
  const out = [];
  for (const p of P.purchases) {
    if (p.type !== CREDIT) continue;
    out.push({ name: p.supplier, date: p.date, time: p.time, kind: 'purchase', ref: p.id, debit: p.total, desc: `قائمة شراء آجل رقم ${p.id}${p.note ? ' — ' + p.note : ''}` });
  }
  for (const r of P.payments) {
    if (r.cls !== SETTLE) continue;
    out.push({ name: r.name, date: r.date, time: r.time, kind: 'payment', ref: r.id, credit: r.amount, desc: `تسديد${r.no ? ' وصل رقم ' + r.no : ''}${r.note ? ' — ' + r.note : ''}` });
  }
  return out;
}

export const customerBalances = (P) => balanceTable(P.customers, customerMovements(P));
export const supplierBalances = (P) => balanceTable(P.suppliers, supplierMovements(P));

function statement(person, movements, { from, to } = {}) {
  const opening = person ? person.opening : 0;
  const mine = movements.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : 0));
  let bal = opening;
  const rows = [];
  for (const mv of mine) {
    if (from && mv.date < from) {
      bal += (mv.debit || 0) - (mv.credit || 0);
      continue;
    }
    if (to && mv.date > to) break;
    if (!rows.length) rows.push({ date: from || person?.since || '', desc: from ? 'رصيد سابق' : 'رصيد افتتاحي', debit: 0, credit: 0, balance: bal, kind: 'opening' });
    bal += (mv.debit || 0) - (mv.credit || 0);
    rows.push({ ...mv, debit: mv.debit || 0, credit: mv.credit || 0, balance: bal });
  }
  if (!rows.length) rows.push({ date: from || person?.since || '', desc: from ? 'رصيد سابق' : 'رصيد افتتاحي', debit: 0, credit: 0, balance: bal, kind: 'opening' });
  return { rows, closing: bal, debit: sum(rows, (r) => r.debit), credit: sum(rows, (r) => r.credit) };
}

export function customerStatement(P, name, range) {
  const person = P.customers.find((c) => c.name === name);
  return statement(person, customerMovements(P).filter((m) => m.name === name), range);
}

export function supplierStatement(P, name, range) {
  const person = P.suppliers.find((c) => c.name === name);
  return statement(person, supplierMovements(P).filter((m) => m.name === name), range);
}

// ---------- stock ----------

// Same as Karton() / seeat() in module alaa: fold loose pieces into cartons.
export function karton(k, s, f) {
  if (f <= 0) return k;
  return k + Math.floor(s / f);
}
export function seeat(k, s, f) {
  if (f <= 0) return 0;
  if (karton(k, s, f) < 0) return 0;
  return s - Math.floor(s / f) * f;
}

function unitLevel(item, unit) {
  if (unit === item.unitL1) return 1;
  if (unit === item.unitL2) return 2;
  return 0;
}

export function stock(P) {
  const acc = new Map(P.items.map((i) => [i.name, { L1: i.openL1, L2: i.openL2, inPcs: 0, outPcs: 0 }]));
  const pieces = (item, lvl, q) => (lvl === 1 && item.fill > 0 ? q * item.fill : q);
  const apply = (line, sign) => {
    const item = P.itemByName.get(line.item);
    if (!item) return;
    const lvl = unitLevel(item, line.unit);
    if (!lvl) return;
    const a = acc.get(item.name);
    a['L' + lvl] += sign * line.qty;
    if (sign > 0) a.inPcs += pieces(item, lvl, line.qty);
    else a.outPcs += pieces(item, lvl, line.qty);
  };
  for (const l of P.purchaseLines) apply(l, +1);
  for (const l of P.saleLines) apply(l, -1);

  return P.items.map((i) => {
    const a = acc.get(i.name);
    const k = karton(a.L1, a.L2, i.fill);
    const s = seeat(a.L1, a.L2, i.fill);
    const totalPcs = i.fill > 0 ? a.L1 * i.fill + a.L2 : a.L1;
    const status = totalPcs < 0 ? 'بالسالب' : totalPcs === 0 ? 'نافد' : i.harig > 0 && k < i.harig ? 'قليل' : 'متوفر';
    return { ...i, k, s, totalPcs, inPcs: a.inPcs, outPcs: a.outPcs, value: k * i.buyL1 + s * i.buyL2, status };
  });
}

// ---------- cash box ----------

export function cashBox(P, { from, to, user } = {}) {
  const f = (r) => inRange(r.date, from, to) && userMatch(r.user, user);
  const cashSales = P.sales.filter((s) => s.type === CASH && f(s));
  const paidSales = P.sales.filter((s) => s.paid && f(s));
  const cashPurchases = P.purchases.filter((p) => p.type === CASH && f(p));
  const receipts = P.receipts.filter(f);
  const payments = P.payments.filter(f);
  const r = {
    cashSales: sum(cashSales, (s) => s.total),
    paidWithInvoices: sum(paidSales, (s) => s.paid),
    receipts: sum(receipts, (x) => x.amount),
    cashPurchases: sum(cashPurchases, (p) => p.total),
    payments: sum(payments, (x) => x.amount),
    receiptList: receipts,
    paymentList: payments,
    purchaseList: cashPurchases,
    byUser: [...groupSum(cashSales, (s) => s.user || '—', (s) => s.total)].sort((a, b) => b[1] - a[1]),
    paymentsByClass: [...groupSum(payments, (x) => x.cls || '—', (x) => x.amount)].sort((a, b) => b[1] - a[1]),
  };
  r.totalIn = r.cashSales + r.paidWithInvoices + r.receipts;
  r.totalOut = r.cashPurchases + r.payments;
  r.net = r.totalIn - r.totalOut;
  return r;
}

// ---------- profit ----------

// Cost of a sold line = buy price stored on the line when it was sold (falls
// back to the item's current buy price), for the unit level that was sold.
export function lineCost(P, line) {
  const item = P.itemByName.get(line.item);
  if (!item) return null;
  const lvl = unitLevel(item, line.unit);
  if (lvl === 1) return line.buyL1 || item.buyL1;
  if (lvl === 2) return line.buyL2 || item.buyL2;
  return null;
}

export function profit(P, filter = {}) {
  const list = salesInRange(P, filter);
  const m = new Map();
  let unknown = 0;
  for (const s of list) {
    for (const l of s.lines) {
      const cost = lineCost(P, l);
      if (cost == null) {
        unknown += l.qty * l.price;
        continue;
      }
      if (!m.has(l.item)) m.set(l.item, { item: l.item, qty: 0, revenue: 0, cost: 0 });
      const e = m.get(l.item);
      e.qty += l.qty;
      e.revenue += l.qty * l.price;
      e.cost += l.qty * cost;
    }
  }
  const items = [...m.values()].map((e) => ({ ...e, profit: e.revenue - e.cost, margin: e.revenue ? (e.revenue - e.cost) / e.revenue : 0 }));
  items.sort((a, b) => b.profit - a.profit);
  const expenses = P.payments.filter((x) => x.cls !== SETTLE && inRange(x.date, filter.from, filter.to));
  const gross = sum(items, (e) => e.profit);
  const expenseTotal = sum(expenses, (x) => x.amount);
  return {
    items,
    revenue: sum(items, (e) => e.revenue),
    cost: sum(items, (e) => e.cost),
    gross,
    expenses,
    expenseTotal,
    net: gross - expenseTotal,
    unknown,
  };
}
