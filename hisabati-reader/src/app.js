// لوحة المحل — UI. Opens a حساباتي Access file and renders reports.
// Opened as a file it is read-only; served by server.ps1 it signs users in
// against حساباتي's own users and can save entries into the same file.
import { Buffer } from 'buffer';
import MDBReader from 'mdb-reader';
import { loadDatabase } from './load.js';
import * as C from './calc.js';
import { setupForms } from './forms.js';
import { setupPos } from './pos.js';
import { setupSettings } from './settings.js';
import { icon, LOGO } from './icons.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'));
const money = (n) => `<span class="num${n < 0 ? ' neg' : ''}">${fmt(n)}</span>`;
const pct = (n) => `<span class="num">${(n * 100).toFixed(1)}%</span>`;
const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const noName = (s) => s || '(بدون اسم)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k) || '';
    } catch {
      return '';
    }
  },
  set: (k, v) => {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      /* per-device preference only */
    }
  },
};

const state = {
  P: null,
  view: 'home',
  filter: { from: localDay(), to: localDay(), user: '' },
  preset: 'today',
  handle: null,
  fileName: '',
  loadedAt: null,
  timer: null,
  server: false, // served by server.ps1: signed in, can write
  test: false,
  version: '',
  token: store.get('lawha-token'),
  user: '',
  admin: false,
  shopName: '',
  stockByName: null,
};

// ---------- remembered file handle (IndexedDB, read-only mode) ----------

const idb = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('lawhat-almahal', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => res(undefined);
      });
    } catch {
      return undefined;
    }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
    } catch {
      /* remembering the file is a convenience only */
    }
  },
};

// ---------- loading ----------

async function readBuffer(buf, name, { quiet = false } = {}) {
  const reader = new MDBReader(Buffer.from(buf));
  const P = C.prepare(loadDatabase(reader));
  state.P = P;
  state.stockByName = new Map(C.stock(P).map((x) => [x.name, x]));
  state.fileName = name;
  state.loadedAt = new Date();
  const users = $('#user');
  const keep = users.value;
  users.innerHTML = '<option value="">الكل</option>' + P.users.map((u) => `<option>${esc(u)}</option>`).join('');
  users.value = P.users.includes(keep) ? keep : '';
  showApp();
  status();
  // A background refresh must not wipe what someone is typing.
  if (quiet && state.view === 'pos') pos().onData();
  else if (quiet && !$('#modal').hidden) return;
  else render();
}

async function readHandle(handle) {
  // Access may write to the file while we read it; one retry covers that.
  for (let i = 0; i < 2; i++) {
    try {
      const f = await handle.getFile();
      return await readBuffer(await f.arrayBuffer(), f.name);
    } catch (e) {
      if (i === 1) throw e;
      await sleep(800);
    }
  }
}

async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: 'ملف حساباتي', accept: { 'application/x-msaccess': ['.accdb', '.mdb'] } }],
      });
      state.handle = h;
      await idb.set('file', h);
      await guarded(() => readHandle(h));
    } catch (e) {
      if (e.name !== 'AbortError') showError(e);
    }
  } else {
    $('#fileInput').click();
  }
}

async function reload() {
  if (state.server) return guarded(() => readServer());
  if (!state.handle) return openFile();
  if ((await state.handle.queryPermission?.({ mode: 'read' })) !== 'granted') {
    if ((await state.handle.requestPermission?.({ mode: 'read' })) !== 'granted') return;
  }
  await guarded(() => readHandle(state.handle));
}

async function guarded(fn) {
  const btn = $('#btnReload');
  btn.disabled = true;
  $('#fileStatus').textContent = 'جاري قراءة البيانات…';
  try {
    await fn();
  } catch (e) {
    showError(e);
  } finally {
    btn.disabled = false;
    status();
  }
}

function showError(e) {
  console.error(e);
  const msg = /not a valid|unsupported|jet|format/i.test(String(e?.message))
    ? 'هذا الملف مو ملف حساباتي (Access). اختار ملف Units2026.accdb.'
    : 'ما كدرت أقرا البيانات: ' + (e?.message || e);
  if ($('#app').hidden) {
    toast(msg, true);
    return;
  }
  openModal(`<h2>صار خطأ</h2><p class="notice error">${esc(msg)}</p>`);
}

function status() {
  const s = $('#fileStatus');
  if (!state.P) {
    s.textContent = '';
    return;
  }
  const t = state.loadedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  s.textContent = `${state.test ? 'وضع تجربة — ' : ''}${state.server ? '' : 'قراءة فقط — '}آخر تحديث ${t}`;
  s.title = state.fileName;
}

function setAuto(on) {
  clearInterval(state.timer);
  state.timer = null;
  store.set('lawha-auto', on ? '1' : '0');
  if (on)
    state.timer = setInterval(async () => {
      if (state.server) {
        readServer({ quiet: true }).catch((e) => console.warn('auto refresh failed', e));
        return;
      }
      if (!state.handle || (await state.handle.queryPermission?.({ mode: 'read' })) !== 'granted') return;
      try {
        await readHandle(state.handle);
      } catch (e) {
        console.warn('auto refresh failed', e);
      }
    }, 60000);
}

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 2600);
}

// ---------- server (server.ps1) ----------

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Lawha': '1', 'X-Token': state.token || '' };
  if (body) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(path, { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('البرنامج المساعد مو شغّال. سد البرنامج وافتحه مرة ثانية.');
  }
  if (r.status === 401) {
    signedOut();
    throw new Error('انتهت الجلسة، سجّل دخول مرة ثانية');
  }
  if (path === '/api/file') {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'ما كدرت أقرا الملف');
    return r;
  }
  const j = await r.json().catch(() => ({ ok: false, error: 'رد غير مفهوم من البرنامج المساعد' }));
  if (!j.ok) throw new Error(j.error || 'صار خطأ');
  return j;
}

async function readServer({ quiet = false } = {}) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await api('/api/file');
      const name = decodeURIComponent(r.headers.get('X-File-Name') || 'Units2026.accdb');
      return await readBuffer(await r.arrayBuffer(), name, { quiet });
    } catch (e) {
      if (i === 1 || /سجّل دخول|مو شغّال/.test(e.message)) throw e;
      await sleep(800);
    }
  }
}

// Saves through server.ps1, then re-reads the file. With background, the
// caller gets the result straight away and the data refreshes behind it.
async function write(op, data, { background = false } = {}) {
  const j = await api('/api/write', { method: 'POST', body: { op, data } });
  const refreshed = readServer({ quiet: background }).catch((e) => toast('انحفظ، بس ما تحدّثت الشاشة: ' + e.message, true));
  if (!background) await refreshed;
  return j.result || {};
}

