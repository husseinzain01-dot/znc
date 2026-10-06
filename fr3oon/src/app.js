// Fr3oon — the interface. Served by the program's helper (server.ps1) on
// this computer, or by the main computer's to a second device. It walks a
// new installation through activation and setup, signs users in, shows the
// reports and sends every save to the helper.
import { loadDatabase } from './load.js';
import * as C from './calc.js';
import { setupForms } from './forms.js';
import { setupPos } from './pos.js';
import { setupSettings } from './settings.js';
import { setupReports } from './reports.js';
import { lowStockCount } from './analysis.js';
import { setupAnalytics } from './analytics.js';
import { setupStockCount } from './stockcount.js';
import { setupLabels } from './labels.js';
import { setupActivity } from './activity.js';
import { icon, LOGO } from './icons.js';
import { databasePicker } from './picker.js';
import { installScanner } from './scanner.js';
import { readerFromTables } from './fulltest.js';

const APP = 'Fr3oon';
const LOCAL_URL = 'http://localhost:8770/';
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
const noName = (s) => s || '(بلا اسم)';
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
  loadedAt: null,
  timer: null,
  server: false, // signed in through the helper: can save
  test: false,
  version: '',
  token: store.get('fr3oon-token'),
  user: '',
  admin: false,
  perms: [],
  shopName: '',
  stockByName: null,
};

// ---------- loading ----------

