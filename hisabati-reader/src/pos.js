// Quick sale (POS): item buttons by category, search / barcode, a cart and
// one-key saving. The cart is kept per user in this browser, so a refresh or
// a closed window doesn't lose a half-entered sale.

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
    if (!list.length) return '<p class="empty">ما لكيت مادة بهذا الاسم</p>';
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

  function linesHtml() {
    if (!cart.lines.length) return `<div class="cart-empty">${icon('pos')}<br>القائمة فارغة<br><small>دوس على مادة أو امسح باركود</small></div>`;
    return cart.lines
      .map((l, i) => {
        const it = itemBy(l.item);
        const units = it ? unitsOf(it, l.unit) : [l.unit];
        return `<div class="cart-line" data-i="${i}">
          <span class="name">${esc(l.item)}</span>
          <span class="line-total num">${fmt(l.qty * l.price)}</span>
          <div class="row">
            ${units.length > 1 ? `<select data-f="unit">${units.map((u) => `<option${u === l.unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>` : `<small class="muted">${esc(l.unit)}</small>`}
            <span class="stepper"><button type="button" data-step="-1" aria-label="أقل">−</button><input data-f="qty" inputmode="decimal" value="${l.qty}"><button type="button" data-step="1" aria-label="أكثر">+</button></span>
            <input class="price" data-f="price" inputmode="numeric" value="${l.price}" title="${can('edit_price') ? 'السعر' : 'السعر (تغييره يحتاج صلاحية)'}"${can('edit_price') ? '' : ' readonly tabindex="-1"'}>
            <button class="icon-btn rm" type="button" data-rm aria-label="شيل">${icon('trash')}</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function customerInfo() {
    if (cart.type !== C.CREDIT || !cart.customer) return '';
    const b = C.customerBalances(P()).find((x) => x.name === cart.customer);
    return b ? `الرصيد الحالي: <b class="num">${fmt(b.balance)}</b>` : '<span class="neg">هذا الزبون مو موجود</span>';
  }

  // Today's latest invoices (a cashier sees their own), one click away
  // from printing again, editing or deleting.
  function recentHtml() {
    const today = localDay();
    const list = P().sales
      .filter((s) => s.date === today && s.lines.length && (can('sales') || s.user === state.user))
      .sort((a, b) => b.id - a.id)
      .slice(0, 8);
    if (!list.length) return '<p class="muted" style="margin:0;font-size:13px">ماكو قوائم اليوم بعد</p>';
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
    const recentHint = [can('print') && 'تطبعها', can('sale_edit') && 'تعدّلها', can('sale_delete') && 'تمسحها'].filter(Boolean);
    return `<div class="pos">
      <section class="pos-items">
        <div class="pos-search">${icon('search')}<input id="posSearch" autocomplete="off" placeholder="ابحث باسم المادة أو رمزها، أو امسح الباركود ودوس Enter" value="${esc(search)}"></div>
        <div class="chips" id="posChips">${chipsHtml()}</div>
        <div class="item-grid" id="posGrid">${gridHtml()}</div>
      </section>
      <aside class="pos-cart">
        <div class="card stack" style="gap:10px">
          <div class="seg" id="posType" style="width:100%"${allowed.length > 1 ? '' : ' hidden'}>${allowed
            .map((t) => `<button data-t="${t}" class="${t === cart.type ? 'on' : ''}" style="flex:1">${t === C.CREDIT ? 'آجل' : 'نقدي'}</button>`)
            .join('')}</div>
          ${allowed.length > 1 ? '' : `<p class="muted" style="margin:0">بيع ${credit ? 'آجل' : 'نقدي'}</p>`}
          <div id="posWho" ${credit ? '' : 'hidden'}>
            <datalist id="dlCust">${P().customers.map((c) => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
            <input id="posCustomer" list="dlCust" autocomplete="off" placeholder="اسم الزبون" value="${esc(cart.customer)}" style="width:100%">
            <p class="muted" id="posCustInfo" style="margin:6px 2px 0;font-size:13px">${customerInfo()}</p>
          </div>
        </div>
        <div class="cart-lines" id="posLines">${linesHtml()}</div>
        <div class="card stack" style="gap:10px">
          <div class="cart-total"><span>المجموع</span><b class="num" id="posTotal">${fmt(total())}</b></div>
          <div id="posPaidRow" ${credit ? '' : 'hidden'}><input id="posPaid" inputmode="numeric" placeholder="المدفوع هسه (اختياري)" value="${esc(cart.paid)}" style="width:100%"></div>
          <input id="posNote" placeholder="ملاحظة (اختياري)" value="${esc(cart.note)}">
          <div class="row" style="display:flex;gap:8px">
            <button class="btn primary big" id="posSave" style="flex:1">${icon('save')} حفظ <span class="kbd">F9</span></button>
            ${can('print') ? `<button class="btn big" id="posSavePrint" style="flex:1">${icon('print')} حفظ وطباعة <span class="kbd">F10</span></button>` : ''}
          </div>
          <button class="btn small" id="posClear">${icon('trash')} قائمة جديدة (مسح)</button>
        </div>
        <div class="card stack" style="gap:6px">
          <h3 style="margin:0">آخر القوائم <small class="muted" style="font-weight:400">${recentHint.length ? '— دوس على قائمة حتى ' + recentHint.join(' أو ') : ''}</small></h3>
          <div id="posRecent" class="stack" style="gap:6px">${recentHtml()}</div>
        </div>
      </aside>
    </div>`;
  }

  function drawLines() {
    $('#posLines').innerHTML = linesHtml();
    $('#posTotal').textContent = fmt(total());
    persist();
  }

  function add(it) {
    const unit = it.unitL2 || it.unitL1;
    const same = cart.lines.findIndex((l) => l.item === it.name && l.unit === unit);
    if (same >= 0) cart.lines[same].qty += 1;
    else cart.lines.push({ item: it.name, unit, qty: 1, price: priceFor(it, unit) });
    drawLines();
    const i = same >= 0 ? same : cart.lines.length - 1;
    $(`#posLines .cart-line[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
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
      toast('ما لكيت مادة بهذا الرمز أو الاسم', true);
    } else {
      toast(`أكو ${list.length} مواد، اختار وحدة منها`);
    }
  }

  async function save(print) {
    if (saving) return;
    if (print && !can('print')) print = false;
    if (!types().includes(cart.type)) return toast('ما عندك صلاحية على هذا النوع من البيع', true);
    const lines = cart.lines.filter((l) => l.qty > 0);
    const credit = cart.type === C.CREDIT;
    let err = '';
    if (!lines.length) err = 'ضيف مادة وحدة على الأقل';
    else if (credit && !cart.customer) err = 'القائمة الآجل تحتاج اسم زبون';
    else if (credit && !P().customers.some((c) => c.name === cart.customer)) err = 'الزبون مو موجود. ضيفه من صفحة الزبائن أول';
    if (err) return toast(err, true);

    saving = true;
    $$('#posSave, #posSavePrint').forEach((b) => (b.disabled = true));
    const paid = credit ? Number(String(cart.paid).replace(/,/g, '')) || 0 : 0;
    const balanceBefore = credit ? C.customerBalances(P()).find((x) => x.name === cart.customer)?.balance || 0 : null;
    const data = { type: cart.type, customer: credit ? cart.customer : '', paid, note: cart.note, date: localDay(), lines };
    try {
      const r = await write('saveSale', data, { background: true });
      toast(`انحفظت القائمة رقم ${r.id} ✔`);
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

  function bind() {
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
      if (b) add(itemBy(b.dataset.item));
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
    $('#posNote').oninput = (e) => {
      cart.note = e.target.value;
      persist();
    };
    const lines = $('#posLines');
    lines.oninput = (e) => {
      const row = e.target.closest('.cart-line');
      if (!row) return;
      const l = cart.lines[+row.dataset.i];
      if (e.target.dataset.f === 'qty') l.qty = Number(e.target.value) || 0;
      if (e.target.dataset.f === 'price' && can('edit_price')) l.price = Number(e.target.value.replace(/,/g, '')) || 0;
      row.querySelector('.line-total').textContent = fmt(l.qty * l.price);
      $('#posTotal').textContent = fmt(total());
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
    $('#posRecent').onclick = (e) => {
      const b = e.target.closest('[data-sale]');
      const inv = b && P().saleById.get(Number(b.dataset.sale));
      if (inv) invoiceModal(inv);
    };
    $('#posSave').onclick = () => save(false);
    if ($('#posSavePrint')) $('#posSavePrint').onclick = () => save(true);
    $('#posClear').onclick = () => {
      if (cart.lines.length && !confirm('تمسح القائمة الحالية؟')) return;
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

  return { view, onData, reset };
}