async function detectServer() {
  if (!location.protocol.startsWith('http')) return null;
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    const j = await r.json();
    return j.ok ? j : null;
  } catch {
    return null;
  }
}

// ---------- full-screen states ----------

function screen(html, wide = false) {
  $('#screen').hidden = false;
  $('#app').hidden = true;
  const card = $('#screenCard');
  card.classList.toggle('wide', wide);
  card.innerHTML = `<div class="brand-mark big" aria-hidden="true">${LOGO}</div>${html}`;
}

function showApp() {
  $('#screen').hidden = true;
  $('#app').hidden = false;
}

function setupScreen(error = '') {
  screen(`<h1>أهلاً بيك بلوحة المحل</h1>
    <p class="muted">أول خطوة: اختار ملف بيانات حساباتي (<code>Units2026.accdb</code>). البرنامج يحفظ مكانه وما يسألك عنه مرة ثانية.</p>
    ${error ? `<p class="notice error">${esc(error)}</p>` : ''}
    <button class="btn primary big block" id="btnChoose">${icon('file')} اختار ملف البيانات</button>
    <p class="muted" style="font-size:13px">إذا الملف على حاسبة ثانية بالشبكة، افتحه من "Network" بنافذة الاختيار.</p>`);
  $('#btnChoose').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'اختار الملف من النافذة اللي انفتحت…';
    try {
      await api('/api/choose-file', { method: 'POST', body: {} });
      loginScreen();
    } catch (err) {
      setupScreen(err.message);
    }
  };
}

async function loginScreen(error = '', chosen = '') {
  let users = [];
  try {
    users = (await api('/api/users')).users || [];
  } catch (e) {
    return setupScreen(e.message);
  }
  const last = chosen || store.get('lawha-last-user');
  screen(`<h1>${esc(state.shopName || 'لوحة المحل')}</h1>
    <p class="muted">سجّل دخول بنفس اسمك وكلمة السر مال حساباتي</p>
    <form id="loginForm" autocomplete="off">
      <label class="field">المستخدم
        ${users.length
          ? `<select id="lUser">${users.map((u) => `<option${u === last ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>`
          : `<input id="lUser" placeholder="اسمك" value="${esc(last)}">`}
      </label>
      <label class="field">كلمة السر <input id="lPass" type="password" autocomplete="current-password"></label>
      ${error ? `<p class="notice error" style="margin:0">${esc(error)}</p>` : ''}
      <button class="btn primary big block" type="submit">دخول</button>
    </form>
    <p class="muted" style="font-size:12px;margin-top:18px">لوحة المحل ${esc(state.version)}${state.test ? ' — وضع تجربة' : ''}</p>`);
  $('#lPass').focus();
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const j = await api('/api/login', { method: 'POST', body: { user: $('#lUser').value.trim(), password: $('#lPass').value } });
      state.token = j.token;
      store.set('lawha-token', j.token);
      store.set('lawha-last-user', j.user);
      signedIn(j);
    } catch (err) {
      loginScreen(err.message, $('#lUser').value.trim());
    }
  };
}

async function signedIn(me) {
  state.user = me.user;
  state.admin = !!me.admin;
  $('#who').hidden = false;
  $('#whoName').textContent = me.user;
  $('#whoRole').textContent = me.admin ? 'مدير' : 'كاشير';
  $('#whoAvatar').textContent = (me.user || '?').trim().charAt(0);
  buildNav();
  POS?.reset();
  state.view = state.admin ? 'home' : 'pos';
  screen('<h1>جاري قراءة البيانات…</h1><p class="muted">لحظات</p>');
  try {
    await readServer();
  } catch (e) {
    if (!state.token) return;
    screen(`<h1>ما كدرت أقرا البيانات</h1><p class="notice error">${esc(e.message)}</p>
      <button class="btn primary block" id="btnRetry">${icon('refresh')} حاول مرة ثانية</button>
      ${state.admin ? `<button class="btn block" id="btnRechoose" style="margin-top:8px">${icon('file')} اختار ملف ثاني</button>` : ''}`);
    $('#btnRetry').onclick = () => signedIn(me);
    if ($('#btnRechoose')) $('#btnRechoose').onclick = () => setupScreen();
  }
}

function signedOut() {
  state.token = '';
  store.set('lawha-token', '');
  state.user = '';
  state.admin = false;
  state.P = null;
  closeModal();
  loginScreen();
}

// Read-only mode: the page was opened straight from a file.
function fileScreen() {
  screen(`<h1>لوحة المحل</h1>
    <p class="muted">هذا البرنامج يقرا بيانات <b>حساباتي</b> (ملف <code>Units2026.accdb</code>) ويطلّعلك التقارير، بدون ما يغيّر شي بالملف.</p>
    <button class="btn primary big block" id="btnOpen2">${icon('file')} فتح ملف البيانات</button>
    <p class="muted" id="lastHint" style="font-size:13px"></p>`);
  $('#btnOpen2').onclick = openFile;
  buildNav();
  $('#btnOpen').hidden = false;
  idb.get('file').then((h) => {
    if (!h) return;
    state.handle = h;
    $('#lastHint').innerHTML = `آخر ملف: <b>${esc(h.name)}</b> <button class="btn small" id="btnLast">افتحه</button>`;
    $('#btnLast').onclick = reload;
    h.queryPermission?.({ mode: 'read' }).then((p) => p === 'granted' && reload());
  });
}

// ---------- period filter ----------

function applyPreset(p, { draw = true } = {}) {
  const today = localDay();
  const ranges = {
    today: [today, today],
    yesterday: [addDays(today, -1), addDays(today, -1)],
    week: [addDays(today, -6), today],
    month: [today.slice(0, 8) + '01', today],
    all: ['', ''],
  };
  const [from, to] = ranges[p] || ranges.today;
  state.preset = p;
  state.filter.from = from;
  state.filter.to = to;
  $('#from').value = from;
  $('#to').value = to;
  $$('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
  if (draw && state.P) render();
}

function periodLabel() {
  const { from, to } = state.filter;
  if (!from && !to) return 'كل الفترات';
  if (from === to) return from;
  return `${from || '…'} إلى ${to || '…'}`;
}

// ---------- generic sortable table ----------

const tables = new Map();
let tableSeq = 0;

// columns: {key, label, num, money, get(row), html(row), total}
function table(rows, columns, { onClick, empty = 'ماكو بيانات', sort, name = 'تقرير' } = {}) {
  const id = 't' + ++tableSeq;
  tables.set(id, { rows, columns, onClick, empty, sort: sort || null, name });
  return `<div class="table-wrap" id="${id}">${tableInner(id)}</div>`;
}

function cellValue(c, r) {
  return c.get ? c.get(r) : r[c.key];
}

function tableInner(id) {
  const t = tables.get(id);
  let rows = t.rows;
  if (t.sort) {
    const c = t.columns.find((x) => x.key === t.sort.key);
    const dir = t.sort.dir;
    rows = [...rows].sort((a, b) => {
      const x = cellValue(c, a), y = cellValue(c, b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'ar')) * dir;
    });
  }
  const head = t.columns
    .map((c) => `<th data-key="${c.key}" class="${t.sort?.key === c.key ? 'sorted' + (t.sort.dir > 0 ? ' asc' : '') : ''}">${esc(c.label)}</th>`)
    .join('');
  const body = rows.length
    ? rows
        .map((r, i) => {
          const tds = t.columns
            .map((c) => {
              if (c.html) return `<td>${c.html(r)}</td>`;
              const v = cellValue(c, r);
              if (c.money) return `<td>${money(v)}</td>`;
              if (c.num) return `<td><span class="num">${fmt(v)}</span></td>`;
              return `<td>${esc(v)}</td>`;
            })
            .join('');
          return `<tr data-i="${t.rows.indexOf(r)}"${t.onClick ? ' class="click"' : ''}>${tds}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${t.columns.length}" class="empty">${esc(t.empty)}</td></tr>`;
  const hasTotal = t.columns.some((c) => c.total);
  const foot =
    hasTotal && rows.length
      ? `<tfoot><tr>${t.columns
          .map((c, i) => {
            if (c.total) return `<td>${money(rows.reduce((a, r) => a + (Number(cellValue(c, r)) || 0), 0))}</td>`;
            return `<td>${i === 0 ? 'المجموع' : ''}</td>`;
          })
          .join('')}</tr></tfoot>`
      : '';
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

document.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-key]');
  if (th) {
    const id = th.closest('.table-wrap').id;
    const t = tables.get(id);
    const key = th.dataset.key;
    t.sort = t.sort?.key === key ? { key, dir: -t.sort.dir } : { key, dir: -1 };
    $('#' + id).innerHTML = tableInner(id);
    return;
  }
  const tr = e.target.closest('tbody tr.click');
  if (tr) {
    const t = tables.get(tr.closest('.table-wrap').id);
    t.onClick?.(t.rows[+tr.dataset.i]);
  }
});

