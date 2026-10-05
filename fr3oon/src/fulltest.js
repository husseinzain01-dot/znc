// The app's half of the full test (Settings → الفحص الشامل). The helper
// saves, edits and deletes on a copy of the data file with the real Access
// engine; here the copy is read back the same way the app reads the real
// file, and the reports must come out as expected:
//   after the saves: the test records add up, nothing else moved;
//   after the deletes: everything is back to where it started.

import * as C from './calc.js';

const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.5;
const money = (n) => Math.round(n || 0).toLocaleString('en-US');

function checker() {
  const steps = [];
  const check = (name, fn) => {
    try {
      const msg = fn();
      steps.push({ name, ok: true, msg: msg || 'سليم' });
    } catch (e) {
      steps.push({ name, ok: false, msg: e.message });
    }
  };
  const need = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  return { steps, check, need };
}

const balances = (list) => new Map(list.map((b) => [b.name, b.balance]));
const stockMap = (P) => new Map(C.stock(P).map((s) => [s.name, s.totalPcs]));

// Everything not made by the test must read the same in both.
function sameExcept(P0, P1, e, check, need) {
  const skipC = new Set([e.customer, e.tag && e.tag + ' عميل']);
  for (const [label, f, skip] of [
    ['أرصدة بقية العملاء لم تتغير', C.customerBalances, skipC],
    ['أرصدة بقية الموردين لم تتغير', C.supplierBalances, new Set([e.supplier])],
  ]) {
    check(label, () => {
      const a = balances(f(P0));
      const b = balances(f(P1));
      for (const [name, bal] of a) {
        if (skip.has(name)) continue;
        need(b.has(name), `"${name}" اختفى`);
        need(near(b.get(name), bal), `"${name}" كان ${money(bal)} وأصبح ${money(b.get(name))}`);
      }
      return `عدد الحسابات: ${a.size}`;
    });
  }
  check('مخزون بقية الأصناف لم يتغير', () => {
    const a = stockMap(P0);
    const b = stockMap(P1);
    for (const [name, pcs] of a) {
      if (name === e.item) continue;
      need(b.has(name), `"${name}" اختفى`);
      need(near(b.get(name), pcs), `"${name}" كان ${pcs} وأصبح ${b.get(name)}`);
    }
    return `عدد الأصناف: ${a.size}`;
  });
  check('فواتير الآخرين وسنداتهم لم تتغير', () => {
    const other = (list) => list.filter((x) => x.user !== e.user);
    for (const [label, k] of [['فواتير البيع', 'sales'], ['فواتير الشراء', 'purchases'], ['سندات القبض', 'receipts'], ['سندات الصرف', 'payments']]) {
      need(other(P0[k]).length === other(P1[k]).length, `${label}: كانت ${other(P0[k]).length} وأصبحت ${other(P1[k]).length}`);
    }
    const total = (P) => C.sum(other(P.sales), (s) => s.total);
    need(near(total(P0), total(P1)), `مجموع المبيعات كان ${money(total(P0))} وأصبح ${money(total(P1))}`);
    return `عدد فواتير البيع: ${other(P1.sales).length}`;
  });
}

