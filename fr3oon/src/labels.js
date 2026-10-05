// طباعة الباركود — shelf / product labels with the shop name, the item name,
// the price and its barcode (EAN-13 when the code is one, else Code 128).
// Rolls print one label per page at the label's exact size; A4 sheets print
// a grid. Items without a code get in-store EAN-13 codes (2…) first.
import { barcodeSvg, newStoreCode } from './barcode.js';
import { installScanner } from './scanner.js';

// w × h in mm; sheets: columns × rows on A4 with the top / side margins left
// by the sheet's layout.
const SIZES = [
  { id: 'r40', name: 'لفة', dims: '40×25', w: 40, h: 25, roll: true },
  { id: 'r50', name: 'لفة', dims: '50×30', w: 50, h: 30, roll: true },
  { id: 'r58', name: 'لفة', dims: '58×40', w: 58, h: 40, roll: true },
  { id: 'a3x8', name: 'ورقة A4', dims: '3×8', cell: '70×37', w: 70, h: 37, cols: 3, rows: 8, top: 0.5, side: 0 },
  { id: 'a4x10', name: 'ورقة A4', dims: '4×10', cell: '52.5×29.7', w: 52.5, h: 29.7, cols: 4, rows: 10, top: 0, side: 0 },
];
const DEFAULTS = { size: 'r40', shop: true, name: true, price: true, digits: true, unit: 'small', font: 'normal', fromStock: false, start: 1 };
const MAX_COPIES = 9999;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COPIES) : 0;
};