function exportCsv(id) {
  const t = tables.get(id);
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.columns.map((c) => q(c.label)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => q(c.csv ? c.csv(r) : cellValue(c, r))).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.name} ${periodLabel()}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Section header with search, Excel and print buttons for the table below it.
function section(title, tableHtml, { search = true } = {}) {
  const id = tableHtml.match(/id="(t\d+)"/)?.[1];
  return `<div class="section-head"><h2>${esc(title)}</h2><div class="tools">
      ${search ? `<input class="search" type="search" placeholder="بحث…" data-search="${id}">` : ''}
      <button class="btn small" data-csv="${id}">Excel</button>
      <button class="btn small" data-print>طباعة</button>
    </div></div>${tableHtml}`;
}

document.addEventListener('input', (e) => {
  const id = e.target.dataset?.search;
  if (!id) return;
  const t = tables.get(id);
  t.all ??= t.rows;
  const q = e.target.value.trim();
  t.rows = q ? t.all.filter((r) => t.columns.some((c) => String(cellValue(c, r) ?? '').includes(q))) : t.all;
  $('#' + id).innerHTML = tableInner(id);
});

document.addEventListener('click', (e) => {
  const csv = e.target.closest('[data-csv]');
  if (csv) exportCsv(csv.dataset.csv);
  if (e.target.closest('[data-print]')) {
    const inModal = !!e.target.closest('#modal');
    document.body.classList.toggle('printing-modal', inModal);
    window.print();
    document.body.classList.remove('printing-modal');
  }
});

// ---------- chart ----------

