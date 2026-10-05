// Entry forms (server mode only): sale and purchase invoices, receipt and
// payment vouchers, customers, suppliers, items. Each form sends one write
// to the local helper (server.ps1), which saves it into the حساباتي file.

import * as C from './calc.js';

export function setupForms(ctx) {
  const { $, $$, esc, fmt, localDay, openModal, closeModal, write, state, toast, can } = ctx;
  const P = () => state.P;

  const datalist = (id, options) =>
    `<datalist id="${id}">${options.map((o) => `<option value="${esc(o.value)}"${o.label ? ` label="${esc(o.label)}"` : ''}></option>`).join('')}</datalist>`;

  const field = (label, html, wide = false) => `<label class="field${wide ? ' wide' : ''}"><span>${esc(label)}</span>${html}</label>`;
  const val = (id) => $('#' + id)?.value.trim() ?? '';
  const numVal = (id) => Number(val(id).replace(/,/g, '')) || 0;

  function requireUser() {
    if (state.user) return true;
    toast('سجّل الدخول أولًا', true);
    return false;
  }

  async function submit(btn, op, data, after) {
    if (!requireUser()) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'جارٍ الحفظ…';
    try {
      const r = await write(op, { ...data, user: state.user });
      closeModal();
      toast('تم الحفظ ✔');
      after?.(r);
    } catch (e) {
      $('#formError').textContent = e.message;
      $('#formError').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function confirmDelete(op, id, what) {
    if (!requireUser()) return;
    if (!confirm(`هل أنت متأكد من حذف ${what}؟ لا يمكن التراجع عن ذلك.`)) return;
    try {
      await write(op, { id, user: state.user });
      closeModal();
      toast('تم الحذف ✔');
    } catch (e) {
      toast(e.message, true);
    }
  }

  const errorBox = '<p class="notice error" id="formError" hidden></p>';

  // ------------------------------------------------------------ invoices

  function stockLabel(item) {
    const s = state.stockByName?.get(item.name);
    const stock = s ? `رصيد ${fmt(s.k)} ${item.unitL1}${item.unitL1 !== item.unitL2 && s.s ? ' + ' + fmt(s.s) + ' ' + item.unitL2 : ''}` : '';
    return [item.code, item.cls, stock].filter(Boolean).join(' — ');
  }

  // preset (a new invoice only): { who, type, lines: [{item, unit, qty, price}] }
  function invoiceEditor(kind, inv, preset = null) {
    const sale = kind === 'sale';
    const items = P().items;
    // Sales: the big (wholesale) unit and other prices need permissions; a
    // line the invoice already had keeps what it was.
    const had = new Set((inv?.lines || []).map((l) => l.item + '|' + l.unit));
    const unitOk = (it, u) =>
      !sale || can('sale_wholesale') || !(it.unitL2 && it.unitL1 !== it.unitL2 && u === it.unitL1) || had.has(it.name + '|' + u);
    const units = (it) => [...new Set([it.unitL1, it.unitL2].filter(Boolean))].filter((u) => unitOk(it, u));
    const priceLocked = sale && !can('edit_price');
    const typeList = sale
      ? [C.CASH, C.CREDIT].filter((t) => t === inv?.type || can(t === C.CREDIT ? 'sale_credit' : 'sale_cash'))
      : [C.CASH, C.CREDIT];
    const priceFor = (it, unit) =>
      sale ? (unit === it.unitL1 ? it.priceL1 : it.priceL2) : unit === it.unitL1 ? it.buyL1 : it.buyL2;
    const lines = (inv?.lines || preset?.lines || []).map((l) => ({ item: l.item, unit: l.unit, qty: l.qty, price: l.price }));
    let type = inv?.type || preset?.type || (sale ? C.CASH : C.CREDIT);

    const people = sale ? P().customers : P().suppliers;
    const balances = new Map((sale ? C.customerBalances(P()) : C.supplierBalances(P())).map((b) => [b.name, b.balance]));
    const who = inv ? (sale ? (inv.customer === 'عميل نقدي' ? '' : inv.customer) : inv.supplier) : preset?.who || '';

    openModal(`<h2>${inv ? `تعديل ${sale ? 'فاتورة بيع' : 'فاتورة شراء'} رقم ${inv.id}` : sale ? 'فاتورة بيع جديدة' : 'فاتورة شراء جديدة'}</h2>
      ${datalist('dlPeople', people.map((p) => ({ value: p.name, label: p.mobile })))}
      ${datalist('dlItems', items.map((it) => ({ value: it.name, label: stockLabel(it) })))}
      <div class="form-grid">
        ${field('النوع', `<div class="seg" id="fType">${typeList.map((t) => `<button type="button" data-t="${t}">${t === C.CREDIT ? 'آجل' : 'نقدي'}</button>`).join('')}</div>`)}
        ${field(sale ? 'العميل' : 'المورد', `<input id="fWho" list="dlPeople" value="${esc(who)}" autocomplete="off" placeholder="${sale ? 'للبيع الآجل يجب اختيار عميل' : 'اختر المورد'}">`)}
        ${field('التاريخ', `<input id="fDate" type="date" value="${inv?.date || localDay()}">`)}
        ${sale ? field('المدفوع', `<input id="fPaid" inputmode="numeric" value="${inv?.paid || ''}" placeholder="للآجل إن دُفع مبلغ الآن">`) : field('رقم فاتورة المورد', `<input id="fNo" inputmode="numeric" value="${esc(inv?.no || '')}">`)}
        ${field('ملاحظة', `<input id="fNote" value="${esc(inv?.note || '')}">`, true)}
      </div>
      <p class="muted" id="fWhoInfo"></p>
      <div class="add-line">
        <input id="fItem" list="dlItems" autocomplete="off" placeholder="اكتب اسم الصنف أو رمزه واضغط Enter">
        <button class="btn" type="button" id="fAdd">إضافة</button>
      </div>
      <div class="table-wrap"><table class="lines"><thead><tr>
        <th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>المبلغ</th><th></th>
      </tr></thead><tbody id="fLines"></tbody>
      <tfoot><tr><td colspan="4">المجموع</td><td id="fTotal" class="num"></td><td></td></tr></tfoot></table></div>
      ${sale ? '' : `<label class="check" style="margin-top:10px"><input type="checkbox" id="fUpd" checked> حدّث سعر الشراء في بطاقات الأصناف من هذه الفاتورة</label>`}
      ${errorBox}
      <div class="form-actions">
        <button class="btn primary" id="fSave">حفظ</button>
        ${sale && can('print') ? '<button class="btn" id="fSavePrint">حفظ وطباعة</button>' : ''}
        <button class="btn" id="fCancel">إلغاء</button>
      </div>`);

    const findItem = (q) => {
      q = q.trim();
      return items.find((it) => it.name === q) || items.find((it) => it.code && it.code === q) || null;
    };

    function drawLines() {
      $('#fLines').innerHTML = lines.length
        ? lines
            .map((l, i) => {
              const it = findItem(l.item);
              return `<tr>
                <td>${esc(l.item)}</td>
                <td><select data-i="${i}" data-f="unit">${(it ? units(it) : [l.unit]).map((u) => `<option${u === l.unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select></td>
                <td><input class="qty" data-i="${i}" data-f="qty" inputmode="decimal" value="${l.qty}"></td>
                <td><input class="price" data-i="${i}" data-f="price" inputmode="numeric" value="${l.price}"${priceLocked ? ' readonly tabindex="-1" title="تغيير السعر يحتاج إلى صلاحية"' : ''}></td>
                <td class="num" data-total="${i}">${fmt(l.qty * l.price)}</td>
                <td><button class="btn small" type="button" data-del="${i}" aria-label="إزالة">×</button></td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="6" class="empty">أضف أصنافًا إلى الفاتورة</td></tr>';
      drawTotal();
    }
    const total = () => lines.reduce((a, l) => a + l.qty * l.price, 0);
    function drawTotal() {
      $('#fTotal').textContent = fmt(total());
    }

    function addItem() {
      const it = findItem($('#fItem').value);
      if (!it) {
        toast('لم يُعثر على هذا الصنف', true);
        return;
      }
      const unit = sale ? it.unitL2 || it.unitL1 : it.unitL1;
      const same = lines.findIndex((l) => l.item === it.name && l.unit === unit);
      if (same >= 0) lines[same].qty += 1;
      else lines.push({ item: it.name, unit, qty: 1, price: priceFor(it, unit) });
      $('#fItem').value = '';
      drawLines();
      const i = same >= 0 ? same : lines.length - 1;
      $(`#fLines input[data-i="${i}"][data-f="qty"]`)?.select();
    }

    function setType(t) {
      type = t;
      $$('#fType button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      if (sale) $('#fPaid').disabled = t !== C.CREDIT;
    }

    function whoInfo() {
      const n = val('fWho');
      const b = balances.get(n);
      $('#fWhoInfo').textContent = n && b != null ? `الرصيد الحالي: ${fmt(b)}` : '';
    }

    $('#fType').onclick = (e) => e.target.dataset.t && setType(e.target.dataset.t);
    $('#fWho').oninput = whoInfo;
    $('#fAdd').onclick = addItem;
    $('#fItem').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addItem();
      }
    };
    $('#fItem').onchange = () => findItem($('#fItem').value) && addItem();
    // a barcode scan anywhere in this window (see scanner.js)
    $('#fItem').scanAdd = (code) => {
      $('#fItem').value = code;
      addItem();
    };
    $('#fLines').oninput = (e) => {
      const i = e.target.dataset.i;
      if (i == null) return;
      const l = lines[+i];
      if (e.target.dataset.f === 'qty') l.qty = Number(e.target.value) || 0;
      if (e.target.dataset.f === 'price') l.price = Number(e.target.value.replace(/,/g, '')) || 0;
      $(`[data-total="${i}"]`).textContent = fmt(l.qty * l.price);
      drawTotal();
    };
    $('#fLines').onchange = (e) => {
      if (e.target.dataset.f !== 'unit') return;
      const l = lines[+e.target.dataset.i];
      l.unit = e.target.value;
      l.price = priceFor(findItem(l.item), l.unit);
      drawLines();
    };
    $('#fLines').onclick = (e) => {
      const d = e.target.dataset.del;
      if (d == null) return;
      lines.splice(+d, 1);
      drawLines();
    };
    $('#fCancel').onclick = closeModal;

    const save = (print) => (e) => {
      const data = {
        id: inv?.id,
        type,
        date: val('fDate'),
        note: val('fNote'),
        lines: lines.filter((l) => l.qty > 0),
      };
      if (sale) Object.assign(data, { customer: val('fWho'), paid: type === C.CREDIT ? numVal('fPaid') : 0 });
      else Object.assign(data, { supplier: val('fWho'), no: val('fNo'), updatePrices: $('#fUpd').checked });
      const err = !data.lines.length
        ? 'أضف صنفًا واحدًا على الأقل'
        : sale && type === C.CREDIT && !data.customer
          ? 'الفاتورة الآجلة تحتاج إلى اسم عميل'
          : !sale && !data.supplier
            ? 'اختر المورد'
            : '';
      if (err) {
        $('#formError').textContent = err;
        $('#formError').hidden = false;
        return;
      }
      submit(e.target, sale ? 'saveSale' : 'savePurchase', data, (r) => print && printSale(P().saleById.get(r.id)));
    };
    $('#fSave').onclick = save(false);
    if ($('#fSavePrint')) $('#fSavePrint').onclick = save(true);

    setType(type);
    whoInfo();
    drawLines();
    $('#fItem').focus();
  }

  // ------------------------------------------------------------ vouchers

  function voucherEditor(kind, v, preset = {}) {
    const receipt = kind === 'receipt';
    const classes = receipt ? P().classesIn : P().classesOut;
    const people = receipt ? P().customers : P().suppliers;
    const cls = v?.cls || preset.cls || C.SETTLE;
    openModal(`<h2>${v ? `تعديل ${receipt ? 'سند قبض' : 'سند صرف'} ${v.no ? 'رقم ' + esc(v.no) : ''}` : receipt ? 'سند قبض جديد' : 'سند صرف / مصروف جديد'}</h2>
      ${datalist('dlPeople', people.map((p) => ({ value: p.name, label: p.mobile })))}
      <div class="form-grid">
        ${field('النوع', `<select id="vCls">${[...new Set([C.SETTLE, ...classes, cls])].map((c) => `<option${c === cls ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`)}
        ${field(receipt ? 'من (العميل)' : 'إلى (المورد)', `<input id="vName" list="dlPeople" autocomplete="off" value="${esc(v?.name || preset.name || '')}">`)}
        ${field('المبلغ', `<input id="vAmount" inputmode="numeric" value="${v?.amount || ''}">`)}
        ${field('التاريخ', `<input id="vDate" type="date" value="${v?.date || localDay()}">`)}
        ${field('ملاحظة', `<input id="vNote" value="${esc(v?.note || '')}">`, true)}
      </div>
      <p class="muted" id="vHint"></p>
      ${errorBox}
      <div class="form-actions">
        <button class="btn primary" id="vSave">حفظ</button>
        ${v ? '<button class="btn danger" id="vDel">حذف</button>' : ''}
        <button class="btn" id="vCancel">إلغاء</button>
      </div>`);
    const hint = () => {
      const settle = $('#vCls').value === C.SETTLE;
      $('#vHint').textContent = settle
        ? receipt
          ? 'تسديد: يُخصم من رصيد العميل.'
          : 'تسديد: يُخصم من رصيد المورد.'
        : receipt
          ? 'مقبوضات أخرى: تدخل الصندوق فقط.'
          : 'مصروف: يُصرف من الصندوق ويُحتسب ضمن المصاريف.';
    };
    $('#vCls').onchange = hint;
    hint();
    $('#vCancel').onclick = closeModal;
    $('#vSave').onclick = (e) => {
      const data = { id: v?.id, cls: val('vCls'), name: val('vName'), amount: numVal('vAmount'), date: val('vDate'), note: val('vNote') };
      const err = data.amount <= 0 ? 'اكتب المبلغ' : data.cls === C.SETTLE && !data.name ? 'التسديد يحتاج إلى اسم' : '';
      if (err) {
        $('#formError').textContent = err;
        $('#formError').hidden = false;
        return;
      }
      submit(e.target, receipt ? 'saveReceipt' : 'savePayment', data);
    };
    if (v) $('#vDel').onclick = () => confirmDelete(receipt ? 'deleteReceipt' : 'deletePayment', v.id, 'هذا السند');
    $('#vAmount').focus();
  }

  // ------------------------------------------------------------ people

  function personEditor(kind, p) {
    const customer = kind === 'customer';
    openModal(`<h2>${p ? 'تعديل بيانات ' + esc(p.name) : customer ? 'عميل جديد' : 'مورد جديد'}</h2>
      <div class="form-grid">
        ${field('الاسم', `<input id="pName" maxlength="35" value="${esc(p?.name || '')}">`)}
        ${field('الهاتف', `<input id="pMobile" maxlength="12" inputmode="tel" value="${esc(p?.mobile || '')}">`)}
        ${customer ? field('النوع', `<select id="pType">${['جملة', 'مفرد'].map((t) => `<option${t === (p?.type || 'جملة') ? ' selected' : ''}>${t}</option>`).join('')}</select>`) : ''}
        ${field('رصيد افتتاحي', `<input id="pOpening" inputmode="numeric" value="${p?.opening || 0}">`)}
        ${field('العنوان', `<input id="pAddress" value="${esc(p?.address || '')}">`, true)}
      </div>
      ${p ? '<p class="muted">إذا غيّرت الاسم، فسيتغيّر في جميع فواتيره وسنداته السابقة.</p>' : ''}
      ${errorBox}
      <div class="form-actions">
        <button class="btn primary" id="pSave">حفظ</button>
        ${p ? '<button class="btn danger" id="pDel">حذف</button>' : ''}
        <button class="btn" id="pCancel">إلغاء</button>
      </div>`);
    $('#pCancel').onclick = closeModal;
    $('#pSave').onclick = (e) => {
      const data = { id: p?.id, name: val('pName'), mobile: val('pMobile'), opening: numVal('pOpening'), address: val('pAddress') };
      if (customer) data.type = val('pType');
      if (!data.name) {
        $('#formError').textContent = 'اكتب الاسم';
        $('#formError').hidden = false;
        return;
      }
      submit(e.target, customer ? 'saveCustomer' : 'saveSupplier', data);
    };
    if (p) $('#pDel').onclick = () => confirmDelete(customer ? 'deleteCustomer' : 'deleteSupplier', p.id, p.name);
    $('#pName').focus();
  }

  // ------------------------------------------------------------ items

  function itemEditor(it) {
    const classes = [...new Set(P().items.map((i) => i.cls).filter(Boolean))];
    const unitsList = [...new Set(P().items.flatMap((i) => [i.unitL1, i.unitL2]).filter(Boolean))];
    const nextCode = String(Math.max(0, ...P().items.map((i) => Number(i.code) || 0)) + 1);
    const n = (id, label, v) => field(label, `<input id="${id}" inputmode="numeric" value="${v ?? 0}">`);
    openModal(`<h2>${it ? 'تعديل صنف: ' + esc(it.name) : 'صنف جديد'}</h2>
      ${datalist('dlCls', classes.map((c) => ({ value: c })))}
      ${datalist('dlUnits', unitsList.map((u) => ({ value: u })))}
      <div class="form-grid">
        ${field('الاسم', `<input id="iName" maxlength="150" value="${esc(it?.name || '')}">`, true)}
        ${field('الرمز / الباركود', `<input id="iCode" maxlength="15" dir="ltr" value="${esc(it?.code || nextCode)}" title="اضغط هنا وامسح باركود الصنف">`)}
        ${field('الفئة', `<input id="iCls" list="dlCls" value="${esc(it?.cls || '')}">`)}
        ${field('الوحدة الكبيرة', `<input id="iU1" list="dlUnits" maxlength="10" value="${esc(it?.unitL1 || 'كرتونة')}">`)}
        ${field('الوحدة الصغيرة', `<input id="iU2" list="dlUnits" maxlength="10" value="${esc(it?.unitL2 || 'قطعة')}">`)}
        ${n('iFill', 'عدد الصغيرة في الكبيرة (التعبئة)', it?.fill ?? 1)}
        ${n('iP1', 'سعر البيع (كبيرة)', it?.priceL1)}
        ${n('iP2', 'سعر البيع (صغيرة)', it?.priceL2)}
        ${n('iB1', 'سعر الشراء (كبيرة)', it?.buyL1)}
        ${n('iB2', 'سعر الشراء (صغيرة)', it?.buyL2)}
        ${n('iHarig', 'حد الطلب (كبيرة)', it?.harig ?? 1)}
        ${n('iO1', 'رصيد افتتاحي (كبيرة)', it?.openL1)}
        ${n('iO2', 'رصيد افتتاحي (صغيرة)', it?.openL2)}
      </div>
      ${it ? '<p class="muted">إذا غيّرت الاسم، فسيتغيّر في جميع الفواتير السابقة.</p>' : ''}
      ${errorBox}
      <div class="form-actions">
        <button class="btn primary" id="iSave">حفظ</button>
        ${it ? '<button class="btn danger" id="iDel">حذف</button>' : ''}
        <button class="btn" id="iCancel">إلغاء</button>
      </div>`);
    // Fill the small-unit price from the big one when it is still empty.
    const autoSmall = (from, to) => () => {
      const fill = numVal('iFill');
      if (fill > 0 && !numVal(to)) $('#' + to).value = Math.round(numVal(from) / fill);
    };
    $('#iP1').onchange = autoSmall('iP1', 'iP2');
    $('#iB1').onchange = autoSmall('iB1', 'iB2');
    $('#iCancel').onclick = closeModal;
    // a scan into the code box replaces the old code instead of adding to it
    $('#iCode').onfocus = (e) => e.target.select();
    $('#iSave').onclick = (e) => {
      const data = {
        id: it?.id, name: val('iName'), code: val('iCode'), cls: val('iCls'), unitL1: val('iU1'), unitL2: val('iU2'),
        fill: numVal('iFill'), priceL1: numVal('iP1'), priceL2: numVal('iP2'), buyL1: numVal('iB1'), buyL2: numVal('iB2'),
        harig: numVal('iHarig'), openL1: numVal('iO1'), openL2: numVal('iO2'),
      };
      const err = !data.name ? 'اكتب اسم الصنف' : !data.unitL1 ? 'اكتب الوحدة الكبيرة' : '';
      if (err) {
        $('#formError').textContent = err;
        $('#formError').hidden = false;
        return;
      }
      submit(e.target, 'saveItem', data);
    };
    if (it) $('#iDel').onclick = () => confirmDelete('deleteItem', it.id, it.name);
    $('#iName').focus();
  }

  // ------------------------------------------------------------ receipt print

  // opts.balance: the customer's balance after this invoice, when the data
  // on screen does not include it yet (printing straight after saving).
  function printSale(inv, opts = {}) {
    if (!inv) return;
    const credit = inv.type === C.CREDIT;
    const bal = !credit ? null : opts.balance != null ? opts.balance : C.customerBalances(P()).find((b) => b.name === inv.customer)?.balance;
    const shop = state.shopName || 'Fr3oon';
    const rows = inv.lines
      .map((l) => `<tr><td>${esc(l.item)}<br><small>${fmt(l.qty)} ${esc(l.unit)} × ${fmt(l.price)}</small></td><td class="n">${fmt(l.qty * l.price)}</td></tr>`)
      .join('');
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) {
      toast('منع المتصفح فتح نافذة الطباعة', true);
      return;
    }
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${inv.id}</title>
      <style>
        @page { size: 80mm auto; margin: 3mm; }
        body { font: 13px/1.4 Tahoma, "Segoe UI", sans-serif; width: 72mm; margin: 0 auto; color: #000; }
        h1 { font-size: 17px; text-align: center; margin: 4px 0; }
        .c { text-align: center; } table { width: 100%; border-collapse: collapse; }
        td { padding: 3px 0; border-bottom: 1px dashed #999; vertical-align: top; }
        .n { text-align: left; direction: ltr; white-space: nowrap; } small { color: #333; }
        .tot td { border: 0; font-weight: bold; font-size: 15px; }
      </style></head><body>
      <h1>${esc(shop)}</h1>
      <div class="c">فاتورة ${credit ? 'آجلة' : 'نقدية'} رقم ${inv.id}<br>${inv.date} ${esc(String(inv.time || '').slice(11, 16))}</div>
      ${credit ? `<div>العميل: <b>${esc(inv.customer)}</b></div>` : ''}
      <table>${rows}
        <tr class="tot"><td>المجموع</td><td class="n">${fmt(inv.total)}</td></tr>
        ${inv.paid ? `<tr class="tot"><td>المدفوع</td><td class="n">${fmt(inv.paid)}</td></tr>` : ''}
        ${bal != null ? `<tr class="tot"><td>رصيدك الإجمالي</td><td class="n">${fmt(bal)}</td></tr>` : ''}
      </table>
      <p class="c">الكاشير: ${esc(inv.user)} — شكراً لزيارتكم</p>
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };<\/script>
      </body></html>`);
    w.document.close();
  }

  return { invoiceEditor, voucherEditor, personEditor, itemEditor, printSale, confirmDelete };
}
