// Renders the app logo (src/icons.js) into Windows .ico files:
//   app.ico      16–256 px (256 as PNG) for shortcuts and Add/Remove Programs
//   app-nsis.ico 16/32/48 px bitmaps for the installer and launcher .exe
// Needs Playwright's Chromium (build machine only).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { LOGO } from '../src/icons.js';

const require = createRequire(import.meta.url);
const pw = require(execSync('npm root -g').toString().trim() + '/playwright');
const outDir = process.argv[2] || 'build';
fs.mkdirSync(outDir, { recursive: true });

const browser = await pw.chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await page.evaluate(async ({ svg, sizes }) => {
  const img = new Image();
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  await img.decode();
  const out = {};
  for (const s of sizes) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, s, s);
    out[s] = { rgba: Array.from(g.getImageData(0, 0, s, s).data), png: c.toDataURL('image/png').split(',')[1] };
  }
  return out;
}, { svg: LOGO, sizes });
await browser.close();

// 32-bit BMP (DIB) icon entry: BITMAPINFOHEADER + bottom-up BGRA + AND mask.
function dib(size, rgba) {
  const maskRow = Math.ceil(size / 32) * 4;
  const buf = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  let o = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      buf[o++] = rgba[i + 2];
      buf[o++] = rgba[i + 1];
      buf[o++] = rgba[i];
      buf[o++] = rgba[i + 3];
    }
  }
  return buf; // AND mask left zero: alpha channel decides transparency
}

function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

const full = sizes.map((s) => ({ size: s, data: s >= 128 ? Buffer.from(images[s].png, 'base64') : dib(s, images[s].rgba) }));
fs.writeFileSync(`${outDir}/app.ico`, ico(full));
fs.writeFileSync(`${outDir}/app-nsis.ico`, ico([16, 32, 48].map((s) => ({ size: s, data: dib(s, images[s].rgba) }))));
fs.writeFileSync(`${outDir}/app-256.png`, Buffer.from(images[256].png, 'base64'));
console.log(`${outDir}/app.ico, app-nsis.ico, app-256.png`);