function barChart(points, { height = 240 } = {}) {
  // points: [[label, value]], single series, columns from one baseline.
  if (!points.length) return '<p class="empty">ماكو مبيعات بهاي الفترة</p>';
  const W = 900, H = height, padL = 70, padR = 12, padT = 12, padB = 26;
  const max = Math.max(...points.map((p) => p[1]), 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB;
  const band = iw / points.length;
  const bw = Math.min(24, Math.max(4, band - 2));
  const y = (v) => padT + ih - (v / top) * ih;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    g += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    g += `<text class="axis-text" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  const labelEvery = Math.ceil(points.length / 10);
  let bars = '';
  points.forEach(([label, v], i) => {
    // RTL page, but time runs left-to-right on the axis like a calendar.
    const cx = padL + band * i + band / 2;
    const h = Math.max(0, y(0) - y(v));
    const r = Math.min(4, h, bw / 2);
    const x0 = cx - bw / 2, x1 = cx + bw / 2, yb = y(0), yt = yb - h;
    const path = h > 0 ? `M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${yb}Z` : '';
    bars += `<rect class="hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${ih}" data-tip="${esc(label)}: ${fmt(v)} دينار"/>`;
    bars += `<path class="bar" d="${path}"/>`;
    if (i % labelEvery === 0) bars += `<text class="axis-text" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(label.slice(5))}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="المبيعات حسب اليوم" direction="ltr">${g}${bars}</svg>`;
}

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

document.addEventListener('mousemove', (e) => {
  const tip = $('#tip');
  const t = e.target.closest?.('[data-tip]');
  if (!t) {
    tip.hidden = true;
    $$('.bar.hover').forEach((b) => b.classList.remove('hover'));
    return;
  }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  tip.style.left = e.clientX + 12 + 'px';
  tip.style.top = e.clientY - 34 + 'px';
  $$('.bar.hover').forEach((b) => b.classList.remove('hover'));
  t.nextElementSibling?.classList.add('hover');
});

// ---------- modal ----------

function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
}

// ---------- forms (server mode) ----------

let F = null;
const forms = () =>
  (F ??= setupForms({ $, $$, esc, fmt, localDay, openModal, closeModal, write, state, toast, icon }));
const canWrite = () => state.server;
const canAdmin = () => state.server && state.admin;
// What a cashier may start; the server enforces the same rule.
const CASHIER_ACTS = new Set(['newSale', 'newReceipt', 'newCustomer']);
// Views list their buttons here; render() puts them in the page header.
let pendingActions = [];
const actionBar = (buttons) => {
  if (canWrite()) pendingActions.push(...buttons.filter(([id]) => state.admin || CASHIER_ACTS.has(id)));
  return '';
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !canWrite()) return;
  const f = forms();
  const a = b.dataset.act;
  if (a === 'newSale') return go('pos');
  if (a === 'newPurchase') f.invoiceEditor('purchase');
  if (a === 'newReceipt') f.voucherEditor('receipt', null, { name: b.dataset.name });
  if (a === 'newPayment') f.voucherEditor('payment', null, { name: b.dataset.name, cls: b.dataset.cls });
  if (a === 'newCustomer') f.personEditor('customer');
  if (a === 'newSupplier') f.personEditor('supplier');
  if (a === 'newItem') f.itemEditor();
});

// ---------- views ----------

const kpi = (label, value, hint = '', accent = false) =>
  `<div class="card kpi${accent ? ' accent' : ''}"><div class="label">${esc(label)}</div><div class="value">${money(value)}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

function viewHome() {
  const P = state.P;
  const f = state.filter;
  const s = C.salesSummary(P, f);
  const box = C.cashBox(P, f);
  const pr = C.profit(P, f);
  const debts = C.customerBalances(P);
  const owed = debts.filter((d) => d.balance > 0).reduce((a, d) => a + d.balance, 0);
  const supp = C.supplierBalances(P).reduce((a, d) => a + d.balance, 0);
  const stockValue = C.stock(P).reduce((a, x) => a + Math.max(0, x.value), 0);

  // Chart: the chosen period, or the 30 days up to its end for a single day.
  const end = f.to || P.lastDate || localDay();
  let start = f.from && f.from !== f.to ? f.from : f.from ? addDays(end, -29) : P.firstDate || addDays(end, -29);
  if (start > end) start = end;
  const daily = C.salesSummary(P, { from: start, to: end, user: f.user }).byDay;
  const map = new Map(daily);
  const pts = [];
  for (let d = start; d <= end && pts.length < 400; d = addDays(d, 1)) pts.push([d, map.get(d) || 0]);

  let hint = '';
  if (!s.count && P.lastDate && state.preset === 'today') {
    hint = `<p class="notice">ماكو مبيعات اليوم بالملف. آخر يوم بيه مبيعات: <b>${P.lastDate}</b>
      <button class="btn small" id="goLast">اعرضه</button></p>`;
  }

  const topItems = s.byItem.slice(0, 8);
  const maxItem = topItems[0]?.total || 1;
  return `${actionBar([['newSale', '+ قائمة بيع'], ['newPurchase', '+ قائمة شراء'], ['newReceipt', '+ وصل قبض'], ['newPayment', '+ وصل دفع / مصروف']])}${hint}
  <div class="grid kpis">
    ${kpi('المبيعات', s.total, `${s.count} قائمة — ${periodLabel()}`, true)}
    ${kpi('نقدي', s.cash)}
    ${kpi('آجل', s.credit)}
    ${kpi('ربح المواد', pr.gross, `بعد المصاريف: ${fmt(pr.net)}`)}
    ${kpi('صافي الصندوق', box.net, `داخل ${fmt(box.totalIn)} — طالع ${fmt(box.totalOut)}`)}
    ${kpi('تسديدات الزبائن', box.receipts)}
  </div>
  <div class="grid kpis" style="margin-top:14px">
    ${kpi('ديون على الزبائن (الكل)', owed, 'المجموع لحد هسه')}
    ${kpi('ديون للموردين (الكل)', supp, 'المجموع لحد هسه')}
    ${kpi('قيمة المخزن بسعر الشراء', stockValue)}
  </div>
  <div class="card" style="margin-top:14px">
    <h3>المبيعات حسب اليوم (${start} إلى ${end})</h3>
    ${barChart(pts)}
  </div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><h3>أكثر المواد مبيعاً</h3>
      ${table(topItems, [
        { key: 'item', label: 'المادة' },
        { key: 'qty', label: 'الكمية', num: true },
        { key: 'total', label: 'المبلغ', money: true },
        { key: 'bar', label: '', html: (r) => `<div class="meter"><span style="width:${(r.total / maxItem) * 100}%"></span></div>` },
      ], { empty: 'ماكو مبيعات' })}
    </div>
    <div class="card"><h3>المبيعات حسب الكاشير</h3>
      ${table(s.byUser.map(([u, t]) => ({ u, t })), [
        { key: 'u', label: 'الكاشير' },
        { key: 't', label: 'المبلغ', money: true, total: true },
      ], { empty: 'ماكو مبيعات' })}
    </div>
  </div>`;
}

function invoiceModal(inv, kind = 'sale') {
  const lines = inv.lines.map((l) => ({ ...l, total: l.qty * l.price }));
  const who = kind === 'sale' ? inv.customer : inv.supplier;
  openModal(`<h2>${kind === 'sale' ? 'قائمة بيع' : 'قائمة شراء'} رقم ${inv.id}</h2>
    <div class="statement-head">
      <span>${kind === 'sale' ? 'الزبون' : 'المورد'}: <b>${esc(noName(who))}</b></span>
      <span>النوع: <b>${esc(inv.type)}</b></span>
      <span>التاريخ: <b>${inv.date}</b></span>
      <span>الوقت: <b>${esc(inv.time.slice(11, 16))}</b></span>
      <span>المستخدم: <b>${esc(inv.user)}</b></span>
      ${inv.paid ? `<span>المدفوع: <b>${fmt(inv.paid)}</b></span>` : ''}
      ${inv.note ? `<span>ملاحظة: <b>${esc(inv.note)}</b></span>` : ''}
    </div>
    ${section('المواد', table(lines, [
      { key: 'item', label: 'المادة' },
      { key: 'qty', label: 'الكمية', num: true },
      { key: 'unit', label: 'الوحدة' },
      { key: 'price', label: 'السعر', money: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
    ], { name: `قائمة ${inv.id}` }), { search: false })}
    ${canWrite() ? `<div class="form-actions no-print">
      ${kind === 'sale' ? `<button class="btn" id="invPrint">${icon('print')} طباعة وصل</button>` : ''}
      ${canAdmin() ? `<button class="btn primary" id="invEdit">${icon('edit')} تعديل</button>
      <button class="btn danger" id="invDel">${icon('trash')} مسح القائمة</button>` : ''}
    </div>` : ''}`);
  if (!canWrite()) return;
  if (kind === 'sale') $('#invPrint').onclick = () => forms().printSale(inv);
  if (!canAdmin()) return;
  $('#invEdit').onclick = () => forms().invoiceEditor(kind, inv);
  $('#invDel').onclick = () => forms().confirmDelete(kind === 'sale' ? 'deleteSale' : 'deletePurchase', inv.id, `القائمة رقم ${inv.id}`);
}

function viewSales() {
  const P = state.P;
  const s = C.salesSummary(P, state.filter);
  const rows = s.list.map((x) => ({ ...x, n: x.lines.length, who: x.type === C.CREDIT ? noName(x.customer) : 'نقدي' }));
  return `${actionBar([['newSale', '+ قائمة بيع']])}<div class="grid kpis">
      ${kpi('المجموع', s.total, `${s.count} قائمة`)}${kpi('نقدي', s.cash)}${kpi('آجل', s.credit)}
    </div>
    ${section('القوائم', table(rows, [
      { key: 'id', label: 'رقم', num: true },
      { key: 'date', label: 'التاريخ' },
      { key: 'tm', label: 'الوقت', get: (r) => r.time.slice(11, 16) },
      { key: 'type', label: 'النوع' },
      { key: 'who', label: 'الزبون' },
      { key: 'user', label: 'الكاشير' },
      { key: 'n', label: 'عدد المواد', num: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
    ], { onClick: (r) => invoiceModal(r), sort: { key: 'id', dir: -1 }, name: 'المبيعات' }))}
    ${section('المبيعات حسب المادة', table(s.byItem, [
      { key: 'item', label: 'المادة' },
      { key: 'qty', label: 'الكمية', num: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
    ], { name: 'المبيعات حسب المادة' }))}`;
}

function waLink(mobile, text) {
  let m = String(mobile || '').replace(/\D/g, '');
  if (m.startsWith('0')) m = '964' + m.slice(1);
  return m ? `https://wa.me/${m}?text=${encodeURIComponent(text)}` : '';
}

function statementModal(kind, name) {
  const P = state.P;
  const range = { from: '', to: '' };
  const draw = () => {
    const st = kind === 'customer' ? C.customerStatement(P, name, range) : C.supplierStatement(P, name, range);
    const person = (kind === 'customer' ? P.customers : P.suppliers).find((c) => c.name === name);
    const text = `كشف حساب: ${noName(name)}\nالرصيد لحد ${range.to || P.lastDate}: ${fmt(st.closing)} دينار`;
    const wa = waLink(person?.mobile, text);
    openModal(`<h2>كشف حساب — ${esc(noName(name))}</h2>
      <div class="statement-head">
        ${person?.mobile ? `<span>الموبايل: <b class="num">${esc(person.mobile)}</b></span>` : ''}
        ${person?.address ? `<span>العنوان: <b>${esc(person.address)}</b></span>` : ''}
        <span>الرصيد: <b>${money(st.closing)}</b></span>
      </div>
      <div class="filters no-print" style="padding:0 0 8px">
        <label>من <input type="date" id="stFrom" value="${range.from}"></label>
        <label>إلى <input type="date" id="stTo" value="${range.to}"></label>
        ${wa ? `<a class="btn small" href="${wa}" target="_blank" rel="noopener">إرسال الرصيد على واتساب</a>` : ''}
        ${canAdmin() && person ? `<button class="btn small" id="stEdit">${icon('edit')} تعديل البيانات</button>` : ''}
        ${person && (canAdmin() || (canWrite() && kind === 'customer')) ? `<button class="btn small primary" id="stPay">${kind === 'customer' ? '+ وصل قبض' : '+ وصل دفع'}</button>` : ''}
      </div>
      ${section('الحركات', table(st.rows, [
        { key: 'date', label: 'التاريخ' },
        { key: 'desc', label: 'البيان' },
        { key: 'debit', label: kind === 'customer' ? 'عليه (مدين)' : 'له (دائن)', money: true, total: true },
        { key: 'credit', label: kind === 'customer' ? 'دفع (دائن)' : 'دفعنا (مدين)', money: true, total: true },
        { key: 'balance', label: 'الرصيد', money: true },
      ], {
        name: `كشف حساب ${noName(name)}`,
        onClick: (r) => {
          const inv = r.kind === 'sale' || r.kind === 'paid' ? P.saleById.get(r.ref) : r.kind === 'purchase' ? P.purchases.find((p) => p.id === r.ref) : null;
          if (inv) return invoiceModal(inv, r.kind === 'purchase' ? 'purchase' : 'sale');
          if (canAdmin() && (r.kind === 'receipt' || r.kind === 'payment')) {
            const v = (r.kind === 'receipt' ? P.receipts : P.payments).find((x) => x.id === r.ref);
            if (v) forms().voucherEditor(r.kind, v);
          }
        },
      }), { search: false })}`);
    if ($('#stEdit')) $('#stEdit').onclick = () => forms().personEditor(kind, person);
    if ($('#stPay')) {
      $('#stPay').onclick = () =>
        kind === 'customer' ? forms().voucherEditor('receipt', null, { name }) : forms().voucherEditor('payment', null, { name, cls: C.SETTLE });
    }
    $('#stFrom').onchange = (e) => ((range.from = e.target.value), draw());
    $('#stTo').onchange = (e) => ((range.to = e.target.value), draw());
  };
  draw();
}

function viewPeople(kind) {
  const P = state.P;
  const list = kind === 'customer' ? C.customerBalances(P) : C.supplierBalances(P);
  const owed = list.filter((x) => x.balance > 0).reduce((a, x) => a + x.balance, 0);
  const rows = list.map((x) => ({ ...x, shown: noName(x.name), mobile: x.info?.mobile || '', type: x.info?.type || '' }));
  const cols = [
    { key: 'shown', label: kind === 'customer' ? 'الزبون' : 'المورد' },
    ...(kind === 'customer' ? [{ key: 'type', label: 'النوع' }] : []),
    { key: 'mobile', label: 'الموبايل', html: (r) => `<span class="num">${esc(r.mobile)}</span>` },
    { key: 'opening', label: 'رصيد افتتاحي', money: true, total: true },
    { key: 'debit', label: kind === 'customer' ? 'مبيعات آجل' : 'مشتريات آجل', money: true, total: true },
    { key: 'credit', label: 'تسديدات', money: true, total: true },
    { key: 'balance', label: 'الرصيد', money: true, total: true },
    { key: 'last', label: 'آخر حركة' },
  ];
  return `${actionBar(kind === 'customer' ? [['newCustomer', '+ زبون جديد'], ['newReceipt', '+ وصل قبض']] : [['newSupplier', '+ مورد جديد'], ['newPayment', '+ وصل دفع']])}
    <div class="grid kpis">
      ${kpi(kind === 'customer' ? 'مجموع الديون على الزبائن' : 'مجموع ديون الموردين', owed, `${list.filter((x) => x.balance > 0).length} ${kind === 'customer' ? 'زبون' : 'مورد'} عليهم رصيد`)}
    </div>
    <p class="muted">دوس على أي اسم حتى يطلعلك كشف الحساب.</p>
    ${section(kind === 'customer' ? 'أرصدة الزبائن' : 'أرصدة الموردين', table(rows, cols, {
      onClick: (r) => statementModal(kind, r.name),
      name: kind === 'customer' ? 'أرصدة الزبائن' : 'أرصدة الموردين',
    }))}`;
}

function viewStock() {
  const P = state.P;
  const st = C.stock(P);
  const pill = (s) => `<span class="pill ${s === 'نافد' || s === 'بالسالب' ? 'bad' : s === 'قليل' ? 'warn' : 'good'}">${s}</span>`;
  const classes = [...new Set(st.map((x) => x.cls))].sort();
  return `${actionBar([['newItem', '+ مادة جديدة']])}<div class="grid kpis">
      ${kpi('قيمة المخزن بسعر الشراء', st.reduce((a, x) => a + Math.max(0, x.value), 0))}
      <div class="card kpi"><div class="label">مواد نافدة</div><div class="value num">${st.filter((x) => x.status === 'نافد').length}</div></div>
      <div class="card kpi"><div class="label">مواد رصيدها بالسالب</div><div class="value num">${st.filter((x) => x.status === 'بالسالب').length}</div><div class="hint">مبيوع أكثر من المشترى — تأكد من قوائم الشراء</div></div>
      <div class="card kpi"><div class="label">مواد قليلة</div><div class="value num">${st.filter((x) => x.status === 'قليل').length}</div></div>
    </div>
    <p class="muted">الرصيد محسوب مثل حساباتي: الرصيد الافتتاحي + المشتريات − المبيعات، والقطع الزايدة تنحسب كراتين.
      الأصناف: ${classes.map(esc).join('، ')}</p>
    ${section('رصيد المواد', table(st, [
      { key: 'code', label: 'الرمز' },
      { key: 'cls', label: 'الصنف' },
      { key: 'name', label: 'المادة' },
      { key: 'k', label: 'الرصيد (وحدة كبيرة)', html: (r) => `<span class="num">${fmt(r.k)}</span> ${esc(r.unitL1)}` , get: (r) => r.k },
      { key: 's', label: 'الرصيد (وحدة صغيرة)', html: (r) => `<span class="num">${fmt(r.s)}</span> ${esc(r.unitL2)}`, get: (r) => r.s },
      { key: 'fill', label: 'التعبئة', num: true },
      { key: 'priceL1', label: 'سعر البيع (كبيرة)', money: true },
      { key: 'priceL2', label: 'سعر البيع (صغيرة)', money: true },
      { key: 'buyL1', label: 'سعر الشراء (كبيرة)', money: true },
      { key: 'value', label: 'القيمة', money: true, total: true },
      { key: 'status', label: 'الحالة', html: (r) => pill(r.status), get: (r) => r.status },
    ], { sort: { key: 'name', dir: 1 }, name: 'المخزن', onClick: canAdmin() ? (r) => forms().itemEditor(P.items.find((i) => i.id === r.id)) : null }))}
    ${canAdmin() ? '<p class="muted">دوس على أي مادة حتى تعدّل أسعارها.</p>' : ''}`;
}

function viewCash() {
  const P = state.P;
  const b = C.cashBox(P, state.filter);
  const line = (label, v, sign) => ({ label, v: sign * v });
  const rows = [
    line('مبيعات نقدي', b.cashSales, 1),
    line('مدفوع مع القوائم', b.paidWithInvoices, 1),
    line('تسديدات من الزبائن', b.receipts, 1),
    line('مشتريات نقدي', b.cashPurchases, -1),
    line('مدفوعات (تسديد موردين ومصاريف)', b.payments, -1),
  ];
  return `${actionBar([['newReceipt', '+ وصل قبض'], ['newPayment', '+ وصل دفع / مصروف']])}<div class="grid kpis">
      ${kpi('الداخل', b.totalIn)}${kpi('الطالع', b.totalOut)}${kpi('الصافي', b.net, periodLabel())}
    </div>
    ${section('حركة الصندوق', table(rows, [
      { key: 'label', label: 'البند' },
      { key: 'v', label: 'المبلغ', money: true, total: true },
    ], { name: 'الصندوق' }), { search: false })}
    <div class="grid two">
      <div>${section('مبيعات نقدي حسب الكاشير', table(b.byUser.map(([u, t]) => ({ u, t })), [
        { key: 'u', label: 'الكاشير' },
        { key: 't', label: 'المبلغ', money: true, total: true },
      ], { name: 'نقدي حسب الكاشير' }), { search: false })}</div>
      <div>${section('المدفوعات حسب النوع', table(b.paymentsByClass.map(([c, t]) => ({ c, t })), [
        { key: 'c', label: 'النوع' },
        { key: 't', label: 'المبلغ', money: true, total: true },
      ], { name: 'المدفوعات حسب النوع' }), { search: false })}</div>
    </div>
    ${section('المقبوضات', table(b.receiptList, [
      { key: 'date', label: 'التاريخ' },
      { key: 'no', label: 'رقم الوصل' },
      { key: 'name', label: 'من' },
      { key: 'cls', label: 'النوع' },
      { key: 'note', label: 'ملاحظة' },
      { key: 'amount', label: 'المبلغ', money: true, total: true },
    ], { name: 'المقبوضات', sort: { key: 'date', dir: -1 }, onClick: canAdmin() ? (r) => forms().voucherEditor('receipt', r) : null }))}
    ${section('المدفوعات', table(b.paymentList, [
      { key: 'date', label: 'التاريخ' },
      { key: 'no', label: 'رقم الوصل' },
      { key: 'name', label: 'إلى' },
      { key: 'cls', label: 'النوع' },
      { key: 'note', label: 'ملاحظة' },
      { key: 'amount', label: 'المبلغ', money: true, total: true },
    ], { name: 'المدفوعات', sort: { key: 'date', dir: -1 }, onClick: canAdmin() ? (r) => forms().voucherEditor('payment', r) : null }))}`;
}

function viewPurchases() {
  const P = state.P;
  const f = state.filter;
  const list = P.purchases.filter((p) => C.inRange(p.date, f.from, f.to) && (!f.user || p.user === f.user));
  const sum = (arr) => arr.reduce((a, p) => a + p.total, 0);
  const bySupplier = new Map();
  for (const p of list) bySupplier.set(p.supplier, (bySupplier.get(p.supplier) || 0) + p.total);
  return `${actionBar([['newPurchase', '+ قائمة شراء']])}<div class="grid kpis">
      ${kpi('المشتريات', sum(list), `${list.length} قائمة — ${periodLabel()}`)}
      ${kpi('نقدي', sum(list.filter((p) => p.type === C.CASH)))}
      ${kpi('آجل', sum(list.filter((p) => p.type === C.CREDIT)))}
    </div>
    ${section('قوائم الشراء', table(list.map((p) => ({ ...p, n: p.lines.length })), [
      { key: 'id', label: 'رقم', num: true },
      { key: 'no', label: 'رقم قائمة المورد' },
      { key: 'date', label: 'التاريخ' },
      { key: 'type', label: 'النوع' },
      { key: 'supplier', label: 'المورد' },
      { key: 'user', label: 'المستخدم' },
      { key: 'n', label: 'عدد المواد', num: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
    ], { onClick: (r) => invoiceModal(r, 'purchase'), sort: { key: 'id', dir: -1 }, name: 'المشتريات' }))}
    ${section('المشتريات حسب المورد', table([...bySupplier].map(([s, t]) => ({ s, t })), [
      { key: 's', label: 'المورد' },
      { key: 't', label: 'المبلغ', money: true, total: true },
    ], { name: 'المشتريات حسب المورد' }), { search: false })}`;
}

function viewProfit() {
  const P = state.P;
  const pr = C.profit(P, state.filter);
  return `<div class="grid kpis">
      ${kpi('المبيعات', pr.revenue)}${kpi('الكلفة', pr.cost)}${kpi('ربح المواد', pr.gross)}
      ${kpi('المصاريف', pr.expenseTotal)}${kpi('الصافي', pr.net, periodLabel())}
    </div>
    <p class="muted">الكلفة = سعر الشراء المسجل ويه كل سطر بيع (أو سعر الشراء الحالي للمادة إذا ما مسجل).
      ${pr.unknown ? `مبيعات بمبلغ ${fmt(pr.unknown)} ما انحسب ربحها لأن المادة أو الوحدة مو موجودة بقائمة المواد.` : ''}</p>
    ${section('الربح حسب المادة', table(pr.items, [
      { key: 'item', label: 'المادة' },
      { key: 'qty', label: 'الكمية', num: true },
      { key: 'revenue', label: 'المبيعات', money: true, total: true },
      { key: 'cost', label: 'الكلفة', money: true, total: true },
      { key: 'profit', label: 'الربح', money: true, total: true },
      { key: 'margin', label: 'نسبة الربح', html: (r) => pct(r.margin), get: (r) => r.margin },
    ], { name: 'الأرباح' }))}
    ${section('المصاريف', table(pr.expenses, [
      { key: 'date', label: 'التاريخ' },
      { key: 'cls', label: 'النوع' },
      { key: 'note', label: 'ملاحظة' },
      { key: 'amount', label: 'المبلغ', money: true, total: true },
    ], { name: 'المصاريف' }), { search: false })}`;
}

function viewChecks() {
  const P = state.P;
  const today = localDay();
  const out = [];
  const add = (kind, what, ref, open) => out.push({ kind, what, ref, open });
  for (const s of P.sales) {
    if (s.date > today) add('تاريخ بالمستقبل', `قائمة بيع رقم ${s.id} تاريخها ${s.date} (انكتبت ${s.time.slice(0, 10)})`, s.id, () => invoiceModal(s));
    if (s.type === C.CREDIT && !s.customer) add('آجل بدون زبون', `قائمة بيع آجل رقم ${s.id} بمبلغ ${fmt(s.total)} بدون اسم زبون`, s.id, () => invoiceModal(s));
    if (!s.lines.length) add('قائمة فارغة', `قائمة بيع رقم ${s.id} (${s.date}) ما بيها مواد`, s.id, () => invoiceModal(s));
  }
  for (const p of P.purchases) {
    if (p.date > today) add('تاريخ بالمستقبل', `قائمة شراء رقم ${p.id} تاريخها ${p.date} (انكتبت ${p.time.slice(0, 10)})`, p.id, () => invoiceModal(p, 'purchase'));
  }
  const seen = new Set();
  for (const l of P.saleLines) {
    const it = P.itemByName.get(l.item);
    const key = l.item + '|' + l.unit;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!it) add('مادة مو موجودة', `"${l.item}" مبيوعة بس مو موجودة بقائمة المواد (ما تنحسب بالمخزن)`, '', null);
    else if (l.unit !== it.unitL1 && l.unit !== it.unitL2) add('وحدة غلط', `"${l.item}" مبيوعة بوحدة "${l.unit || 'فارغة'}" والمادة وحداتها ${it.unitL1}/${it.unitL2}`, '', null);
  }
  for (const it of P.items) {
    if (!it.priceL1 && !it.priceL2) add('سعر صفر', `المادة "${it.name}" ما عندها سعر بيع`, '', null);
    if (it.unitL1 && it.unitL1 === it.unitL2) add('وحدتين بنفس الاسم', `المادة "${it.name}" وحدتها الكبيرة والصغيرة "${it.unitL1}" — رصيدها بحساباتي ينحسب مرتين`, '', null);
  }
  const known = new Set(P.customers.map((c) => c.name));
  for (const n of new Set(P.sales.filter((s) => s.type === C.CREDIT && s.customer).map((s) => s.customer))) {
    if (!known.has(n)) add('زبون مو معرّف', `"${n}" عنده قوائم آجل بس مو موجود بقائمة الزبائن`, '', null);
  }
  return `<p class="muted">أشياء لكيتها بالبيانات تستاهل تشوفها وتصلّحها بحساباتي. هذا البرنامج ما يغيّر شي بالملف.</p>
    ${section(`ملاحظات (${out.length})`, table(out, [
      { key: 'kind', label: 'النوع' },
      { key: 'what', label: 'التفاصيل' },
    ], { onClick: (r) => r.open?.(), empty: 'ما لكيت أي مشكلة', name: 'ملاحظات البيانات' }))}`;
}

