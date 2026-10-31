// Builds release/sana.html: one file, the scripts and styles inside it.
import fs from 'node:fs';
import { build } from 'esbuild';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'chrome110', write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('src/index.html', 'utf8')
  .replace('/*STYLES*/', () => fs.readFileSync('src/style.css', 'utf8'))
  .replace('/*SCRIPT*/', () => js);
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/sana.html', html);
console.log(`release/sana.html ${Math.round(html.length / 1024)} KB`);