export function setupLabels(ctx) {
  const { $, $$, esc, fmt, money, write, state, toast, icon, onAfter, openModal, closeModal, store, can } = ctx;
  const P = () => state.P;

  let cfg = { ...DEFAULTS };
  try {
    cfg = { ...DEFAULTS, ...JSON.parse(store.get('fr3oon-labels') || '{}') };
  } catch {
    /* defaults */
  }
  if (!SIZES.some((s) => s.id === cfg.size)) cfg.size = DEFAULTS.size;
  const saveCfg = () => store.set('fr3oon-labels', JSON.stringify(cfg));
  const size = () => SIZES.find((s) => s.id === cfg.size);
  const sizeLabel = (s, html = false) => {
    const d = (t) => (html ? `<span dir="ltr">${t}</span>` : `⁦${t}⁩`);
    return s.roll ? `${s.name} ${d(s.dims)} مم` : `${s.name} ${d(s.dims)} (${d(s.cell)} مم)`;
  };

  const picked = new Set(); // item ids, in the order they were chosen
  const copies = new Map(); // id → copies typed
  let search = '';
  let cls = null; // null = all categories
  let flashId = null;

  const items = () => P().items;
  const byId = (id) => items().find((i) => i.id === id);
  const hasCode = (it) => !!String(it.code || '').trim();
  const byName = (a, b) => a.localeCompare(b, 'ar');

  // The price on the label: the small unit's (or the big one's), falling
  // back to the big unit for an item sold only by it.
  function priceOf(it) {
    const small = cfg.unit === 'small' && it.unitL2 && it.unitL2 !== it.unitL1 && it.priceL2 > 0;
    return small ? { price: it.priceL2, unit: it.unitL2 } : { price: it.priceL1 || it.priceL2, unit: it.unitL1 || it.unitL2 };
  }
  // Copies from the stock, in the unit the price is in.
  function stockCopies(it) {
    const s = state.stockByName?.get(it.name);
    if (!s) return 0;
    const small = priceOf(it).unit === it.unitL2 && it.unitL2 !== it.unitL1;
    const n = small || !(it.fill > 0) ? s.totalPcs : s.k;
    return Math.max(0, Math.min(MAX_COPIES, Math.floor(n)));
  }
  const copiesOf = (it) => (cfg.fromStock ? stockCopies(it) : copies.has(it.id) ? copies.get(it.id) : 1);

  function visible() {
    const q = search.trim();
    return items()
      .filter((it) => (cls == null || it.cls === cls) && (!q || it.name.includes(q) || (it.code && it.code.startsWith(q))))
      .sort((a, b) => byName(a.name, b.name));
  }
  const pickedItems = () => [...picked].map(byId).filter(Boolean);

  // ---------------------------------------------------------------- one label

  // Font sizes follow the label, in mm.
  function metrics(s) {
    const k = cfg.font === 'small' ? 0.85 : 1;
    const name = Math.min(s.h * 0.095, s.w * 0.065) * k;
    return { pad: Math.max(1.2, Math.min(2.4, s.h * 0.06)), name, shop: name * 0.78, digits: name * 0.8, price: name * 1.45, unit: name * 0.78 };
  }

  function labelCss(s) {
    const m = metrics(s);
    const mm = (v) => `${v.toFixed(2)}mm`;
    return `.lbl { box-sizing: border-box; width: ${s.w}mm; height: ${s.h}mm; padding: ${mm(m.pad)} ${mm(m.pad * 1.2)}; overflow: hidden;
        display: flex; flex-direction: column; gap: ${mm(m.pad * 0.25)}; background: #fff; color: #000; text-align: center; direction: rtl;
        font-family: "IBM Plex Sans Arabic", Tahoma, "Segoe UI", Arial, sans-serif; line-height: 1.15; }
      .lbl > * { flex: none; min-width: 0; }
      .lbl-shop { font-size: ${mm(m.shop)}; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .lbl-name { font-size: ${mm(m.name)}; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
      .lbl-bc { flex: 1 1 0; min-height: ${mm(s.h * 0.22)}; position: relative; }
      .lbl-bc svg { position: absolute; inset: 0; margin: 0 auto; display: block; width: 100%; max-width: 52mm; height: 100%; }
      .lbl-digits { font-family: "Consolas", "Courier New", monospace; font-size: ${mm(m.digits)}; letter-spacing: .06em; direction: ltr; line-height: 1; }
      .lbl-price { display: flex; justify-content: center; align-items: baseline; gap: ${mm(m.pad * 0.6)}; line-height: 1.05; white-space: nowrap; }
      .lbl-price b { font-size: ${mm(m.price)}; font-weight: 800; direction: ltr; }
      .lbl-price small { font-size: ${mm(m.unit)}; font-weight: 600; }
      .lbl-nocode { flex: 1 1 auto; display: grid; place-items: center; border: .3mm dashed #000; font-size: ${mm(m.shop)}; padding: 0 1mm; }
      .lbl-blank { visibility: hidden; }`;
  }

  function labelHtml(it) {
    const { price, unit } = priceOf(it);
    const code = String(it.code || '').trim();
    return `<div class="lbl">
      ${cfg.shop && state.shopName ? `<div class="lbl-shop">${esc(state.shopName)}</div>` : ''}
      ${cfg.name ? `<div class="lbl-name">${esc(it.name)}</div>` : ''}
      ${code ? `<div class="lbl-bc">${barcodeSvg(code, { height: 60, text: false, quiet: 10 })}</div>` : '<div class="lbl-nocode">بلا باركود — ولّد له رمزاً أولاً</div>'}
      ${code && cfg.digits ? `<div class="lbl-digits">${esc(code)}</div>` : ''}
      ${cfg.price ? `<div class="lbl-price"><b>${fmt(price)}</b><small>دينار / ${esc(unit)}</small></div>` : ''}
    </div>`;
  }

  // ---------------------------------------------------------------- the page

  function rowHtml(it) {
    const on = picked.has(it.id);
    const { price, unit } = priceOf(it);
    return `<tr data-id="${it.id}" class="${on ? 'lb-on' : ''}${flashId === it.id ? ' lb-hit' : ''}">
      <td class="lb-ck"><input type="checkbox" data-id="${it.id}"${on ? ' checked' : ''} aria-label="تحديد ${esc(it.name)}"></td>
      <td class="lb-name"><b>${esc(it.name)}</b>${it.cls ? `<small>${esc(it.cls)}</small>` : ''}</td>
      <td class="lb-code">${hasCode(it) ? `<span class="num">${esc(it.code)}</span>` : '<span class="pill warn">بلا باركود</span>'}</td>
      <td class="lb-price">${money(price)} <small class="muted">/ ${esc(unit)}</small></td>
      <td class="lb-copies"><input class="lb-n" data-id="${it.id}" inputmode="numeric" autocomplete="off" value="${copiesOf(it)}" aria-label="عدد النسخ"${cfg.fromStock ? ' disabled title="عدد النسخ = الرصيد الحالي"' : ''}></td>
    </tr>`;
  }

  function bodyHtml() {
    const list = visible();
    if (!list.length) return '<tr><td colspan="5" class="empty">لا يوجد صنف بهذا الاسم أو الرمز</td></tr>';
    const shown = list.slice(0, 500);
    return shown.map(rowHtml).join('') + (list.length > shown.length ? `<tr><td colspan="5" class="muted lb-more">يظهر أول 500 صنف من ${list.length}. اكتب في البحث أو اختر فئة لتضييق القائمة.</td></tr>` : '');
  }

  function totals() {
    const list = pickedItems();
    return { items: list.length, labels: list.reduce((a, it) => a + copiesOf(it), 0), noCode: list.filter((it) => !hasCode(it)).length };
  }

  function sumHtml() {
    const t = totals();
    return `المحدد: <b class="num">${t.items}</b> — الملصقات: <b class="num">${t.labels}</b>${t.noCode ? ` <span class="pill warn">بلا باركود: <span class="num">${t.noCode}</span></span>` : ''}`;
  }

  function previewHtml() {
    const s = size();
    const first = pickedItems()[0];
    const it = first || visible()[0] || items()[0];
    if (!it) return '<p class="muted">لا توجد أصناف</p>';
    const px = (mm) => mm * (96 / 25.4);
    const scale = Math.min(300 / px(s.w), 220 / px(s.h), 2.6);
    return `<style>${labelCss(s)}</style>
      <div class="lb-stage" style="width:${(px(s.w) * scale).toFixed(1)}px;height:${(px(s.h) * scale).toFixed(1)}px">
        <div class="lb-scale" style="transform:scale(${scale.toFixed(3)})">${labelHtml(it)}</div>
      </div>
      <p class="muted lb-small">${first ? 'معاينة بأول صنف محدد' : 'معاينة بأول صنف في القائمة'}، بنسب الملصق الفعلية مكبّرةً على الشاشة.</p>`;
  }

  function asideHtml() {
    const s = size();
    const t = totals();
    const chk = (k, label) => `<label class="check"><input type="checkbox" data-cfg="${k}"${cfg[k] ? ' checked' : ''}> ${label}</label>`;
    const seg = (k, opts) =>
      `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${cfg[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `<div class="card lb-settings">
        <h3>${icon('labels')} إعدادات الملصق</h3>
        <div class="lb-group"><span class="lb-cap">المقاس</span>
          <div class="lb-sizes">${SIZES.map((x) => `<button type="button" class="chip${x.id === cfg.size ? ' on' : ''}" data-size="${x.id}">${sizeLabel(x, true)}</button>`).join('')}</div>
        </div>
        ${s.roll ? '' : `<label class="lb-group lb-start"><span class="lb-cap">ابدأ من الملصق رقم</span>
          <input id="lbStart" inputmode="numeric" value="${cfg.start}" title="لورقة استُعمل جزء منها"> <small class="muted">من ${s.cols * s.rows} في الورقة</small></label>`}
        <div class="lb-group"><span class="lb-cap">يظهر على الملصق</span>
          <div class="lb-checks">${chk('shop', 'اسم المحل')}${chk('name', 'اسم الصنف')}${chk('price', 'السعر')}${chk('digits', 'أرقام الباركود')}</div>
        </div>
        <div class="lb-group"><span class="lb-cap">السعر بالوحدة</span>${seg('unit', [['small', 'الصغيرة'], ['big', 'الكبيرة']])}</div>
        <div class="lb-group"><span class="lb-cap">حجم الخط</span>${seg('font', [['small', 'صغير'], ['normal', 'عادي']])}</div>
      </div>
      <div class="card lb-preview-card">
        <h3>معاينة</h3>
        <div class="lb-preview" id="lbPreview">${previewHtml()}</div>
      </div>
      <div class="card lb-print-card">
        <p class="lb-sum" id="lbSum2">${sumHtml()}</p>
        <button class="btn primary big block" id="lbPrint"${t.labels ? '' : ' disabled'}>${icon('print')} طباعة <span class="num" id="lbPrintN">${t.labels}</span> ملصق</button>
        <p class="muted lb-small">${s.roll
          ? 'طابعة الملصقات: اختر في نافذة الطباعة الطابعة ومقاس الورق نفسه، والهوامش «بلا»، والمقياس 100%.'
          : 'ورق A4: اختر في نافذة الطباعة الهوامش «بلا» والمقياس 100% (أو «الحجم الفعلي»).'}</p>
      </div>`;
  }

  function view() {
    onAfter(bind);
    const noCode = items().filter((it) => !hasCode(it)).length;
    const classes = [...new Set(items().map((i) => i.cls).filter(Boolean))].sort(byName);
    return `<div class="lb">
      <section class="lb-items">
        ${noCode ? `<div class="notice lb-gen"><span>أصناف بلا باركود: <b class="num">${noCode}</b>. لا تُطبع ملصقاتها قبل أن يكون لها رمز.</span>
          <button class="btn small primary" id="lbGen">${icon('labels')} توليد باركود للأصناف التي بلا رمز (<span class="num">${noCode}</span>)</button></div>` : ''}
        <div class="card lb-pick">
          <div class="lb-search">${icon('search')}<input id="lbSearch" autocomplete="off" enterkeyhint="go" placeholder="ابحث باسم الصنف أو رمزه، أو امسح الباركود" value="${esc(search)}"></div>
          <div class="chips lb-cls">${[[null, 'الكل'], ...classes.map((c) => [c, c])]
            .map(([v, l]) => `<button type="button" class="chip${v === cls ? ' on' : ''}" data-cls="${v == null ? '' : esc(v)}"${v == null ? ' data-all="1"' : ''}>${esc(l)}</button>`)
            .join('')}</div>
          <div class="lb-tools">
            <button class="btn small" id="lbAll">${icon('check')} تحديد الكل</button>
            <button class="btn small" id="lbNone">إلغاء التحديد</button>
            <label class="check small"><input type="checkbox" id="lbFromStock"${cfg.fromStock ? ' checked' : ''}> عدد النسخ = الرصيد الحالي</label>
            <span class="lb-sum muted" id="lbSum">${sumHtml()}</span>
          </div>
        </div>
        <div class="table-wrap lb-wrap"><table class="lb-table">
          <thead><tr><th class="lb-ck"></th><th>الصنف</th><th>الباركود</th><th>السعر</th><th>عدد النسخ</th></tr></thead>
          <tbody id="lbBody">${bodyHtml()}</tbody>
        </table></div>
      </section>
      <aside class="lb-aside" id="lbAside">${asideHtml()}</aside>
    </div>`;
  }

  // ---------------------------------------------------------------- updates

  function drawSummary() {
    const t = totals();
    $('#lbSum').innerHTML = sumHtml();
    $('#lbSum2').innerHTML = sumHtml();
    $('#lbPrintN').textContent = t.labels;
    $('#lbPrint').disabled = !t.labels;
  }
  const drawPreview = () => ($('#lbPreview').innerHTML = previewHtml());
  const drawBody = () => ($('#lbBody').innerHTML = bodyHtml());
  function drawAside() {
    $('#lbAside').innerHTML = asideHtml();
    bindAside();
  }

  function toggle(id, on) {
    if (on) picked.add(id);
    else picked.delete(id);
    const tr = $(`#lbBody tr[data-id="${id}"]`);
    if (tr) {
      tr.classList.toggle('lb-on', on);
      tr.querySelector('input[type=checkbox]').checked = on;
    }
    drawSummary();
    drawPreview();
  }

  // A scan: select the item, or one more copy when it is already selected.
  function scan(code) {
    const q = String(code || '').trim();
    const it = items().find((x) => x.code === q) || items().find((x) => x.name === q);
    search = '';
    if ($('#lbSearch')) $('#lbSearch').value = '';
    if (!it) {
      drawBody();
      return toast(`لا يوجد صنف بالباركود ${q}`, true);
    }
    if (picked.has(it.id) && !cfg.fromStock) copies.set(it.id, Math.min(MAX_COPIES, copiesOf(it) + 1));
    picked.add(it.id);
    if (cls != null && it.cls !== cls) cls = null;
    flashId = it.id;
    $('#main').querySelectorAll('.lb-cls .chip').forEach((c) => c.classList.toggle('on', cls == null ? !!c.dataset.all : c.dataset.cls === cls && !c.dataset.all));
    drawBody();
    flashId = null;
    drawSummary();
    drawPreview();
    $(`#lbBody tr[data-id="${it.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast(`${it.name}: ${copiesOf(it)} نسخة`);
    $('#lbSearch')?.focus();
  }

  // ---------------------------------------------------------------- codes

  function generate(only, then) {
    const missing = (only || items()).filter((it) => !hasCode(it));
    if (!missing.length) return toast('كل الأصناف لها باركود');
    if (!(can('labels') || can('item_manage'))) return toast('ليست لديك صلاحية لذلك. اطلبها من المدير.', true);
    const taken = new Set(items().map((i) => String(i.code || '').trim()).filter(Boolean));
    const codes = missing.map((it) => {
      const code = newStoreCode(taken);
      taken.add(code);
      return { id: it.id, code, name: it.name };
    });
    openModal(`<h2>توليد باركود للأصناف التي بلا رمز</h2>
      <p>سيُعطى كل صنف من هذه الأصناف (عددها <b class="num">${codes.length}</b>) رمز EAN-13 داخلياً خاصاً بالمحل يبدأ بالرقم 2،
        ويُحفظ في رمز الصنف فيمكن مسحه عند البيع. ${then ? '' : 'ستُحدَّد للطباعة بعد الحفظ.'}</p>
      <div class="table-wrap lb-gen-list"><table><thead><tr><th>الصنف</th><th>الرمز الجديد</th></tr></thead><tbody>
        ${codes.slice(0, 200).map((c) => `<tr><td>${esc(c.name)}</td><td><span class="num">${c.code}</span></td></tr>`).join('')}
        ${codes.length > 200 ? `<tr><td colspan="2" class="muted">و${codes.length - 200} صنفاً آخر…</td></tr>` : ''}
      </tbody></table></div>
      <p class="notice error" id="lbGenErr" hidden></p>
      <div class="form-actions">
        <button class="btn primary" id="lbGenGo">${icon('save')} توليد وحفظ${then ? ' ثم الطباعة' : ''}</button>
        <button class="btn" id="lbGenNo">إلغاء</button>
      </div>`);
    $('#lbGenNo').onclick = closeModal;
    $('#lbGenGo').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'جارٍ الحفظ…';
      try {
        await write('setItemCodes', { codes: codes.map(({ id, code }) => ({ id, code })) });
        codes.forEach((c) => picked.add(c.id));
        closeModal();
        toast(`حُفظت الرموز الجديدة ✔ (عدد الأصناف: ${codes.length})`);
        if (state.view === 'labels' && $('#main')) {
          $('#main').innerHTML = view();
          bind();
        }
        then?.();
      } catch (err) {
        b.disabled = false;
        b.innerHTML = `${icon('save')} توليد وحفظ`;
        $('#lbGenErr').textContent = err.message;
        $('#lbGenErr').hidden = false;
      }
    };
  }

  // ---------------------------------------------------------------- printing

  function startPrint() {
    const list = pickedItems().filter((it) => copiesOf(it) > 0);
    if (!list.length) return toast('حدّد صنفاً واحداً على الأقل، وعدد نسخ أكبر من صفر', true);
    const missing = list.filter((it) => !hasCode(it));
    if (!missing.length) return printLabels(list);
    const ready = list.filter(hasCode);
    openModal(`<h2>أصناف محددة بلا باركود</h2>
      <p>هذه الأصناف المحددة ليس لها رمز (عددها <b class="num">${missing.length}</b>): ${missing.slice(0, 8).map((it) => `«${esc(it.name)}»`).join('، ')}${missing.length > 8 ? '…' : ''}</p>
      <p class="muted">${ready.length ? 'ولّد لها رموزاً أولاً لتُطبع مع غيرها، أو اطبع الباقي فقط.' : 'ولّد لها رموزاً أولاً، ثم تُطبع.'}</p>
      <div class="form-actions">
        <button class="btn primary" id="lbMissGen">${icon('labels')} توليد رموز لها ثم الطباعة</button>
        ${ready.length ? `<button class="btn" id="lbMissSkip">${icon('print')} طباعة الباقي فقط (<span class="num">${ready.length}</span>)</button>` : ''}
        <button class="btn" id="lbMissNo">رجوع</button>
      </div>`);
    $('#lbMissNo').onclick = closeModal;
    if ($('#lbMissSkip'))
      $('#lbMissSkip').onclick = () => {
        closeModal();
        toast(`تُخطّي ${missing.length} صنف بلا باركود`, true);
        printLabels(ready);
      };
    $('#lbMissGen').onclick = () => generate(missing, () => printLabels(pickedItems().filter((it) => copiesOf(it) > 0 && hasCode(it))));
  }

  // The app's own font for the labels (it is embedded in this page).
  function fontFaces() {
    let css = '';
    for (const sh of document.styleSheets) {
      try {
        for (const r of sh.cssRules) if (r instanceof CSSFontFaceRule) css += r.cssText + '\n';
      } catch {
        /* another origin's sheet */
      }
    }
    return css;
  }

  function printLabels(list) {
    const s = size();
    const one = new Map(list.map((it) => [it.id, labelHtml(it)]));
    const labels = list.flatMap((it) => Array(copiesOf(it)).fill(one.get(it.id)));
    if (!labels.length) return toast('لا توجد ملصقات للطباعة', true);
    let body, pageCss;
    if (s.roll) {
      pageCss = `@page { size: ${s.w}mm ${s.h}mm; margin: 0; }
        @media print { .lbl { break-after: page; page-break-after: always; } .lbl:last-child { break-after: auto; page-break-after: auto; } }
        @media screen { .sheet { display: flex; flex-wrap: wrap; gap: 4mm; justify-content: center; zoom: 1.6; } .lbl { box-shadow: 0 1px 3px rgba(0,0,0,.3); } }`;
      body = `<div class="sheet">${labels.join('')}</div>`;
    } else {
      const per = s.cols * s.rows;
      const skip = Math.min(per - 1, Math.max(0, (toInt(cfg.start) || 1) - 1));
      const cells = [...Array(skip).fill('<div class="lbl lbl-blank"></div>'), ...labels];
      const pages = [];
      for (let i = 0; i < cells.length; i += per) pages.push(`<div class="page">${cells.slice(i, i + per).join('')}</div>`);
      pageCss = `@page { size: A4; margin: 0; }
        .page { box-sizing: border-box; width: 210mm; height: 297mm; padding: ${s.top}mm ${s.side}mm 0; display: grid; overflow: hidden; background: #fff;
          grid-template-columns: repeat(${s.cols}, ${s.w}mm); grid-auto-rows: ${s.h}mm; align-content: start; justify-content: center; }
        @media print { .page { break-after: page; page-break-after: always; } .page:last-child { break-after: auto; page-break-after: auto; } }
        @media screen { .page { margin: 0 auto 8mm; box-shadow: 0 2px 10px rgba(0,0,0,.25); } .page .lbl { outline: .2mm dashed #c8c8c8; outline-offset: -.1mm; } }`;
      body = pages.join('');
    }
    const w = window.open('', '_blank', 'width=960,height=760');
    if (!w) return toast('منع المتصفح فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا البرنامج.', true);
    const title = `ملصقات الباركود — ${labels.length}`;
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>${fontFaces()}</style>
      <style>
        html, body { margin: 0; padding: 0; background: #fff; }
        ${labelCss(s)}
        ${pageCss}
        .bar { display: none; }
        @media screen {
          body { background: #e9eaee; padding: 72px 12px 24px; font-family: "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif; }
          .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; position: fixed; inset: 0 0 auto; z-index: 2; padding: 12px 18px;
            background: #fff; color: #111; border-bottom: 1px solid #d0d0d6; font-size: 14px; }
          .bar b { font-size: 16px; } .bar span { color: #555; }
          .bar button { margin-inline-start: auto; font: inherit; font-weight: 700; padding: 8px 20px; border-radius: 10px; border: 0; background: #5b21b6; color: #fff; cursor: pointer; }
        }
      </style></head><body>
      <div class="bar"><b>${esc(title)}</b><span>${sizeLabel(s, true)} — ${s.roll ? 'ملصق في كل صفحة' : `${s.cols * s.rows} ملصقاً في الورقة`}. في نافذة الطباعة: الهوامش «بلا» والمقياس 100%.</span>
        <button onclick="window.print()">طباعة</button></div>
      ${body}
      <script>(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(function () { window.print(); }, 200); });<\/script>
      </body></html>`);
    w.document.close();
  }

  // ---------------------------------------------------------------- events

  function bindAside() {
    $('#lbAside .lb-sizes').onclick = (e) => {
      const b = e.target.closest('[data-size]');
      if (!b) return;
      cfg.size = b.dataset.size;
      saveCfg();
      drawAside();
    };
    $$('#lbAside [data-cfg]').forEach((c) => {
      c.onchange = () => {
        cfg[c.dataset.cfg] = c.checked;
        saveCfg();
        drawPreview();
      };
    });
    $$('#lbAside [data-seg]').forEach((g) => {
      g.onclick = (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        cfg[g.dataset.seg] = b.dataset.v;
        saveCfg();
        $$('button', g).forEach((x) => x.classList.toggle('on', x === b));
        drawPreview();
        if (g.dataset.seg === 'unit') {
          drawBody();
          drawSummary();
        }
      };
    });
    if ($('#lbStart'))
      $('#lbStart').onchange = (e) => {
        cfg.start = Math.max(1, Math.min(size().cols * size().rows, toInt(e.target.value) || 1));
        e.target.value = cfg.start;
        saveCfg();
      };
    $('#lbPrint').onclick = startPrint;
  }

  function bind() {
    const box = $('#lbSearch');
    if (!box) return;
    box.oninput = () => {
      search = box.value;
      drawBody();
    };
    box.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = search.trim();
      if (!q) return;
      if (items().some((x) => x.code === q || x.name === q)) return scan(q);
      const list = visible();
      if (list.length === 1) scan(list[0].code || list[0].name);
      else toast(list.length ? `عدد الأصناف المطابقة: ${list.length}، اختر من القائمة` : 'لا يوجد صنف بهذا الاسم أو الرمز', !list.length);
    };
    $('#main .lb-cls').onclick = (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      cls = c.dataset.all ? null : c.dataset.cls;
      $$('#main .lb-cls .chip').forEach((x) => x.classList.toggle('on', x === c));
      drawBody();
    };
    $('#lbAll').onclick = () => {
      visible().forEach((it) => picked.add(it.id));
      drawBody();
      drawSummary();
      drawPreview();
    };
    $('#lbNone').onclick = () => {
      picked.clear();
      drawBody();
      drawSummary();
      drawPreview();
    };
    $('#lbFromStock').onchange = (e) => {
      cfg.fromStock = e.target.checked;
      saveCfg();
      drawBody();
      drawSummary();
    };
    const body = $('#lbBody');
    body.onchange = (e) => {
      const id = Number(e.target.dataset?.id);
      if (e.target.type === 'checkbox') toggle(id, e.target.checked);
    };
    body.oninput = (e) => {
      if (!e.target.classList.contains('lb-n')) return;
      const id = Number(e.target.dataset.id);
      const n = toInt(e.target.value);
      copies.set(id, n);
      if (n > 0 && !picked.has(id)) toggle(id, true);
      else drawSummary();
    };
    body.onclick = (e) => {
      if (e.target.closest('input, label, button')) return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) toggle(Number(tr.dataset.id), !picked.has(Number(tr.dataset.id)));
    };
    if ($('#lbGen')) $('#lbGen').onclick = () => generate(null);
    bindAside();
    if (!matchMedia('(pointer: coarse)').matches && !document.activeElement?.closest?.('#main')) box.focus();
  }

  installScanner(() => (state.view === 'labels' && $('#modal').hidden && $('#lbSearch') ? { input: $('#lbSearch'), onScan: scan } : null));

  return { view };
}