// ---------- quick sale & settings pages (server mode) ----------

let afterRender = [];
const onAfter = (fn) => afterRender.push(fn);

let POS = null;
const pos = () =>
  (POS ??= setupPos({ $, $$, esc, fmt, money, localDay, state, write, toast, forms, icon, onAfter, C, store }));
let SET = null;
const settings = () =>
  (SET ??= setupSettings({ $, $$, esc, api, state, toast, icon, onAfter, readServer, guarded, setupScreen }));

// ---------- navigation ----------

// server: needs server.ps1 (signed in); admin: managers only.
const NAV = [
  { group: 'البيع' },
  { id: 'pos', label: 'بيع سريع', server: true },
  { id: 'home', label: 'الرئيسية', admin: true },
  { id: 'sales', label: 'المبيعات' },
  { id: 'purchases', label: 'المشتريات', admin: true },
  { group: 'الحسابات' },
  { id: 'customers', label: 'الزبائن' },
  { id: 'suppliers', label: 'الموردين', admin: true },
  { id: 'cash', label: 'الصندوق', admin: true },
  { id: 'profit', label: 'الأرباح', admin: true },
  { group: 'المخزن' },
  { id: 'stock', label: 'المخزن والأسعار' },
  { id: 'checks', label: 'ملاحظات البيانات', admin: true },
  { group: 'النظام', server: true, admin: true },
  { id: 'settings', label: 'الإعدادات', server: true, admin: true },
];

