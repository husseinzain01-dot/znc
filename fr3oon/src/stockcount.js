// الجرد — counting the stock. The count in progress lives in this module and
// in this browser (per user), so a refresh or a closed window can resume it.
// Saving sends only the counted items; counted − expected (in the item's
// small unit, like C.stock's totalPcs) corrects each one's stock from then on.
import { installScanner } from './scanner.js';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
// '' → null (not counted), a bad entry → NaN
function parseQty(v) {
  const s = String(v ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))
    .replace(/٫/g, '.')
    .replace(/[,،\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
const fmtQ = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 3 }));

export function setupStockCount(ctx) {
  const { $, $$, esc, money, write, state, table, section, toast, icon, onAfter, openModal, closeModal, store, refreshData, localDay } = ctx;
  const P = () => state.P;
  const key = () => 'fr3oon-count-' + (state.user || '');
  const touch = matchMedia('(pointer: coarse)');

  let owner = null; // the user whose draft is loaded
  let draft = null; // { v, started, scope: {kind, cls, n}, items: [names], q: {name: {b, s}} }
  let mode = 'start'; // 'start' | 'count'
  let filter = 'all';
  let search = '';
  let scanMode = store.get('fr3oon-count-scan') === 'jump' ? 'jump' : 'add';
  const scope = { kind: 'all', cls: '', picked: new Set() };
  let pickSearch = '';
  let busy = false;
  let focusMemo = null;
  let msg = null; // { ok, html } — the last scan
  let dropArmed = 0;

  // ---------------------------------------------------------------- the draft

  function syncUser() {
    if (owner === state.user) return;
    owner = state.user;
    draft = loadDraft();
    mode = 'start';
    filter = 'all';
    search = '';
    msg = null;
  }
  function loadDraft() {
    try {
      const d = JSON.parse(store.get(key()) || 'null');
      if (d && Array.isArray(d.items) && d.q && d.scope) return d;
    } catch {
      /* nothing to resume */
    }
    return null;
  }
  const persist = () => store.set(key(), draft ? JSON.stringify(draft) : '');

  // ---------------------------------------------------------------- items & quantities

  const item = (name) => P().itemByName.get(name);
  // Two inputs (big + small) when the big unit holds several small ones.
  const isTwo = (it) => it.fill > 1;
  const bigU = (it) => it.unitL1 || 'وحدة';
  const smallU = (it) => (isTwo(it) || it.fill > 0 ? it.unitL2 || it.unitL1 : it.unitL1) || 'وحدة';
  // Same as the helper's Get-PieceCost: the cost of one small unit.
  const pieceCost = (it) =>
    it.unitL2 && it.unitL1 !== it.unitL2 && it.fill > 0 ? (it.buyL2 > 0 ? it.buyL2 : it.buyL1 / it.fill) : it.buyL1;
  const stockOf = (it) => state.stockByName?.get(it.name)?.totalPcs ?? 0;
  // The stock when the item was counted: the stock now, with what was sold
  // (or bought) after that moment put back. Selling while counting is then
  // no false shortage.
  const nowStamp = () => new Date().toLocaleString('sv-SE').slice(0, 19);
  function pieces(it, l) {
    const lvl = l.unit === it.unitL1 ? 1 : l.unit === it.unitL2 ? 2 : 0;
    if (it.fill > 0) return lvl === 1 ? l.qty * it.fill : lvl === 2 ? l.qty : 0;
    return lvl === 1 ? l.qty : 0;
  }
  function stockAt(it, at) {
    let n = stockOf(it);
    if (!at) return n;
    const after = (r) => (r.time || r.date + ' 23:59:59') > at;
    for (const s of P().sales) if (after(s)) for (const l of s.lines) if (l.item === it.name) n += pieces(it, l);
    for (const p of P().purchases) if (after(p)) for (const l of p.lines) if (l.item === it.name) n -= pieces(it, l);
    return n;
  }
  const expOf = (it) => stockAt(it, draft?.q[it.name]?.at);

  // «3 كرتونة + 4 قطعة» from a quantity in small units
  function qtyParts(it, pcs) {
    const a = Math.abs(pcs);
    let parts;
    if (isTwo(it)) {
      const k = Math.floor(a / it.fill);
      const s = Math.round((a - k * it.fill) * 1000) / 1000;
      parts = [k ? [k, bigU(it)] : null, s ? [s, smallU(it)] : null].filter(Boolean);
      if (!parts.length) parts = [[0, smallU(it)]];
    } else parts = [[a, smallU(it)]];
    return parts.map(([n, u], i) => [(i === 0 && pcs < 0 ? '−' : '') + fmtQ(n), u]);
  }
  const qtyHtml = (it, pcs) =>
    qtyParts(it, pcs).map(([n, u]) => `<span class="num">${n}</span> ${esc(u)}`).join(' <span class="muted">+</span> ');
  const qtyText = (it, pcs) => qtyParts(it, pcs).map(([n, u]) => `${n} ${u}`).join(' + ');
  // a difference: «نقص 2 كرتونة + 3 قطعة» / «زيادة 4 قطعة»
  const diffHtml = (it, d) =>
    !d ? '<span class="pill good">مطابق</span>' : `<span class="${d > 0 ? 'sc-plus' : 'sc-minus'}">${d > 0 ? 'زيادة' : 'نقص'} ${qtyHtml(it, Math.abs(d))}</span>`;
  const diffText = (it, d) => (!d ? 'مطابق' : `${d > 0 ? 'زيادة' : 'نقص'} ${qtyText(it, Math.abs(d))}`);

  // What was typed for an item: { counted: number|null, bad }
  function entry(it) {
    const e = draft.q[it.name];
    if (!e) return { counted: null, bad: false };
    const s = parseQty(e.s);
    const b = isTwo(it) ? parseQty(e.b) : null;
    if (Number.isNaN(s) || Number.isNaN(b)) return { counted: null, bad: true };
    if (s == null && b == null) return { counted: null, bad: false };
    return { counted: isTwo(it) ? (b || 0) * it.fill + (s || 0) : s, bad: false };
  }

  function stats() {
    let counted = 0, diff = 0, plus = 0, minus = 0;
    for (const name of draft.items) {
      const it = item(name);
      if (!it) continue;
      const { counted: c } = entry(it);
      if (c == null) continue;
      counted++;
      const d = c - expOf(it);
      if (d) diff++;
      if (d > 0) plus += d * pieceCost(it);
      if (d < 0) minus -= d * pieceCost(it);
    }
    return { counted, diff, plus, minus, total: draft.items.length };
  }

  const scopeLabel = (sc) =>
    (sc.kind === 'cls' ? `فئة: ${sc.cls || 'بلا فئة'}` : sc.kind === 'pick' ? `أصناف مختارة (${sc.n})` : 'كل الأصناف').slice(0, 100);
  const byName = (a, b) => a.localeCompare(b, 'ar');
  const classes = () => [...new Set(P().items.map((i) => i.cls))].sort(byName);

  function scopeItems() {
    const list =
      scope.kind === 'cls' ? P().items.filter((i) => i.cls === scope.cls) : scope.kind === 'pick' ? P().items.filter((i) => scope.picked.has(i.name)) : P().items;
    return [...list].sort((a, b) => byName(a.cls, b.cls) || byName(a.name, b.name)).map((i) => i.name);
  }

  const stamp = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : `${localDay(d)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };

  // ---------------------------------------------------------------- views

  function view() {
    syncUser();
    // keep the caret where it was across a re-render (auto refresh)
    const a = document.activeElement;
    focusMemo = a && a.id && a.closest?.('#main') ? { id: a.id, pos: a.selectionStart ?? null } : null;
    onAfter(bind);
    if (mode === 'count' && draft) return countView();
    mode = 'start';
    return startView();
  }

  function redraw() {
    if (state.view !== 'stockcount' || !$('#main')) return;
    $('#main').innerHTML = view();
    bind();
  }

  // ----- the start screen: last count, a new count, history

  function countsWithLines() {
    const lines = new Map();
    for (const l of P().stockCountLines || []) {
      if (!lines.has(l.countId)) lines.set(l.countId, []);
      lines.get(l.countId).push(l);
    }
    return (P().stockCounts || [])
      .map((c) => {
        const ls = lines.get(c.id) || [];
        let plus = 0, minus = 0, changed = 0;
        for (const l of ls) {
          const d = l.counted - l.expected;
          if (d) changed++;
          if (d > 0) plus += d * l.cost;
          if (d < 0) minus -= d * l.cost;
        }
        return { ...c, lines: ls, n: ls.length, changed, plus, minus, net: plus - minus };
      })
      .sort((a, b) => (b.time || '').localeCompare(a.time || '') || b.id - a.id);
  }

  const tile = (ico, label, value, hint = '') =>
    `<div class="card kpi"><div class="label"><span class="k-ico">${icon(ico)}</span>${esc(label)}</div><div class="value">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

  function startView() {
    const counts = countsWithLines();
    const last = counts[0];
    const resume = draft
      ? (() => {
          const st = stats();
          return `<div class="notice info sc-resume">
            <div><b>يوجد جرد لم يُحفظ بعد</b> — ${esc(scopeLabel(draft.scope))}، بدأ في <span class="num">${esc(stamp(draft.started))}</span>.
              تم عدّ <b class="num">${st.counted}</b> من <b class="num">${st.total}</b>.</div>
            <div class="sc-resume-acts">
              <button class="btn primary" id="scResume">${icon('stockcount')} متابعة الجرد السابق</button>
              <button class="btn danger" id="scDrop">${dropArmed ? 'اضغط مرة أخرى لتأكيد التجاهل' : 'تجاهله'}</button>
            </div>
          </div>`;
        })()
      : '';
    const kinds = [['all', 'كل الأصناف'], ['cls', 'فئة'], ['pick', 'أصناف أختارها']];
    const n = scopeItems().length;
    return `${resume}
    <div class="grid kpis">
      ${tile('stockcount', 'آخر جرد', last ? `<span class="num">${esc(last.date)}</span>` : '—', last ? `رقم ${last.id} — ${esc(last.user)} — ${esc(last.scope)}` : 'لم يُسجَّل أي جرد بعد')}
      ${tile('checks', 'أصناف بفرق في آخر جرد', last ? `<span class="num">${last.changed}</span>` : '—', last ? `عدد الأصناف المعدودة: ${last.n}` : '')}
      ${tile('out', 'قيمة النقص في آخر جرد', last ? money(last.minus) : '—', 'بسعر الشراء')}
      ${tile('profit', 'قيمة الزيادة في آخر جرد', last ? money(last.plus) : '—', last ? `الصافي: ${money(last.net)}` : '')}
    </div>
    <div class="card sc-new">
      <h3>${icon('plus')} جرد جديد</h3>
      <div class="sc-new-row">
        <div class="seg" id="scScope">${kinds.map(([k, l]) => `<button type="button" data-k="${k}" class="${scope.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${scope.kind === 'cls'
          ? `<select id="scCls" class="sc-select" aria-label="الفئة">${classes()
              .map((c) => `<option value="${esc(c)}"${c === scope.cls ? ' selected' : ''}>${esc(c || 'بلا فئة')}</option>`)
              .join('')}</select>`
          : ''}
        <span class="muted" id="scScopeN">عدد الأصناف في الجرد: <b class="num">${n}</b></span>
        <button class="btn primary" id="scBegin"${draft ? ' disabled title="أكمل الجرد غير المحفوظ أو تجاهله أولاً"' : ''}>${icon('stockcount')} ابدأ الجرد</button>
      </div>
      ${scope.kind === 'pick' ? pickHtml() : ''}
      ${draft ? '<p class="muted sc-small">لبدء جرد جديد، تابع الجرد غير المحفوظ واحفظه، أو تجاهله.</p>' : '<p class="muted sc-small">عُدّ الأصناف على الرفوف، ثم احفظ الجرد: يُصحَّح رصيد كل صنف معدود إلى الكمية التي عددتها، ويبقى تقرير بالزيادة والنقص.</p>'}
    </div>
    ${section('الجردات السابقة', table(counts, [
      { key: 'id', label: 'رقم', num: true, plain: true },
      { key: 'date', label: 'التاريخ' },
      { key: 'tm', label: 'الوقت', get: (r) => (r.time || '').slice(11, 16) },
      { key: 'user', label: 'المستخدم' },
      { key: 'scope', label: 'النطاق' },
      { key: 'n', label: 'المعدود', num: true },
      { key: 'changed', label: 'بفرق', num: true },
      { key: 'plus', label: 'قيمة الزيادة', money: true, total: true },
      { key: 'minus', label: 'قيمة النقص', money: true, total: true },
      { key: 'net', label: 'الصافي', money: true, total: true },
      { key: 'note', label: 'ملاحظة' },
    ], { onClick: (r) => report(r.id), empty: 'لا توجد جردات سابقة', name: 'الجردات' }))}
    ${counts.length ? '<p class="muted sc-small">اضغط على أي جرد لعرض تقريره.</p>' : ''}`;
  }

  function pickList() {
    const q = pickSearch.trim();
    return P()
      .items.filter((i) => !q || i.name.includes(q) || (i.code && i.code.startsWith(q)))
      .sort((a, b) => byName(a.name, b.name));
  }
  function pickHtml() {
    return `<div class="sc-pick">
      <div class="sc-pick-tools">
        <input id="scPickSearch" class="search" type="search" placeholder="ابحث باسم الصنف أو رمزه" value="${esc(pickSearch)}" autocomplete="off">
        <button class="btn small" id="scPickAll">تحديد الظاهر</button>
        <button class="btn small" id="scPickNone">إلغاء التحديد</button>
        <span class="muted">المحدد: <b class="num" id="scPickN">${scope.picked.size}</b></span>
      </div>
      <div class="sc-pick-list" id="scPickList">${pickListHtml()}</div>
    </div>`;
  }
  function pickListHtml() {
    const list = pickList();
    if (!list.length) return '<p class="empty">لا يوجد صنف بهذا الاسم</p>';
    return list
      .slice(0, 400)
      .map((i) => `<label class="check sc-pick-item"><input type="checkbox" data-name="${esc(i.name)}"${scope.picked.has(i.name) ? ' checked' : ''}>
        <span>${esc(i.name)}</span><small class="muted">${esc(i.cls || '')}</small></label>`)
      .join('') + (list.length > 400 ? `<p class="muted sc-small">يظهر أول 400 صنف من ${list.length}. اكتب في البحث لتضييق القائمة.</p>` : '');
  }

  // ----- counting

  function visibleNames() {
    const q = search.trim();
    return draft.items
      .map((name, n) => ({ name, n }))
      .filter(({ name }) => {
        const it = item(name);
        if (q && !(name.includes(q) || (it?.code && it.code.startsWith(q)))) return false;
        if (filter === 'all' || !it) return filter === 'all';
        const { counted } = entry(it);
        if (filter === 'done') return counted != null;
        if (filter === 'todo') return counted == null;
        return counted != null && counted !== expOf(it);
      });
  }

  function rowClass(it) {
    const { counted, bad } = entry(it);
    if (bad) return 'sc-err';
    if (counted == null) return '';
    return counted === expOf(it) ? 'sc-ok' : 'sc-off';
  }
  function diffCell(it) {
    const { counted } = entry(it);
    if (counted == null) return '<span class="muted">—</span>';
    return diffHtml(it, counted - expOf(it));
  }
  function valCell(it) {
    const { counted } = entry(it);
    if (counted == null) return '';
    const d = counted - expOf(it);
    return d ? money(d * pieceCost(it)) : '';
  }

  function rowHtml(name, n) {
    const it = item(name);
    if (!it) return `<tr data-n="${n}" class="sc-gone"><td colspan="7">${esc(name)} <span class="pill bad">لم يعد موجوداً في الأصناف</span></td></tr>`;
    const e = draft.q[name] || {};
    const inp = (f, unit) =>
      `<label class="sc-q"><input id="scq-${n}-${f}" data-n="${n}" data-f="${f}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(e[f] ?? '')}" aria-label="${esc(name)}: ${esc(unit)}"><span>${esc(unit)}</span></label>`;
    return `<tr data-n="${n}" class="${rowClass(it)}">
      <td class="sc-name"><b>${esc(name)}</b><small class="sc-sub">${it.code ? `<span class="num">${esc(it.code)}</span> · ` : ''}${esc(it.cls || 'بلا فئة')}</small></td>
      <td class="sc-code"><span class="num">${esc(it.code || '—')}</span></td>
      <td class="sc-cls">${esc(it.cls || '—')}</td>
      <td class="sc-exp"><small class="sc-lbl">المتوقع: </small>${qtyHtml(it, expOf(it))}</td>
      <td class="sc-in">${isTwo(it) ? inp('b', bigU(it)) + inp('s', smallU(it)) : inp('s', smallU(it))}</td>
      <td class="sc-diff">${diffCell(it)}</td>
      <td class="sc-val">${valCell(it)}</td>
    </tr>`;
  }

  function bodyHtml() {
    const rows = visibleNames();
    if (!rows.length) {
      const why = search.trim() ? 'لا يوجد صنف بهذا الاسم أو الرمز في هذا الجرد' : filter === 'todo' ? 'عُدَّت كل الأصناف ✔' : filter === 'diff' ? 'لا توجد فروق حتى الآن' : 'لا توجد أصناف';
      return `<tr><td colspan="7" class="empty">${why}</td></tr>`;
    }
    return rows.map(({ name, n }) => rowHtml(name, n)).join('');
  }

  function chipsHtml(st) {
    return [['all', 'الكل', st.total], ['done', 'المعدود', st.counted], ['todo', 'غير المعدود', st.total - st.counted], ['diff', 'بفرق', st.diff]]
      .map(([f, l, c]) => `<button type="button" class="chip${filter === f ? ' on' : ''}" data-filter="${f}">${l} <span class="num sc-chip-n">${c}</span></button>`)
      .join('');
  }
  function progressHtml(st) {
    const pct = st.total ? Math.round((st.counted / st.total) * 100) : 0;
    return `<div class="sc-prog-text">تم عدّ <b class="num">${st.counted}</b> من <b class="num">${st.total}</b>
        ${st.diff ? `<span class="pill warn">بفرق: <span class="num">${st.diff}</span></span>` : ''}</div>
      <div class="meter sc-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      <div class="sc-prog-vals muted">الزيادة ${money(st.plus)} — النقص ${money(st.minus)}</div>`;
  }
  const msgHtml = () => (msg ? `<span class="${msg.ok ? 'sc-msg-ok' : 'sc-msg-bad'}">${msg.html}</span>` : '<span class="muted">امسح باركود صنف أو اكتب اسمه، ثم اكتب الكمية المعدودة في سطره.</span>');

  function countView() {
    const st = stats();
    return `<div class="sc-count">
      <div class="card sc-bar">
        <div class="sc-bar-top">
          <div class="sc-title"><b>${esc(scopeLabel(draft.scope))}</b><small class="muted">بدأ في <span class="num">${esc(stamp(draft.started))}</span></small></div>
          <div class="sc-progress" id="scProgress">${progressHtml(st)}</div>
          <div class="sc-acts">
            <button class="btn primary" id="scReview">${icon('check')} مراجعة وحفظ</button>
            <button class="btn small" id="scLater" title="يبقى الجرد محفوظاً على هذا الجهاز لتتابعه لاحقاً">إيقاف مؤقت</button>
            <button class="btn small danger" id="scDiscard">${icon('trash')} إلغاء الجرد</button>
          </div>
        </div>
        <div class="sc-scanrow">
          <div class="sc-scan">${icon('search')}<input id="scScan" autocomplete="off" enterkeyhint="go" placeholder="امسح الباركود أو اكتب اسم الصنف أو رمزه ثم Enter" value="${esc(search)}"></div>
          <div class="seg sc-mode" id="scMode" role="group" aria-label="عند المسح">
            <button type="button" data-m="add" class="${scanMode === 'add' ? 'on' : ''}">كل مسح = وحدة صغيرة واحدة</button>
            <button type="button" data-m="jump" class="${scanMode === 'jump' ? 'on' : ''}">انتقل للصنف فقط</button>
          </div>
        </div>
        <div class="sc-msg" id="scMsg" aria-live="polite">${msgHtml()}</div>
        <div class="chips" id="scFilters">${chipsHtml(st)}</div>
      </div>
      <div class="table-wrap sc-wrap"><table class="sc-table">
        <thead><tr><th>الصنف</th><th class="sc-code">الرمز</th><th class="sc-cls">الفئة</th><th>المتوقع</th><th>المعدود</th><th>الفرق</th><th>قيمة الفرق</th></tr></thead>
        <tbody id="scBody">${bodyHtml()}</tbody>
      </table></div>
    </div>`;
  }

  function drawBody() {
    $('#scBody').innerHTML = bodyHtml();
    drawStats();
  }
  function drawStats() {
    const st = stats();
    $('#scProgress').innerHTML = progressHtml(st);
    $('#scFilters').innerHTML = chipsHtml(st);
  }
  function drawRow(n) {
    const tr = $(`#scBody tr[data-n="${n}"]`);
    const it = item(draft.items[n]);
    if (!tr || !it) return;
    tr.className = rowClass(it);
    tr.querySelector('.sc-diff').innerHTML = diffCell(it);
    tr.querySelector('.sc-val').innerHTML = valCell(it);
  }
  function say(ok, html) {
    msg = { ok, html };
    const box = $('#scMsg');
    if (!box) return;
    box.innerHTML = msgHtml();
    box.classList.remove('sc-pulse');
    void box.offsetWidth;
    box.classList.add('sc-pulse');
  }
  function hit(n) {
    const tr = $(`#scBody tr[data-n="${n}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tr.classList.remove('sc-hit');
    void tr.offsetWidth;
    tr.classList.add('sc-hit');
  }
  const focusScan = () => {
    const s = $('#scScan');
    if (s && !touch.matches) s.focus();
  };

  // A scan (or Enter on an exact code): find the item; add one small unit,
  // or only go to its line.
  function scan(code) {
    const q = String(code || '').trim();
    if (!q || !draft) return;
    const it = P().items.find((x) => x.code === q) || item(q);
    search = '';
    if ($('#scScan')) $('#scScan').value = '';
    if (!it) {
      drawBody();
      say(false, `لا يوجد صنف بالرمز <span class="num">${esc(q)}</span>`);
      return focusScan();
    }
    let n = draft.items.indexOf(it.name);
    if (n < 0) {
      if (draft.scope.kind !== 'pick') {
        drawBody();
        say(false, `«${esc(it.name)}» ليس ضمن نطاق هذا الجرد (${esc(scopeLabel(draft.scope))})`);
        return focusScan();
      }
      draft.items.push(it.name);
      draft.scope.n = draft.items.length;
      n = draft.items.length - 1;
    }
    if (scanMode === 'add') {
      const e = (draft.q[it.name] ||= {});
      e.s = String(Math.round(((parseQty(e.s) || 0) + 1) * 1000) / 1000);
      e.at = nowStamp();
    }
    persist();
    if (filter !== 'all' && !visibleNames().some((r) => r.n === n)) filter = 'all';
    drawBody();
    const { counted } = entry(it);
    say(
      true,
      `${icon('check')} <b>${esc(it.name)}</b> — ${scanMode === 'add' ? `المعدود الآن: ${counted == null ? '—' : qtyHtml(it, counted)}` : 'اكتب الكمية في سطره'}`,
    );
    hit(n);
    if (scanMode === 'jump' && !touch.matches) {
      const inp = $(`#scq-${n}-${isTwo(it) ? 'b' : 's'}`);
      inp?.focus();
      inp?.select();
    } else focusScan();
  }

  function enterSearch() {
    const q = search.trim();
    if (!q) return;
    if (P().items.some((x) => x.code === q || x.name === q)) return scan(q);
    const rows = visibleNames();
    if (rows.length === 1) {
      const { n, name } = rows[0];
      const it = item(name);
      hit(n);
      const inp = it && $(`#scq-${n}-${isTwo(it) ? 'b' : 's'}`);
      inp?.focus();
      inp?.select();
    } else if (!rows.length) say(false, `لا يوجد صنف بهذا الاسم أو الرمز: ${esc(q)}`);
    else say(false, `عدد الأصناف المطابقة: <span class="num">${rows.length}</span>، اكتب المزيد أو اختر من الجدول`);
  }

  function begin() {
    const items = scopeItems();
    if (!items.length) return toast(scope.kind === 'pick' ? 'اختر صنفاً واحداً على الأقل' : 'لا توجد أصناف في هذا النطاق', true);
    draft = { v: 1, started: new Date().toISOString(), scope: { kind: scope.kind, cls: scope.cls, n: items.length }, items, q: {} };
    persist();
    mode = 'count';
    filter = 'all';
    search = '';
    msg = null;
    redraw();
  }

  function discard() {
    openModal(`<h2>إلغاء الجرد الحالي</h2>
      <p>سيُحذف ما عددته في هذا الجرد (${esc(scopeLabel(draft.scope))}) ولن تتغيّر أي أرصدة. لا يمكن التراجع عن ذلك.</p>
      <div class="form-actions"><button class="btn danger" id="scDiscardYes">${icon('trash')} نعم، ألغِ الجرد</button><button class="btn" id="scDiscardNo">رجوع</button></div>`);
    $('#scDiscardNo').onclick = closeModal;
    $('#scDiscardYes').onclick = () => {
      draft = null;
      persist();
      mode = 'start';
      closeModal();
      toast('أُلغي الجرد الحالي');
      redraw();
    };
  }

  // ---------------------------------------------------------------- review & save

  async function review() {
    if (busy) return;
    busy = true;
    const btn = $('#scReview');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جارٍ تحديث الأرصدة…';
    }
    try {
      await refreshData(); // expected = the stock right now
    } catch (e) {
      busy = false;
      toast('تعذّر تحديث الأرصدة: ' + e.message, true);
      redraw();
      return;
    }
    busy = false;
    redraw();
    const lines = [];
    let bad = 0;
    for (const name of draft.items) {
      const it = item(name);
      if (!it) continue;
      const { counted, bad: b } = entry(it);
      if (b) bad++;
      if (counted == null) continue;
      const expected = expOf(it);
      const cost = pieceCost(it);
      lines.push({ it, item: name, expected, counted, diff: counted - expected, value: (counted - expected) * cost });
    }
    if (bad) return toast(`توجد كمية غير صحيحة في ${bad} سطر. صحّحها أولاً (اختر «الكل» وابحث عن السطر الأحمر).`, true);
    if (!lines.length) return toast('لم تَعُدّ أي صنف بعد', true);
    const diffs = lines.filter((l) => l.diff).sort((a, b) => a.value - b.value);
    const plus = diffs.filter((l) => l.diff > 0).reduce((a, l) => a + l.value, 0);
    const minus = -diffs.filter((l) => l.diff < 0).reduce((a, l) => a + l.value, 0);
    const left = draft.items.length - lines.length;
    openModal(`<h2>مراجعة الجرد قبل الحفظ</h2>
      <p class="muted">أُعيدت قراءة الأرصدة الآن. المتوقع لكل صنف هو رصيده لحظة عدّه، فما بيع أو اشتُري بعد العدّ لا يُحسب فرقاً. ${esc(scopeLabel(draft.scope))}.</p>
      <div class="grid kpis sc-sum">
        ${tile('stockcount', 'أصناف معدودة', `<span class="num">${lines.length}</span>`, `من أصل ${draft.items.length}`)}
        ${tile('checks', 'أصناف بفرق', `<span class="num">${diffs.length}</span>`)}
        ${tile('profit', 'قيمة الزيادة', money(plus), 'بسعر الشراء')}
        ${tile('out', 'قيمة النقص', money(minus), 'بسعر الشراء')}
        ${tile('cash', 'الصافي', money(plus - minus))}
      </div>
      ${left ? `<p class="notice">لم تُعَدّ أصناف عددها <b class="num">${left}</b> من نطاق الجرد، ولن تتغيّر أرصدتها.</p>` : ''}
      ${diffs.length
        ? section('الأصناف التي فيها فرق', table(diffs, linesColumns(), { name: 'فروق الجرد' }), { search: false })
        : '<p class="notice good">كل الأصناف المعدودة مطابقة للرصيد المتوقع.</p>'}
      <label class="field sc-note">ملاحظة (اختياري)<input id="scNote" maxlength="255" placeholder="مثلاً: جرد نهاية الشهر"></label>
      <p class="notice error" id="scErr" hidden></p>
      <div class="form-actions">
        <button class="btn primary" id="scSave">${icon('save')} تأكيد وحفظ الجرد</button>
        <button class="btn" id="scBack">رجوع للعدّ</button>
      </div>`);
    $('#scBack').onclick = () => {
      closeModal();
      focusScan();
    };
    $('#scSave').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'جارٍ الحفظ…';
      try {
        const r = await write('saveStockCount', {
          note: $('#scNote').value.trim(),
          scope: scopeLabel(draft.scope),
          lines: lines.map(({ item: name, expected, counted }) => ({ item: name, expected, counted })),
        });
        draft = null;
        persist();
        mode = 'start';
        msg = null;
        redraw();
        toast(`حُفظ الجرد رقم ${r.id} ✔`);
        report(r.id);
      } catch (err) {
        b.disabled = false;
        b.innerHTML = `${icon('save')} تأكيد وحفظ الجرد`;
        $('#scErr').textContent = err.message;
        $('#scErr').hidden = false;
      }
    };
  }

  // Lines of a count: { it?, item, expected, counted, diff, value }
  function linesColumns() {
    const q = (f) => (r) => (r.it ? qtyHtml(r.it, r[f]) : `<span class="num">${fmtQ(r[f])}</span>`);
    const t = (f) => (r) => (r.it ? qtyText(r.it, r[f]) : fmtQ(r[f]));
    return [
      { key: 'item', label: 'الصنف' },
      { key: 'cls', label: 'الفئة', get: (r) => r.it?.cls || '' },
      { key: 'expected', label: 'المتوقع', html: q('expected'), csv: t('expected') },
      { key: 'counted', label: 'المعدود', html: q('counted'), csv: t('counted') },
      {
        key: 'diff', label: 'الفرق',
        html: (r) => (r.it ? diffHtml(r.it, r.diff) : `<span class="num">${fmtQ(r.diff)}</span>`),
        csv: (r) => (r.it ? diffText(r.it, r.diff) : fmtQ(r.diff)),
      },
      { key: 'value', label: 'قيمة الفرق', money: true, total: true },
    ];
  }

  // ---------------------------------------------------------------- the report

  function report(id) {
    const c = countsWithLines().find((x) => x.id === id);
    if (!c) return toast('الجرد غير موجود، حدّث البيانات', true);
    const rows = c.lines
      .map((l) => ({ it: item(l.item), item: l.item, expected: l.expected, counted: l.counted, diff: l.counted - l.expected, value: (l.counted - l.expected) * l.cost }))
      .sort((a, b) => (!!b.diff - !!a.diff) || a.value - b.value || a.item.localeCompare(b.item, 'ar'));
    // a later count of the same items was based on this one's result
    const later = countsWithLines().filter((x) => x.id !== id && (x.time || '') > (c.time || '') && x.lines.some((l) => c.lines.some((m) => m.item === l.item)));
    openModal(`<h2>تقرير الجرد رقم ${c.id}</h2>
      <div class="statement-head">
        <span>التاريخ: <b class="num">${esc(c.date)}</b></span>
        <span>الوقت: <b class="num">${esc((c.time || '').slice(11, 16))}</b></span>
        <span>المستخدم: <b>${esc(c.user)}</b></span>
        <span>النطاق: <b>${esc(c.scope || '—')}</b></span>
        ${c.note ? `<span>ملاحظة: <b>${esc(c.note)}</b></span>` : ''}
      </div>
      <div class="grid kpis sc-sum">
        ${tile('stockcount', 'أصناف معدودة', `<span class="num">${c.n}</span>`)}
        ${tile('checks', 'أصناف بفرق', `<span class="num">${c.changed}</span>`)}
        ${tile('profit', 'قيمة الزيادة', money(c.plus))}
        ${tile('out', 'قيمة النقص', money(c.minus))}
        ${tile('cash', 'الصافي', money(c.net))}
      </div>
      ${section('أصناف الجرد', table(rows, linesColumns(), { name: `تقرير الجرد ${c.id}` }))}
      ${state.admin ? `<div class="form-actions no-print">
        <button class="btn danger" id="scUndo">${icon('trash')} إلغاء هذا الجرد</button>
      </div>` : ''}`);
    if (!$('#scUndo')) return;
    $('#scUndo').onclick = () => {
      openModal(`<h2>إلغاء الجرد رقم ${c.id}</h2>
        <p>سيُحذف هذا الجرد وتعود أرصدة أصنافه (عددها <b class="num">${c.n}</b>) كما كانت قبله.</p>
        ${later.length ? `<p class="notice">بعد هذا الجرد جردٌ لاحق (رقم ${later.map((x) => x.id).join('، ')}) لبعض الأصناف نفسها، وقد بُني على نتيجته. إلغاؤه يغيّر أرصدة هذه الأصناف بعد الجرد اللاحق أيضاً.</p>` : ''}
        <p class="notice error" id="scUndoErr" hidden></p>
        <div class="form-actions"><button class="btn danger" id="scUndoYes">${icon('trash')} نعم، ألغِ هذا الجرد</button><button class="btn" id="scUndoNo">رجوع</button></div>`);
      $('#scUndoNo').onclick = () => report(c.id);
      $('#scUndoYes').onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await write('deleteStockCount', { id: c.id });
          closeModal();
          toast(`أُلغي الجرد رقم ${c.id} ✔`);
        } catch (err) {
          b.disabled = false;
          $('#scUndoErr').textContent = err.message;
          $('#scUndoErr').hidden = false;
        }
      };
    };
  }

  // ---------------------------------------------------------------- events

  function bind() {
    if (mode === 'count' && draft && $('#scScan')) return bindCount();
    if (!$('#scBegin')) return;
    if ($('#scResume'))
      $('#scResume').onclick = () => {
        mode = 'count';
        dropArmed = 0;
        redraw();
      };
    if ($('#scDrop'))
      $('#scDrop').onclick = (e) => {
        if (!dropArmed) {
          dropArmed = setTimeout(() => {
            dropArmed = 0;
            if ($('#scDrop')) $('#scDrop').textContent = 'تجاهله';
          }, 4000);
          e.currentTarget.textContent = 'اضغط مرة أخرى لتأكيد التجاهل';
          return;
        }
        clearTimeout(dropArmed);
        dropArmed = 0;
        draft = null;
        persist();
        toast('تم تجاهل الجرد غير المحفوظ');
        redraw();
      };
    $('#scScope').onclick = (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      scope.kind = b.dataset.k;
      if (scope.kind === 'cls' && !classes().includes(scope.cls)) scope.cls = classes()[0] ?? '';
      redraw();
    };
    if ($('#scCls'))
      $('#scCls').onchange = (e) => {
        scope.cls = e.target.value;
        $('#scScopeN b').textContent = scopeItems().length;
      };
    if ($('#scPickSearch')) {
      $('#scPickSearch').oninput = (e) => {
        pickSearch = e.target.value;
        $('#scPickList').innerHTML = pickListHtml();
      };
      const sync = () => {
        $('#scPickN').textContent = scope.picked.size;
        $('#scScopeN b').textContent = scope.picked.size;
      };
      $('#scPickList').onchange = (e) => {
        const name = e.target.dataset?.name;
        if (name == null) return;
        if (e.target.checked) scope.picked.add(name);
        else scope.picked.delete(name);
        sync();
      };
      $('#scPickAll').onclick = () => {
        pickList().slice(0, 400).forEach((i) => scope.picked.add(i.name));
        $('#scPickList').innerHTML = pickListHtml();
        sync();
      };
      $('#scPickNone').onclick = () => {
        scope.picked.clear();
        $('#scPickList').innerHTML = pickListHtml();
        sync();
      };
    }
    $('#scBegin').onclick = begin;
  }

  function bindCount() {
    const scanBox = $('#scScan');
    scanBox.oninput = () => {
      search = scanBox.value;
      $('#scBody').innerHTML = bodyHtml();
    };
    scanBox.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      enterSearch();
    };
    $('#scMode').onclick = (e) => {
      const b = e.target.closest('button[data-m]');
      if (!b) return;
      scanMode = b.dataset.m;
      store.set('fr3oon-count-scan', scanMode === 'jump' ? 'jump' : '');
      $$('#scMode button').forEach((x) => x.classList.toggle('on', x === b));
      focusScan();
    };
    $('#scFilters').onclick = (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      filter = b.dataset.filter;
      drawBody();
    };
    const body = $('#scBody');
    body.oninput = (e) => {
      const f = e.target.dataset?.f;
      if (!f) return;
      const n = Number(e.target.dataset.n);
      const name = draft.items[n];
      const q = (draft.q[name] ||= {});
      q[f] = e.target.value;
      q.at = nowStamp();
      if (!q.b && !q.s) delete draft.q[name];
      persist();
      drawRow(n);
      drawStats();
    };
    body.onkeydown = (e) => {
      if (e.key !== 'Enter' || !e.target.dataset?.f) return;
      e.preventDefault();
      const all = $$('#scBody input[data-f]');
      const next = all[all.indexOf(e.target) + 1];
      if (next) {
        next.focus();
        next.select();
        next.closest('tr')?.scrollIntoView({ block: 'nearest' });
      } else focusScan();
    };
    body.onfocusin = (e) => e.target.dataset?.f && e.target.select();
    $('#scReview').onclick = review;
    $('#scLater').onclick = () => {
      mode = 'start';
      redraw();
    };
    $('#scDiscard').onclick = discard;
    const back = focusMemo && document.getElementById(focusMemo.id);
    if (back) {
      back.focus();
      if (focusMemo.pos != null) back.setSelectionRange?.(focusMemo.pos, focusMemo.pos);
    } else focusScan();
    focusMemo = null;
  }

  // Barcode scans while counting go to the count, wherever the focus is.
  installScanner(() =>
    state.view === 'stockcount' && mode === 'count' && draft && $('#modal').hidden && $('#scScan') ? { input: $('#scScan'), onScan: scan } : null,
  );

  return { view };
}
