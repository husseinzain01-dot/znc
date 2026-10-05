// Calculations behind التقارير المتقدمة and التحليلات. Pure functions over the
// prepared data (calc.js prepare): no DOM, so they run under node in
// test/analysis.test.mjs. Costs follow C.profit exactly: a sold line costs
// the buy price stored on it (or the item's current one), and a line whose
// item or unit is unknown has no cost — its revenue goes to `unknown` and
// it is left out of every profit figure.

import * as C from './calc.js';

export const CASH_CUSTOMER = 'عميل نقدي';
export const NO_CLASS = 'بدون فئة';
export const NO_SUPPLIER = 'بدون مورد سابق';
// Week as the shop counts it: Saturday first.
export const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

// ---------- dates (ISO 'YYYY-MM-DD', calendar arithmetic in UTC) ----------

const utc = (iso) => new Date(iso + 'T00:00:00Z');
export const isoToday = () => new Date().toLocaleDateString('en-CA');
export function addDays(iso, n) {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const monthEnd = (ym) => {
  const d = utc(ym + '-01');
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};
export function addMonths(ym, n) {
  const d = utc(ym + '-01');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
// 0 = Saturday … 6 = Friday
export const weekdayIndex = (iso) => (utc(iso).getUTCDay() + 1) % 7;

// The period just before [from, to], of the same length. A period that
// starts on the 1st of a month and stays inside it compares with the same
// days of the month before (this month so far vs last month's first days;
// a whole month vs the whole month before). Open-ended periods have none.
export function previousPeriod(from, to) {
  if (!from || !to || from > to) return null;
  if (from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7)) {
    const pm = addMonths(from.slice(0, 7), -1);
    const end = to === monthEnd(from.slice(0, 7)) ? monthEnd(pm) : pm + '-' + to.slice(8);
    return { from: pm + '-01', to: end > monthEnd(pm) ? monthEnd(pm) : end };
  }
  const n = daysBetween(from, to) + 1;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

export const pctChange = (cur, prev) => (prev ? (cur - prev) / Math.abs(prev) : null);

// ---------- units ----------

const unitLevel = (item, unit) => (unit === item.unitL1 ? 1 : unit === item.unitL2 ? 2 : 0);
// Does this item have a real small unit inside the big one?
export const twoUnits = (item) => item.fill > 1 && !!item.unitL2 && item.unitL2 !== item.unitL1;
// A sold/bought quantity in the item's smallest unit; null when the unit is unknown.
export function toPieces(item, unit, qty) {
  const lvl = unitLevel(item, unit);
  if (!lvl) return null;
  return lvl === 1 && item.fill > 0 ? qty * item.fill : qty;
}
// Pieces back to big units (may be fractional).
export const toBig = (item, pcs) => (item.fill > 0 ? pcs / item.fill : pcs);
// Pieces as "big + small" for display.
export function splitPieces(item, pcs) {
  if (!twoUnits(item)) return { big: toBig(item, pcs), small: 0 };
  const sign = pcs < 0 ? -1 : 1;
  const a = Math.abs(pcs);
  const big = Math.floor(a / item.fill);
  return { big: sign * big, small: sign * (a - big * item.fill) };
}

// ---------- sales lists ----------

// Invoices that count as sales: with lines, cash or credit (as salesSummary).
export function saleList(P, filter = {}) {
  return C.salesInRange(P, filter).filter((s) => s.lines.length > 0 && (s.type === C.CASH || s.type === C.CREDIT));
}

// ---------- profit per item / per category ----------

export function itemProfit(P, filter = {}) {
  const m = new Map();
  let unknown = 0;
  for (const s of C.salesInRange(P, filter)) {
    for (const l of s.lines) {
      const cost = C.lineCost(P, l);
      if (cost == null) {
        unknown += l.qty * l.price;
        continue;
      }
      const it = P.itemByName.get(l.item);
      if (!m.has(l.item)) {
        m.set(l.item, { item: l.item, cls: it.cls || NO_CLASS, unitL1: it.unitL1, unitL2: it.unitL2, pcs: 0, revenue: 0, cost: 0, sales: new Set() });
      }
      const e = m.get(l.item);
      e.pcs += toPieces(it, l.unit, l.qty);
      e.revenue += l.qty * l.price;
      e.cost += l.qty * cost;
      e.sales.add(s.id);
    }
  }
  const items = [...m.values()].map(({ sales, ...e }) => {
    const it = P.itemByName.get(e.item);
    const { big, small } = splitPieces(it, e.pcs);
    const profit = e.revenue - e.cost;
    return { ...e, big, small, two: twoUnits(it), invoices: sales.size, profit, margin: e.revenue ? profit / e.revenue : 0 };
  });
  items.sort((a, b) => b.profit - a.profit);
  const revenue = C.sum(items, (e) => e.revenue);
  const cost = C.sum(items, (e) => e.cost);
  return { items, revenue, cost, gross: revenue - cost, margin: revenue ? (revenue - cost) / revenue : 0, unknown };
}

export function categoryProfit(P, filter = {}) {
  const ip = itemProfit(P, filter);
  const m = new Map();
  for (const e of ip.items) {
    if (!m.has(e.cls)) m.set(e.cls, { cls: e.cls, items: 0, revenue: 0, cost: 0 });
    const c = m.get(e.cls);
    c.items++;
    c.revenue += e.revenue;
    c.cost += e.cost;
  }
  const cats = [...m.values()].map((c) => ({
    ...c,
    profit: c.revenue - c.cost,
    margin: c.revenue ? (c.revenue - c.cost) / c.revenue : 0,
    share: ip.revenue ? c.revenue / ip.revenue : 0,
  }));
  cats.sort((a, b) => b.revenue - a.revenue);
  return { cats, revenue: ip.revenue, cost: ip.cost, gross: ip.gross, unknown: ip.unknown };
}

// ---------- stock-based reports (not tied to the period) ----------

export function lastSaleDates(P) {
  const m = new Map();
  for (const s of P.sales) {
    if (!s.date) continue;
    for (const l of s.lines) if (!m.has(l.item) || m.get(l.item) < s.date) m.set(l.item, s.date);
  }
  return m;
}

// In stock, and not sold for `days` days or more (or never).
export function slowMoving(P, days, today = isoToday(), stock = C.stock(P)) {
  const last = lastSaleDates(P);
  return stock
    .filter((x) => x.totalPcs > 0)
    .map((x) => {
      const d = last.get(x.name) || '';
      return { ...x, last: d, since: d ? daysBetween(d, today) : null };
    })
    .filter((x) => x.since == null || x.since >= days)
    .sort((a, b) => b.value - a.value);
}

// Latest purchase line of each item: supplier, date and price per big unit.
export function lastPurchases(P) {
  const m = new Map();
  const list = [...P.purchases].sort((a, b) => (a.date + String(a.id).padStart(9, '0') < b.date + String(b.id).padStart(9, '0') ? -1 : 1));
  for (const p of list) {
    for (const l of p.lines) {
      const it = P.itemByName.get(l.item);
      if (!it) continue;
      const lvl = unitLevel(it, l.unit);
      if (!lvl) continue;
      const price = lvl === 1 || !(it.fill > 0) ? l.price : l.price * it.fill;
      m.set(l.item, { supplier: p.supplier, date: p.date, price, purchaseId: p.id });
    }
  }
  return m;
}

// Pieces sold per item from `from` on.
function soldSince(P, from) {
  const m = new Map();
  for (const s of P.sales) {
    if (!s.date || s.date < from) continue;
    for (const l of s.lines) {
      const it = P.itemByName.get(l.item);
      const pcs = it && toPieces(it, l.unit, l.qty);
      if (pcs == null) continue;
      m.set(l.item, (m.get(l.item) || 0) + pcs);
    }
  }
  return m;
}

// Items to order: at or below the reorder level (harig > 0, k < harig), or
// out of stock and sold in the last 60 days. Suggested order, in big units:
// enough to bring the stock up to 2 × harig — or, with no reorder level,
// to what sold in the last 30 days — at least 1.
export function lowStock(P, today = isoToday(), stock = C.stock(P)) {
  const sold60 = soldSince(P, addDays(today, -59));
  const sold30 = soldSince(P, addDays(today, -29));
  const lastBuy = lastPurchases(P);
  const out = [];
  for (const x of stock) {
    const below = x.harig > 0 && x.k < x.harig;
    const outOfStock = x.totalPcs <= 0 && (sold60.get(x.name) || 0) > 0;
    if (!below && !outOfStock) continue;
    const have = Math.max(0, toBig(x, x.totalPcs));
    const target = x.harig > 0 ? 2 * x.harig : Math.ceil(toBig(x, sold30.get(x.name) || 0));
    const qty = Math.max(1, Math.ceil(target - have - 1e-9));
    const lb = lastBuy.get(x.name);
    const price = lb ? lb.price : x.buyL1;
    out.push({
      ...x,
      reason: x.totalPcs <= 0 ? 'نافد' : 'تحت حد الطلب',
      qty,
      supplier: lb?.supplier || '',
      lastDate: lb?.date || '',
      price,
      est: qty * price,
      sold60: toBig(x, sold60.get(x.name) || 0),
    });
  }
  out.sort((a, b) => a.supplier.localeCompare(b.supplier, 'ar') || a.name.localeCompare(b.name, 'ar'));
  return out;
}

export const lowStockCount = (P, today = isoToday()) => lowStock(P, today).length;

// Low-stock rows grouped by last supplier (named suppliers first).
export function groupBySupplier(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.supplier || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m]
    .map(([supplier, items]) => ({ supplier, items, total: C.sum(items, (r) => r.est) }))
    .sort((a, b) => (!a.supplier) - (!b.supplier) || b.total - a.total);
}

// ---------- period figures ----------

export function periodStats(P, filter = {}) {
  const list = saleList(P, filter);
  const sales = C.sum(list, (s) => s.total);
  const ip = itemProfit(P, filter);
  const cash = C.sum(list.filter((s) => s.type === C.CASH), (s) => s.total);
  return {
    sales,
    invoices: list.length,
    avg: list.length ? sales / list.length : 0,
    gross: ip.gross,
    units: C.sum(list, (s) => C.sum(s.lines, (l) => l.qty)),
    cash,
    credit: sales - cash,
    unknown: ip.unknown,
  };
}

// This period's figures, the previous period's, and the change of each.
export function comparePeriods(P, filter = {}) {
  const cur = periodStats(P, filter);
  const range = previousPeriod(filter.from, filter.to);
  if (!range) return { cur, prev: null, range: null, change: null };
  const prev = periodStats(P, { ...filter, ...range });
  const change = Object.fromEntries(Object.keys(cur).map((k) => [k, pctChange(cur[k], prev[k])]));
  return { cur, prev, range, change };
}

const byKey = (list, keyFn) => {
  const m = new Map();
  for (const s of list) {
    const k = keyFn(s);
    if (k == null) continue;
    const e = m.get(k) || { total: 0, count: 0 };
    e.total += s.total;
    e.count++;
    m.set(k, e);
  }
  return m;
};

// Sales by hour of the day the invoice was entered (0–23).
export function salesByHour(P, filter = {}) {
  const m = byKey(saleList(P, filter), (s) => (/^\d{4}-\d\d-\d\d \d\d/.test(s.time) ? Number(s.time.slice(11, 13)) : null));
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, ...(m.get(h) || { total: 0, count: 0 }) }));
}

