// Quick sale (POS): item buttons by category, search / barcode, a cart and
// one-key saving. The cart is kept per user in this browser, so a refresh or
// a closed window doesn't lose a half-entered sale.

import { toQty } from './numsep.js';

export function setupPos(ctx) {
  const { $, $$, esc, fmt, localDay, state, write, toast, forms, icon, onAfter, C, store, invoiceModal, can } = ctx;
  const P = () => state.P;
  const key = () => 'lawha-cart-' + (state.user || '');
  const emptyCart = () => ({ type: C.CASH, customer: '', paid: '', note: '', lines: [] });

  let cart = load();
  let search = '';
  let cls = '';
  let saving = false;

  function load() {
    try {
      const c = JSON.parse(store.get('lawha-cart-' + (state.user || '')) || 'null');
      if (c && Array.isArray(c.lines)) return c;
    } catch {
      /* start empty */
    }
    return emptyCart();
  }
  const persist = () => store.set(key(), cart.lines.length || cart.customer ? JSON.stringify(cart) : '');

  // Selling by the big unit (wholesale) needs its own permission; a line
  // already in the big unit keeps it so the select still shows it.
  const isBig = (it, unit) => !!it.unitL2 && it.unitL1 !== it.unitL2 && unit === it.unitL1;
  const unitsOf = (it, cur) =>
    [...new Set([it.unitL2, it.unitL1].filter(Boolean))].filter((u) => u === cur || !isBig(it, u) || can('sale_wholesale'));
  // Sale types this user may save; the first one is the default.
  const types = () => [C.CASH, C.CREDIT].filter((t) => can(t === C.CREDIT ? 'sale_credit' : 'sale_cash'));
  const priceFor = (it, unit) => (unit === it.unitL1 ? it.priceL1 : it.priceL2);
  const itemBy = (name) => P().itemByName.get(name);
  const total = () => cart.lines.reduce((a, l) => a + l.qty * l.price, 0);

  function stockText(it) {
    const s = state.stockByName?.get(it.name);
    if (!s) return '';
    if (s.totalPcs <= 0) return 'نافد';
    const small = it.unitL1 !== it.unitL2 && s.s ? ` + ${fmt(s.s)} ${it.unitL2}` : '';
    return `رصيد ${fmt(s.k)} ${it.unitL1}${small}`;
  }

  function matches() {
    const q = search.trim();
    return P().items.filter((it) => (!cls || it.cls === cls) && (!q || it.name.includes(q) || (it.code && it.code.startsWith(q))));
  }

  function gridHtml() {
    const list = matches();
    if (!list.length) return '<p class="empty">لا يوجد صنف بهذا الاسم</p>';
    return list
      .slice(0, 160)
      .map((it) => {
        const st = stockText(it);
        const unit = it.unitL2 || it.unitL1;
        return `<button class="item-btn${st === 'نافد' ? ' out' : ''}" data-item="${esc(it.name)}">
          <b>${esc(it.name)}</b>
          <small>${esc(st)}</small>
          <span class="price num">${fmt(priceFor(it, unit))} <small>/ ${esc(unit)}</small></span>
        </button>`;
      })
      .join('');
  }

  function chipsHtml() {
    const classes = [...new Set(P().items.map((i) => i.cls).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    return [['', 'الكل'], ...classes.map((c) => [c, c])]
      .map(([v, label]) => `<button class="chip${v === cls ? ' on' : ''}" data-cls="${esc(v)}">${esc(label)}</button>`)
      .join('');
  }

  // Rows grow when the invoice is short and tighten as it fills up, so the
  // lines always fill the panel and stay easy to read.
  const density = () => (cart.lines.length <= 3 ? 'd-lg' : cart.lines.length <= 6 ? 'd-md' : 'd-sm');
  function countHtml() {
    if (!cart.lines.length) return '';
    const qty = cart.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
    return `<span>عدد الأصناف: <b class="num">${cart.lines.length}</b></span><span>مجموع الكميات: <b class="num">${fmt(qty)}</b></span>`;
  }

  function linesHtml() {
    if (!cart.lines.length) return `<div class="cart-empty">${icon('pos')}<br>الفاتورة فارغة<br><small>اضغط على صنف أو امسح الباركود</small></div>`;
    return cart.lines
      .map((l, i) => {
        const it = itemBy(l.item);
        const units = it ? unitsOf(it, l.unit) : [l.unit];
        return `<div class="cart-line" data-i="${i}">
          <span class="name"><small class="ln num">${i + 1}</small>${esc(l.item)}</span>
          <span class="line-total num">${fmt(l.qty * l.price)}</span>
          <div class="row">
            ${units.length > 1 ? `<select data-f="unit">${units.map((u) => `<option${u === l.unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>` : `<small class="muted">${esc(l.unit)}</small>`}
            <span class="stepper"><button type="button" data-step="-1" aria-label="أقل">−</button><input data-f="qty" inputmode="decimal" value="${l.qty}"><button type="button" data-step="1" aria-label="أكثر">+</button></span>
            <input class="price" data-f="price" inputmode="numeric" value="${l.price}" title="${can('edit_price') ? 'السعر' : 'السعر (تغييره يحتاج إلى صلاحية)'}"${can('edit_price') ? '' : ' readonly tabindex="-1"'}>
            <button class="icon-btn rm" type="button" data-rm aria-label="إزالة">${icon('trash')}</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function customerInfo() {
    if (cart.type !== C.CREDIT || !cart.customer) return '';
    const b = C.customerBalances(P()).find((x) => x.name === cart.customer);
    return b ? `الرصيد الحالي: <b class="num">${fmt(b.balance)}</b>` : '<span class="neg">هذا العميل غير موجود</span>';
  }

  // Today's latest invoices (a cashier sees their own), one click away
  // from printing again, editing or deleting.
  function recentHtml() {
    const today = localDay();
    const list = P().sales
      .filter((s) => s.date === today && s.lines.length && (can('sales') || s.user === state.user))
      .sort((a, b) => b.id - a.id)
      .slice(0, 8);
    if (!list.length) return '<p class="muted" style="margin:0;font-size:13px">لا توجد فواتير اليوم بعد</p>';
    return list
      .map((s) => `<button class="recent" data-sale="${s.id}">
          <span><b>رقم ${s.id}</b> <small>${esc(s.time.slice(11, 16))} — ${s.type === C.CREDIT ? esc(s.customer) : 'نقدي'}</small></span>
          <b class="num">${fmt(s.total)}</b>
        </button>`)
      .join('');
  }

  function view() {
    onAfter(bind);
    const allowed = types();
    if (!allowed.includes(cart.type)) cart.type = allowed[0] || C.CASH;
    const credit = cart.type === C.CREDIT;
    const recentHint = [can('print') && 'طباعتها', can('sale_edit') && 'تعديلها', can('sale_delete') && 'حذفها'].filter(Boolean);
    return `<div class="pos">
      <section class="pos-items">
        <div class="pos-search">${icon('search')}<input id="posSearch" autocomplete="off" placeholder="ابحث باسم الصنف أو رمزه، أو امسح الباركود واضغط Enter" value="${esc(search)}"></div>
        <div class="chips" id="posChips">${chipsHtml()}</div>
        <div class="item-grid" id="posGrid">${gridHtml()}</div>
      </section>
      <aside class="pos-cart">
        <div class="card cart-card">
          <div class="pos-resize" id="posResize" title="اسحب لتكبير الفاتورة أو تصغيرها، ونقرتان للحجم الأصلي"></div>
          <div class="cart-head">
            <div class="seg" id="posType"${allowed.length > 1 ? '' : ' hidden'}>${allowed
              .map((t) => `<button data-t="${t}" class="${t === cart.type ? 'on' : ''}">${t === C.CREDIT ? 'آجل' : 'نقدي'}</button>`)
              .join('')}</div>
            ${allowed.length > 1 ? '' : `<b class="cart-kind">بيع ${credit ? 'آجل' : 'نقدي'}</b>`}
            <button class="btn small" type="button" id="posRecentBtn" aria-expanded="false">${icon('activity')} آخر الفواتير</button>
          </div>
          <div id="posWho" class="cart-who" ${credit ? '' : 'hidden'}>
            <datalist id="dlCust">${P().customers.map((c) => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
            <input id="posCustomer" list="dlCust" autocomplete="off" placeholder="اسم العميل" value="${esc(cart.customer)}" style="width:100%">
            <p class="muted" id="posCustInfo" style="margin:6px 2px 0;font-size:13px">${customerInfo()}</p>
          </div>
          <div class="cart-count" id="posCount">${countHtml()}</div>
          <div class="cart-lines ${density()}" id="posLines">${linesHtml()}</div>
          <div class="cart-foot">
            <div class="cart-total">
              <span>المجموع</span>
              <button class="btn small" type="button" id="posNoteBtn"${cart.note ? ' hidden' : ''}>${icon('edit')} ملاحظة</button>
              <b class="num" id="posTotal">${fmt(total())}</b>
            </div>
            <div id="posPaidRow" ${credit ? '' : 'hidden'}><input id="posPaid" inputmode="numeric" placeholder="المدفوع الآن (اختياري)" value="${esc(cart.paid)}" style="width:100%"></div>
            <input id="posNote" placeholder="ملاحظة على الفاتورة" value="${esc(cart.note)}"${cart.note ? '' : ' hidden'}>
            <div class="cart-actions">
              <button class="btn primary big" id="posSave">${icon('save')} حفظ <span class="kbd">F9</span></button>
              ${can('print') ? `<button class="btn big" id="posSavePrint">${icon('print')} حفظ وطباعة <span class="kbd">F10</span></button>` : ''}
              <button class="btn big danger icon-only" type="button" id="posClear" title="فاتورة جديدة (تفريغ)" aria-label="فاتورة جديدة (تفريغ)">${icon('trash')}</button>
            </div>
          </div>
          <div class="cart-recent" id="posRecentPop" hidden>
            <div class="cart-recent-head"><b>آخر فواتير اليوم</b><button class="icon-btn" type="button" id="posRecentClose" aria-label="إغلاق">×</button></div>
            ${recentHint.length ? `<p class="muted">اضغط على فاتورة ل${recentHint.join(' أو ')}</p>` : ''}
            <div id="posRecent" class="stack" style="gap:6px">${recentHtml()}</div>
          </div>
        </div>
      </aside>
    </div>`;
  }

  function drawLines() {
    $('#posLines').className = 'cart-lines ' + density();
    $('#posLines').innerHTML = linesHtml();
    $('#posCount').innerHTML = countHtml();
    $('#posTotal').textContent = fmt(total());
    persist();
  }

  // the line just added, in view within the cart only: never moves the page
  function showLine(i) {
    const box = $('#posLines');
    const el = box?.querySelector(`.cart-line[data-i="${i}"]`);
    if (!el || box.scrollHeight <= box.clientHeight) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top - 8;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
  }

  function add(it) {
    const unit = it.unitL2 || it.unitL1;
    const same = cart.lines.findIndex((l) => l.item === it.name && l.unit === unit);
    if (same >= 0) cart.lines[same].qty += 1;
    else cart.lines.push({ item: it.name, unit, qty: 1, price: priceFor(it, unit) });
    drawLines();
    const i = same >= 0 ? same : cart.lines.length - 1;
    showLine(i);
  }

  function enterSearch() {
    const q = search.trim();
    if (!q) return;
    const exact = P().items.find((it) => it.code === q || it.name === q);
    const list = exact ? [exact] : matches();
    if (list.length === 1) {
      add(list[0]);
      search = '';
      $('#posSearch').value = '';
      $('#posGrid').innerHTML = gridHtml();
    } else if (!list.length) {
      toast('لا يوجد صنف بهذا الرمز أو الاسم', true);
    } else {
      toast(`عدد الأصناف المطابقة: ${list.length}، اختر أحدها`);
    }
  }

  // A barcode scan: only an exact code (or name), never a near match.
  function scan(code) {
    const q = code.trim();
    const it = P().items.find((x) => x.code === q) || P().items.find((x) => x.name === q);
    search = '';
    if ($('#posSearch')) $('#posSearch').value = '';
    if ($('#posGrid')) $('#posGrid').innerHTML = gridHtml();
    if (!it) return toast(`لا يوجد صنف بالباركود ${q}. أضِفه في رمز الصنف من صفحة المخزون والأسعار.`, true);
    add(it);
  }

  async function save(print) {
    if (saving) return;
    if (print && !can('print')) print = false;
    if (!types().includes(cart.type)) return toast('ليست لديك صلاحية لهذا النوع من البيع', true);
    const lines = cart.lines.filter((l) => l.qty > 0);
    const credit = cart.type === C.CREDIT;
    let err = '';
    if (!lines.length) err = 'أضف صنفًا واحدًا على الأقل';
    else if (credit && !cart.customer) err = 'الفاتورة الآجلة تحتاج إلى اسم عميل';
    else if (credit && !P().customers.some((c) => c.name === cart.customer)) err = 'العميل غير موجود. أضفه أولًا من صفحة العملاء';
    if (err) return toast(err, true);

    saving = true;
    $$('#posSave, #posSavePrint').forEach((b) => (b.disabled = true));
    const paid = credit ? Number(String(cart.paid).replace(/,/g, '')) || 0 : 0;
    const balanceBefore = credit ? C.customerBalances(P()).find((x) => x.name === cart.customer)?.balance || 0 : null;
    const data = { type: cart.type, customer: credit ? cart.customer : '', paid, note: cart.note, date: localDay(), lines };
    try {
      const r = await write('saveSale', data, { background: true });
      toast(`حُفظت الفاتورة رقم ${r.id} ✔`);
      if (print) {
        const sum = lines.reduce((a, l) => a + l.qty * l.price, 0);
        forms().printSale(
          {
            id: r.id, type: cart.type, customer: data.customer, date: data.date,
            time: new Date().toLocaleString('sv-SE').replace('T', ' '), lines, total: sum, paid, user: state.user, note: data.note,
          },
          { balance: credit ? balanceBefore + sum - paid : null },
        );
      }
      cart = emptyCart();
      persist();
      if (state.view === 'pos') {
        $('#main').innerHTML = view();
        bind();
      }
    } catch (e) {
      toast(e.message, true);
    } finally {
      saving = false;
      $$('#posSave, #posSavePrint').forEach((b) => (b.disabled = false));
    }
  }

  function setType(t) {
    if (!types().includes(t)) return;
    cart.type = t;
    $$('#posType button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    $('#posWho').hidden = t !== C.CREDIT;
    $('#posPaidRow').hidden = t !== C.CREDIT;
    persist();
    if (t === C.CREDIT) $('#posCustomer').focus();
  }

  // The invoice's width: drag its inner edge (wider towards the items),
  // remembered in this browser; a double click goes back to the default.
  function bindResize() {
    const h = $('#posResize'), grid = $('.pos'), cartEl = $('.pos-cart');
    if (!h || !grid || !cartEl) return;
    const KEY = 'fr3oon-cartw';
    const set = (w) => grid.style.setProperty('--cartw', w + 'px');
    const saved = Number(store.get(KEY));
    if (saved >= 300 && saved <= 900) set(saved);
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    h.onpointerdown = (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = cartEl.getBoundingClientRect().width;
      const max = Math.min(820, grid.getBoundingClientRect().width * 0.7);
      h.classList.add('drag');
      h.onpointermove = (m) => set(Math.round(Math.max(330, Math.min(max, w0 + (rtl ? 1 : -1) * (m.clientX - x0)))));
      h.onpointerup = h.onpointercancel = () => {
        h.classList.remove('drag');
        h.onpointermove = h.onpointerup = h.onpointercancel = null;
        store.set(KEY, String(Math.round(cartEl.getBoundingClientRect().width)));
      };
    };
    h.ondblclick = () => {
      grid.style.removeProperty('--cartw');
      store.set(KEY, '');
    };
  }

  function bind() {
    bindResize();
    const s = $('#posSearch');
    s.oninput = () => {
      search = s.value;
      $('#posGrid').innerHTML = gridHtml();
    };
    s.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enterSearch();
      }
      if (e.key === 'Escape') {
        search = '';
        s.value = '';
        $('#posGrid').innerHTML = gridHtml();
      }
    };
    $('#posChips').onclick = (e) => {
      const b = e.target.closest('[data-cls]');
      if (!b) return;
      cls = b.dataset.cls;
      $('#posChips').innerHTML = chipsHtml();
      $('#posGrid').innerHTML = gridHtml();
    };
    $('#posGrid').onclick = (e) => {
      const b = e.target.closest('[data-item]');
      if (!b) return;
      add(itemBy(b.dataset.item));
      // back to the search box, so the next scan or Enter doesn't click this
      // button again; the page stays where it is (the list may be scrolled far down)
      $('#posSearch').focus({ preventScroll: true });
    };
    $('#posType').onclick = (e) => e.target.dataset.t && setType(e.target.dataset.t);
    $('#posCustomer').oninput = (e) => {
      cart.customer = e.target.value.trim();
      $('#posCustInfo').innerHTML = customerInfo();
      persist();
    };
    $('#posPaid').oninput = (e) => {
      cart.paid = e.target.value;
      persist();
    };
    $('#posNoteBtn').onclick = () => {
      $('#posNoteBtn').hidden = true;
      $('#posNote').hidden = false;
      $('#posNote').focus();
    };
    $('#posNote').oninput = (e) => {
      cart.note = e.target.value;
      persist();
    };
    const lines = $('#posLines');
    lines.oninput = (e) => {
      const row = e.target.closest('.cart-line');
      if (!row) return;
      const l = cart.lines[+row.dataset.i];
      if (e.target.dataset.f === 'qty') l.qty = toQty(e.target.value);
      if (e.target.dataset.f === 'price' && can('edit_price')) l.price = Number(e.target.value.replace(/,/g, '')) || 0;
      row.querySelector('.line-total').textContent = fmt(l.qty * l.price);
      $('#posTotal').textContent = fmt(total());
      $('#posCount').innerHTML = countHtml();
      persist();
    };
    lines.onchange = (e) => {
      if (e.target.dataset.f !== 'unit') return;
      const l = cart.lines[+e.target.closest('.cart-line').dataset.i];
      l.unit = e.target.value;
      const it = itemBy(l.item);
      if (it) l.price = priceFor(it, l.unit);
      drawLines();
    };
    lines.onclick = (e) => {
      const row = e.target.closest('.cart-line');
      if (!row) return;
      const i = +row.dataset.i;
      const step = e.target.closest('[data-step]');
      if (step) {
        cart.lines[i].qty = Math.max(0, (Number(cart.lines[i].qty) || 0) + Number(step.dataset.step));
        if (cart.lines[i].qty === 0) cart.lines.splice(i, 1);
        drawLines();
      }
      if (e.target.closest('[data-rm]')) {
        cart.lines.splice(i, 1);
        drawLines();
      }
    };
    const recent = (open) => {
      $('#posRecentPop').hidden = !open;
      $('#posRecentBtn').setAttribute('aria-expanded', String(open));
    };
    // a click anywhere else closes it (it lies over the cart's buttons)
    document.onpointerdown = (e) => {
      const pop = $('#posRecentPop');
      if (!pop || pop.hidden || e.target.closest('#posRecentPop, #posRecentBtn')) return;
      recent(false);
    };
    $('#posRecentBtn').onclick = () => recent($('#posRecentPop').hidden);
    $('#posRecentClose').onclick = () => recent(false);
    $('#posRecent').onclick = (e) => {
      const b = e.target.closest('[data-sale]');
      const inv = b && P().saleById.get(Number(b.dataset.sale));
      if (inv) {
        recent(false);
        invoiceModal(inv);
      }
    };
    $('#posSave').onclick = () => save(false);
    if ($('#posSavePrint')) $('#posSavePrint').onclick = () => save(true);
    $('#posClear').onclick = () => {
      if (cart.lines.length && !confirm('هل تريد تفريغ الفاتورة الحالية؟')) return;
      cart = emptyCart();
      persist();
      $('#main').innerHTML = view();
      bind();
    };
    if (!document.activeElement || document.activeElement === document.body) s.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (state.view !== 'pos' || !$('#modal').hidden || !$('#posSave')) return;
    if (e.key === 'F9') {
      e.preventDefault();
      save(false);
    }
    if (e.key === 'F10') {
      e.preventDefault();
      save(true);
    }
  });

  // New data arrived (another save, auto refresh): update stock on the
  // buttons without touching the cart or what is being typed.
  function onData() {
    if (!$('#posGrid')) return;
    $('#posGrid').innerHTML = gridHtml();
    $('#posChips').innerHTML = chipsHtml();
    if (cart.type === C.CREDIT) $('#posCustInfo').innerHTML = customerInfo();
    if ($('#posRecent')) $('#posRecent').innerHTML = recentHtml();
  }

  // The cart belongs to whoever signed in.
  function reset() {
    cart = load();
  }

  return { view, onData, reset, scan };
}
