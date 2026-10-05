// The printed sale receipt, for 80 mm (72 mm printable) and 58 mm (48 mm
// printable) thermal printers: black on white, Windows fonts only (Tahoma,
// Arial), the invoice number as a Code 128 barcode. The shop's choices
// (paper, address, phone, closing line, barcode, logo) are kept in the
// database (Settings → الإيصال) and arrive as state.receipt.

import { barcodeSvg } from './barcode.js';
import { LOGO } from './icons.js';

const CREDIT = 'اجل';
const DEFAULT_FOOTER = 'شكراً لزيارتكم';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'));
const qtyFmt = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const num = (n) => `<span class="n" dir="ltr">${fmt(n)}</span>`;

// The logo as black line art on white: no navy tile (a solid block wastes
// paper and blurs on a thermal head), every stroke black.
const BLACK_LOGO = LOGO.replace(/<rect[^>]*\/>/, '').replace(/stroke="#[0-9a-fA-F]{3,6}"/g, 'stroke="#000"');

// The shop's settings with the defaults filled in: '' = never set.
export function receiptOptions(r = {}) {
  r = r || {};
  return {
    width: String(r.width) === '58' ? '58' : '80',
    address: String(r.address || '').trim(),
    phone: String(r.phone || '').trim(),
    footer: String(r.footer || '').trim() || DEFAULT_FOOTER,
    barcode: String(r.barcode ?? '') !== '0',
    logo: String(r.logo ?? '') !== '0',
  };
}