const TITLES = {
  pos: ['بيع سريع', 'اختار المواد، وبعدين احفظ القائمة'],
  home: ['الرئيسية', ''],
  sales: ['المبيعات', ''],
  purchases: ['المشتريات', ''],
  customers: ['الزبائن', 'الأرصدة وكشوفات الحساب'],
  suppliers: ['الموردين', 'الأرصدة وكشوفات الحساب'],
  stock: ['المخزن والأسعار', 'رصيد كل مادة وأسعارها'],
  cash: ['الصندوق', ''],
  profit: ['الأرباح', ''],
  checks: ['ملاحظات البيانات', 'أشياء تستاهل تصلّحها بحساباتي'],
  settings: ['الإعدادات', ''],
};

// In read-only mode everything readable is open; signed in, cashiers see less.
const visible = (n) => (n.server ? state.server && (!n.admin || state.admin) : !state.server || !n.admin || state.admin);

function buildNav() {
  const items = NAV.filter(visible);
  // drop group headings with nothing under them
  const out = items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
  $('#nav').innerHTML = out
    .map((n) => (n.group ? `<div class="group">${esc(n.group)}</div>` : `<button data-view="${n.id}">${icon(n.id)}<span>${esc(n.label)}</span></button>`))
    .join('');
}

function go(view) {
  if (!NAV.some((n) => n.id === view && visible(n))) view = state.server && !state.admin ? 'pos' : 'home';
  state.view = view;
  $('#app').classList.remove('menu-open');
  render();
  $('#main').scrollTop = 0;
  window.scrollTo(0, 0);
}

