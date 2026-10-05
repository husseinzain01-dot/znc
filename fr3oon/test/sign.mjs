// Signs a license or an update list the way the vendor tool does (for tests
// and for publishing from a build machine). Never commit a real private key.
//   node test/sign.mjs license <key.json> <machine code> <customer> [expiry YYYY-MM-DD]
//   node test/sign.mjs update  <key.json> <version> <installer url> <installer file> [notes]
import fs from 'node:fs';
import crypto from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
export function keyFrom(file) {
  const k = JSON.parse(fs.readFileSync(file, 'utf8'));
  return crypto.createPrivateKey({ key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y, d: k.d }, format: 'jwk' });
}
const sign = (key, context, data) => b64u(crypto.sign('sha256', Buffer.from(`${context}\n${data}`), { key, dsaEncoding: 'ieee-p1363' }));

export function makeLicense(key, machine, name, expiry = '', issued = new Date().toISOString().slice(0, 10)) {
  const payload = b64u(JSON.stringify({ p: 'Fr3oon', m: machine.toUpperCase(), n: name, e: expiry, i: issued }));
  return `${payload}.${sign(key, 'FR3OON-LICENSE', payload)}`;
}

export function makeUpdate(key, version, url, file, notes = '') {
  const data = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  return { product: 'Fr3oon', version, url, sha256, size: data.length, notes, date: new Date().toISOString().slice(0, 10), sig: sign(key, 'FR3OON-UPDATE', `${version}\n${url}\n${sha256}`) };
}

if (process.argv[1] && process.argv[1].endsWith('sign.mjs')) {
  const [kind, keyFile, ...rest] = process.argv.slice(2);
  const key = keyFrom(keyFile);
  if (kind === 'license') console.log(makeLicense(key, rest[0], rest[1] || '', rest[2] || ''));
  else if (kind === 'update') console.log(JSON.stringify(makeUpdate(key, rest[0], rest[1], rest[2], rest[3] || ''), null, 2));
  else { console.error('usage: license|update ...'); process.exit(2); }
}