// inv: { id, date, time 'YYYY-MM-DD HH:MM:SS', type, customer, lines [{item, qty, unit, price}], total, paid, user, note }
// opts: { shopName, receipt (state.receipt), balance (the customer's balance after this invoice, credit only), user (cashier when inv has none),
//         print (add the print-on-load script), preview (screen only: the whole paper width, for an <iframe> as wide as the paper) }
export function receiptHtml(inv, { shopName = '', receipt = {}, balance = null, user = '', print = false, preview = false } = {}) {
  const o = receiptOptions(receipt);
  const narrow = o.width === '58';
  const credit = inv.type === CREDIT;
  const lines = inv.lines || [];
  const total = inv.total != null ? Number(inv.total) : lines.reduce((a, l) => a + l.qty * l.price, 0);
  const paid = Number(inv.paid) || 0;
  const time = String(inv.time || '').slice(11, 16);
  const cashier = inv.user || user;
  const shop = shopName || 'Fr3oon';

  const row = (label, value, cls = '') => `<div class="row${cls ? ' ' + cls : ''}"><span>${label}</span><b>${value}</b></div>`;
  const items = lines
    .map(
      (l) => `<div class="item">
        <div class="name">${esc(l.item)}</div>
        <div class="row"><span><span class="n" dir="ltr">${qtyFmt(l.qty)}</span> ${esc(l.unit || '')} × ${num(l.price)}</span><b>${num(l.qty * l.price)}</b></div>
      </div>`,
    )
    .join('');

  const totals = [
    row('المجموع', num(total), 'grand'),
    credit ? row('المدفوع', num(paid)) : '',
    credit ? row('المتبقي', num(total - paid), 'strong') : '',
    balance != null ? row('رصيد العميل الإجمالي', num(balance), 'balance') : '',
  ].join('');

  const code = o.barcode && inv.id != null && inv.id !== '' ? barcodeSvg(String(inv.id), { height: 40, text: true, quiet: 10 }) : '';

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${esc(inv.id)}</title>
<style>
  @page { size: ${o.width}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: ${narrow ? 48 : 72}mm; margin: 0 auto; padding: 2mm 0 7mm;
    font: ${narrow ? 11 : 12.5}px/1.45 Tahoma, Arial, sans-serif; direction: rtl;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow-wrap: anywhere;
  }
  .n { unicode-bidi: isolate; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .head { text-align: center; }
  .logo { width: ${narrow ? 13 : 17}mm; height: ${narrow ? 13 : 17}mm; margin: 0 auto 1mm; }
  .logo svg { width: 100%; height: 100%; display: block; }
  .shop { font-size: ${narrow ? 15 : 18}px; font-weight: bold; line-height: 1.25; margin: 0 0 1mm; }
  .addr { color: #000; }
  .phone { font-weight: bold; }
  .title { margin: 2.5mm 0 2mm; padding: 1mm 0; border-block: 1.5px solid #000; text-align: center; font-weight: bold; font-size: ${narrow ? 12.5 : 14}px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .row > span { min-width: 0; }
  .row > b { white-space: nowrap; }
  .meta .row > b { font-weight: bold; text-align: left; white-space: normal; }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .items { margin-top: 1mm; }
  .item { padding: 1.2mm 0; border-bottom: 1px dotted #000; }
  .item:last-child { border-bottom: 0; }
  .item .name { font-weight: bold; }
  .item .row > span { color: #222; }
  .count { font-size: ${narrow ? 10 : 11}px; text-align: center; margin-top: 1mm; }
  .totals { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1.5mm 0; margin-top: 1.5mm; display: grid; gap: .6mm; }
  .totals .grand { font-size: ${narrow ? 14 : 17}px; font-weight: bold; }
  .totals .grand b { font-size: ${narrow ? 16 : 20}px; }
  .totals .strong { font-weight: bold; }
  .totals .balance { margin-top: 1mm; padding: 1mm 1.5mm; border: 1.5px solid #000; font-weight: bold; }
  .note { margin-top: 2mm; font-size: ${narrow ? 10.5 : 11.5}px; white-space: pre-line; }
  .cashier { margin-top: 2mm; text-align: center; }
  .footer { margin-top: 2.5mm; text-align: center; font-weight: bold; font-size: ${narrow ? 12 : 13.5}px; white-space: pre-line; }
  .code { margin: 2.5mm auto 0; width: ${narrow ? 40 : 50}mm; height: ${narrow ? 11 : 13}mm; }
  .code svg { display: block; width: 100%; height: 100%; }
  .cut { position: relative; margin-top: 5mm; border-top: 1.5px dashed #000; }
  .cut span { position: absolute; top: -.8em; inset-inline-start: 0; background: #fff; padding-inline-end: 1mm; font: 12px/1 Arial, sans-serif; }
  ${preview ? `@media screen { body { width: ${o.width}mm; padding: 4mm ${narrow ? 5 : 4}mm 5mm; } html { overflow: hidden; } }` : ''}
</style></head><body>
  <div class="head">
    ${o.logo ? `<div class="logo">${BLACK_LOGO}</div>` : ''}
    <div class="shop">${esc(shop)}</div>
    ${o.address ? `<div class="addr">${esc(o.address)}</div>` : ''}
    ${o.phone ? `<div class="phone">هاتف: <span class="n" dir="ltr">${esc(o.phone)}</span></div>` : ''}
  </div>
  <div class="title">${credit ? 'فاتورة بيع آجلة' : 'فاتورة بيع نقدية'}</div>
  <div class="meta">
    ${row('رقم الفاتورة', `<span class="n" dir="ltr">${esc(inv.id)}</span>`)}
    ${row('التاريخ', `<span class="n" dir="ltr">${esc(inv.date || '')}${time ? ' ' + esc(time) : ''}</span>`)}
    ${credit && inv.customer ? row('العميل', esc(inv.customer)) : ''}
  </div>
  <div class="sep"></div>
  <div class="items">${items}</div>
  <div class="count">عدد الأصناف: ${lines.length}</div>
  <div class="totals">${totals}</div>
  ${inv.note ? `<div class="note">ملاحظة: ${esc(inv.note)}</div>` : ''}
  ${cashier ? `<div class="cashier">الكاشير: <b>${esc(cashier)}</b></div>` : ''}
  <div class="footer">${esc(o.footer)}</div>
  ${code ? `<div class="code">${code}</div>` : ''}
  <div class="cut"><span>✂</span></div>
  ${print ? '<script>window.onload = function () { window.print(); setTimeout(function () { window.close(); }, 300); };<\/script>' : ''}
</body></html>`;
}

// A sample invoice for trying the settings out.
export function sampleInvoice(user = '') {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const lines = [
    { item: 'أرز بسمتي 5 كغ', qty: 2, unit: 'كيس', price: 8500 },
    { item: 'زيت دوار الشمس 1.8 لتر', qty: 1, unit: 'قنينة', price: 6250 },
    { item: 'سكر أبيض', qty: 3, unit: 'كغ', price: 1250 },
  ];
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  return {
    id: 1024, date: day, time: `${day} ${p(now.getHours())}:${p(now.getMinutes())}:00`, type: CREDIT,
    customer: 'عميل تجريبي', lines, total, paid: 10000, user, note: '',
  };
}

// The sample as a page for an <iframe srcdoc> preview.
export function receiptPreviewHtml(opts = {}) {
  const inv = sampleInvoice(opts.user);
  return receiptHtml(inv, { balance: inv.total - inv.paid + 15000, ...opts, preview: true, print: false });
}

// Opens the receipt in a small window and prints it (then the window
// closes). Returns the window, or null when the browser blocked it.
export function printReceipt(inv, opts = {}) {
  if (!inv) return null;
  const narrow = receiptOptions(opts.receipt).width === '58';
  const w = window.open('', '_blank', `width=${narrow ? 300 : 380},height=680`);
  if (!w) return null;
  w.document.write(receiptHtml(inv, { ...opts, print: true }));
  w.document.close();
  return w;
}
