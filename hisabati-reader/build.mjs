// Bundles the app into one self-contained HTML file that works offline,
// from a double-click (read-only) or served by server/server.ps1:
// release/hisabati-reader.html
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
  inject: ['./src/stubs/buffer-global.js'],
  alias: {
    // only needed for password-protected files, which حساباتي does not use
    'create-hash': './src/stubs/no-crypto.js',
    'browserify-aes/browser.js': './src/stubs/no-crypto.js',
  },
  plugins: [
    {
      // mdb-reader's Numeric (price) reader is very slow; same results, fast
      // (see src/stubs/numeric-fast.js and test/numeric.test.mjs)
      name: 'fast-numeric',
      setup(b) {
        b.onLoad({ filter: /mdb-reader[\\/]lib[\\/]browser[\\/]data[\\/]numeric\.js$/ }, () => ({
          contents: fs.readFileSync('src/stubs/numeric-fast.js', 'utf8'),
          loader: 'js',
        }));
      },
    },
  ],
});
if (!out.outputFiles[0].text.includes('B256') && !/BigInt\(256\)/.test(out.outputFiles[0].text)) throw new Error('fast Numeric reader was not bundled');

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
const css = fs.readFileSync('src/styles.css', 'utf8');
const favicon = 'data:image/svg+xml,' + encodeURIComponent(LOGO);
const html = fs
  .readFileSync('src/index.html', 'utf8')
  .replace('/*FAVICON*/', () => favicon)
  .replace('/*FONTS*/', () => fonts)
  .replace('/*STYLES*/', () => css)
  .replaceAll('/*LOGO*/', () => LOGO)
  .replace('/*SCRIPT*/', () => js);
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/hisabati-reader.html', html);
console.log(`release/hisabati-reader.html ${(html.length / 1024).toFixed(0)} KB`);