export function salesByWeekday(P, filter = {}) {
  const m = byKey(saleList(P, filter), (s) => (s.date ? weekdayIndex(s.date) : null));
  return WEEKDAYS.map((name, i) => ({ day: i, name, ...(m.get(i) || { total: 0, count: 0 }) }));
}

// Every day from..to (missing days are 0).
export function salesByDay(P, filter, from, to) {
  const m = byKey(saleList(P, { ...filter, from, to }), (s) => s.date);
  const out = [];
  if (!from || !to) return out;
  for (let d = from; d <= to && out.length < 2000; d = addDays(d, 1)) out.push({ date: d, ...(m.get(d) || { total: 0, count: 0 }) });
  return out;
}

// The trend chart: this period against the one before, point by point.
// One day → by hour; up to 120 days → by day; longer → by month.
export function salesTrend(P, filter = {}) {
  let { from, to } = filter;
  if (!from) from = P.firstDate;
  if (!to) to = P.lastDate && P.lastDate > (from || '') ? P.lastDate : from;
  if (!from || !to) return { mode: 'day', points: [], prev: null };
  const prevRange = previousPeriod(filter.from, filter.to);
  if (from === to) {
    const cur = salesByHour(P, { ...filter, from, to });
    const prev = prevRange ? salesByHour(P, { ...filter, ...prevRange }) : null;
    return { mode: 'hour', from, to, prev: prevRange, points: cur.map((c, i) => ({ label: String(c.hour).padStart(2, '0') + ':00', cur: c.total, prev: prev ? prev[i].total : null })) };
  }
  const days = daysBetween(from, to) + 1;
  if (days <= 120) {
    const cur = salesByDay(P, filter, from, to);
    const prev = prevRange ? salesByDay(P, filter, prevRange.from, prevRange.to) : null;
    return {
      mode: 'day', from, to, prev: prevRange,
      points: cur.map((c, i) => ({ label: c.date, cur: c.total, prev: prev ? (prev[i]?.total ?? null) : null, prevLabel: prev?.[i]?.date || '' })),
    };
  }
  const months = [];
  for (let ym = from.slice(0, 7); ym <= to.slice(0, 7) && months.length < 600; ym = addMonths(ym, 1)) months.push(ym);
  const m = byKey(saleList(P, { ...filter, from, to }), (s) => s.date.slice(0, 7));
  return { mode: 'month', from, to, prev: null, points: months.map((ym) => ({ label: ym, cur: m.get(ym)?.total || 0, prev: null })) };
}

