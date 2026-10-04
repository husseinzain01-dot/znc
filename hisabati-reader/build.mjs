// Bundles the app into one self-contained HTML file that works offline from
// a double-click (file://): release/hisabati-reader.html
import fs from 'node:fs';
import * as esbuild from 'esbuild';

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
    'create-hash': './src/stubs/no-crypto.js',
    'browserify-aes/browser.js': './src/stubs/no-crypto.js',
  },
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/styles.css', 'utf8');
const html = fs
  .readFileSync('src/index.html', 'utf8')
  .replace('/*STYLES*/', () => css)
  .replace('/*SCRIPT*/', () => js);
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/hisabati-reader.html', html);
console.log(`release/hisabati-reader.html ${(html.length / 1024).toFixed(0)} KB`);