const views = {
  pos: () => pos().view(),
  home: viewHome,
  sales: viewSales,
  purchases: viewPurchases,
  customers: () => viewPeople('customer'),
  suppliers: () => viewPeople('supplier'),
  stock: viewStock,
  cash: viewCash,
  profit: viewProfit,
  checks: viewChecks,
  settings: () => settings().view(),
};
const periodViews = new Set(['home', 'sales', 'purchases', 'cash', 'profit']);

function render() {
  if (!state.P) return;
  if (!NAV.some((n) => n.id === state.view && visible(n))) state.view = state.server && !state.admin ? 'pos' : 'home';
  tables.clear();
  pendingActions = [];
  afterRender = [];
  const period = periodViews.has(state.view);
  $('#filters').hidden = !period;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  const [title, sub] = TITLES[state.view] || ['', ''];
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = period ? periodLabel() : sub;
  $('#main').innerHTML = views[state.view]();
  $('#pageActions').innerHTML = pendingActions
    .map(([id, label]) => `<button class="btn primary" data-act="${id}">${esc(label)}</button>`)
    .join('');
  $('#shopTitle').textContent = state.shopName || 'لوحة المحل';
  for (const fn of afterRender) fn();
  $('#goLast')?.addEventListener('click', () => {
    state.preset = '';
    state.filter.from = state.filter.to = state.P.lastDate;
    $('#from').value = $('#to').value = state.P.lastDate;
    $$('#presets button').forEach((b) => b.classList.remove('on'));
    render();
  });
}

