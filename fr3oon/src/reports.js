// التقارير المتقدمة: profit per item and per category for the period,
// slow-moving items, the last 12 months side by side, and what to reorder
// (with a printable purchase order per supplier). The numbers come from
// analysis.js; this file only lays them out.
import * as A from './analysis.js';

const TABS = [
  ['items', 'أرباح الأصناف'],
  ['cats', 'أرباح الفئات'],
  ['slow', 'الأصناف الراكدة'],
  ['months', 'مقارنة الشهور'],
  ['low', 'النواقص وطلبية الشراء'],
];
const SLOW_DAYS = [30, 60, 90, 180];

export function setupReports(ctx) {
  const { $, esc, fmt, money, table, section, icon, onAfter, can, store, state, forms, toast, localDay } = ctx;
  let tab = TABS.some(([id]) => id === store.get('fr3oon-report-tab')) ? store.get('fr3oon-report-tab') : 'items';
  let slowDays = SLOW_DAYS.includes(Number(store.get('fr3oon-report-slow'))) ? Number(store.get('fr3oon-report-slow')) : 60;
  let lowGroups = [];

  // ---------- small pieces ----------

  const qtyFmt = (n) => (n == null || isNaN(n) ? '' : (Math.round(n * 100) / 100).toLocaleString('en-US'));
  const pctText = (r) => `${(r * 100).toFixed(1)}%`;
  const pct = (r) => `<span class="num${r < 0 ? ' neg' : ''}">${pctText(r)}</span>`;
  const kpi = (label, valueHtml, hint = '', ico = 'reports', accent = false) =>
    `<div class="card kpi${accent ? ' accent' : ''}"><div class="label"><span class="k-ico">${icon(ico)}</span>${esc(label)}</div><div class="value">${valueHtml}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const count = (n) => `<span class="num">${fmt(n)}</span>`;
  // "3 كرتونة + 5 علبة"
  const qtyHtml = (big, small, u1, u2) =>
    `<span class="rep-qty">${big || !small ? `<span class="num">${qtyFmt(big)}</span> ${esc(u1)}` : ''}${big && small ? ' + ' : ''}${small ? `<span class="num">${qtyFmt(small)}</span> ${esc(u2)}` : ''}</span>`;
  const qtyText = (big, small, u1, u2) => [big || !small ? `${qtyFmt(big)} ${u1}` : '', small ? `${qtyFmt(small)} ${u2}` : ''].filter(Boolean).join(' + ');
  // ▲/▼ with the sign and the arrow, never colour alone
  const delta = (r, upIsGood = true) => {
    if (r == null || !isFinite(r)) return '<span class="muted">—</span>';
    const up = r > 0, flat = Math.abs(r) < 0.0005;
    const cls = flat ? 'flat' : up === upIsGood ? 'up' : 'down';
    return `<span class="delta ${cls}"><span aria-hidden="true">${flat ? '•' : up ? '▲' : '▼'}</span> <span class="num">${flat ? '0.0%' : (up ? '+' : '−') + Math.abs(r * 100).toFixed(1) + '%'}</span></span>`;
  };
  const deltaText = (r) => (r == null || !isFinite(r) ? '' : `${r >= 0 ? '+' : '-'}${Math.abs(r * 100).toFixed(1)}%`);
  const chips = (list, on, attr) =>
    `<div class="chips" role="tablist">${list.map(([id, label]) => `<button type="button" class="chip${String(id) === String(on) ? ' on' : ''}" role="tab" aria-selected="${String(id) === String(on)}" ${attr}="${id}">${esc(label)}</button>`).join('')}</div>`;
  const stockHtml = (x) => qtyHtml(x.k, A.twoUnits(x) ? x.s : 0, x.unitL1, x.unitL2);
  const stockText = (x) => qtyText(x.k, A.twoUnits(x) ? x.s : 0, x.unitL1, x.unitL2);

  // ---------- 1. profit per item ----------

  function viewItems() {
    const ip = A.itemProfit(state.P, state.filter);
    const losing = ip.items.filter((x) => x.profit < 0).length;
    return `<div class="grid kpis">
        ${kpi('المبيعات', money(ip.revenue), `الأصناف المبيعة: ${count(ip.items.length)}`, 'sales')}
        ${kpi('التكلفة', money(ip.cost), 'بسعر الشراء وقت البيع', 'out')}
        ${kpi('إجمالي الربح', money(ip.gross), `نسبة الربح ${pctText(ip.margin)}`, 'profit', true)}
        ${kpi('أصناف بخسارة', count(losing), losing ? 'بيعت بأقل من تكلفتها' : 'لا يوجد صنف بيع بخسارة', 'checks')}
      </div>
      ${unknownNote(ip.unknown)}
      ${section('أرباح الأصناف', table(ip.items, [
        { key: 'item', label: 'الصنف' },
        { key: 'cls', label: 'الفئة' },
        { key: 'pcs', label: 'الكمية المبيعة', get: (r) => r.pcs, html: (r) => qtyHtml(r.big, r.small, r.unitL1, r.unitL2), csv: (r) => qtyText(r.big, r.small, r.unitL1, r.unitL2) },
        { key: 'invoices', label: 'الفواتير', num: true },
        { key: 'revenue', label: 'المبيعات', money: true, total: true },
        { key: 'cost', label: 'التكلفة', money: true, total: true },
        { key: 'profit', label: 'الربح', money: true, total: true },
        { key: 'margin', label: 'نسبة الربح', get: (r) => r.margin, html: (r) => pct(r.margin), csv: (r) => pctText(r.margin) },
      ], { name: 'أرباح الأصناف', sort: { key: 'profit', dir: -1 }, empty: 'لا توجد مبيعات في هذه الفترة' }))}`;
  }

  const unknownNote = (unknown) =>
    `<p class="muted rep-note">التكلفة = سعر الشراء المسجّل مع كل سطر بيع (أو سعر الشراء الحالي للصنف إن لم يكن مسجّلاً).
      ${unknown ? `لم يُحسب ربح مبيعات بمبلغ <span class="num">${fmt(unknown)}</span> لأن الصنف أو الوحدة غير موجودين في قائمة الأصناف.` : ''}</p>`;

  // ---------- 2. profit per category ----------

  function viewCats() {
    const cp = A.categoryProfit(state.P, state.filter);
    const best = [...cp.cats].sort((a, b) => b.profit - a.profit)[0];
    return `<div class="grid kpis">
        ${kpi('المبيعات', money(cp.revenue), `عدد الفئات: ${count(cp.cats.length)}`, 'sales')}
        ${kpi('التكلفة', money(cp.cost), '', 'out')}
        ${kpi('إجمالي الربح', money(cp.gross), `نسبة الربح ${pctText(cp.revenue ? cp.gross / cp.revenue : 0)}`, 'profit', true)}
        ${kpi('الفئة الأعلى ربحاً', best ? `<span class="rep-kpi-text">${esc(best.cls)}</span>` : '—', best ? `ربح ${fmt(best.profit)}` : '', 'stock')}
      </div>
      ${unknownNote(cp.unknown)}
      ${section('أرباح الفئات', table(cp.cats, [
        { key: 'cls', label: 'الفئة' },
        { key: 'items', label: 'الأصناف المبيعة', num: true },
        { key: 'revenue', label: 'المبيعات', money: true, total: true },
        { key: 'cost', label: 'التكلفة', money: true, total: true },
        { key: 'profit', label: 'الربح', money: true, total: true },
        { key: 'margin', label: 'نسبة الربح', get: (r) => r.margin, html: (r) => pct(r.margin), csv: (r) => pctText(r.margin) },
        { key: 'share', label: 'الحصة من المبيعات', get: (r) => r.share, csv: (r) => pctText(r.share),
          html: (r) => `<span class="rep-share"><span class="meter"><span style="width:${(r.share * 100).toFixed(1)}%"></span></span>${pct(r.share)}</span>` },
      ], { name: 'أرباح الفئات', sort: { key: 'revenue', dir: -1 }, empty: 'لا توجد مبيعات في هذه الفترة' }))}`;
  }

  // ---------- 3. slow-moving ----------

  function viewSlow() {
    const today = localDay();
    const stock = ctx.C.stock(state.P);
    const rows = A.slowMoving(state.P, slowDays, today, stock);
    const value = rows.reduce((a, x) => a + Math.max(0, x.value), 0);
    const all = stock.reduce((a, x) => a + Math.max(0, x.value), 0);
    const never = rows.filter((x) => !x.last).length;
    return `<div class="rep-bar">
        <span class="rep-bar-label">لم يُبع منذ</span>
        ${chips(SLOW_DAYS.map((d) => [d, `${d} يوماً`]), slowDays, 'data-slow')}
      </div>
      <p class="muted rep-note">هذا التقرير لا يتأثر بفلتر الفترة أعلاه: يشمل كل صنف رصيده أكبر من صفر ولم يُبع خلال آخر ${slowDays} يوماً حتى اليوم (<span class="num">${today}</span>).</p>
      <div class="grid kpis">
        ${kpi('أصناف راكدة', count(rows.length), `منها ${fmt(never)} لم يُبع قط`, 'stock')}
        ${kpi('قيمتها بسعر الشراء', money(value), 'رأس مال مجمّد في المخزون', 'cash', true)}
        ${kpi('نسبتها من قيمة المخزون', `<span class="num">${all ? pctText(value / all) : '0.0%'}</span>`, `قيمة المخزون كله ${fmt(all)}`, 'reports')}
      </div>
      ${section('الأصناف الراكدة', table(rows, [
        { key: 'name', label: 'الصنف' },
        { key: 'cls', label: 'الفئة' },
        { key: 'totalPcs', label: 'الرصيد الحالي', get: (r) => r.totalPcs, html: stockHtml, csv: stockText },
        { key: 'value', label: 'القيمة بسعر الشراء', money: true, total: true },
        { key: 'last', label: 'آخر بيع', get: (r) => r.last, html: (r) => (r.last ? `<span class="num">${r.last}</span>` : '<span class="pill warn">لم يُبع قط</span>'), csv: (r) => r.last || 'لم يُبع قط' },
        { key: 'since', label: 'منذ (يوم)', get: (r) => (r.since == null ? Infinity : r.since), html: (r) => (r.since == null ? '<span class="muted">—</span>' : `<span class="num">${fmt(r.since)}</span>`), csv: (r) => (r.since == null ? '' : r.since) },
      ], { name: `الأصناف الراكدة ${slowDays} يوماً`, sort: { key: 'value', dir: -1 }, empty: 'لا توجد أصناف راكدة — كل صنف في المخزون بيع مؤخراً' }))}`;
  }

  // ---------- 4. the last 12 months ----------

  function viewMonths() {
    const today = localDay();
    const rows = A.monthlyComparison(state.P, 12, today);
    const cur = rows.at(-1), prev = rows.at(-2);
    const best = [...rows].sort((a, b) => b.sales - a.sales)[0];
    const thisMonth = today.slice(0, 7);
    return `<p class="muted rep-note">آخر 12 شهراً حتى اليوم، ولا تتأثر بفلتر الفترة أعلاه. المصاريف هي سندات الصرف عدا «تسديد» للموردين و«سحب شخصي»، والصافي = إجمالي الربح − المصاريف. التغيّر مقارنة بالشهر الذي قبله.</p>
      <div class="grid kpis">
        ${kpi('مبيعات هذا الشهر', money(cur.sales), `${delta(cur.change)} <span>عن الشهر السابق (${fmt(prev.sales)})</span>`, 'sales', true)}
        ${kpi('صافي هذا الشهر', money(cur.net), `${delta(cur.netChange)} <span>عن الشهر السابق (${fmt(prev.net)})</span>`, 'profit')}
        ${kpi('أفضل شهر مبيعاً', best?.sales ? `<span class="num">${best.month}</span>` : '—', best?.sales ? `مبيعات ${fmt(best.sales)}` : 'لا توجد مبيعات', 'analytics')}
        ${kpi('مبيعات 12 شهراً', money(rows.reduce((a, r) => a + r.sales, 0)), `الصافي ${fmt(rows.reduce((a, r) => a + r.net, 0))}`, 'cash')}
      </div>
      ${section('مقارنة الشهور', table(rows, [
        { key: 'month', label: 'الشهر', html: (r) => `<span class="num">${r.month}</span>${r.month === thisMonth ? ' <span class="pill info">حتى اليوم</span>' : ''}` },
        { key: 'invoices', label: 'الفواتير', num: true, total: true },
        { key: 'sales', label: 'المبيعات', money: true, total: true },
        { key: 'cost', label: 'التكلفة', money: true, total: true },
        { key: 'gross', label: 'إجمالي الربح', money: true, total: true },
        { key: 'expenses', label: 'المصاريف', money: true, total: true },
        { key: 'net', label: 'الصافي', money: true, total: true },
        { key: 'avg', label: 'متوسط الفاتورة', money: true },
        { key: 'change', label: 'التغيّر في المبيعات', get: (r) => (r.change == null ? -Infinity : r.change), html: (r) => delta(r.change), csv: (r) => deltaText(r.change) },
      ], { name: 'مقارنة الشهور', sort: { key: 'month', dir: -1 } }), { search: false })}`;
  }

  // ---------- 5. low stock & purchase orders ----------

  function viewLow() {
    const rows = A.lowStock(state.P, localDay());
    lowGroups = A.groupBySupplier(rows);
    const total = rows.reduce((a, r) => a + r.est, 0);
    const out = rows.filter((r) => r.reason === 'نافد').length;
    const canBuy = can('purchase');
    const groups = lowGroups
      .map((g, gi) => {
        const t = table(g.items, [
          { key: 'name', label: 'الصنف' },
          { key: 'cls', label: 'الفئة' },
          { key: 'reason', label: 'الحالة', html: (r) => `<span class="pill ${r.reason === 'نافد' ? 'bad' : 'warn'}">${r.reason}</span>` },
          { key: 'totalPcs', label: 'الرصيد الحالي', get: (r) => r.totalPcs, html: stockHtml, csv: stockText },
          { key: 'harig', label: 'حد الطلب', get: (r) => r.harig, html: (r) => (r.harig > 0 ? `<span class="num">${fmt(r.harig)}</span> ${esc(r.unitL1)}` : '<span class="muted">غير محدد</span>'), csv: (r) => r.harig || '' },
          { key: 'qty', label: 'الكمية المقترحة', get: (r) => r.qty, html: (r) => `<b class="num">${fmt(r.qty)}</b> ${esc(r.unitL1)}`, csv: (r) => `${r.qty} ${r.unitL1}` },
          { key: 'price', label: 'آخر سعر شراء', money: true },
          { key: 'lastDate', label: 'آخر شراء', html: (r) => (r.lastDate ? `<span class="num">${r.lastDate}</span>` : '<span class="muted">—</span>') },
          { key: 'est', label: 'التكلفة التقديرية', money: true, total: true },
        ], { name: `طلبية ${g.supplier || A.NO_SUPPLIER}`, sort: { key: 'est', dir: -1 } });
        const id = t.match(/id="(t\d+)"/)?.[1];
        return `<div class="card rep-supplier">
          <div class="rep-supplier-head">
            <div class="rep-supplier-name"><span class="k-ico">${icon('suppliers')}</span>
              <div><h3>${esc(g.supplier || A.NO_SUPPLIER)}</h3>
              <small class="muted">${fmt(g.items.length)} صنف — التكلفة التقديرية <span class="num">${fmt(g.total)}</span></small></div></div>
            <div class="tools">
              <button class="btn small" data-order-print="${gi}">${icon('print')} طباعة طلبية</button>
              ${canBuy ? `<button class="btn small primary" data-order-create="${gi}">${icon('plus')} إنشاء فاتورة شراء</button>` : ''}
              <button class="btn small" data-csv="${id}">Excel</button>
            </div>
          </div>
          ${t}
        </div>`;
      })
      .join('');
    return `<p class="muted rep-note">يشمل كل صنف رصيده أقل من حد الطلب، وكل صنف نفد رصيده وبيع خلال آخر 60 يوماً. الكمية المقترحة بالوحدة الكبيرة: ما يرفع الرصيد إلى ضعف حد الطلب، أو إلى مبيعات آخر 30 يوماً إن لم يُحدَّد للصنف حد طلب، وواحدة على الأقل. السعر من آخر فاتورة شراء، ولا يتأثر هذا التقرير بفلتر الفترة.</p>
      <div class="grid kpis">
        ${kpi('أصناف تحتاج طلباً', count(rows.length), `${fmt(out)} نافد — ${fmt(rows.length - out)} تحت حد الطلب`, 'checks', true)}
        ${kpi('التكلفة التقديرية', money(total), 'بآخر سعر شراء', 'purchases')}
        ${kpi('الموردون', count(lowGroups.filter((g) => g.supplier).length), 'حسب آخر مورد لكل صنف', 'suppliers')}
      </div>
      ${rows.length ? `<div class="rep-groups">${groups}</div>` : `<div class="card rep-empty">${icon('check')}<b>لا توجد نواقص</b><span class="muted">كل الأصناف فوق حد الطلب، ولا يوجد صنف نافد بيع مؤخراً.</span></div>`}`;
  }

  function printOrder(g) {
    const shop = state.shopName || 'Fr3oon';
    const date = localDay();
    const rows = g.items
      .map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}${r.code ? `<br><small>${esc(r.code)}</small>` : ''}</td><td>${esc(r.unitL1)}</td><td class="n">${fmt(r.qty)}</td><td class="n">${fmt(r.price)}</td><td class="n">${fmt(r.est)}</td></tr>`)
      .join('');
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) {
      toast('منع المتصفح فتح نافذة الطباعة', true);
      return;
    }
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طلبية شراء — ${esc(g.supplier || A.NO_SUPPLIER)}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        body { font: 14px/1.5 Tahoma, "Segoe UI", sans-serif; color: #000; margin: 0; }
        header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 14px; }
        h1 { font-size: 22px; margin: 0; } h2 { font-size: 17px; margin: 0; font-weight: normal; }
        .meta { display: flex; gap: 32px; margin-bottom: 14px; } .meta b { font-size: 15px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #888; padding: 6px 8px; text-align: right; vertical-align: top; }
        th { background: #eee; } small { color: #444; }
        .n { text-align: left; direction: ltr; white-space: nowrap; }
        tfoot td { font-weight: bold; font-size: 15px; }
        footer { margin-top: 18px; font-size: 12px; color: #333; }
        .sign { display: flex; justify-content: space-between; margin-top: 48px; }
      </style></head><body>
      <header><div><h1>${esc(shop)}</h1></div><h2>طلبية شراء</h2></header>
      <div class="meta"><span>إلى المورد: <b>${esc(g.supplier || '..............................')}</b></span><span>التاريخ: <b dir="ltr">${date}</b></span><span>عدد الأصناف: <b>${g.items.length}</b></span></div>
      <table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>المبلغ</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5">المجموع التقديري</td><td class="n">${fmt(g.total)}</td></tr></tfoot></table>
      <footer>الأسعار تقديرية حسب آخر فاتورة شراء من المورد.</footer>
      <div class="sign"><span>توقيع المسؤول: ....................</span><span>ختم المحل</span></div>
      <script>window.onload = () => { window.print(); };<\/script>
      </body></html>`);
    w.document.close();
  }

  function createInvoice(g) {
    if (!can('purchase')) return toast('ليست لديك صلاحية لذلك. اطلبها من المدير.', true);
    forms().invoiceEditor('purchase', null, {
      who: g.supplier,
      type: 'اجل',
      lines: g.items.map((r) => ({ item: r.name, unit: r.unitL1, qty: r.qty, price: r.price })),
    });
  }

  // ---------- the page ----------

  const VIEWS = { items: viewItems, cats: viewCats, slow: viewSlow, months: viewMonths, low: viewLow };
  const body = () => `<div class="rep-tabs">${chips(TABS, tab, 'data-rtab')}</div><div class="rep-body">${VIEWS[tab]()}</div>`;

  // Tabs and day chips redraw this page only, not the whole app.
  function redraw() {
    const root = $('#repRoot');
    if (root) root.innerHTML = body();
  }

  function bind() {
    const root = $('#repRoot');
    if (!root) return;
    root.onclick = (e) => {
      const t = e.target.closest('[data-rtab]');
      if (t) {
        tab = t.dataset.rtab;
        store.set('fr3oon-report-tab', tab);
        return redraw();
      }
      const d = e.target.closest('[data-slow]');
      if (d) {
        slowDays = Number(d.dataset.slow);
        store.set('fr3oon-report-slow', String(slowDays));
        return redraw();
      }
      const p = e.target.closest('[data-order-print]');
      if (p) return printOrder(lowGroups[+p.dataset.orderPrint]);
      const c = e.target.closest('[data-order-create]');
      if (c) return createInvoice(lowGroups[+c.dataset.orderCreate]);
    };
  }

  return {
    view: () => {
      onAfter(bind);
      return `<div id="repRoot" class="rep">${body()}</div>`;
    },
  };
}
