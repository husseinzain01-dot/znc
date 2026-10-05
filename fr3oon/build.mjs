// Bundles the app into one self-contained HTML file that works offline,
// served by server/server.ps1: release/fr3oon.html
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { LOGO } from './src/icons.js';

const out = await esbuild.build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
  minify: true,
  write: false,
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});

// Arabic + Latin subsets of IBM Plex Sans Arabic, embedded so the app looks
// the same on every machine without internet.
const fontDir = 'node_modules/@fontsource/ibm-plex-sans-arabic';
let fonts = '';
for (const w of [400, 600, 700]) {
  const css = fs.readFileSync(path.join(fontDir, `${w}.css`), 'utf8');
  for (const m of css.matchAll(/\/\* ibm-plex-sans-arabic-(arabic|latin)-\d+-normal \*\/\s*(@font-face \{[^}]*\})/g)) {
    fonts += m[2].replace(/src: [^;]+;/, (src) => {
      const file = src.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
      const b64 = fs.readFileSync(path.join(fontDir, 'files', file)).toString('base64');
      return `src: url(data:font/woff2;base64,${b64}) format('woff2');`;
    });
  }
}

const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// the app's styles, then each screen's own (src/css/*.css)
const css = [fs.readFileSync('src/styles.css', 'utf8'), ...fs.readdirSync('src/css').filter((f) => f.endsWith('.css')).sort().map((f) => fs.readFileSync(path.join('src/css', f), 'utf8'))].join('\n');
const favicon = 'data:image/svg+xml,' + encodeURIComponent(LOGO);
const html = fs
  .readFileSync('src/index.html', 'utf8')
  .replace('/*FAVICON*/', () => favicon)
  .replace('/*FONTS*/', () => fonts)
  .replace('/*STYLES*/', () => css)
  .replaceAll('/*LOGO*/', () => LOGO)
  .replace('/*SCRIPT*/', () => js);
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/fr3oon.html', html);
console.log(`release/fr3oon.html ${(html.length / 1024).toFixed(0)} KB`);
