// Barcode encoders against the standard tables and known codes.
import { eanCheck, isEan13, ean13Bits, code128Bits, newStoreCode, barcodeSvg } from '../src/barcode.js';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ok ' : '  BAD', m); if (!c) bad++; };
ok(eanCheck('400638133393') === '1', 'EAN check digit 4006381333931');
ok(isEan13('6281000000011') === (eanCheck('628100000001') === '1'), 'isEan13 agrees with the check digit');
ok(!isEan13('6281000000012') || eanCheck('628100000001') === '2', 'a wrong check digit is not EAN');
const bits = ean13Bits('4006381333931');
ok(bits.length === 95, 'EAN-13: 95 modules');
// 4006381333931: first 6 after the leading 4 use parity LGLLGG
const expect = '101' + '0001101' + '0100111' + '0001101' + '0111101' + '0110111' + '0001001' + '01010' +
  '1000010' + '1000010' + '1000010' + '1110100' + '1000010' + '1100110' + '101';
// 0 (L) 0 (G) 6 (L) 3 (L) 8 (G) 1 (G) | 3 3 3 9 3 1 (R)
const expect2 = '101' + '0001101' + '0100111' + '0101111' + '0111101' + '0001001' + '0110011' + '01010' +
  '1000010' + '1000010' + '1000010' + '1110100' + '1000010' + '1100110' + '101';
ok(bits === expect2, 'EAN-13 4006381333931 modules match the standard');
const c = code128Bits('Fr3oon-12');
ok(c.endsWith('1100011101011') && c.startsWith('11010010000'), 'Code 128: start B and stop pattern');
ok((c.length - 13) % 11 === 0, 'Code 128: 11 modules per symbol');
const c2 = code128Bits('123456');
ok(c2.startsWith('11010011100') && (c2.length - 13) / 11 === 1 + 3 + 1, 'Code 128 set C for even digits: start C, 3 pairs, check');
const taken = new Set([newStoreCode(new Set())]);
const n2 = newStoreCode(taken);
ok(isEan13(n2) && n2.startsWith('2') && !taken.has(n2), 'in-store code: valid EAN starting with 2, not taken: ' + n2);
ok(barcodeSvg('6281000000011').includes('<svg') && barcodeSvg('').length === 0, 'svg made, nothing for an empty code');
console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
process.exit(bad ? 1 : 0);
