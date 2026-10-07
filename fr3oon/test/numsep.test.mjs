// Thousands separators in the amount boxes.
import { groupDigits as g } from '../src/numsep.js';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ok ' : '  BAD', m); if (!c) bad++; };
const cases = [
  ['1500000', '1,500,000'], ['1,500,000', '1,500,000'], ['999', '999'], ['1000', '1,000'], ['-25000', '-25,000'],
  ['0012', '12'], ['0', '0'], ['12.5', '12.5'], ['١٢٣٤٥', '12,345'], ['abc1000x', '1,000'], ['', ''], ['1000.5.5', '1,000.55'],
];
for (const [i, o] of cases) ok(g(i) === o, `${JSON.stringify(i)} -> ${JSON.stringify(g(i))}`);
// what the forms read back: the commas dropped, the same number
for (const n of [0, 7, 1500000, 92500000, -25000]) ok(Number(g(String(n)).replace(/,/g, '')) === n, `${n} reads back the same`);
if (bad) { console.log(`${bad} FAILED`); process.exit(1); }
console.log('ALL PASSED');
