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
      steps.push({ name, ok: true, msg: msg || 'تمام' });
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
  const skipC = new Set([e.customer, e.tag && e.tag + ' زبون']);
  for (const [label, f, skip] of [
    ['أرصدة كل الزبائن الثانيين ما تغيّرت', C.customerBalances, skipC],
    ['أرصدة كل الموردين الثانيين ما تغيّرت', C.supplierBalances, new Set([e.supplier])],
  ]) {
    check(label, () => {
      const a = balances(f(P0));
      const b = balances(f(P1));
      for (const [name, bal] of a) {
        if (skip.has(name)) continue;
        need(b.has(name), `"${name}" اختفى`);
        need(near(b.get(name), bal), `"${name}" كان ${money(bal)} وصار ${money(b.get(name))}`);
      }
      return `${a.size} حساب`;
    });
  }
  check('مخزن كل المواد الثانية ما تغيّر', () => {
    const a = stockMap(P0);
    const b = stockMap(P1);
    for (const [name, pcs] of a) {
      if (name === e.item) continue;
      need(b.has(name), `"${name}" اختفت`);
      need(near(b.get(name), pcs), `"${name}" كان ${pcs} وصار ${b.get(name)}`);
    }
    return `${a.size} مادة`;
  });
  check('قوائم ووصولات الآخرين ما تغيّرت', () => {
    const other = (list) => list.filter((x) => x.user !== e.user);
    for (const [label, k] of [['قوائم البيع', 'sales'], ['قوائم الشراء', 'purchases'], ['وصولات القبض', 'receipts'], ['وصولات الدفع', 'payments']]) {
      need(other(P0[k]).length === other(P1[k]).length, `${label}: كانت ${other(P0[k]).length} وصارت ${other(P1[k]).length}`);
    }
    const total = (P) => C.sum(other(P.sales), (s) => s.total);
    need(near(total(P0), total(P1)), `مجموع المبيعات كان ${money(total(P0))} وصار ${money(total(P1))}`);
    return `${other(P1.sales).length} قائمة بيع`;
  });
}

export function verifyRun(P0, P1, e, today) {
  const { steps, check, need } = checker();
  const f = { from: today, to: today, user: e.user };
  check('رصيد زبون الفحص بكشف الحساب', () => {
    const b = C.customerBalances(P1).find((x) => x.name === e.customer);
    need(b, 'الزبون مو موجود بالملف');
    need(near(b.balance, e.customerBalance), `طلع ${money(b.balance)} والمفروض ${money(e.customerBalance)}`);
    const st = C.customerStatement(P1, e.customer, {});
    need(near(st.closing, e.customerBalance), `كشف الحساب طلع ${money(st.closing)}`);
    return money(b.balance);
  });
  check('رصيد مورد الفحص', () => {
    const b = C.supplierBalances(P1).find((x) => x.name === e.supplier);
    need(b, 'المورد مو موجود بالملف');
    need(near(b.balance, e.supplierBalance), `طلع ${money(b.balance)} والمفروض ${money(e.supplierBalance)}`);
    return money(b.balance);
  });
  check('مخزن مادة الفحص (كارتون وقطع)', () => {
    const s = C.stock(P1).find((x) => x.name === e.item);
    need(s, 'المادة مو موجودة بالملف');
    need(s.totalPcs === e.stockPcs && s.k === e.stockK && s.s === e.stockS, `طلع ${s.k} كارتون و ${s.s} قطعة والمفروض ${e.stockK} و ${e.stockS}`);
    return `${s.k} كارتون و ${s.s} قطعة`;
  });
  check('تقرير المبيعات', () => {
    const s = C.salesSummary(P1, f);
    need(s.count === e.salesCount, `عدد القوائم ${s.count} والمفروض ${e.salesCount}`);
    need(near(s.total, e.salesTotal) && near(s.cash, e.salesCash) && near(s.credit, e.salesCredit),
      `المجموع ${money(s.total)} (نقدي ${money(s.cash)}، آجل ${money(s.credit)}) والمفروض ${money(e.salesTotal)}`);
    return `${s.count} قوائم بـ ${money(s.total)}`;
  });
  check('قائمة البيع الآجل بعد التعديل', () => {
    const inv = P1.sales.find((s) => s.customer === e.customer);
    need(inv, 'القائمة مو موجودة');
    need(inv.lines.length === 2, `بيها ${inv.lines.length} أسطر والمفروض 2`);
    need(near(inv.total, 17500) && near(inv.paid, 4000), `المبلغ ${money(inv.total)} والمدفوع ${money(inv.paid)}`);
    return `رقم ${inv.id}`;
  });
  check('الصندوق', () => {
    const b = C.cashBox(P1, f);
    need(near(b.totalIn, e.cashIn) && near(b.totalOut, e.cashOut) && near(b.net, e.cashNet),
      `داخل ${money(b.totalIn)} طالع ${money(b.totalOut)} والمفروض ${money(e.cashIn)} و ${money(e.cashOut)}`);
    return `الصافي ${money(b.net)}`;
  });
  check('الأرباح (حسب سعر الشراء وقت البيع)', () => {
    const p = C.profit(P1, f);
    need(near(p.gross, e.gross), `طلع ${money(p.gross)} والمفروض ${money(e.gross)}`);
    return money(p.gross);
  });
  sameExcept(P0, P1, e, check, need);
  return steps;
}

export function verifyClean(P0, P2, e) {
  const { steps, check, need } = checker();
  check('ما بقى أثر لبيانات الفحص', () => {
    need(!P2.customers.some((c) => c.name === e.customer), 'زبون الفحص بعده موجود');
    need(!P2.suppliers.some((c) => c.name === e.supplier), 'مورد الفحص بعده موجود');
    need(!P2.items.some((c) => c.name === e.item), 'مادة الفحص بعدها موجودة');
    need(![...P2.sales, ...P2.receipts, ...P2.payments].some((x) => x.user === e.user), 'بقت قوائم أو وصولات من الفحص');
  });
  check('العدد رجع مثل البداية', () => {
    for (const [label, k] of [['الزبائن', 'customers'], ['الموردين', 'suppliers'], ['المواد', 'items'], ['قوائم البيع', 'sales'], ['أسطر البيع', 'saleLines'],
      ['قوائم الشراء', 'purchases'], ['أسطر الشراء', 'purchaseLines'], ['وصولات القبض', 'receipts'], ['وصولات الدفع', 'payments']]) {
      need(P0[k].length === P2[k].length, `${label}: كانت ${P0[k].length} وصارت ${P2[k].length}`);
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