// Customers by sales in the period; the walk-in cash customer is summed apart.
export function topCustomers(P, filter = {}, n = 10) {
  const list = saleList(P, filter);
  const isCash = (s) => !s.customer || s.customer === CASH_CUSTOMER;
  const m = byKey(list.filter((s) => !isCash(s)), (s) => s.customer);
  const all = [...m].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.total - a.total);
  const cash = list.filter(isCash);
  return { list: all.slice(0, n), customers: all.length, cashTotal: C.sum(cash, (s) => s.total), cashCount: cash.length, total: C.sum(list, (s) => s.total) };
}

export function salesByUser(P, filter = {}) {
  const m = byKey(saleList(P, filter), (s) => s.user || '—');
  return [...m].map(([user, e]) => ({ user, ...e })).sort((a, b) => b.total - a.total);
}

// ---------- the last 12 months ----------

export function monthlyComparison(P, months = 12, today = isoToday()) {
  const last = today.slice(0, 7);
  const rows = [];
  for (let i = months; i >= 0; i--) {
    const ym = addMonths(last, -i);
    const range = { from: ym + '-01', to: monthEnd(ym) };
    const list = saleList(P, range);
    const sales = C.sum(list, (s) => s.total);
    const pr = C.profit(P, range);
    rows.push({ month: ym, invoices: list.length, sales, cost: pr.cost, gross: pr.gross, expenses: pr.expenseTotal, net: pr.net, avg: list.length ? sales / list.length : 0 });
  }
  // the extra (oldest) month is only there to give the first one its change
  for (let i = 1; i < rows.length; i++) {
    rows[i].change = pctChange(rows[i].sales, rows[i - 1].sales);
    rows[i].netChange = pctChange(rows[i].net, rows[i - 1].net);
  }
  return rows.slice(1);
}
