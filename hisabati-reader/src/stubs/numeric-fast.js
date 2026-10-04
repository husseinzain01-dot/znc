// Faster drop-in for mdb-reader's data/numeric.js (Access "Numeric" /
// decimal columns: prices). The original adds and multiplies 40-digit
// arrays sixteen times per value, about 0.25 ms each: 1.5 s for the
// invoice lines alone. BigInt gives the same text in a fraction of that.
// Checked value for value against the original by test/numeric.test.mjs.

const B256 = BigInt(256);

export function readNumeric(buffer, column) {
  const bytes = buffer.slice(1, 17);
  // same byte order as the original: value = sum of byte(i) * 256^i
  let v = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; --i) {
    v = v * B256 + BigInt(bytes[12 - 4 * Math.floor(i / 4) + (i % 4)]);
  }
  const scale = column.scale || 0;
  let digits = v.toString();
  if (digits.length <= scale) digits = '0'.repeat(scale + 1 - digits.length) + digits;
  const text = scale > 0 ? digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale) : digits;
  return (buffer[0] & 0x80 ? '-' : '') + text;
}