export function verifyRun(P0, P1, e, today) {
  const { steps, check, need } = checker();
  const f = { from: today, to: today, user: e.user };
  check('رصيد عميل الفحص في كشف الحساب', () => {
    const b = C.customerBalances(P1).find((x) => x.name === e.customer);
    need(b, 'العميل غير موجود في الملف');
    need(near(b.balance, e.customerBalance), `النتيجة ${money(b.balance)} والمتوقع ${money(e.customerBalance)}`);
    const st = C.customerStatement(P1, e.customer, {});
    need(near(st.closing, e.customerBalance), `نتيجة كشف الحساب ${money(st.closing)} والمتوقع ${money(e.customerBalance)}`);
    return money(b.balance);
  });
  check('رصيد مورد الفحص', () => {
    const b = C.supplierBalances(P1).find((x) => x.name === e.supplier);
    need(b, 'المورد غير موجود في الملف');
    need(near(b.balance, e.supplierBalance), `النتيجة ${money(b.balance)} والمتوقع ${money(e.supplierBalance)}`);
    return money(b.balance);
  });
  check('مخزون صنف الفحص (كراتين وقطع)', () => {
    const s = C.stock(P1).find((x) => x.name === e.item);
    need(s, 'الصنف غير موجود في الملف');
    need(s.totalPcs === e.stockPcs && s.k === e.stockK && s.s === e.stockS, `النتيجة: كراتين ${s.k} وقطع ${s.s}، والمتوقع: كراتين ${e.stockK} وقطع ${e.stockS}`);
    return `كراتين: ${s.k}، قطع: ${s.s}`;
  });
  check('تقرير المبيعات', () => {
    const s = C.salesSummary(P1, f);
    need(s.count === e.salesCount, `عدد الفواتير ${s.count} والمتوقع ${e.salesCount}`);
    need(near(s.total, e.salesTotal) && near(s.cash, e.salesCash) && near(s.credit, e.salesCredit),
      `المجموع ${money(s.total)} (نقدي ${money(s.cash)}، آجل ${money(s.credit)}) والمتوقع ${money(e.salesTotal)}`);
    return `عدد الفواتير: ${s.count}، المجموع: ${money(s.total)}`;
  });
  check('فاتورة البيع الآجل بعد التعديل', () => {
    const inv = P1.sales.find((s) => s.customer === e.customer);
    need(inv, 'الفاتورة غير موجودة');
    need(inv.lines.length === 2, `عدد أسطرها ${inv.lines.length} والمتوقع 2`);
    need(near(inv.total, 17500) && near(inv.paid, 4000), `المبلغ ${money(inv.total)} والمدفوع ${money(inv.paid)}`);
    return `رقم ${inv.id}`;
  });
  check('الصندوق', () => {
    const b = C.cashBox(P1, f);
    need(near(b.totalIn, e.cashIn) && near(b.totalOut, e.cashOut) && near(b.net, e.cashNet),
      `الوارد ${money(b.totalIn)} والصادر ${money(b.totalOut)} والمتوقع ${money(e.cashIn)} و${money(e.cashOut)}`);
    return `الصافي ${money(b.net)}`;
  });
  check('الأرباح (حسب سعر الشراء وقت البيع)', () => {
    const p = C.profit(P1, f);
    need(near(p.gross, e.gross), `النتيجة ${money(p.gross)} والمتوقع ${money(e.gross)}`);
    return money(p.gross);
  });
  sameExcept(P0, P1, e, check, need);
  return steps;
}

export function verifyClean(P0, P2, e) {
  const { steps, check, need } = checker();
  check('لم يبقَ أثر لبيانات الفحص', () => {
    need(!P2.customers.some((c) => c.name === e.customer), 'عميل الفحص ما زال موجودًا');
    need(!P2.suppliers.some((c) => c.name === e.supplier), 'مورد الفحص ما زال موجودًا');
    need(!P2.items.some((c) => c.name === e.item), 'صنف الفحص ما زال موجودًا');
    need(![...P2.sales, ...P2.receipts, ...P2.payments].some((x) => x.user === e.user), 'بقيت فواتير أو سندات من الفحص');
  });
  check('عادت الأعداد كما كانت في البداية', () => {
    for (const [label, k] of [['العملاء', 'customers'], ['الموردون', 'suppliers'], ['الأصناف', 'items'], ['فواتير البيع', 'sales'], ['أسطر البيع', 'saleLines'],
      ['فواتير الشراء', 'purchases'], ['أسطر الشراء', 'purchaseLines'], ['سندات القبض', 'receipts'], ['سندات الصرف', 'payments']]) {
      need(P0[k].length === P2[k].length, `${label}: كانت ${P0[k].length} وأصبحت ${P2[k].length}`);
    }
  });
  sameExcept(P0, P2, { ...e, customer: '', supplier: '', item: '' }, check, need);
  return steps;
}

// Tables sent as JSON by the helper (the main computer's data for another
// device, or the test engine's copy) in the shape mdb-reader has, for
// load.js. Rows come as objects, or as arrays with the column names once.
export function readerFromTables(tables) {
  const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/;
  const rowsOf = (t) =>
    t.cols ? (t.rows || []).map((a) => Object.fromEntries(t.cols.map((c, i) => [c, a[i]]))) : t.rows || [];
  return {
    getTableNames: () => Object.keys(tables),
    getTable: (name) => ({
      getData: ({ columns } = {}) =>
        rowsOf(tables[name]).map((r) => {
          const o = {};
          for (const k of columns || Object.keys(r)) o[k] = typeof r[k] === 'string' && iso.test(r[k]) ? new Date(r[k] + 'Z') : r[k];
          return o;
        }),
    }),
  };
}
