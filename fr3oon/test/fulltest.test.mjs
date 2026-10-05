// Checks the app half of the full test against what the helper wrote on its
// test engine. Usage (after run-ops.ps1 with KEEP_TMP=1):
//   node test/fulltest.test.mjs <run-ops temp folder>
import fs from 'node:fs';
import path from 'node:path';
import { loadDatabase } from '../src/load.js';
import * as C from '../src/calc.js';
import { verifyRun, verifyClean, readerFromTables } from '../src/fulltest.js';

const [dir] = process.argv.slice(2);
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const P = (tables) => C.prepare(loadDatabase(readerFromTables(tables)));
const P0 = P(json(path.join(dir, 'fulltest-start.json')));
const P1 = P(json(path.join(dir, 'fulltest-run.json')));
const P2 = P(json(path.join(dir, 'fulltest-clean.json')));
const e = json(path.join(dir, 'fulltest-expect.json'));
const today = new Date().toLocaleDateString('sv-SE');
let bad = 0;
for (const [title, steps] of [['after saves', verifyRun(P0, P1, e, today)], ['after deletes', verifyClean(P0, P2, e)]]) {
  console.log(`== ${title}`);
  for (const s of steps) {
    console.log(`  ${s.ok ? 'ok ' : 'BAD'} ${s.name}: ${s.msg}`);
    if (!s.ok) bad++;
  }
}
// the checker must also catch a wrong number
const wrong = verifyRun(P0, P1, { ...e, customerBalance: e.customerBalance + 1 }, today).filter((s) => !s.ok).length;
console.log(wrong === 1 ? '  ok  a wrong expectation is caught' : `  BAD wrong expectation gave ${wrong} failures`);
if (wrong !== 1) bad++;
console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
process.exit(bad ? 1 : 0);