// ---------- wiring ----------

function init() {
  $('#btnOpen').onclick = openFile;
  $('#btnReload').innerHTML = `${icon('refresh')} تحديث`;
  $('#btnReload').onclick = reload;
  $('#btnLogout').innerHTML = icon('logout', 'flip');
  $('#btnLogout').onclick = async () => {
    try {
      await api('/api/logout', { method: 'POST', body: {} });
    } catch {
      /* signed out locally either way */
    }
    signedOut();
  };
  $('#btnMenu').innerHTML = icon('menu');
  $('#btnMenu').onclick = () => $('#app').classList.toggle('menu-open');
  $('#scrim').onclick = () => $('#app').classList.remove('menu-open');
  $('#nav').onclick = (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) go(b.dataset.view);
  };
  $('#auto').onchange = (e) => setAuto(e.target.checked);
  $('#fileInput').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) await guarded(async () => readBuffer(await f.arrayBuffer(), f.name));
    e.target.value = '';
  };
  $('#presets').onclick = (e) => {
    const b = e.target.closest('button[data-p]');
    if (b) applyPreset(b.dataset.p);
  };
  const custom = () => {
    state.preset = '';
    $$('#presets button').forEach((b) => b.classList.remove('on'));
    render();
  };
  $('#from').onchange = (e) => ((state.filter.from = e.target.value), custom());
  $('#to').onchange = (e) => ((state.filter.to = e.target.value), custom());
  $('#user').onchange = (e) => ((state.filter.user = e.target.value), render());

  // An open entry form only closes from its own buttons, so a stray click
  // outside it doesn't throw away what was typed.
  const formOpen = () => !!$('#modal .form-actions [id$="Save"]');
  $('#modalClose').onclick = closeModal;
  $('#modal').onclick = (e) => e.target.id === 'modal' && !formOpen() && closeModal();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !formOpen()) closeModal();
    if (e.key === 'F2' && state.server && state.P) {
      e.preventDefault();
      closeModal();
      go('pos');
    }
  });
  applyPreset('today', { draw: false });

  const auto = store.get('lawha-auto') !== '0';
  $('#auto').checked = auto;

  detectServer().then(async (ping) => {
    if (!ping) {
      $('#auto').checked = false;
      return fileScreen();
    }
    state.server = true;
    state.test = !!ping.test;
    state.version = ping.version || '';
    state.shopName = ping.shopName || '';
    document.title = state.shopName || 'لوحة المحل';
    setAuto(auto);
    if (!ping.configured) return setupScreen();
    if (state.token) {
      try {
        return signedIn(await api('/api/me'));
      } catch {
        /* expired: sign in again */
      }
    }
    loginScreen();
  });
}

init();
