// Barcodes as SVG, for labels and receipts: EAN-13 (the 13-digit codes on
// products, and the in-store codes Fr3oon makes, starting with 2) and
// Code 128 (anything else: letters, short numbers, invoice numbers).
// Bars are black on white whatever the theme: they are printed.

// EAN-13 check digit for the first 12 digits.
export function eanCheck(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}
export const isEan13 = (code) => /^\d{13}$/.test(code) && eanCheck(code.slice(0, 12)) === code[12];

// A new in-store code: 2 + 11 digits + check, not one of `taken`.
export function newStoreCode(taken, start = 1) {
  for (let n = start; ; n++) {
    const d12 = '2' + String(n).padStart(11, '0');
    const code = d12 + eanCheck(d12);
    if (!taken.has(code)) return code;
  }
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const G = R.map((p) => [...p].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// The modules (1 = bar) of an EAN-13 code.
export function ean13Bits(code) {
  const d = code.split('').map(Number);
  const par = PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

// Code 128 patterns (bar/space widths), values 0–106.
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

// Code 128: set C for an even run of digits (shorter), else set B.
export function code128Bits(text) {
  const vals = [];
  if (/^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4) {
    vals.push(105);
    for (let i = 0; i < text.length; i += 2) vals.push(Number(text.slice(i, i + 2)));
  } else {
    vals.push(104);
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      vals.push(c >= 32 && c <= 126 ? c - 32 : 0);
    }
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  let bits = '';
  for (const v of vals) {
    const w = C128[v];
    for (let i = 0; i < w.length; i++) bits += (i % 2 ? '0' : '1').repeat(Number(w[i]));
  }
  return bits;
}

// The code as an SVG (width follows the modules; height in modules).
// opts: { height = 50, text = true, quiet = 10 }
export function barcodeSvg(code, { height = 50, text = true, quiet = 10 } = {}) {
  code = String(code || '').trim();
  if (!code) return '';
  let c = code;
  if (/^\d{12}$/.test(c)) c += eanCheck(c);
  const ean = isEan13(c);
  const bits = ean ? ean13Bits(c) : code128Bits(code);
  const W = bits.length + quiet * 2;
  const textH = text ? 11 : 0;
  let rects = '';
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') { i++; continue; }
    let j = i;
    while (bits[j] === '1') j++;
    // EAN guard bars run a little lower, under the digits
    const guard = ean && (i < 3 || (i >= 45 && i < 50) || i >= 92);
    rects += `<rect x="${quiet + i}" y="0" width="${j - i}" height="${height + (guard && text ? 5 : 0)}"/>`;
    i = j;
  }
  const label = text
    ? ean
      ? `<text x="${quiet - 7}" y="${height + textH}">${c[0]}</text><text x="${quiet + 24}" y="${height + textH}" text-anchor="middle">${c.slice(1, 7)}</text><text x="${quiet + 70}" y="${height + textH}" text-anchor="middle">${c.slice(7)}</text>`
      : `<text x="${W / 2}" y="${height + textH}" text-anchor="middle">${code.replace(/[<&>]/g, '')}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height + textH + 1}" class="barcode" preserveAspectRatio="none" direction="ltr"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${label ? `<g fill="#000" font-family="Arial, sans-serif" font-size="10" letter-spacing="1">${label}</g>` : ''}</svg>`;
}