async function showData(P, { quiet = false } = {}) {
  state.P = P;
  state.stockByName = new Map(C.stock(P).map((x) => [x.name, x]));
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

async function reload() {
  return guarded(() => readServer());
}

async function guarded(fn) {
  const btn = $('#btnReload');
  btn.disabled = true;
  $('#fileStatus').textContent = 'جارٍ تحديث البيانات…';
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
  const msg = 'تعذّرت قراءة البيانات: ' + (e?.message || e);
  if ($('#app').hidden) {
    toast(msg, true);
    return;
  }
  openModal(`<h2>حدث خطأ</h2><p class="notice error">${esc(msg)}</p>`);
}

function status() {
  const s = $('#fileStatus');
  if (!state.P) {
    s.textContent = '';
    return;
  }
  const t = state.loadedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  s.textContent = `${state.test ? 'وضع التجربة — ' : ''}آخر تحديث ${t}`;
}

function setAuto(on) {
  clearInterval(state.timer);
  state.timer = null;
  store.set('fr3oon-auto', on ? '1' : '0');
  if (on)
    state.timer = setInterval(() => {
      // skip a tick while a read is still going
      if (state.server && state.token && !reading) refreshData({ quiet: true }).catch((e) => console.warn('auto refresh failed', e));
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

// ---------- the helper (server.ps1) ----------

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Lawha': '1', 'X-Token': state.token || '' };
  if (body) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(path, { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(`لا يمكن الاتصال ببرنامج ${APP}. أغلق البرنامج ثم افتحه من جديد.`);
  }
  if (r.status === 401) {
    signedOut();
    throw new Error('انتهت الجلسة، سجّل الدخول من جديد');
  }
  const j = await r.json().catch(() => ({ ok: false, error: 'ردّ غير مفهوم من البرنامج' }));
  if (!j.ok) {
    const e = new Error(j.error || 'حدث خطأ');
    e.license = !!j.license;
    throw e;
  }
  return j;
}

// This page comes from the main computer's program over the network (a
// second device), not from this computer's own.
const isRemote = () => !['localhost', '127.0.0.1'].includes(location.hostname);

// The data, as compact JSON read by the helper from the database.
// A database on another computer, or this device reaching the main one over
// a network or VPN, can falter for a moment: try again a few times, waiting
// a little longer each time, before saying it failed.
async function readServer({ quiet = false } = {}) {
  const waits = [700, 1500, 3000];
  for (let i = 0; ; i++) {
    try {
      const j = await api('/api/data');
      const out = await showData(C.prepare(loadDatabase(readerFromTables(j.tables))), { quiet });
      refreshMe();
      return out;
    } catch (e) {
      if (i >= waits.length || e.license || /سجّل الدخول/.test(e.message)) throw e;
      if ($('#fileStatus')) $('#fileStatus').textContent = `الاتصال بطيء، إعادة المحاولة (${i + 1})…`;
      await sleep(waits[i]);
    }
  }
}

// Re-reading after saves: one read at a time. Asked while one is running
// (sales saved back to back), a single further read follows and covers
// them all.
let reading = null;
let queued = null;
function refreshData(opts = {}) {
  if (!reading) {
    reading = readServer(opts).finally(() => {
      reading = null;
    });
    return reading;
  }
  queued ??= reading.catch(() => {}).then(() => {
    queued = null;
    return refreshData({ quiet: true });
  });
  return queued;
}

// Saves through the helper, then re-reads. With background, the caller gets
// the result straight away and the data refreshes behind it.
async function write(op, data, { background = false } = {}) {
  const j = await api('/api/write', { method: 'POST', body: { op, data } });
  const refreshed = refreshData({ quiet: background }).catch((e) => toast('تم الحفظ، لكن تعذّر تحديث الشاشة: ' + e.message, true));
  if (!background) await refreshed;
  return j.result || {};
}

async function detectServer() {
  if (!location.protocol.startsWith('http')) return null;
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
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

const versionLine = () => `<p class="muted version-line">${APP} ${esc(state.version)}${state.test ? ' — وضع التجربة' : ''}</p>`;

// Where to begin, from what the helper says about this installation.
async function startScreen(st) {
  st = st || (await detectServer());
  if (!st) {
    return screen(`<h1>${APP}</h1><p class="notice error">لا يمكن الاتصال بالبرنامج. أغلقه ثم افتحه من أيقونته على سطح المكتب.</p>`);
  }
  state.server = true;
  state.test = !!st.test;
  state.version = st.version || '';
  state.shopName = st.shopName || '';
  document.title = state.shopName ? `${state.shopName} — ${APP}` : APP;
  if (isRemote()) return loginScreen();
  const params = new URLSearchParams(location.search);
  if (params.has('unlink')) return unlinkRemote();
  if (st.remoteUrl) return linkedScreen(st, params.has('remote-down'));
  if (!st.licensed) return st.configured || st.licenseExpired ? activationScreen(st) : welcomeScreen(st);
  if (!st.configured) return setupScreen(st);
  if (state.token) {
    try {
      return signedIn(await api('/api/me'));
    } catch {
      /* expired: sign in again */
    }
  }
  loginScreen();
}

// A new installation: the main computer (database here, activation) or a
// second device that works on the main computer's data.
function welcomeScreen(st) {
  screen(`<h1>مرحباً بك في ${APP}</h1>
    <p class="muted">نظام لإدارة المبيعات والمشتريات والمخزون والحسابات. اختر طريقة استخدام هذا الجهاز:</p>
    <div class="choice-list">
      <button class="choice" id="wMain">${icon('stock')}<span><b>هذا هو الجهاز الرئيسي</b><small>تُحفظ قاعدة البيانات على هذا الجهاز. يحتاج إلى تفعيل.</small></span></button>
      <button class="choice" id="wSecond">${icon('customers')}<span><b>جهاز إضافي</b><small>يتصل بالجهاز الرئيسي في المحل ويعمل على بياناته.</small></span></button>
    </div>
    ${versionLine()}`, true);
  $('#wMain').onclick = () => activationScreen(st);
  $('#wSecond').onclick = () => connectScreen(st);
}

function activationScreen(st, error = '') {
  const err = error || (st.licenseExpired ? st.licenseError : '');
  screen(`<h1>تفعيل ${APP}</h1>
    <p class="muted">أرسل رمز هذا الجهاز إلى مزوّد البرنامج، وسيرسل إليك مفتاح التفعيل الخاص به.</p>
    <div class="machine-code"><small>رمز هذا الجهاز</small><b dir="ltr" id="aCode">${esc(st.machine || '')}</b>
      <button class="btn small" id="aCopy">${icon('file')} نسخ الرمز</button></div>
    <label class="field">مفتاح التفعيل
      <textarea id="aKey" dir="ltr" rows="4" placeholder="الصق مفتاح التفعيل هنا"></textarea></label>
    ${err ? `<p class="notice error">${esc(err)}</p>` : ''}
    <button class="btn primary big block" id="aGo">تفعيل</button>
    ${st.configured ? '' : '<button class="btn block" id="aBack" style="margin-top:8px">رجوع</button>'}
    ${versionLine()}`, true);
  $('#aCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(st.machine);
      toast('نُسخ الرمز ✔');
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('#aCode'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('حدّد الرمز وانسخه بـ Ctrl+C');
    }
  };
  if ($('#aBack')) $('#aBack').onclick = () => welcomeScreen(st);
  $('#aGo').onclick = async (e) => {
    const key = $('#aKey').value.trim();
    if (!key) return $('#aKey').focus();
    e.currentTarget.disabled = true;
    try {
      const j = await api('/api/activate', { method: 'POST', body: { key } });
      toast(`تم التفعيل ✔ ${j.name || ''}`);
      startScreen();
    } catch (err2) {
      activationScreen(st, err2.message);
    }
  };
  $('#aKey').focus();
}

// A second device: use the main computer's program instead of a database here.
function connectScreen(st, error = '') {
  screen(`<h1>الاتصال بالجهاز الرئيسي</h1>
    <p class="muted">يعمل هذا الجهاز على بيانات الجهاز الرئيسي في المحل، عبر الشبكة أو VPN، ويُحفظ كل شيء هناك.
      يجب أن يكون ${APP} مفتوحاً على الجهاز الرئيسي، وأن يفعّل المدير فيه «السماح للأجهزة الأخرى بالاتصال» من الإعدادات.</p>
    <label class="field">اسم الجهاز الرئيسي أو عنوانه (IP)
      <input id="cTarget" dir="ltr" placeholder="SHOP-PC  أو  192.168.1.10"></label>
    ${error ? `<p class="notice error">${esc(error)}</p>` : ''}
    <button class="btn primary big block" id="cGo">اتصال</button>
    <button class="btn block" id="cBack" style="margin-top:8px">رجوع</button>
    ${versionLine()}`, true);
  $('#cBack').onclick = () => (st.licensed ? startScreen() : welcomeScreen(st));
  const go2 = async () => {
    const target = $('#cTarget').value.trim();
    if (!target) return $('#cTarget').focus();
    $('#cGo').disabled = true;
    $('#cGo').textContent = 'جارٍ الاتصال…';
    try {
      const j = await api('/api/remote', { method: 'POST', body: { target } });
      location.href = j.url;
    } catch (e) {
      connectScreen(st, e.message);
      $('#cTarget').value = target;
    }
  };
  $('#cGo').onclick = go2;
  $('#cTarget').onkeydown = (e) => e.key === 'Enter' && go2();
  $('#cTarget').focus();
}

// This device opens the main computer's program; shown when the main
// computer did not answer, or to undo the link.
function linkedScreen(st, down = false) {
  screen(`<h1>${APP}</h1>
    ${down ? `<p class="notice error">لم يردّ الجهاز الرئيسي (<span dir="ltr">${esc(st.remoteUrl)}</span>). تأكّد أنه يعمل و${APP} مفتوح عليه، وأن الشبكة أو VPN متصلة.</p>` : ''}
    <div class="login-file"><small class="muted">هذا الجهاز متصل بالجهاز الرئيسي</small><code dir="ltr">${esc(st.remoteUrl)}</code></div>
    <a class="btn primary big block" href="${esc(st.remoteUrl)}" style="margin-top:12px">فتح الجهاز الرئيسي</a>
    <button class="btn block" id="lUnlink" style="margin-top:8px">إلغاء الربط</button>
    ${versionLine()}`);
  $('#lUnlink').onclick = () => unlinkRemote();
}

// First time on the main computer: the shop, its manager, and where the
// database and its backups go.
function setupScreen(st, error = '', keep = {}) {
  const v = (k, d = '') => esc(keep[k] ?? d);
  screen(`<h1>إعداد المحل</h1>
    <p class="muted">تُنشأ قاعدة بيانات جديدة لمحلّك على هذا الجهاز. يمكنك تغيير هذه الإعدادات لاحقاً.</p>
    <form id="sForm" class="setup-form" autocomplete="off">
      <label class="field">اسم المحل <input id="sShop" maxlength="60" value="${v('shopName')}" required></label>
      <div class="form-grid">
        <label class="field">اسم المدير <input id="sAdmin" maxlength="45" value="${v('admin', 'المدير')}" required></label>
        <label class="field">كلمة المرور <input id="sPass" type="password" minlength="4" required></label>
        <label class="field">تأكيد كلمة المرور <input id="sPass2" type="password" minlength="4" required></label>
      </div>
      <label class="field">مجلد قاعدة البيانات
        <span class="row path-row"><input id="sDb" dir="ltr" value="${v('dbDir', st.defaultDbDir)}"><button type="button" class="btn" data-pick="sDb">اختيار…</button></span></label>
      <label class="field">مجلد النسخ الاحتياطي اليومي
        <span class="row path-row"><input id="sBk" dir="ltr" value="${v('backupDir', st.defaultBackupDir)}"><button type="button" class="btn" data-pick="sBk">اختيار…</button></span></label>
      <p class="muted" style="font-size:13px">يُنسخ الملف تلقائياً إلى مجلد النسخ الاحتياطي كل يوم. يُفضّل أن يكون على قرص آخر أو ذاكرة خارجية.</p>
      ${error ? `<p class="notice error">${esc(error)}</p>` : ''}
      <button class="btn primary big block" type="submit" id="sGo">إنشاء قاعدة البيانات</button>
    </form>
    <button class="btn block" id="sOpen" style="margin-top:8px">${icon('file')} لديّ قاعدة بيانات موجودة (${APP} أو حساباتي): فتحها</button>
    ${versionLine()}`, true);
  $$('[data-pick]').forEach((b) => {
    b.onclick = async () => {
      try {
        const j = await api('/api/choose-folder', { method: 'POST', body: {} });
        $('#' + b.dataset.pick).value = j.dir;
      } catch (e) {
        toast(e.message, true);
      }
    };
  });
  $('#sOpen').onclick = () => openDbScreen();
  $('#sForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      shopName: $('#sShop').value.trim(), admin: $('#sAdmin').value.trim(), password: $('#sPass').value,
      dbDir: $('#sDb').value.trim(), backupDir: $('#sBk').value.trim(),
    };
    if (body.password !== $('#sPass2').value) return setupScreen(st, 'كلمتا المرور غير متطابقتين', body);
    $('#sGo').disabled = true;
    $('#sGo').textContent = 'جارٍ الإنشاء…';
    try {
      await api('/api/setup', { method: 'POST', body });
      toast('أُنشئت قاعدة البيانات ✔');
      store.set('fr3oon-last-user', body.admin);
      startScreen();
    } catch (err) {
      setupScreen(st, err.message, body);
    }
  };
  $('#sShop').focus();
}

// Opening an existing Fr3oon database (moved computers, reinstalled
// Windows, or another copy). Users may differ, so everyone signs in again.
function openDbScreen() {
  screen(`<h1>فتح قاعدة بيانات</h1>
    <p class="muted">اختر ملف قاعدة بيانات ${APP} (<code>fr3oon.accdb</code>)، أو قاعدة بيانات برنامج حساباتي (مثل <code>Units2026.accdb</code>) ليعمل عليها ${APP} مباشرة.</p>
    <div id="setupPicker"></div>
    <button class="btn block" id="pkBack" style="margin-top:12px">رجوع بدون تغيير</button>`, true);
  $('#pkBack').onclick = () => startScreen();
  databasePicker({ esc, api, icon }, $('#setupPicker'), async (j) => {
    if (j.hisabati) return linkHisabatiScreen(j);
    toast('فُتحت قاعدة البيانات: ' + j.file);
    try {
      await api('/api/logout', { method: 'POST', body: {} });
    } catch {
      /* signed out locally either way */
    }
    signedOut();
  }, { auto: true });
}

// A حساباتي database: Fr3oon works on it directly once linked (its own
// tables added, حساباتي's users brought over), after a safety copy.
function linkHisabatiScreen(info, error = '', keep = {}) {
  const users = info.users || [];
  const v = (k, d = '') => esc(keep[k] ?? d);
  screen(`<h1>ربط قاعدة بيانات حساباتي</h1>
    <p class="muted">هذا الملف قاعدة بيانات برنامج «حساباتي». يعمل ${APP} عليها مباشرة، ويبقى حساباتي يعمل عليها كالمعتاد في الوقت نفسه.</p>
    <div class="link-file">
      <code dir="ltr">${esc(info.path)}</code>
      <div class="db-facts">
        <span><small class="muted">الأصناف</small><b class="num">${fmt(info.items)}</b></span>
        <span><small class="muted">فواتير البيع</small><b class="num">${fmt(info.sales)}</b></span>
        <span><small class="muted">العملاء</small><b class="num">${fmt(info.customers)}</b></span>
        <span><small class="muted">الموردون</small><b class="num">${fmt(info.suppliers)}</b></span>
        <span><small class="muted">المستخدمون</small><b class="num">${fmt(users.length)}</b></span>
      </div>
    </div>
    <ul class="link-steps">
      <li>تُؤخذ نسخة من الملف أولاً في مجلد النسخ الاحتياطي.</li>
      <li>تُضاف جداول ${APP} الخاصة (المستخدمون، الإعدادات، سجل العمليات، الجرد) دون تغيير أي شيء من بيانات حساباتي.</li>
      <li>${users.length ? 'يُنقل مستخدمو حساباتي بكلمات مرورهم. المستخدم الذي تختاره أدناه يكون المدير، والباقون يبيعون نقداً ويطبعون، ويمكنك تعديل صلاحياتهم من الإعدادات.' : 'لا يوجد مستخدمون في حساباتي: أنشئ حساب المدير أدناه.'}</li>
    </ul>
    <form id="hForm" class="setup-form" autocomplete="off">
      <label class="field">اسم المحل <input id="hShop" maxlength="60" value="${v('shopName')}" required></label>
      <div class="form-grid">
        <label class="field">${users.length ? 'المدير (من مستخدمي حساباتي)' : 'اسم المدير'}
          ${users.length
            ? `<select id="hAdmin">${users.map((u) => `<option${u === keep.admin ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>`
            : `<input id="hAdmin" maxlength="45" value="${v('admin', 'المدير')}">`}</label>
        <label class="field">${users.length ? 'كلمة مروره في حساباتي' : 'كلمة المرور'} <input id="hPass" type="password" required></label>
      </div>
      ${error ? `<p class="notice error">${esc(error)}</p>` : ''}
      <button class="btn primary big block" type="submit" id="hGo">ربط والبدء</button>
    </form>
    <button class="btn block" id="hBack" style="margin-top:8px">رجوع</button>
    ${versionLine()}`, true);
  $('#hBack').onclick = () => openDbScreen();
  $('#hForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = { path: info.path, shopName: $('#hShop').value.trim(), admin: $('#hAdmin').value.trim(), password: $('#hPass').value };
    $('#hGo').disabled = true;
    $('#hGo').textContent = 'جارٍ الربط…';
    try {
      const j = await api('/api/link-hisabati', { method: 'POST', body });
      store.set('fr3oon-last-user', body.admin);
      alert(`تم ربط قاعدة البيانات ✔\nحُفظت نسخة منها قبل الربط في:\n${j.copy}${j.skipped?.length ? `\n\nلم يُنقل (بلا كلمة مرور في حساباتي): ${j.skipped.join('، ')}` : ''}`);
      state.token = '';
      store.set('fr3oon-token', '');
      startScreen();
    } catch (err) {
      linkHisabatiScreen(info, err.message, body);
    }
  };
  $('#hShop').focus();
}

async function loginScreen(error = '', chosen = '') {
  let users = [];
  try {
    users = (await api('/api/users')).users || [];
  } catch (e) {
    if (e.license) return startScreen();
    return screen(`<h1>${APP}</h1><p class="notice error">${esc(e.message)}</p>
      <button class="btn primary block" id="btnRetry">${icon('refresh')} إعادة المحاولة</button>`);
  }
  const last = chosen || store.get('fr3oon-last-user');
  const info = isRemote() ? {} : (await detectServer()) || {};
  // another database may have been opened: its own shop name
  if (info.shopName != null) {
    state.shopName = info.shopName;
    document.title = state.shopName ? `${state.shopName} — ${APP}` : APP;
  }
  screen(`<h1>${esc(state.shopName || APP)}</h1>
    <p class="muted">سجّل الدخول باسم المستخدم وكلمة المرور</p>
    <form id="loginForm" autocomplete="off">
      <label class="field">المستخدم
        ${users.length
          ? `<select id="lUser">${users.map((u) => `<option${u === last ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>`
          : `<input id="lUser" placeholder="اسم المستخدم" value="${esc(last)}">`}
      </label>
      <label class="field">كلمة المرور <input id="lPass" type="password" autocomplete="current-password"></label>
      ${error ? `<p class="notice error" style="margin:0">${esc(error)}</p>` : ''}
      <button class="btn primary big block" type="submit" id="lGo">دخول</button>
    </form>
    ${isRemote() ? `<div class="login-file">
      <small class="muted">متصل بالجهاز الرئيسي</small>
      <code dir="ltr">${esc(location.host)}</code>
      <a class="btn small" href="${LOCAL_URL}?unlink=1">${icon('file')} إلغاء الربط والعودة إلى هذا الجهاز</a>
    </div>` : ''}
    ${info.dbPath ? `<div class="login-file">
      <small class="muted">قاعدة البيانات</small>
      <code dir="ltr">${esc(info.dbPath)}</code>
      ${/^\\\\/.test(info.dbPath) ? `<p class="notice info">قاعدة البيانات على جهاز آخر في الشبكة، وفتحها بهذه الطريقة أبطأ وقد يتعثر. الأسرع والأثبت: شغّل ${APP} على ذلك الجهاز، وفعّل فيه «السماح للأجهزة الأخرى بالاتصال»، ثم اجعل هذا الجهاز «جهازاً إضافياً» متصلاً به.</p>` : ''}
      <button type="button" class="btn small" id="lChange">${icon('file')} فتح قاعدة بيانات أخرى</button>
    </div>` : ''}
    ${versionLine()}`);
  $('#lPass').focus();
  if ($('#btnRetry')) $('#btnRetry').onclick = () => loginScreen();
  if ($('#lChange')) $('#lChange').onclick = () => openDbScreen();
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const j = await api('/api/login', { method: 'POST', body: { user: $('#lUser').value.trim(), password: $('#lPass').value } });
      state.token = j.token;
      store.set('fr3oon-token', j.token);
      store.set('fr3oon-last-user', j.user);
      signedIn(j);
    } catch (err) {
      loginScreen(err.message, $('#lUser').value.trim());
    }
  };
}

// The helper sends permissions as text ("pos,sale_cash,print").
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : []).map(String).filter(Boolean);

function setMe(me) {
  state.admin = !!me.admin;
  state.perms = asList(me.perms);
  $('#whoRole').textContent = me.admin ? 'مدير' : 'مستخدم';
}

// A manager may change someone's permissions while they are signed in: pick
// that up with each refresh instead of waiting for the next sign-in.
async function refreshMe() {
  if (!state.server || !state.token) return;
  try {
    const me = await api('/api/me');
    if (!!me.admin === state.admin && asList(me.perms).join() === state.perms.join()) return;
    setMe(me);
    buildNav();
    render();
  } catch {
    /* the next refresh tries again */
  }
}

// Stop opening the main computer: this device is on its own again.
async function unlinkRemote() {
  try {
    await api('/api/remote', { method: 'POST', body: { target: '' } });
    toast('أُلغي الربط ✔');
  } catch (e) {
    toast(e.message, true);
  }
  history.replaceState(null, '', '/');
  startScreen();
}

function passwordModal() {
  openModal(`<h2>تغيير كلمة المرور</h2>
    <div class="form-grid">
      <label class="field">كلمة المرور الحالية <input id="pwOld" type="password"></label>
      <label class="field">كلمة المرور الجديدة <input id="pwNew" type="password" minlength="4"></label>
      <label class="field">تأكيد كلمة المرور الجديدة <input id="pwNew2" type="password" minlength="4"></label>
    </div>
    <p class="notice error" id="pwErr" hidden></p>
    <div class="form-actions"><button class="btn primary" id="pwSave">حفظ</button><button class="btn" id="pwCancel">إلغاء</button></div>`);
  $('#pwCancel').onclick = closeModal;
  $('#pwOld').focus();
  $('#pwSave').onclick = async () => {
    const err = (m) => {
      $('#pwErr').textContent = m;
      $('#pwErr').hidden = false;
    };
    if ($('#pwNew').value.length < 4) return err('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
    if ($('#pwNew').value !== $('#pwNew2').value) return err('كلمتا المرور غير متطابقتين');
    try {
      await api('/api/password', { method: 'POST', body: { old: $('#pwOld').value, new: $('#pwNew').value } });
      closeModal();
      toast('تم تغيير كلمة المرور ✔');
    } catch (e) {
      err(e.message);
    }
  };
}

async function signedIn(me) {
  state.user = me.user;
  setMe(me);
  $('#who').hidden = false;
  $('#whoName').textContent = me.user;
  // the first letter of the name, after «ال» (المدير → م)
  $('#whoAvatar').textContent = ((me.user || '?').trim().replace(/^ال(?=.)/, '') || '?').charAt(0);
  buildNav();
  POS?.reset();
  state.view = homeView();
  // shop-wide settings everyone needs (the printed receipt)
  api('/api/settings').then((j) => (state.receipt = j.receipt || {})).catch(() => {});
  // a manager on this computer hears about a new version by itself
  if (me.admin && !isRemote()) setTimeout(checkUpdate, 4000);
  screen('<h1>جارٍ تحميل البيانات…</h1><p class="muted">لحظات</p>');
  try {
    await readServer();
  } catch (e) {
    if (!state.token) return;
    if (e.license) return startScreen();
    screen(`<h1>تعذّرت قراءة البيانات</h1><p class="notice error">${esc(e.message)}</p>
      <button class="btn primary block" id="btnRetry">${icon('refresh')} إعادة المحاولة</button>
      ${isRemote() ? '' : `<button class="btn block" id="btnRechoose" style="margin-top:8px">${icon('file')} فتح قاعدة بيانات أخرى</button>`}`);
    $('#btnRetry').onclick = () => signedIn(me);
    if ($('#btnRechoose')) $('#btnRechoose').onclick = () => openDbScreen();
  }
}

async function checkUpdate(tries = 0) {
  try {
    const j = await api('/api/update-status');
    // looked up on the side: ask again a little later
    if (j.pending && tries < 6) setTimeout(() => checkUpdate(tries + 1), 10000);
    $('#updateNote').hidden = !j.available;
    if (j.available) {
      $('#updateNote').innerHTML = `${icon('refresh')}<span><b>يتوفر تحديث</b><small>الإصدار ${esc(j.latest)}</small></span>`;
      $('#updateNote').onclick = () => {
        go('settings');
        setTimeout(() => {
          $('#set-updates')?.scrollIntoView({ block: 'start' });
          $('#upCheck')?.click();
        }, 300);
      };
    }
  } catch {
    /* checked again at the next sign-in */
  }
}

function signedOut() {
  state.token = '';
  store.set('fr3oon-token', '');
  state.user = '';
  state.admin = false;
  state.perms = [];
  state.P = null;
  closeModal();
  loginScreen();
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
  // each date isolated left-to-right inside the Arabic text
  const d = (x) => (x ? `\u2066${x}\u2069` : '…');
  if (from === to) return d(from);
  return `${d(from)} إلى ${d(to)}`;
}

// ---------- generic sortable table ----------

const tables = new Map();
let tableSeq = 0;

// columns: {key, label, num, money, get(row), html(row), total}
function table(rows, columns, { onClick, empty = 'لا توجد بيانات', sort, name = 'تقرير' } = {}) {
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
  const ra = e.target.closest('[data-row-act]');
  if (ra) {
    rowAction(ra);
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
  const cols = t.columns.filter((c) => c.key !== 'act');
  const lines = [cols.map((c) => q(c.label)).join(',')];
  for (const r of t.rows) lines.push(cols.map((c) => q(c.csv ? c.csv(r) : cellValue(c, r))).join(','));
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
  if (!points.length) return '<p class="empty">لا توجد مبيعات في هذه الفترة</p>';
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
  (F ??= setupForms({ $, $$, esc, fmt, localDay, openModal, closeModal, write, state, toast, icon, can }));
const canWrite = () => state.server;
// Signed in: managers can do everything, everyone else what a manager ticked
// for them in Settings. The server checks the same permissions on every save.
const can = (perm) => state.server && (state.admin || state.perms.includes(perm));
const canSell = () => can('sale_cash') || can('sale_credit');
const ACT_PERM = {
  newSale: canSell,
  newPurchase: () => can('purchase'),
  newReceipt: () => can('receipt'),
  newPayment: () => can('payment'),
  newCustomer: () => can('customer_add'),
  newSupplier: () => can('supplier_manage'),
  newItem: () => can('item_manage'),
};
// Views list their buttons here; render() puts them in the page header.
let pendingActions = [];
const actionBar = (buttons) => {
  if (canWrite()) pendingActions.push(...buttons.filter(([id]) => ACT_PERM[id]?.()));
  return '';
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !canWrite()) return;
  const f = forms();
  const a = b.dataset.act;
  if (!ACT_PERM[a]?.()) return toast('ليست لديك صلاحية لذلك. اطلبها من المدير.', true);
  if (a === 'newSale') return go('pos');
  if (a === 'newPurchase') f.invoiceEditor('purchase');
  if (a === 'newReceipt') f.voucherEditor('receipt', null, { name: b.dataset.name });
  if (a === 'newPayment') f.voucherEditor('payment', null, { name: b.dataset.name, cls: b.dataset.cls });
  if (a === 'newCustomer') f.personEditor('customer');
  if (a === 'newSupplier') f.personEditor('supplier');
  if (a === 'newItem') f.itemEditor();
});

// ---------- views ----------

// Print / edit / delete right on each invoice row, so they don't hide
// behind opening the invoice. Each needs its own permission.
const canEditInv = (kind) => can(kind === 'sale' ? 'sale_edit' : 'purchase_edit');
const canDelInv = (kind) => can(kind === 'sale' ? 'sale_delete' : 'purchase_edit');
const invoiceActions = (kind) =>
  canWrite() && ((kind === 'sale' && can('print')) || canEditInv(kind) || canDelInv(kind))
    ? [{
        key: 'act', label: '', get: () => '', csv: () => '',
        html: (r) => `<span class="row-acts">${kind === 'sale' && can('print') ? `<button class="btn small" data-row-act="print" data-kind="sale" data-id="${r.id}" title="طباعة الفاتورة">${icon('print')}</button>` : ''}${canEditInv(kind)
          ? `<button class="btn small" data-row-act="edit" data-kind="${kind}" data-id="${r.id}">${icon('edit')} تعديل</button>` : ''}${canDelInv(kind)
          ? `<button class="btn small danger" data-row-act="del" data-kind="${kind}" data-id="${r.id}">${icon('trash')} حذف</button>`
          : ''}</span>`,
      }]
    : [];

function rowAction(btn) {
  const id = Number(btn.dataset.id);
  const kind = btn.dataset.kind;
  const inv = kind === 'sale' ? state.P.saleById.get(id) : state.P.purchases.find((p) => p.id === id);
  if (!inv) return toast('الفاتورة غير موجودة، حدّث البيانات', true);
  const f = forms();
  const act = btn.dataset.rowAct;
  if (act === 'print' && can('print')) f.printSale(inv);
  if (act === 'edit' && canEditInv(kind)) f.invoiceEditor(kind, inv);
  if (act === 'del' && canDelInv(kind)) f.confirmDelete(kind === 'sale' ? 'deleteSale' : 'deletePurchase', id, `الفاتورة رقم ${id} (${fmt(inv.total)} دينار)`);
}

// Each tile wears the icon of what it counts.
const KPI_ICONS = [
  [/الموردين/, 'suppliers'], [/المشتريات/, 'purchases'], [/العملاء/, 'customers'], [/المخزون/, 'stock'], [/الربح|الصافي$/, 'profit'],
  [/الصندوق|الوارد/, 'cash'], [/الصادر|المصاريف|التكلفة/, 'out'], [/آجل/, 'receipt'], [/نقدي/, 'cash'], [/المبيعات|المجموع/, 'sales'],
];
const kpi = (label, value, hint = '', accent = false) => {
  const ico = KPI_ICONS.find(([re]) => re.test(label))?.[1];
  return `<div class="card kpi${accent ? ' accent' : ''}"><div class="label">${ico ? `<span class="k-ico">${icon(ico)}</span>` : ''}${esc(label)}</div><div class="value">${money(value)}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
};

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
    hint = `<p class="notice">لا توجد مبيعات مسجّلة اليوم. آخر يوم فيه مبيعات: <b>${P.lastDate}</b>
      <button class="btn small" id="goLast">اعرضه</button></p>`;
  }

  // items at their reorder level or sold out while still selling
  const low = can('reports') || !state.server ? lowStockCount(P, localDay()) : 0;
  if (low) {
    hint += `<p class="notice low-alert">${icon('stock')} <span><b>${fmt(low)}</b> ${low === 1 ? 'صنف وصل' : low === 2 ? 'صنفان وصلا' : 'أصناف وصلت'} إلى حد الطلب أو نفدت.</span>
      <button class="btn small" id="goLow">عرض النواقص وطلبية الشراء</button></p>`;
  }

  const topItems = s.byItem.slice(0, 8);
  const maxItem = topItems[0]?.total || 1;
  return `${actionBar([['newSale', '+ فاتورة بيع'], ['newPurchase', '+ فاتورة شراء'], ['newReceipt', '+ سند قبض'], ['newPayment', '+ سند صرف / مصروف']])}${hint}
  <div class="grid kpis">
    ${kpi('المبيعات', s.total, `${s.count} فاتورة — ${periodLabel()}`, true)}
    ${kpi('نقدي', s.cash)}
    ${kpi('آجل', s.credit)}
    ${kpi('إجمالي الربح', pr.gross, `الصافي بعد المصاريف: ${fmt(pr.net)}`)}
    ${kpi('صافي الصندوق', box.net, `الوارد ${fmt(box.totalIn)} — الصادر ${fmt(box.totalOut)}`)}
    ${kpi('تسديدات العملاء', box.receipts)}
  </div>
  <div class="grid kpis" style="margin-top:14px">
    ${kpi('ديون على العملاء (الكل)', owed, 'المجموع حتى الآن')}
    ${kpi('ديون للموردين (الكل)', supp, 'المجموع حتى الآن')}
    ${kpi('قيمة المخزون بسعر الشراء', stockValue)}
  </div>
  <div class="card" style="margin-top:14px">
    <h3>المبيعات حسب اليوم (${start} إلى ${end})</h3>
    ${barChart(pts)}
  </div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><h3>الأصناف الأكثر مبيعاً</h3>
      ${table(topItems, [
        { key: 'item', label: 'الصنف' },
        { key: 'qty', label: 'الكمية', num: true },
        { key: 'total', label: 'المبلغ', money: true },
        { key: 'bar', label: '', html: (r) => `<div class="meter"><span style="width:${(r.total / maxItem) * 100}%"></span></div>` },
      ], { empty: 'لا توجد مبيعات' })}
    </div>
    <div class="card"><h3>المبيعات حسب الكاشير</h3>
      ${table(s.byUser.map(([u, t]) => ({ u, t })), [
        { key: 'u', label: 'الكاشير' },
        { key: 't', label: 'المبلغ', money: true, total: true },
      ], { empty: 'لا توجد مبيعات' })}
    </div>
  </div>`;
}

function invoiceModal(inv, kind = 'sale') {
  const lines = inv.lines.map((l) => ({ ...l, total: l.qty * l.price }));
  const who = kind === 'sale' ? inv.customer : inv.supplier;
  openModal(`<h2>${kind === 'sale' ? 'فاتورة بيع' : 'فاتورة شراء'} رقم ${inv.id}</h2>
    <div class="statement-head">
      <span>${kind === 'sale' ? 'العميل' : 'المورد'}: <b>${esc(noName(who))}</b></span>
      <span>النوع: <b>${esc(inv.type)}</b></span>
      <span>التاريخ: <b>${inv.date}</b></span>
      <span>الوقت: <b>${esc(inv.time.slice(11, 16))}</b></span>
      <span>المستخدم: <b>${esc(inv.user)}</b></span>
      ${inv.paid ? `<span>المدفوع: <b>${fmt(inv.paid)}</b></span>` : ''}
      ${inv.note ? `<span>ملاحظة: <b>${esc(inv.note)}</b></span>` : ''}
    </div>
    ${section('الأصناف', table(lines, [
      { key: 'item', label: 'الصنف' },
      { key: 'qty', label: 'الكمية', num: true },
      { key: 'unit', label: 'الوحدة' },
      { key: 'price', label: 'السعر', money: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
    ], { name: `فاتورة ${inv.id}` }), { search: false })}
    ${canWrite() ? `<div class="form-actions no-print">
      ${kind === 'sale' && can('print') ? `<button class="btn" id="invPrint">${icon('print')} طباعة الفاتورة</button>` : ''}
      ${canEditInv(kind) ? `<button class="btn primary" id="invEdit">${icon('edit')} تعديل</button>` : ''}
      ${canDelInv(kind) ? `<button class="btn danger" id="invDel">${icon('trash')} حذف الفاتورة</button>` : ''}
    </div>` : ''}`);
  if ($('#invPrint')) $('#invPrint').onclick = () => forms().printSale(inv);
  if ($('#invEdit')) $('#invEdit').onclick = () => forms().invoiceEditor(kind, inv);
  if ($('#invDel')) $('#invDel').onclick = () => forms().confirmDelete(kind === 'sale' ? 'deleteSale' : 'deletePurchase', inv.id, `الفاتورة رقم ${inv.id}`);
}

function viewSales() {
  const P = state.P;
  const s = C.salesSummary(P, state.filter);
  const rows = s.list.map((x) => ({ ...x, n: x.lines.length, who: x.type === C.CREDIT ? noName(x.customer) : 'نقدي' }));
  return `${actionBar([['newSale', '+ فاتورة بيع']])}<div class="grid kpis">
      ${kpi('المجموع', s.total, `${s.count} فاتورة`)}${kpi('نقدي', s.cash)}${kpi('آجل', s.credit)}
    </div>
    ${section('الفواتير', table(rows, [
      { key: 'id', label: 'رقم', num: true },
      { key: 'date', label: 'التاريخ' },
      { key: 'tm', label: 'الوقت', get: (r) => r.time.slice(11, 16) },
      { key: 'type', label: 'النوع' },
      { key: 'who', label: 'العميل' },
      { key: 'user', label: 'الكاشير' },
      { key: 'n', label: 'عدد الأصناف', num: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
      ...invoiceActions('sale'),
    ], { onClick: (r) => invoiceModal(r), sort: { key: 'id', dir: -1 }, name: 'المبيعات' }))}
    ${section('المبيعات حسب الصنف', table(s.byItem, [
      { key: 'item', label: 'الصنف' },
      { key: 'qty', label: 'الكمية', num: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
    ], { name: 'المبيعات حسب الصنف' }))}`;
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
    const text = `كشف حساب: ${noName(name)}\nالرصيد حتى ${range.to || P.lastDate}: ${fmt(st.closing)} دينار`;
    const wa = waLink(person?.mobile, text);
    openModal(`<h2>كشف حساب — ${esc(noName(name))}</h2>
      <div class="statement-head">
        ${person?.mobile ? `<span>الهاتف: <b class="num">${esc(person.mobile)}</b></span>` : ''}
        ${person?.address ? `<span>العنوان: <b>${esc(person.address)}</b></span>` : ''}
        <span>الرصيد: <b>${money(st.closing)}</b></span>
      </div>
      <div class="filters no-print" style="padding:0 0 8px">
        <label>من <input type="date" id="stFrom" value="${range.from}"></label>
        <label>إلى <input type="date" id="stTo" value="${range.to}"></label>
        ${wa ? `<a class="btn small" href="${wa}" target="_blank" rel="noopener">إرسال الرصيد عبر واتساب</a>` : ''}
        ${person && can(kind === 'customer' ? 'customer_edit' : 'supplier_manage') ? `<button class="btn small" id="stEdit">${icon('edit')} تعديل البيانات</button>` : ''}
        ${person && can(kind === 'customer' ? 'receipt' : 'payment') ? `<button class="btn small primary" id="stPay">${kind === 'customer' ? '+ سند قبض' : '+ سند صرف'}</button>` : ''}
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
          if (can('voucher_edit') && (r.kind === 'receipt' || r.kind === 'payment')) {
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
    { key: 'shown', label: kind === 'customer' ? 'العميل' : 'المورد' },
    ...(kind === 'customer' ? [{ key: 'type', label: 'النوع' }] : []),
    { key: 'mobile', label: 'الهاتف', html: (r) => `<span class="num">${esc(r.mobile)}</span>` },
    { key: 'opening', label: 'رصيد افتتاحي', money: true, total: true },
    { key: 'debit', label: kind === 'customer' ? 'مبيعات آجلة' : 'مشتريات آجلة', money: true, total: true },
    { key: 'credit', label: 'تسديدات', money: true, total: true },
    { key: 'balance', label: 'الرصيد', money: true, total: true },
    { key: 'last', label: 'آخر حركة' },
  ];
  return `${actionBar(kind === 'customer' ? [['newCustomer', '+ عميل جديد'], ['newReceipt', '+ سند قبض']] : [['newSupplier', '+ مورد جديد'], ['newPayment', '+ سند صرف']])}
    <div class="grid kpis">
      ${kpi(kind === 'customer' ? 'مجموع الديون على العملاء' : 'مجموع ديون الموردين', owed, `عدد ${kind === 'customer' ? 'العملاء' : 'الموردين'} الذين لديهم رصيد: ${list.filter((x) => x.balance > 0).length}`)}
    </div>
    <p class="muted">اضغط على أي اسم لعرض كشف الحساب.</p>
    ${section(kind === 'customer' ? 'أرصدة العملاء' : 'أرصدة الموردين', table(rows, cols, {
      onClick: (r) => statementModal(kind, r.name),
      name: kind === 'customer' ? 'أرصدة العملاء' : 'أرصدة الموردين',
    }))}`;
}

function viewStock() {
  const P = state.P;
  const st = C.stock(P);
  const pill = (s) => `<span class="pill ${s === 'نافد' || s === 'سالب' ? 'bad' : s === 'قليل' ? 'warn' : 'good'}">${s}</span>`;
  const classes = [...new Set(st.map((x) => x.cls))].sort();
  return `${actionBar([['newItem', '+ صنف جديد']])}<div class="grid kpis">
      ${kpi('قيمة المخزون بسعر الشراء', st.reduce((a, x) => a + Math.max(0, x.value), 0))}
      <div class="card kpi"><div class="label">أصناف نافدة</div><div class="value num">${st.filter((x) => x.status === 'نافد').length}</div></div>
      <div class="card kpi"><div class="label">أصناف رصيدها سالب</div><div class="value num">${st.filter((x) => x.status === 'سالب').length}</div><div class="hint">الكمية المبيعة أكثر من المشتراة — تحقّق من فواتير الشراء</div></div>
      <div class="card kpi"><div class="label">أصناف قليلة الرصيد</div><div class="value num">${st.filter((x) => x.status === 'قليل').length}</div></div>
    </div>
    <p class="muted">يُحسب الرصيد هكذا: الرصيد الافتتاحي + المشتريات − المبيعات، وتُحوَّل القطع الزائدة إلى كراتين.
      الفئات: ${classes.map(esc).join('، ')}</p>
    ${section('رصيد الأصناف', table(st, [
      { key: 'code', label: 'الرمز' },
      { key: 'cls', label: 'الفئة' },
      { key: 'name', label: 'الصنف' },
      { key: 'k', label: 'الرصيد (وحدة كبيرة)', html: (r) => `<span class="num">${fmt(r.k)}</span> ${esc(r.unitL1)}` , get: (r) => r.k },
      { key: 's', label: 'الرصيد (وحدة صغيرة)', html: (r) => `<span class="num">${fmt(r.s)}</span> ${esc(r.unitL2)}`, get: (r) => r.s },
      { key: 'fill', label: 'التعبئة', num: true },
      { key: 'priceL1', label: 'سعر البيع (كبيرة)', money: true },
      { key: 'priceL2', label: 'سعر البيع (صغيرة)', money: true },
      { key: 'buyL1', label: 'سعر الشراء (كبيرة)', money: true },
      { key: 'value', label: 'القيمة', money: true, total: true },
      { key: 'status', label: 'الحالة', html: (r) => pill(r.status), get: (r) => r.status },
    ], { sort: { key: 'name', dir: 1 }, name: 'المخزون', onClick: can('item_manage') ? (r) => forms().itemEditor(P.items.find((i) => i.id === r.id)) : null }))}
    ${can('item_manage') ? '<p class="muted">اضغط على أي صنف لتعديل أسعاره.</p>' : ''}`;
}

function viewCash() {
  const P = state.P;
  const b = C.cashBox(P, state.filter);
  const line = (label, v, sign) => ({ label, v: sign * v });
  const rows = [
    line('مبيعات نقدية', b.cashSales, 1),
    line('المدفوع مع الفواتير', b.paidWithInvoices, 1),
    line('تسديدات العملاء', b.receipts, 1),
    line('مشتريات نقدية', b.cashPurchases, -1),
    line('المدفوعات (تسديد للموردين ومصاريف)', b.payments, -1),
  ];
  return `${actionBar([['newReceipt', '+ سند قبض'], ['newPayment', '+ سند صرف / مصروف']])}<div class="grid kpis">
      ${kpi('الوارد', b.totalIn)}${kpi('الصادر', b.totalOut)}${kpi('الصافي', b.net, periodLabel())}
    </div>
    ${section('حركة الصندوق', table(rows, [
      { key: 'label', label: 'البند' },
      { key: 'v', label: 'المبلغ', money: true, total: true },
    ], { name: 'الصندوق' }), { search: false })}
    <div class="grid two">
      <div>${section('المبيعات النقدية حسب الكاشير', table(b.byUser.map(([u, t]) => ({ u, t })), [
        { key: 'u', label: 'الكاشير' },
        { key: 't', label: 'المبلغ', money: true, total: true },
      ], { name: 'المبيعات النقدية حسب الكاشير' }), { search: false })}</div>
      <div>${section('المدفوعات حسب النوع', table(b.paymentsByClass.map(([c, t]) => ({ c, t })), [
        { key: 'c', label: 'النوع' },
        { key: 't', label: 'المبلغ', money: true, total: true },
      ], { name: 'المدفوعات حسب النوع' }), { search: false })}</div>
    </div>
    ${section('المقبوضات', table(b.receiptList, [
      { key: 'date', label: 'التاريخ' },
      { key: 'no', label: 'رقم السند' },
      { key: 'name', label: 'من' },
      { key: 'cls', label: 'النوع' },
      { key: 'note', label: 'ملاحظة' },
      { key: 'amount', label: 'المبلغ', money: true, total: true },
    ], { name: 'المقبوضات', sort: { key: 'date', dir: -1 }, onClick: can('voucher_edit') ? (r) => forms().voucherEditor('receipt', r) : null }))}
    ${section('المدفوعات', table(b.paymentList, [
      { key: 'date', label: 'التاريخ' },
      { key: 'no', label: 'رقم السند' },
      { key: 'name', label: 'إلى' },
      { key: 'cls', label: 'النوع' },
      { key: 'note', label: 'ملاحظة' },
      { key: 'amount', label: 'المبلغ', money: true, total: true },
    ], { name: 'المدفوعات', sort: { key: 'date', dir: -1 }, onClick: can('voucher_edit') ? (r) => forms().voucherEditor('payment', r) : null }))}`;
}

function viewPurchases() {
  const P = state.P;
  const f = state.filter;
  const list = P.purchases.filter((p) => C.inRange(p.date, f.from, f.to) && (!f.user || p.user === f.user));
  const sum = (arr) => arr.reduce((a, p) => a + p.total, 0);
  const bySupplier = new Map();
  for (const p of list) bySupplier.set(p.supplier, (bySupplier.get(p.supplier) || 0) + p.total);
  return `${actionBar([['newPurchase', '+ فاتورة شراء']])}<div class="grid kpis">
      ${kpi('المشتريات', sum(list), `${list.length} فاتورة — ${periodLabel()}`)}
      ${kpi('نقدي', sum(list.filter((p) => p.type === C.CASH)))}
      ${kpi('آجل', sum(list.filter((p) => p.type === C.CREDIT)))}
    </div>
    ${section('فواتير الشراء', table(list.map((p) => ({ ...p, n: p.lines.length })), [
      { key: 'id', label: 'رقم', num: true },
      { key: 'no', label: 'رقم فاتورة المورد' },
      { key: 'date', label: 'التاريخ' },
      { key: 'type', label: 'النوع' },
      { key: 'supplier', label: 'المورد' },
      { key: 'user', label: 'المستخدم' },
      { key: 'n', label: 'عدد الأصناف', num: true },
      { key: 'total', label: 'المبلغ', money: true, total: true },
      ...invoiceActions('purchase'),
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
      ${kpi('المبيعات', pr.revenue)}${kpi('التكلفة', pr.cost)}${kpi('إجمالي الربح', pr.gross)}
      ${kpi('المصاريف', pr.expenseTotal)}${kpi('الصافي', pr.net, periodLabel())}
    </div>
    <p class="muted">التكلفة = سعر الشراء المسجّل مع كل سطر بيع (أو سعر الشراء الحالي للصنف إن لم يكن مسجّلاً).
      ${pr.unknown ? `لم يُحسب ربح مبيعات بمبلغ ${fmt(pr.unknown)} لأن الصنف أو الوحدة غير موجودين في قائمة الأصناف.` : ''}</p>
    ${section('الربح حسب الصنف', table(pr.items, [
      { key: 'item', label: 'الصنف' },
      { key: 'qty', label: 'الكمية', num: true },
      { key: 'revenue', label: 'المبيعات', money: true, total: true },
      { key: 'cost', label: 'التكلفة', money: true, total: true },
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
    if (s.date > today) add('تاريخ في المستقبل', `فاتورة بيع رقم ${s.id} تاريخها ${s.date} (أُدخلت في ${s.time.slice(0, 10)})`, s.id, () => invoiceModal(s));
    if (s.type === C.CREDIT && !s.customer) add('آجل بدون عميل', `فاتورة بيع آجل رقم ${s.id} بمبلغ ${fmt(s.total)} بدون اسم عميل`, s.id, () => invoiceModal(s));
    if (!s.lines.length) add('فاتورة فارغة', `فاتورة بيع رقم ${s.id} (${s.date}) لا تحتوي على أصناف`, s.id, () => invoiceModal(s));
  }
  for (const p of P.purchases) {
    if (p.date > today) add('تاريخ في المستقبل', `فاتورة شراء رقم ${p.id} تاريخها ${p.date} (أُدخلت في ${p.time.slice(0, 10)})`, p.id, () => invoiceModal(p, 'purchase'));
  }
  const seen = new Set();
  for (const l of P.saleLines) {
    const it = P.itemByName.get(l.item);
    const key = l.item + '|' + l.unit;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!it) add('صنف غير موجود', `"${l.item}" مُباع لكنه غير موجود في قائمة الأصناف (لا يُحتسب في المخزون)`, '', null);
    else if (l.unit !== it.unitL1 && l.unit !== it.unitL2) add('وحدة خاطئة', `"${l.item}" مُباع بوحدة "${l.unit || 'فارغة'}" بينما وحدات الصنف هي ${it.unitL1}/${it.unitL2}`, '', null);
  }
  for (const it of P.items) {
    if (!it.priceL1 && !it.priceL2) add('سعر البيع صفر', `الصنف "${it.name}" ليس له سعر بيع`, '', null);
    if (it.unitL1 && it.unitL1 === it.unitL2) add('وحدتان بالاسم نفسه', `الصنف "${it.name}" وحدتاه الكبيرة والصغيرة باسم واحد "${it.unitL1}" — قد يُحسب رصيده مرتين؛ عدّل وحدتيه`, '', null);
  }
  const known = new Set(P.customers.map((c) => c.name));
  for (const n of new Set(P.sales.filter((s) => s.type === C.CREDIT && s.customer).map((s) => s.customer))) {
    if (!known.has(n)) add('عميل غير مسجّل', `"${n}" لديه فواتير آجلة لكنه غير موجود في قائمة العملاء`, '', null);
  }
  return `<p class="muted">أمور وُجدت في البيانات تستحق المراجعة والتصحيح. هذه الصفحة للاطلاع فقط ولا تغيّر شيئاً في البيانات.</p>
    ${section(`ملاحظات (${out.length})`, table(out, [
      { key: 'kind', label: 'النوع' },
      { key: 'what', label: 'التفاصيل' },
    ], { onClick: (r) => r.open?.(), empty: 'لم يُعثر على أي مشكلة', name: 'ملاحظات البيانات' }))}`;
}

// ---------- quick sale & settings pages (server mode) ----------

let afterRender = [];
const onAfter = (fn) => afterRender.push(fn);

let POS = null;
const pos = () =>
  (POS ??= setupPos({ $, $$, esc, fmt, money, localDay, state, write, toast, forms, icon, onAfter, C, store, invoiceModal, can }));
// What every screen module gets from the app.
const moduleCtx = () => ({
  $, $$, esc, fmt, money, api, write, state, C, table, section, toast, icon, onAfter, openModal, closeModal,
  can, localDay, addDays, periodLabel, store, forms, barChart, refreshData, readServer,
});
let REP = null, ANA = null, CNT = null, LAB = null, ACT = null;
const reports = () => (REP ??= setupReports(moduleCtx()));
const analytics = () => (ANA ??= setupAnalytics(moduleCtx()));
const stockCount = () => (CNT ??= setupStockCount(moduleCtx()));
const labels = () => (LAB ??= setupLabels(moduleCtx()));
const activity = () => (ACT ??= setupActivity(moduleCtx()));
let SET = null;
const settings = () =>
  (SET ??= setupSettings({ $, $$, esc, api, state, toast, icon, onAfter, readServer, guarded, openDbScreen, signedOut, startScreen, openModal, closeModal, localDay }));

// ---------- navigation ----------

// server: needs server.ps1 (signed in); admin: managers only. Signed in,
// every other screen needs the permission with its id.
const NAV = [
  { group: 'البيع' },
  { id: 'pos', label: 'بيع سريع', server: true },
  { id: 'home', label: 'الرئيسية' },
  { id: 'sales', label: 'المبيعات' },
  { id: 'purchases', label: 'المشتريات' },
  { group: 'الحسابات' },
  { id: 'customers', label: 'العملاء' },
  { id: 'suppliers', label: 'الموردون' },
  { id: 'cash', label: 'الصندوق' },
  { id: 'profit', label: 'الأرباح' },
  { group: 'المخزون' },
  { id: 'stock', label: 'المخزون والأسعار' },
  { id: 'stockcount', label: 'الجرد', perm: 'stock_count', server: true },
  { id: 'labels', label: 'طباعة الباركود', perm: 'labels', server: true },
  { id: 'checks', label: 'ملاحظات البيانات' },
  { group: 'التقارير' },
  { id: 'analytics', label: 'التحليلات' },
  { id: 'reports', label: 'التقارير المتقدمة' },
  { group: 'النظام', server: true, admin: true },
  { id: 'activity', label: 'سجل العمليات', server: true, admin: true },
  { id: 'settings', label: 'الإعدادات', server: true, admin: true },
];

const TITLES = {
  pos: ['بيع سريع', 'اختر الأصناف، ثم احفظ الفاتورة'],
  home: ['الرئيسية', ''],
  sales: ['المبيعات', ''],
  purchases: ['المشتريات', ''],
  customers: ['العملاء', 'الأرصدة وكشوفات الحساب'],
  suppliers: ['الموردون', 'الأرصدة وكشوفات الحساب'],
  stock: ['المخزون والأسعار', 'رصيد كل صنف وأسعاره'],
  cash: ['الصندوق', ''],
  profit: ['الأرباح', ''],
  checks: ['ملاحظات البيانات', 'أمور في البيانات تستحق المراجعة'],
  settings: ['الإعدادات', ''],
  stockcount: ['الجرد', 'عُدّ المخزون، ويصحّح البرنامج الفرق ويُصدر تقرير الزيادة والنقص'],
  labels: ['طباعة الباركود', 'ملصقات بالاسم والسعر والباركود'],
  analytics: ['التحليلات', ''],
  reports: ['التقارير المتقدمة', ''],
  activity: ['سجل العمليات', 'من فعل ماذا ومتى'],
  none: ['أهلاً بك', ''],
};

// In read-only mode everything readable is open; signed in, each user sees
// the screens they were given.
const visible = (n) => {
  if (!state.server) return !n.server;
  if (n.group) return !n.admin || state.admin;
  if (n.admin) return state.admin;
  return n.id === 'pos' ? canSell() : can(n.perm || n.id);
};
// Where a user lands: the dashboard if they may see it, else the sale screen,
// else the first screen they have.
function homeView() {
  for (const id of ['home', 'pos']) if (NAV.some((n) => n.id === id && visible(n))) return id;
  return NAV.find((n) => n.id && visible(n))?.id || 'none';
}

function buildNav() {
  const items = NAV.filter(visible);
  // drop group headings with nothing under them
  const out = items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
  $('#nav').innerHTML = out
    .map((n) => (n.group ? `<div class="group">${esc(n.group)}</div>` : `<button data-view="${n.id}">${icon(n.id)}<span>${esc(n.label)}</span></button>`))
    .join('');
}

function go(view) {
  if (!NAV.some((n) => n.id === view && visible(n))) view = homeView();
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
  stockcount: () => stockCount().view(),
  labels: () => labels().view(),
  analytics: () => analytics().view(),
  reports: () => reports().view(),
  activity: () => activity().view(),
  none: () => `<div class="card"><h3>لا توجد شاشات متاحة لك</h3>
    <p class="muted">ليس لدى المستخدم <b>${esc(state.user)}</b> صلاحية البيع ولا أي شاشة أخرى. اطلب من المدير تحديد صلاحياتك من الإعدادات ← المستخدمون والصلاحيات، ثم الضغط على «حفظ».
      تتحدّث الشاشة تلقائياً بعد الحفظ.</p>
    <p class="muted" style="font-size:12px">الصلاحيات المستلمة: <code dir="ltr">${esc(state.perms.join(', ') || '—')}</code></p></div>`,
};
const periodViews = new Set(['home', 'sales', 'purchases', 'cash', 'profit', 'analytics', 'reports']);

function render() {
  if (!state.P) return;
  if (!NAV.some((n) => n.id === state.view && visible(n))) state.view = homeView();
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
    .map(([id, label], i) => `<button class="btn${i === 0 ? ' primary' : ''}" data-act="${id}">${esc(label)}</button>`)
    .join('');
  $('#shopTitle').textContent = state.shopName || APP;
  for (const fn of afterRender) fn();
  $('#goLow')?.addEventListener('click', () => {
    store.set('fr3oon-report-tab', 'low');
    REP = null;
    go('reports');
  });
  $('#goLast')?.addEventListener('click', () => {
    state.preset = '';
    state.filter.from = state.filter.to = state.P.lastDate;
    $('#from').value = $('#to').value = state.P.lastDate;
    $$('#presets button').forEach((b) => b.classList.remove('on'));
    render();
  });
}

// ---------- wiring ----------

// Light, dark, or as Windows is set; remembered on this computer. The page
// head already applied it before drawing (index.html).
const THEMES = [['light', 'sun', 'فاتح'], ['dark', 'moon', 'داكن'], ['auto', 'monitor', 'تلقائي']];
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(choice = store.get('fr3oon-theme') || 'auto') {
  const dark = choice === 'dark' || (choice === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $$('#themeSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.theme === choice));
}

function init() {
  $('#themeSwitch').innerHTML = THEMES.map(([id, ic, label]) => `<button type="button" data-theme="${id}" title="المظهر: ${label}" aria-label="المظهر: ${label}">${icon(ic)}</button>`).join('');
  $('#themeSwitch').onclick = (e) => {
    const b = e.target.closest('button[data-theme]');
    if (!b) return;
    store.set('fr3oon-theme', b.dataset.theme);
    applyTheme(b.dataset.theme);
  };
  darkQuery.addEventListener?.('change', () => applyTheme());
  applyTheme();
  $('#btnReload').innerHTML = icon('refresh');
  $('#btnReload').title = 'تحديث البيانات الآن';
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
  $('#btnPassword').innerHTML = icon('edit');
  $('#btnPassword').onclick = passwordModal;
  $('#btnMenu').innerHTML = icon('menu');
  $('#btnMenu').onclick = () => $('#app').classList.toggle('menu-open');
  $('#scrim').onclick = () => $('#app').classList.remove('menu-open');
  $('#nav').onclick = (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) go(b.dataset.view);
  };
  $('#auto').onchange = (e) => setAuto(e.target.checked);
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

  // The helper runs while a window is open: say so every few seconds, and
  // goodbye when the window closes (it then stops by itself).
  if (location.protocol.startsWith('http')) {
    const alive = () => fetch('/api/alive', { method: 'POST', cache: 'no-store' }).catch(() => {});
    alive();
    setInterval(alive, 5000);
    addEventListener('pagehide', () => navigator.sendBeacon?.('/api/bye'));
  }

  const auto = store.get('fr3oon-auto') !== '0';
  $('#auto').checked = auto;
  setAuto(auto);
  startScreen();
}

// Barcode scans: into the open invoice window, else the quick sale screen.
installScanner(() => {
  if (!$('#modal').hidden) {
    const f = $('#fItem');
    return f?.scanAdd ? { input: f, onScan: f.scanAdd } : null;
  }
  if (state.view === 'pos' && $('#posSearch') && POS) return { input: $('#posSearch'), onScan: (code) => POS.scan(code) };
  return null;
});

init();
