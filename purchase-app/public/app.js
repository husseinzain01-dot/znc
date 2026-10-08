// واجهة نظام طلبات الشراء — تعمل بدون إنترنت، وكل القواعد تُفرض في الخادم
'use strict';

const STATUS = {
  draft: { label: 'مسودة', cls: 'b-gray' },
  pending: { label: 'قيد الموافقة', cls: 'b-amber' },
  returned: { label: 'معاد للتعديل', cls: 'b-violet' },
  rejected: { label: 'مرفوض', cls: 'b-red' },
  approved: { label: 'معتمد — بانتظار الشراء', cls: 'b-blue' },
  ordered: { label: 'صدر أمر الشراء', cls: 'b-indigo' },
  partial: { label: 'استلام جزئي', cls: 'b-teal' },
  received: { label: 'مستلم — مغلق', cls: 'b-green' },
  cancelled: { label: 'ملغى', cls: 'b-gray' },
};
const PRIORITY = { normal: { label: 'عادي', cls: 'b-gray' }, urgent: { label: 'مستعجل', cls: 'b-amber' }, emergency: { label: 'طارئ', cls: 'b-red' } };
const ACTIONS = {
  created: 'إنشاء الطلب', edited: 'تعديل الطلب', submitted: 'إرسال للموافقة', resubmitted: 'إعادة الإرسال للموافقة',
  approved: 'موافقة', rejected: 'رفض', returned: 'إعادة للتعديل', ordered: 'إصدار أمر شراء', partial: 'استلام جزئي',
  received: 'استلام كامل وإغلاق', cancelled: 'إلغاء الطلب', attached: 'إضافة مرفق', detached: 'حذف مرفق',
};
const ROLES = { admin: 'مدير النظام', user: 'مستخدم', viewer: 'مشاهد (تدقيق)' };
const UNITS = ['قطعة', 'كغم', 'طن', 'كيس', 'لتر', 'علبة', 'كرتون', 'متر', 'مجموعة', 'خدمة'];
const CUR = { IQD: 'د.ع', USD: '$' };

const S = { me: null, users: [], settings: null, company: '', requests: [], view: 'list', openId: null, form: null, draft: null, filters: { q: '', status: '', scope: 'all' } };

// ── أدوات ──
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = (n, cur) => { const v = (+n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); return cur ? `${v} ${CUR[cur] || cur}` : v; };
const dt = iso => { if (!iso) return '—'; const d = new Date(iso); return `${d.toLocaleDateString('en-CA')} ${d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}`; };
const daysSince = iso => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso)) / 864e5)) : 0);
const badge = (map, k) => { const m = map[k] || { label: k || '—', cls: 'b-gray' }; return `<span class="badge ${m.cls}">${esc(m.label)}</span>`; };
const who = u => (u ? esc(u.name) : '—');
const userName = id => { const u = S.users.find(x => x.id === id); return u ? u.name : '؟'; };
const sizeTxt = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB');
let toastTimer;
function toast(msg, bad) {
  const el = $('toast'); el.textContent = msg; el.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), bad ? 4500 : 2200);
}

async function api(method, url, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); } catch (_) { throw new Error('تعذر الاتصال بالبرنامج — تأكد أن نافذة البرنامج مفتوحة'); }
  let data = {};
  try { data = await res.json(); } catch (_) { /* ignore */ }
  if (res.status === 401 && S.me) { S.me = null; closeModal(); renderLogin('انتهت الجلسة، سجّل الدخول من جديد'); }
  if (res.status === 503) { S.me = null; closeModal(); renderDbSetup({ dbError: data.error }); }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ (' + res.status + ')');
  return data;
}
// تنفيذ إجراء مع رسالة نجاح/خطأ وتحديث البيانات
async function run(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); await refresh(); return true; }
  catch (e) { toast('⚠ ' + e.message, true); return false; }
}

// ── الصلاحيات (للعرض فقط؛ الخادم يتحقق مجدداً) ──
const isAdmin = () => S.me && S.me.role === 'admin';
const isOwner = r => r.createdBy.id === S.me.id;
const curStep = r => (r.status === 'pending' ? r.chain[r.currentStep] : null);
function canApprove(r) {
  const s = curStep(r);
  if (!s) return false;
  if (isOwner(r)) return false;
  return s.approvers.length ? s.approvers.includes(S.me.id) : S.me.isOwner;
}
const chainForDep = (set, dep) => (dep && set.chains && set.chains[dep] && set.chains[dep].length ? set.chains[dep] : set.chain);
const badChain = c => c.some(s => !s.approvers.length || !S.users.some(u => u.id === s.approvers[0] && u.active));
const chainIncomplete = () => S.me.isOwner
  ? badChain(S.settings.chain) || Object.values(S.settings.chains || {}).some(badChain)
  : badChain(chainForDep(S.settings, S.me.department));
const awaitingMe = r => canApprove(r) || (S.me.isBuyer && r.status === 'approved');
const isLate = r => !!r.neededBy && r.neededBy < today() && !['received', 'rejected', 'cancelled', 'draft'].includes(r.status);
const listed = () => S.requests.filter(r => r.status !== 'draft' || isOwner(r));

// ── التشغيل ──
async function init() {
  try {
    const st = await api('GET', '/api/status');
    S.company = st.company;
    if (!st.dbReady) return renderDbSetup(st);
    if (st.needsSetup) return renderSetup();
    if (!st.loggedIn) return renderLogin();
    await refresh();
  } catch (e) {
    if (!S.me) renderLogin();
    else toast(e.message, true);
  }
}
async function refresh(quiet) {
  const d = await api('GET', '/api/bootstrap');
  Object.assign(S, { me: d.me, users: d.users, settings: d.settings, company: d.company, requests: d.requests });
  if (quiet && S.view !== 'list') return updateBadges();
  renderApp();
  if (S.openId && !$('modal').classList.contains('hidden') && $('modal').dataset.kind === 'detail') openDetail(S.openId);
}
setInterval(() => {
  if (S.me && document.visibilityState === 'visible' && $('modal').classList.contains('hidden')) refresh(true).catch(() => {});
}, 30000);

// ── شاشات الدخول ──
function authShell(inner) {
  $('app').innerHTML = `<div class="authWrap"><div class="authCard"><img class="authLogo" src="favicon.svg" alt="">${inner}</div></div>`;
}
// ── إعدادات الاتصال بـ SQL Server ──
function dbFormHtml(c, mode) {
  const chk = (n, v, l) => `<label class="check"><input type="checkbox" name="${n}"${v ? ' checked' : ''}> ${l}</label>`;
  return `<form data-submit="dbSave" data-mode="${mode}" autocomplete="off">
    <div class="formGrid dbGrid">
      <div class="formGroup"><label>اسم الخادم (Server)</label><input name="server" value="${esc(c.server)}" dir="ltr" placeholder="localhost" required></div>
      <div class="formGroup"><label>اسم النسخة (Instance) — اختياري</label><input name="instance" value="${esc(c.instance)}" dir="ltr" placeholder="مثال: SQLEXPRESS"></div>
      <div class="formGroup"><label>المنفذ (Port)</label><input name="port" type="number" min="1" max="65535" value="${esc(c.port)}" dir="ltr"></div>
      <div class="formGroup"><label>اسم قاعدة البيانات</label><input name="database" value="${esc(c.database)}" dir="ltr" required></div>
      <div class="formGroup"><label>اسم مستخدم SQL Server</label><input name="user" value="${esc(c.user)}" dir="ltr" placeholder="مثال: sa" required autocomplete="off"></div>
      <div class="formGroup"><label>كلمة المرور</label><input name="password" type="password" dir="ltr" autocomplete="new-password" placeholder="${c.hasPassword ? '•••••• محفوظة' : ''}"></div>
    </div>
    <div class="dbChecks">${chk('encrypt', c.encrypt, 'تشفير الاتصال (Encrypt)')}${chk('trustCert', c.trustCert !== false, 'الوثوق بشهادة الخادم (Trust server certificate)')}</div>
    <p class="help">إذا كتبت اسم النسخة (مثل SQLEXPRESS) يُتجاهل رقم المنفذ وتلزم خدمة "SQL Server Browser". تُنشأ قاعدة البيانات وجداولها تلقائياً إذا كان للحساب صلاحية ذلك، وإلا شغّل ملف schema.sql أولاً. ${c.hasPassword ? 'اترك كلمة المرور فارغة للإبقاء على المحفوظة. ' : ''}تُحفظ الإعدادات على هذا الجهاز فقط.</p>
    <div id="dbMsg"></div>
    <div class="actions">
      <button class="btn btn-secondary" type="button" data-act="dbTest">🔌 اختبار الاتصال</button>
      <button class="btn btn-primary" type="submit">💾 حفظ والاتصال</button>
    </div>
  </form>`;
}
function dbFormData(f) {
  const d = Object.fromEntries(new FormData(f));
  d.encrypt = !!f.elements.encrypt.checked; d.trustCert = !!f.elements.trustCert.checked;
  return d;
}
function dbMsg(html, bad) { const el = $('dbMsg'); if (el) el.innerHTML = `<div class="dbMsg ${bad ? 'bad' : 'ok'}">${html}</div>`; }
async function renderDbSetup(st) {
  let c = { server: 'localhost', instance: '', port: 1433, database: 'PurchaseRequestsDB', user: '', trustCert: true };
  try { c = await api('GET', '/api/db-config'); } catch (_) { /* first run */ }
  $('app').innerHTML = `<div class="authWrap"><div class="authCard wide"><img class="authLogo" src="favicon.svg" alt="">
    <h1>إعدادات قاعدة البيانات</h1><p>أدخل بيانات الاتصال بـ SQL Server على هذا الجهاز، ثم اضغط "اختبار الاتصال".</p>
    ${dbFormHtml(c, 'first')}</div></div>`;
  if (st && st.dbError) dbMsg('<b>تعذر الاتصال بالإعدادات المحفوظة:</b><br>' + esc(st.dbError), true);
}
async function loadDbCard() {
  const el = $('dbCard'); if (!el) return;
  try {
    const c = await api('GET', '/api/db-config');
    el.innerHTML = `<div class="secHdr">اتصال قاعدة البيانات (SQL Server)</div>
      <p class="help">متصل الآن بقاعدة <b dir="ltr">${esc(c.database)}</b> على الخادم <b dir="ltr">${esc(c.serverLabel)}</b>. تغيير الخادم أو قاعدة البيانات ينقل البرنامج إلى بيانات أخرى ويُخرج جميع المستخدمين.</p>
      ${dbFormHtml(c, 'settings')}`;
  } catch (e) { el.innerHTML = `<div class="dbMsg bad">${esc(e.message)}</div>`; }
}

function renderSetup() {
  authShell(`<h1>إعداد النظام لأول مرة</h1><p>أنشئ حساب مدير النظام. يمكنك إضافة باقي المستخدمين لاحقاً.</p>
    <form data-submit="setup">
      <div class="formGroup"><label>اسم الشركة / الجهة</label><input name="company" required maxlength="120"></div>
      <div class="formGroup"><label>اسمك الكامل</label><input name="name" required maxlength="80"></div>
      <div class="formGroup"><label>اسم المستخدم (إنجليزي)</label><input name="username" required maxlength="60" autocomplete="username" dir="ltr"></div>
      <div class="formGroup"><label>كلمة المرور (6 أحرف على الأقل)</label><input name="password" type="password" required minlength="6" autocomplete="new-password"></div>
      <button class="btn btn-primary" type="submit">إنشاء الحساب والبدء</button>
      <div class="err" id="authErr"></div>
    </form>`);
}
function renderLogin(msg) {
  authShell(`<h1>${esc(S.company || 'نظام طلبات الشراء')}</h1><p>نظام طلبات الشراء وسلسلة الموافقات</p>
    <form data-submit="login">
      <div class="formGroup"><label>اسم المستخدم</label><input name="username" required autocomplete="username" dir="ltr" autofocus></div>
      <div class="formGroup"><label>كلمة المرور</label><input name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn btn-primary" type="submit">تسجيل الدخول</button>
      <div class="err" id="authErr">${esc(msg || '')}</div>
    </form>`);
}
const SUBMIT = {
  async dbSave(f) {
    const d = dbFormData(f), first = f.dataset.mode === 'first';
    if (!first && !confirm('حفظ إعدادات قاعدة البيانات وإعادة الاتصال؟')) return;
    dbMsg('جارٍ الاتصال بـ SQL Server وتجهيز الجداول…');
    try {
      const r = await api('POST', '/api/db-config', d);
      if (first) { if (r.needsSetup) renderSetup(); else renderLogin('تم الاتصال بقاعدة البيانات. سجّل الدخول.'); return; }
      toast('تم حفظ إعدادات قاعدة البيانات');
      const st = await api('GET', '/api/status');
      if (!st.loggedIn || st.needsSetup) { S.me = null; return st.needsSetup ? renderSetup() : renderLogin('تم الاتصال بقاعدة البيانات الجديدة. سجّل الدخول.'); }
      await refresh();
    } catch (e) { dbMsg(esc(e.message), true); }
  },
  async setup(f) {
    try { await api('POST', '/api/setup', Object.fromEntries(new FormData(f))); await refresh(); }
    catch (e) { $('authErr').textContent = e.message; }
  },
  async login(f) {
    try { await api('POST', '/api/login', Object.fromEntries(new FormData(f))); S.view = 'list'; await refresh(); }
    catch (e) { $('authErr').textContent = e.message; }
  },
};

// ── الهيكل العام ──
function renderApp() {
  const waiting = S.requests.filter(awaitingMe).length;
  const tab = (v, label, extra = '') => `<button class="tab${S.view === v ? ' act' : ''}" data-act="view" data-v="${v}">${label}${extra}</button>`;
  $('app').innerHTML = `<header class="top">
      <div class="brand"><img src="favicon.svg" alt=""><div>${esc(S.company || 'طلبات الشراء')}<small>نظام طلبات الشراء والموافقات</small></div></div>
      <nav class="tabs">
        ${tab('list', '📋 متابعة الطلبات', `<span class="cnt" id="waitCnt"${waiting ? '' : ' style="display:none"'}>${waiting}</span>`)}
        ${S.me.role !== 'viewer' ? tab('new', '＋ طلب جديد') : ''}
        ${S.me.isOwner ? tab('settings', '⚙ سلاسل الموافقات') : ''}${isAdmin() ? tab('users', '👥 المستخدمون والأقسام') : ''}
      </nav>
      <div class="who"><div><div class="name">${esc(S.me.name)}</div><div class="role">${esc(ROLES[S.me.role])}${S.me.department ? ' · ' + esc(S.me.department) : ''}</div></div>
        <button class="topBtn" data-act="changePassword">🔑</button><button class="topBtn" data-act="logout">خروج</button></div>
    </header><main id="main"></main>`;
  renderView();
}
function updateBadges() {
  const n = S.requests.filter(awaitingMe).length, el = $('waitCnt');
  if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
}
function renderView() {
  const m = $('main');
  if (S.view === 'new') m.innerHTML = formView();
  else if (S.view === 'settings' && S.me.isOwner) { m.innerHTML = settingsView(); loadDbCard(); }
  else if (S.view === 'users' && isAdmin()) m.innerHTML = usersView();
  else { S.view = 'list'; m.innerHTML = listView(); renderTable(); }
}

// ── قائمة الطلبات ──
function listView() {
  const list = listed();
  const cnt = st => list.filter(r => st.includes(r.status)).length;
  const openVal = list.filter(r => ['pending', 'approved', 'ordered', 'partial'].includes(r.status) && r.currency === 'IQD').reduce((s, r) => s + r.total, 0);
  const late = list.filter(isLate).length;
  const stat = (l, v, s, c) => `<div class="stat"${c ? ` style="border-inline-start-color:${c}"` : ''}><div class="l">${l}</div><div class="v"${c ? ` style="color:${c}"` : ''}>${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const f = S.filters;
  const opt = (v, l, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`;
  const warn = chainIncomplete() ? `<div class="dbMsg bad" style="margin:0 0 14px">⚠ سلسلة الموافقات غير مكتملة: يجب تحديد مستخدم معتمد لكل مرحلة قبل إرسال أي طلب.${S.me.isOwner ? ' <button class="btn btn-sm btn-primary" data-act="view" data-v="settings">إكمال الإعدادات</button>' : ' راجع مالك النظام.'}</div>` : '';
  return `${warn}<div class="pageTitle"><h2>متابعة طلبات الشراء</h2><button class="btn btn-secondary btn-sm" data-act="exportCsv">⬇ تصدير إلى Excel</button></div>
    <div class="stats">
      ${stat('إجمالي الطلبات', list.length)}
      ${stat('بانتظار إجرائي', list.filter(awaitingMe).length, 'موافقة أو شراء', '#d97706')}
      ${stat('قيد الموافقة', cnt(['pending']))}
      ${stat('معتمد / قيد التوريد', cnt(['approved', 'ordered', 'partial']), '', '#2563eb')}
      ${stat('مستلم ومغلق', cnt(['received']), '', '#059669')}
      ${stat('مرفوض / معاد', cnt(['rejected', 'returned']), '', '#dc2626')}
      ${stat('متأخر عن الموعد', late, 'تجاوز تاريخ الحاجة', late ? '#dc2626' : '')}
      ${stat('قيمة المفتوح', fmt(openVal), 'بالدينار العراقي')}
    </div>
    <div class="card">
      <div class="filters">
        <div class="formGroup"><label>بحث</label><input data-filter="q" value="${esc(f.q)}" placeholder="رقم الطلب، الصنف، المورد، مقدم الطلب..."></div>
        <div class="formGroup"><label>النطاق</label><select data-filter="scope">${opt('all', 'كل الطلبات', f.scope)}${opt('awaiting', 'بانتظار إجرائي', f.scope)}${opt('mine', 'طلباتي', f.scope)}${opt('late', 'المتأخرة', f.scope)}</select></div>
        <div class="formGroup"><label>الحالة</label><select data-filter="status">${opt('', 'كل الحالات', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v.label, f.status)).join('')}</select></div>
      </div>
      <div class="tableWrap"><table id="reqTable"></table></div>
    </div>`;
}
function filtered() {
  const f = S.filters, q = f.q.toLowerCase();
  let list = listed();
  if (f.scope === 'mine') list = list.filter(isOwner);
  if (f.scope === 'awaiting') list = list.filter(awaitingMe);
  if (f.scope === 'late') list = list.filter(isLate);
  if (f.status) list = list.filter(r => r.status === f.status);
  if (q) list = list.filter(r => [r.no, r.title, r.department, r.category, r.supplier, r.createdBy.name, r.po && r.po.no, ...r.items.map(i => i.name)].join(' ').toLowerCase().includes(q));
  return list;
}
function progressDots(r) {
  if (!r.chain.length) return '<span class="sub">—</span>';
  const poSt = ['ordered', 'partial', 'received'].includes(r.status) ? 'approved' : r.status === 'approved' ? 'pending' : 'waiting';
  const rcSt = r.status === 'received' ? 'approved' : r.status === 'partial' ? 'pending' : 'waiting';
  return `<div class="dots">${r.chain.map(s => `<span class="dot ${s.status}" title="${esc(s.title)}"></span>`).join('')}<span class="dotSep"></span><span class="dot ${poSt}" title="أمر الشراء"></span><span class="dot ${rcSt}" title="الاستلام"></span></div>`;
}
function renderTable() {
  const el = $('reqTable'); if (!el) return;
  const list = filtered();
  if (!list.length) { el.innerHTML = '<tbody><tr><td class="empty">لا توجد طلبات مطابقة.</td></tr></tbody>'; return; }
  el.innerHTML = `<thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>الموضوع</th><th>القسم</th><th>مقدم الطلب</th><th>القيمة التقديرية</th><th>الأولوية</th><th>الحالة</th><th>المرحلة الحالية</th><th>التقدم</th></tr></thead><tbody>${list.map(r => {
    const s = curStep(r), mine = awaitingMe(r);
    return `<tr class="row${mine ? ' mine' : ''}" data-act="open" data-id="${r.id}">
      <td class="nowrap"><b>${esc(r.no)}</b>${mine ? ' <span class="badge b-amber">بانتظارك</span>' : ''}</td>
      <td class="nowrap">${esc(r.requestDate)}</td>
      <td>${esc(r.title || r.items[0]?.name)}<div class="sub">${esc(r.category)} · ${r.items.length} صنف${r.attachments.length ? ' · 📎' + r.attachments.length : ''}</div></td>
      <td>${esc(r.department || '—')}</td>
      <td>${who(r.createdBy)}</td>
      <td class="nowrap"><b>${fmt(r.total, r.currency)}</b></td>
      <td>${badge(PRIORITY, r.priority)}</td>
      <td>${badge(STATUS, r.status)}${isLate(r) ? ' <span class="badge b-red">متأخر</span>' : ''}</td>
      <td>${s ? `${esc(s.title)}<div class="sub">منذ ${daysSince(s.startedAt)} يوم</div>` : '—'}</td>
      <td>${progressDots(r)}</td></tr>`;
  }).join('')}</tbody>`;
}

// ── نموذج الطلب ──
function blankForm() {
  return { id: null, no: '', requestDate: today(), neededBy: '', title: '', department: S.me.department || '', category: S.settings.categories[0], priority: 'normal', supplier: '', currency: 'IQD', justification: '', notes: '', items: [{ name: '', spec: '', unit: UNITS[0], qty: '', price: '' }] };
}
const formTotal = () => S.form.items.reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0), 0);
function chainPreview() {
  const t = formTotal(), amount = S.form.currency === 'USD' ? t * (+S.settings.usdRate || 1) : t;
  const base = chainForDep(S.settings, S.me.department);
  let stages = base.filter(s => amount >= (+s.minAmount || 0));
  if (!stages.length) stages = [base[0]];
  const owner = S.users.find(u => u.isOwner);
  const who = s => !s.approvers.length ? '<span style="color:#dc2626">⚠ بدون معتمد</span>' : s.approvers[0] === S.me.id && owner ? `${esc(owner.name)} <span class="sub">(بدلاً عنك)</span>` : esc(userName(s.approvers[0]));
  const label = S.settings.chains && S.settings.chains[S.me.department] ? `سلسلة قسم ${esc(S.me.department)}` : 'السلسلة العامة';
  return `<b>مسار الموافقات الإجباري (${label}):</b> ${stages.map((s, i) => `<span class="st"><b>${i + 1}</b> ${esc(s.title)}: ${who(s)}</span>`).join(' ← ')}`;
}
function formView() {
  if (!S.form) S.form = blankForm();
  const f = S.form;
  const sel = (k, opts) => `<select data-f="${k}">${opts.map(o => `<option${o === f[k] ? ' selected' : ''}>${esc(o)}</option>`).join('')}${f[k] && !opts.includes(f[k]) ? `<option selected>${esc(f[k])}</option>` : ''}</select>`;
  const pri = Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}"${f.priority === k ? ' selected' : ''}>${v.label}</option>`).join('');
  return `<div class="pageTitle"><h2>${f.id ? 'تعديل طلب الشراء ' + esc(f.no) : 'طلب شراء جديد'}</h2></div>
  <div class="card">
    <div class="secHdr">بيانات الطلب</div>
    <div class="formGrid">
      <div class="formGroup"><label>رقم الطلب</label><input value="${esc(f.no || 'يُولّد تلقائياً عند الحفظ')}" readonly></div>
      <div class="formGroup"><label>تاريخ الطلب *</label><input type="date" data-f="requestDate" value="${esc(f.requestDate)}"></div>
      <div class="formGroup"><label>مطلوب قبل تاريخ</label><input type="date" data-f="neededBy" value="${esc(f.neededBy)}"></div>
      <div class="formGroup full"><label>موضوع الطلب *</label><input data-f="title" maxlength="150" value="${esc(f.title)}" placeholder="مثال: شراء قطع غيار لمولدة الموقع الرئيسي"></div>
      <div class="formGroup"><label>القسم الطالب</label><input value="${esc(f.department || S.me.department || '—')}" readonly title="قسم مقدم الطلب — يحدد سلسلة الموافقات"></div>
      <div class="formGroup"><label>فئة المشتريات</label>${sel('category', S.settings.categories)}</div>
      <div class="formGroup"><label>الأولوية</label><select data-f="priority">${pri}</select></div>
      <div class="formGroup"><label>المورد المقترح</label><input data-f="supplier" maxlength="150" value="${esc(f.supplier)}" placeholder="اختياري"></div>
      <div class="formGroup"><label>العملة</label><select data-f="currency"><option value="IQD"${f.currency === 'IQD' ? ' selected' : ''}>دينار عراقي (د.ع)</option><option value="USD"${f.currency === 'USD' ? ' selected' : ''}>دولار أمريكي ($)</option></select></div>
    </div>
    <div class="secHdr" style="margin-top:18px">الأصناف المطلوبة</div>
    <div class="tableWrap"><table class="items"><thead><tr><th>#</th><th style="min-width:170px">الصنف *</th><th style="min-width:160px">المواصفات</th><th>الوحدة</th><th>الكمية *</th><th>سعر الوحدة التقديري</th><th>الإجمالي</th><th></th></tr></thead>
      <tbody id="itemsBody">${itemsRows()}</tbody>
      <tfoot><tr><td colspan="6" style="text-align:left">الإجمالي التقديري</td><td class="money" id="grandTotal">${fmt(formTotal(), f.currency)}</td><td></td></tr></tfoot></table></div>
    <div class="actions"><button class="btn btn-secondary btn-sm" data-act="addItem">＋ إضافة صنف</button></div>
    <div class="formGrid" style="margin-top:14px">
      <div class="formGroup full"><label>مبرر الطلب *</label><textarea rows="3" data-f="justification" maxlength="3000" placeholder="لماذا نحتاج هذه المشتريات؟ وما أثر عدم توفرها؟">${esc(f.justification)}</textarea></div>
      <div class="formGroup full"><label>ملاحظات إضافية</label><textarea rows="2" data-f="notes" maxlength="3000">${esc(f.notes)}</textarea></div>
    </div>
    <div class="chainPreview" id="chainPreview">${chainPreview()}</div>
    <p class="help" style="margin-top:10px">يمكن إرفاق عروض الأسعار والمستندات من شاشة الطلب بعد حفظه.</p>
    <div class="actions">
      <button class="btn btn-primary" data-act="saveForm" data-submit="1">➤ إرسال للموافقة</button>
      <button class="btn btn-secondary" data-act="saveForm" data-submit="0">💾 حفظ كمسودة</button>
      <button class="btn btn-secondary" data-act="cancelForm">إلغاء</button>
    </div>
  </div>`;
}
function itemsRows() {
  const it = S.form.items;
  const units = u => UNITS.map(x => `<option${x === u ? ' selected' : ''}>${x}</option>`).join('') + (u && !UNITS.includes(u) ? `<option selected>${esc(u)}</option>` : '');
  return it.map((i, n) => `<tr>
    <td class="num">${n + 1}</td>
    <td><input data-item="${n}" data-k="name" value="${esc(i.name)}" maxlength="200" placeholder="اسم الصنف"></td>
    <td><input data-item="${n}" data-k="spec" value="${esc(i.spec)}" maxlength="300" placeholder="المواصفات / الموديل"></td>
    <td><select data-item="${n}" data-k="unit">${units(i.unit)}</select></td>
    <td><input type="number" min="0" step="any" data-item="${n}" data-k="qty" value="${esc(i.qty)}" placeholder="0"></td>
    <td><input type="number" min="0" step="any" data-item="${n}" data-k="price" value="${esc(i.price)}" placeholder="0"></td>
    <td class="money" id="line${n}">${fmt((+i.qty || 0) * (+i.price || 0))}</td>
    <td><button class="btn btn-danger btn-sm" data-act="removeItem" data-i="${n}"${it.length < 2 ? ' disabled' : ''}>✕</button></td></tr>`).join('');
}
function updateFormTotals() {
  $('grandTotal').textContent = fmt(formTotal(), S.form.currency);
  $('chainPreview').innerHTML = chainPreview();
}

// ── تفاصيل الطلب ──
function openModal(kind, title, body, tools = '', small) {
  const m = $('modal');
  m.dataset.kind = kind;
  m.querySelector('.modalBox').classList.toggle('small', !!small);
  $('modalTitle').innerHTML = title; $('modalTools').innerHTML = tools; $('modalBody').innerHTML = body;
  m.classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); S.openId = null; }
function openDetail(id) {
  const r = S.requests.find(x => x.id === id);
  if (!r) { closeModal(); return; }
  const keepComment = $('actComment') && $('modal').dataset.kind === 'detail' && S.openId === id ? $('actComment').value : '';
  S.openId = id;
  openModal('detail', `طلب شراء <b>${esc(r.no)}</b> ${badge(STATUS, r.status)} ${badge(PRIORITY, r.priority)}`, detailHtml(r), `<button class="btn btn-secondary btn-sm" data-act="print" data-id="${r.id}">🖨 طباعة</button>`);
  if (keepComment && $('actComment')) $('actComment').value = keepComment;
}
function detailHtml(r) {
  const info = (l, v) => `<div class="info"><div class="l">${l}</div><div class="v">${v || '—'}</div></div>`;
  let h = `<div class="infoGrid">
    ${info('موضوع الطلب', esc(r.title))}${info('مقدم الطلب', who(r.createdBy))}${info('تاريخ الطلب', esc(r.requestDate))}
    ${info('مطلوب قبل', esc(r.neededBy) + (isLate(r) ? ' <span class="badge b-red">متأخر</span>' : ''))}
    ${info('القسم', esc(r.department))}${info('الفئة', esc(r.category))}${info('المورد المقترح', esc(r.supplier))}${info('القيمة التقديرية', fmt(r.total, r.currency))}
  </div>
  <div class="block"><div class="blockT">مبرر الطلب</div><div class="text">${esc(r.justification) || '—'}</div></div>
  <div class="block tableWrap"><table><thead><tr><th>#</th><th>الصنف</th><th>المواصفات</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>
    ${r.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td>${esc(i.spec)}</td><td>${esc(i.unit)}</td><td>${fmt(i.qty)}</td><td>${fmt(i.price)}</td><td>${fmt(i.qty * i.price)}</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="6">الإجمالي التقديري</td><td>${fmt(r.total, r.currency)}</td></tr></tfoot></table></div>
  ${r.notes ? `<div class="block"><div class="blockT">ملاحظات</div><div class="text">${esc(r.notes)}</div></div>` : ''}
  <div class="block"><div class="blockT">سلسلة الموافقات وتتبع الطلب</div>${stepperHtml(r)}</div>
  ${attachmentsHtml(r)}`;
  if (r.po) h += `<div class="block"><div class="blockT">أمر الشراء</div><div class="infoGrid">
    ${info('رقم الأمر', esc(r.po.no))}${info('المورد', esc(r.po.supplier))}${info('التاريخ', esc(r.po.date))}${info('المبلغ الفعلي', fmt(r.po.amount, r.currency))}
    ${info('موعد التوريد المتوقع', esc(r.po.expected))}${info('أصدره', who(r.po.by))}</div></div>`;
  if (r.receipts.length) h += `<div class="block"><div class="blockT">سجل الاستلام</div>${r.receipts.map(x => `<div class="att">${x.complete ? '<span class="badge b-green">كامل</span>' : '<span class="badge b-teal">جزئي</span>'} <span>${esc(x.date)} — ${who(x.by)}${x.invoice ? ' — فاتورة ' + esc(x.invoice) : ''}${x.note ? '<div class="sub">' + esc(x.note) + '</div>' : ''}</span></div>`).join('')}</div>`;
  h += actionsHtml(r);
  h += `<div class="block"><div class="blockT">السجل الزمني (سجل التدقيق)</div><ul class="timeline">${r.history.slice().reverse().map(x => `<li><span class="tlDot ${esc(x.action)}"></span><div><b>${esc(ACTIONS[x.action] || x.action)}</b> — ${who(x.by)}<div class="sub">${dt(x.at)}</div>${x.comment ? `<div class="cmt">${esc(x.comment)}</div>` : ''}</div></li>`).join('')}</ul></div>`;
  return h;
}
function stepperHtml(r) {
  const ic = { approved: '✓', rejected: '✕', returned: '↩', pending: '…', waiting: '', skipped: '–' };
  const lbl = { approved: 'تمت الموافقة', rejected: 'مرفوض', returned: 'أُعيد للتعديل', pending: 'بانتظار القرار', waiting: 'لم يصل بعد', skipped: 'لم يُنفّذ' };
  const ended = ['rejected', 'cancelled'].includes(r.status);
  const steps = [{ title: 'تقديم الطلب', status: r.submittedAt ? 'approved' : 'pending', by: r.createdBy, at: r.submittedAt || r.createdAt, approvers: [] }, ...r.chain];
  const last = r.receipts[r.receipts.length - 1];
  steps.push({ title: 'إصدار أمر الشراء', status: ['ordered', 'partial', 'received'].includes(r.status) ? 'approved' : r.status === 'approved' ? 'pending' : ended ? 'skipped' : 'waiting', by: r.po && r.po.by, at: r.po && r.po.at, approvers: S.settings.buyers, comment: r.po ? 'أمر ' + r.po.no : '', buyers: true, startedAt: r.approvedAt });
  steps.push({ title: 'الاستلام والإغلاق', status: r.status === 'received' ? 'approved' : r.status === 'partial' ? 'pending' : ended ? 'skipped' : 'waiting', by: last && last.by, at: last && last.at, approvers: [] });
  return `<ol class="stepper">${steps.map((s, i) => {
    let line = '';
    if (s.at && s.by && s.status !== 'pending') line = `${who(s.by)} · ${dt(s.at)}`;
    else if (s.status === 'pending' && i > 0) line = (s.buyers ? 'قسم المشتريات / مدير النظام' : s.approvers && s.approvers.length ? 'بانتظار: ' + esc(s.approvers.map(userName).join('، ')) : 'مدير النظام') + (s.startedAt ? ` · منذ ${daysSince(s.startedAt)} يوم` : '');
    else if (s.status === 'waiting' && !s.buyers && s.approvers && s.approvers.length) line = 'المعتمد: ' + esc(s.approvers.map(userName).join('، '));
    return `<li class="step ${s.status}"><span class="stepIc">${ic[s.status] || i}</span><div class="stepB"><div class="stepT">${esc(s.title)} <span class="stepS">${lbl[s.status] || ''}</span></div>${line ? `<div class="sub">${line}</div>` : ''}${s.comment ? `<div class="cmt">${esc(s.comment)}</div>` : ''}</div></li>`;
  }).join('')}</ol>`;
}
function attachmentsHtml(r) {
  const canAdd = (isOwner(r) || isAdmin() || S.me.isBuyer) && !['rejected', 'cancelled', 'received'].includes(r.status);
  const canDel = a => isAdmin() || (a.by.id === S.me.id && !['rejected', 'cancelled', 'received'].includes(r.status));
  if (!r.attachments.length && !canAdd) return '';
  return `<div class="block"><div class="blockT">المرفقات (عروض أسعار، فواتير، مستندات)</div><div class="attList">
    ${r.attachments.map(a => `<div class="att">📎 <a href="/api/requests/${r.id}/attachments/${a.id}" target="_blank" rel="noopener">${esc(a.name)}</a><span class="sub">${sizeTxt(a.size)} · ${who(a.by)} · ${dt(a.at)}</span>${canDel(a) ? `<button class="btn btn-danger btn-sm" data-act="delAtt" data-id="${r.id}" data-att="${a.id}">✕</button>` : ''}</div>`).join('') || '<div class="sub">لا توجد مرفقات.</div>'}
    ${canAdd ? `<label class="btn btn-secondary btn-sm" style="align-self:flex-start">＋ إرفاق ملف (حتى 8 ميغابايت)<input type="file" data-upload="${r.id}" hidden></label>` : ''}
  </div></div>`;
}
function actionsHtml(r) {
  const owner = isOwner(r) || isAdmin();
  const btns = []; let extra = '';
  if (canApprove(r)) {
    extra += `<div class="note">أنت المخوّل باتخاذ القرار في مرحلة: <b>${esc(curStep(r).title)}</b></div>`;
    btns.push(`<button class="btn btn-success" data-act="decide" data-d="approved" data-id="${r.id}">✔ موافقة</button>`,
      `<button class="btn btn-secondary" data-act="decide" data-d="returned" data-id="${r.id}">↩ إعادة للتعديل</button>`,
      `<button class="btn btn-danger" data-act="decide" data-d="rejected" data-id="${r.id}">✕ رفض</button>`);
  } else if (r.status === 'pending' && isOwner(r)) {
    extra += '<div class="note">لا يمكنك اعتماد طلب قدّمته بنفسك (مبدأ فصل المهام).</div>';
  }
  if (owner && ['draft', 'returned'].includes(r.status)) {
    btns.push(`<button class="btn btn-primary" data-act="edit" data-id="${r.id}">✎ تعديل الطلب</button>`,
      `<button class="btn btn-success" data-act="submitExisting" data-id="${r.id}">➤ ${r.status === 'returned' ? 'إعادة الإرسال' : 'إرسال للموافقة'}</button>`);
  }
  if (owner && r.status === 'draft') btns.push(`<button class="btn btn-danger" data-act="deleteDraft" data-id="${r.id}">🗑 حذف المسودة</button>`);
  const canCancel = owner && ['pending', 'returned', 'approved'].includes(r.status);
  if (canCancel) btns.push(`<button class="btn btn-danger" data-act="cancelReq" data-id="${r.id}">⊘ إلغاء الطلب</button>`);
  if (S.me.isBuyer && r.status === 'approved') {
    extra += `<div class="subForm"><div class="blockT">إصدار أمر الشراء</div><div class="formGrid">
      <div class="formGroup"><label>رقم أمر الشراء *</label><input id="poNo" maxlength="60"></div>
      <div class="formGroup"><label>المورد المعتمد *</label><input id="poSupplier" maxlength="150" value="${esc(r.supplier)}"></div>
      <div class="formGroup"><label>المبلغ الفعلي (${CUR[r.currency]}) *</label><input id="poAmount" type="number" min="0" step="any" value="${r.total}"></div>
      <div class="formGroup"><label>تاريخ الأمر</label><input id="poDate" type="date" value="${today()}"></div>
      <div class="formGroup"><label>موعد التوريد المتوقع</label><input id="poExpected" type="date" value="${esc(r.neededBy)}"></div>
    </div><div class="actions"><button class="btn btn-primary" data-act="issuePo" data-id="${r.id}">📄 تسجيل أمر الشراء</button></div></div>`;
  }
  if ((S.me.isBuyer || isOwner(r)) && ['ordered', 'partial'].includes(r.status)) {
    extra += `<div class="subForm"><div class="blockT">تسجيل الاستلام</div><div class="formGrid">
      <div class="formGroup"><label>نوع الاستلام</label><select id="rcvType"><option value="full">استلام كامل وإغلاق الطلب</option><option value="partial">استلام جزئي</option></select></div>
      <div class="formGroup"><label>تاريخ الاستلام</label><input id="rcvDate" type="date" value="${today()}"></div>
      <div class="formGroup"><label>رقم الفاتورة / وصل الاستلام</label><input id="rcvInvoice" maxlength="60"></div>
      <div class="formGroup full"><label>ملاحظة الاستلام</label><input id="rcvNote" maxlength="1000" placeholder="مطابقة الكميات والمواصفات..."></div>
    </div><div class="actions"><button class="btn btn-success" data-act="receive" data-id="${r.id}">📦 تأكيد الاستلام</button></div></div>`;
  }
  if (!btns.length && !extra) return '';
  const needComment = canApprove(r) || canCancel;
  return `<div class="block actBox"><div class="blockT">الإجراءات</div>${extra}
    ${needComment ? '<div class="formGroup"><label>ملاحظات القرار (إلزامية عند الرفض أو الإعادة أو الإلغاء)</label><textarea id="actComment" rows="2" maxlength="1000"></textarea></div>' : ''}
    ${btns.length ? `<div class="actions">${btns.join('')}</div>` : ''}</div>`;
}

// ── الطباعة والتصدير ──
function printRequest(id) {
  const r = S.requests.find(x => x.id === id); if (!r) return;
  const w = window.open('', '_blank');
  if (!w) return toast('⚠ اسمح بالنوافذ المنبثقة للطباعة', true);
  const lbl = { approved: 'موافق', rejected: 'مرفوض', returned: 'معاد للتعديل', pending: 'بانتظار القرار', waiting: '—', skipped: '—' };
  const sig = [{ title: 'مقدم الطلب', by: r.createdBy, at: r.submittedAt, status: r.submittedAt ? 'approved' : 'pending', comment: '' }, ...r.chain];
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(r.no)}</title><style>
    body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#111;margin:24px;font-size:12px}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px double #0f766e;padding-bottom:10px;margin-bottom:14px}
    .hd h1{margin:0;font-size:20px}.co{font-size:15px;font-weight:bold;color:#0f766e}
    .meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #999;margin-bottom:12px}.meta div{border:1px solid #ccc;padding:6px}.meta b{display:block;font-size:10px;color:#555}
    table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #999;padding:6px;text-align:right}th{background:#eef7f6}
    tfoot td{font-weight:bold;background:#f6f6f6}.box{border:1px solid #999;padding:8px;margin:8px 0;min-height:28px;white-space:pre-wrap}
    h3{font-size:13px;margin:14px 0 4px}.sig td{height:40px}.ft{margin-top:18px;font-size:10px;color:#666;text-align:center}
  </style></head><body>
    <div class="hd"><div><div class="co">${esc(S.company)}</div><h1>نموذج طلب شراء</h1></div>
      <div><div><b>رقم الطلب:</b> ${esc(r.no)}</div><div><b>الحالة:</b> ${esc(STATUS[r.status].label)}</div><div><b>الأولوية:</b> ${esc(PRIORITY[r.priority].label)}</div></div></div>
    <div class="meta">
      <div><b>تاريخ الطلب</b>${esc(r.requestDate)}</div><div><b>مطلوب قبل</b>${esc(r.neededBy || '—')}</div><div><b>مقدم الطلب</b>${who(r.createdBy)}</div><div><b>القسم</b>${esc(r.department)}</div>
      <div><b>الفئة</b>${esc(r.category)}</div><div><b>المورد المقترح</b>${esc(r.supplier || '—')}</div><div><b>العملة</b>${CUR[r.currency]}</div><div><b>المرفقات</b>${r.attachments.length}</div>
    </div>
    <h3>موضوع الطلب</h3><div class="box">${esc(r.title)}</div>
    <h3>الأصناف المطلوبة</h3>
    <table><thead><tr><th>#</th><th>الصنف</th><th>المواصفات</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>
      ${r.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td>${esc(i.spec)}</td><td>${esc(i.unit)}</td><td>${fmt(i.qty)}</td><td>${fmt(i.price)}</td><td>${fmt(i.qty * i.price)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="6">الإجمالي التقديري</td><td>${fmt(r.total, r.currency)}</td></tr></tfoot></table>
    <h3>مبرر الطلب</h3><div class="box">${esc(r.justification)}</div>
    ${r.notes ? `<h3>ملاحظات</h3><div class="box">${esc(r.notes)}</div>` : ''}
    ${r.po ? `<h3>أمر الشراء</h3><div class="box">رقم ${esc(r.po.no)} — ${esc(r.po.supplier)} — ${fmt(r.po.amount, r.currency)} — بتاريخ ${esc(r.po.date)}</div>` : ''}
    <h3>التواقيع والموافقات</h3>
    <table class="sig"><thead><tr><th>المرحلة</th><th>الاسم</th><th>القرار</th><th>التاريخ</th><th>الملاحظات</th><th style="width:110px">التوقيع</th></tr></thead><tbody>
      ${sig.map(s => `<tr><td>${esc(s.title)}</td><td>${s.by ? who(s.by) : ''}</td><td>${esc(lbl[s.status] || '')}</td><td>${s.at ? dt(s.at) : ''}</td><td>${esc(s.comment || '')}</td><td></td></tr>`).join('')}
      <tr><td>قسم المشتريات</td><td>${r.po ? who(r.po.by) : ''}</td><td>${r.po ? 'صدر أمر الشراء' : ''}</td><td>${r.po ? dt(r.po.at) : ''}</td><td></td><td></td></tr>
      <tr><td>أمين المخزن (الاستلام)</td><td></td><td></td><td></td><td></td><td></td></tr>
    </tbody></table>
    <div class="ft">طُبع من نظام طلبات الشراء بتاريخ ${dt(new Date().toISOString())} بواسطة ${esc(S.me.name)}</div>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
function exportCsv() {
  const head = ['رقم الطلب', 'التاريخ', 'الموضوع', 'القسم', 'الفئة', 'مقدم الطلب', 'الأولوية', 'الحالة', 'المرحلة الحالية', 'القيمة التقديرية', 'العملة', 'رقم أمر الشراء', 'المورد', 'المبلغ الفعلي', 'مطلوب قبل', 'تاريخ الإغلاق'];
  const rows = filtered().map(r => { const s = curStep(r); return [r.no, r.requestDate, r.title, r.department, r.category, r.createdBy.name, PRIORITY[r.priority].label, STATUS[r.status].label, s ? s.title : '', r.total, r.currency, r.po && r.po.no, r.po && r.po.supplier, r.po && r.po.amount, r.neededBy, r.closedAt ? r.closedAt.slice(0, 10) : '']; });
  const csv = '﻿' + [head, ...rows].map(a => a.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `طلبات-الشراء-${today()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── إعدادات سلسلة الموافقات ──
const curChain = () => (S.chainDep ? S.draft.chains[S.chainDep] : S.draft.chain);
function chainSummary(c) {
  if (!c || !c.length) return '<span class="sub">—</span>';
  return c.map(x => `${esc(x.title)}: ${x.approvers.length ? esc(userName(x.approvers[0])) : '<span style="color:#dc2626">⚠ بدون معتمد</span>'}`).join(' ← ');
}
function settingsView() {
  if (!S.draft) { S.draft = { ...JSON.parse(JSON.stringify(S.settings)), company: S.company }; S.draft.chains = S.draft.chains || {}; }
  const d = S.draft, active = S.users.filter(u => u.active);
  if (S.chainDep && !S.settings.departments.includes(S.chainDep)) S.chainDep = '';
  const picks = (sel, attr) => active.map(u => `<label class="pick"><input type="checkbox" ${attr} value="${u.id}"${sel.includes(u.id) ? ' checked' : ''}> ${esc(u.name)}${u.department ? ` <span class="sub">(${esc(u.department)})</span>` : ''}</label>`).join('') || '<span class="sub">أضف مستخدمين أولاً من تبويب المستخدمون.</span>';
  const usersIn = dep => S.users.filter(u => u.active && u.department === dep).length;
  const rows = S.settings.departments.map(dep => {
    const own = d.chains[dep];
    return `<tr class="row${S.chainDep === dep ? ' mine' : ''}" data-act="chainDep" data-dep="${esc(dep)}"><td><b>${esc(dep)}</b><div class="sub">${usersIn(dep)} مستخدم</div></td>
      <td>${own ? '<span class="badge b-teal">سلسلة خاصة</span>' : '<span class="badge b-gray">السلسلة العامة</span>'}</td><td class="sub" style="color:var(--ink2)">${chainSummary(own || d.chain)}</td>
      <td><button class="btn btn-secondary btn-sm" data-act="chainDep" data-dep="${esc(dep)}">تعديل</button></td></tr>`;
  }).join('');
  const dep = S.chainDep, own = dep ? d.chains[dep] : d.chain;
  let editor;
  if (dep && !own) {
    editor = `<div class="dbMsg ok" style="margin:0">قسم <b>${esc(dep)}</b> يستخدم الآن <b>السلسلة العامة</b>: ${chainSummary(d.chain)}</div>
      <div class="actions"><button class="btn btn-primary" data-act="chainCreate">＋ إنشاء سلسلة خاصة لقسم ${esc(dep)}</button></div>`;
  } else {
    const c = own;
    editor = c.map((st, i) => `<div class="stageRow">
      <div class="stageHead"><span class="stageNo">${i + 1}</span>
        <div class="formGroup"><label>اسم المرحلة</label><input data-stage="${i}" data-k="title" value="${esc(st.title)}" maxlength="80"></div>
        <div class="formGroup"><label>تُطبَّق إذا كانت القيمة ≥ (د.ع)</label><input type="number" min="0" step="any" data-stage="${i}" data-k="minAmount" value="${+st.minAmount || 0}"></div>
        <button class="btn btn-secondary btn-sm" data-act="stageMove" data-i="${i}" data-dir="-1"${i === 0 ? ' disabled' : ''}>▲</button>
        <button class="btn btn-secondary btn-sm" data-act="stageMove" data-i="${i}" data-dir="1"${i === c.length - 1 ? ' disabled' : ''}>▼</button>
        <button class="btn btn-danger btn-sm" data-act="stageRemove" data-i="${i}"${c.length < 2 ? ' disabled' : ''}>✕</button>
      </div>
      <div class="formGroup" style="max-width:420px"><label>المعتمد (المستخدم الذي ينتقل إليه الطلب في هذه المرحلة) *</label>
        <select data-stage-user="${i}"${st.approvers.length ? '' : ' style="border-color:#f87171"'}><option value="">— اختر المستخدم —</option>${active.map(u => `<option value="${u.id}"${st.approvers[0] === u.id ? ' selected' : ''}>${esc(u.name)}${u.department ? ' — ' + esc(u.department) : ''}</option>`).join('')}</select></div>
    </div>`).join('') + `<div class="actions" style="margin-top:0"><button class="btn btn-secondary btn-sm" data-act="stageAdd">＋ إضافة مرحلة</button>
      ${dep ? `<button class="btn btn-danger btn-sm" data-act="chainDrop">حذف السلسلة الخاصة والرجوع إلى العامة</button>` : ''}</div>`;
  }
  return `<div class="pageTitle"><h2>سلاسل الموافقات حسب الأقسام</h2></div>
  <div class="card">
    <div class="dbMsg ok" style="margin:0 0 12px">🔒 هذه الإعدادات لك وحدك بصفتك <b>مالك النظام</b>، ولا يستطيع أي مستخدم آخر تغييرها، حتى مديرو النظام. السلاسل <b>إجبارية على كل الطلبات وكل المستخدمين</b> بلا استثناء.</div>
    <p class="help">لكل قسم سلسلة موافقات خاصة به: طلب أي مستخدم يمر تلقائياً بسلسلة <b>قسمه</b>، ولا يستطيع اختيار قسم آخر. القسم الذي ليس له سلسلة خاصة يستخدم <b>السلسلة العامة</b>. ينتقل الطلب من مستخدم إلى مستخدم، ولا يرى المعتمد الطلب إلا بعد موافقة المرحلة التي قبله. إذا كان مقدم الطلب هو معتمد إحدى المراحل فأنت من يعتمدها بدلاً عنه. اضغط على أي قسم لتعديل سلسلته، ثم احفظ.</p>
    <div class="tableWrap"><table><thead><tr><th>القسم</th><th>السلسلة المطبّقة</th><th>المراحل والمعتمدون</th><th></th></tr></thead><tbody>
      <tr class="row${!dep ? ' mine' : ''}" data-act="chainDep" data-dep=""><td><b>⭐ السلسلة العامة</b><div class="sub">للأقسام بدون سلسلة خاصة</div></td><td><span class="badge b-blue">عامة</span></td><td class="sub" style="color:var(--ink2)">${chainSummary(d.chain)}</td><td><button class="btn btn-secondary btn-sm" data-act="chainDep" data-dep="">تعديل</button></td></tr>
      ${rows}
    </tbody></table></div>
  </div>
  <div class="card">
    <div class="secHdr">${dep ? `سلسلة قسم ${esc(dep)}` : 'السلسلة العامة'}</div>
    ${editor}
    <div class="actions"><button class="btn btn-primary" data-act="saveSettings">💾 حفظ كل السلاسل</button><button class="btn btn-secondary" data-act="resetDraft">تراجع عن التغييرات</button></div>
  </div>
  <div class="card">
    <div class="secHdr">المشتريات والإعدادات العامة</div>
    <label class="sub" style="display:block;margin-bottom:5px">موظفو المشتريات (يصدرون أوامر الشراء ويسجلون الاستلام — مدير النظام مخوّل دائماً):</label>
    <div class="pickList" style="margin-bottom:14px">${picks(d.buyers, 'data-buyer')}</div>
    <div class="formGrid">
      <div class="formGroup"><label>اسم الشركة / الجهة</label><input data-draft="company" value="${esc(d.company)}" maxlength="120"></div>
      <div class="formGroup"><label>سعر صرف الدولار (لتحديد مسار الموافقات)</label><input type="number" min="1" data-draft="usdRate" value="${+d.usdRate || 1310}"></div>
      <div class="formGroup"></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-act="saveSettings">💾 حفظ الإعدادات</button>
      <button class="btn btn-secondary" data-act="resetDraft">تراجع عن التغييرات</button>
    </div>
  </div>
  <div class="card">
    <div class="secHdr">النسخ الاحتياطي</div>
    <p class="help">كل البيانات (الطلبات والمرفقات والمستخدمين) محفوظة في قاعدة بيانات SQL Server. خذ نسخة احتياطية بشكل دوري؛ يُحفظ الملف في مجلد النسخ الافتراضي لـ SQL Server على هذا الجهاز.</p>
    <button class="btn btn-secondary" data-act="backup">🗄 أخذ نسخة احتياطية الآن</button>
  </div>
  <div class="card" id="dbCard"><div class="sub">جارٍ تحميل إعدادات قاعدة البيانات…</div></div>`;
}

// ── المستخدمون ──
function usersView() {
  const depList = `<datalist id="depList">${S.settings.departments.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  const roleOpts = sel => Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');
  const chips = (key, list) => `<div class="chips">${list.map((x, i) => `<span class="chip">${esc(x)}<button data-act="listRemove" data-list="${key}" data-i="${i}" title="حذف">✕</button></span>`).join('')}</div>
    <div class="chipAdd"><input id="add_${key}" maxlength="80" placeholder="${key === 'departments' ? 'اسم قسم جديد، مثل: المشتريات' : 'اسم فئة جديدة'}"><button class="btn btn-secondary btn-sm" data-act="listAdd" data-list="${key}">＋ إضافة</button></div>`;
  return `<div class="pageTitle"><h2>المستخدمون والأقسام</h2></div>
  <div class="card"><div class="secHdr">إضافة مستخدم</div>
    <form data-submit="addUser">${depList}<div class="formGrid">
      <div class="formGroup"><label>الاسم الكامل *</label><input name="name" required maxlength="80"></div>
      <div class="formGroup"><label>اسم المستخدم (إنجليزي) *</label><input name="username" required maxlength="60" dir="ltr" autocomplete="off"></div>
      <div class="formGroup"><label>كلمة المرور * (6 أحرف على الأقل)</label><input name="password" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="formGroup"><label>القسم * (اختر أو اكتب قسماً جديداً)</label><input name="department" list="depList" maxlength="80" autocomplete="off" required></div>
      <div class="formGroup"><label>الصلاحية</label><select name="role">${roleOpts('user')}</select></div>
      ${S.me.isOwner ? '<div class="formGroup" style="justify-content:flex-end"><label class="check"><input type="checkbox" name="buyer" value="1"> موظف مشتريات (يصدر أوامر الشراء ويسجل الاستلام)</label></div>' : ''}
    </div><div class="actions"><button class="btn btn-primary" type="submit">＋ إضافة المستخدم</button></div></form>
    <p class="help" style="margin-top:10px"><b>مستخدم:</b> يقدّم طلبات ويعتمد المرحلة المعيّن لها. <b>موظف مشتريات:</b> يرى الطلبات بعد اكتمال موافقتها، ويصدر أمر الشراء ويسجل الاستلام. <b>مشاهد:</b> يرى كل الطلبات للتدقيق دون أي إجراء. <b>مدير النظام:</b> يدير المستخدمين والأقسام. <b>مالك النظام</b> (أنت) وحده يضبط سلسلة الموافقات.</p>
  </div>
  <div class="card"><div class="tableWrap"><table><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>القسم</th><th>الصلاحية</th><th>دوره في سير العمل</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${S.users.map(u => {
      const roles = [...S.settings.chain.filter(s => s.approvers.includes(u.id)).map(s => `معتمد: ${s.title} (العامة)`),
        ...Object.entries(S.settings.chains || {}).flatMap(([dep, c]) => c.filter(s => s.approvers.includes(u.id)).map(s => `معتمد: ${s.title} (${dep})`))];
      if (S.settings.buyers.includes(u.id)) roles.push('موظف مشتريات');
      const locked = u.isOwner && !S.me.isOwner;
      return `<tr><td><b>${esc(u.name)}</b>${u.isOwner ? ' <span class="badge b-amber">👑 مالك النظام</span>' : ''}</td><td dir="ltr" style="text-align:right">${esc(u.username)}</td><td>${esc(u.department || '—')}</td><td>${esc(ROLES[u.role])}</td>
      <td>${roles.map(s => `<span class="badge b-teal">${esc(s)}</span>`).join(' ') || '<span class="sub">—</span>'}</td>
      <td>${u.active ? '<span class="badge b-green">فعّال</span>' : '<span class="badge b-gray">موقوف</span>'}</td>
      <td><button class="btn btn-secondary btn-sm" data-act="editUser" data-id="${u.id}"${locked ? ' disabled title="حساب مالك النظام يعدّله صاحبه فقط"' : ''}>تعديل</button></td></tr>`;
    }).join('')}
  </tbody></table></div></div>
  <div class="card"><div class="secHdr">الأقسام</div><p class="help">تظهر في نموذج الطلب وعند إضافة المستخدمين. حذف القسم من القائمة لا يغيّر الطلبات والمستخدمين المسجلين عليه.</p>${chips('departments', S.settings.departments)}</div>
  <div class="card"><div class="secHdr">فئات المشتريات</div>${chips('categories', S.settings.categories)}</div>`;
}
function editUserModal(id) {
  const u = S.users.find(x => x.id === id); if (!u) return;
  const lockOwner = u.isOwner ? ' disabled' : '';
  openModal('user', 'تعديل المستخدم' + (u.isOwner ? ' — مالك النظام' : ''), `<form data-submit="saveUser" data-id="${u.id}"><datalist id="depList2">${S.settings.departments.map(x => `<option value="${esc(x)}">`).join('')}</datalist><div class="formGrid" style="grid-template-columns:1fr 1fr">
    <div class="formGroup"><label>الاسم الكامل</label><input name="name" value="${esc(u.name)}" required maxlength="80"></div>
    <div class="formGroup"><label>القسم</label><input name="department" list="depList2" value="${esc(u.department)}" maxlength="80" autocomplete="off"></div>
    <div class="formGroup"><label>الصلاحية</label><select name="role"${lockOwner}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === u.role ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="formGroup"><label>الحالة</label><select name="active"${lockOwner}><option value="1"${u.active ? ' selected' : ''}>فعّال</option><option value="0"${!u.active ? ' selected' : ''}>موقوف (لا يستطيع الدخول)</option></select></div>
    ${S.me.isOwner ? `<div class="formGroup full"><label class="check"><input type="checkbox" name="buyer" value="1"${S.settings.buyers.includes(u.id) ? ' checked' : ''}> موظف مشتريات (يصدر أوامر الشراء ويسجل الاستلام)</label></div>` : ''}
    <div class="formGroup full"><label>كلمة مرور جديدة (اتركها فارغة لعدم التغيير)</label><input name="password" type="password" minlength="6" autocomplete="new-password"></div>
  </div><div class="actions"><button class="btn btn-primary" type="submit">💾 حفظ</button><button class="btn btn-secondary" type="button" data-act="closeModal">إلغاء</button></div></form>`, '', true);
}

// ── معالجات الأحداث ──
const ACT = {
  view(d) { S.view = d.v; if (d.v === 'new') S.form = blankForm(); if (d.v === 'settings') S.draft = null; renderApp(); window.scrollTo(0, 0); },
  async logout() { try { await api('POST', '/api/logout', {}); } catch (_) { /* ignore */ } S.me = null; renderLogin(); },
  open(d) { openDetail(d.id); },
  closeModal() { closeModal(); },
  print(d) { printRequest(d.id); },
  exportCsv() { exportCsv(); },
  addItem() { S.form.items.push({ name: '', spec: '', unit: UNITS[0], qty: '', price: '' }); $('itemsBody').innerHTML = itemsRows(); updateFormTotals(); },
  removeItem(d) { if (S.form.items.length < 2) return; S.form.items.splice(+d.i, 1); $('itemsBody').innerHTML = itemsRows(); updateFormTotals(); },
  cancelForm() { S.form = null; S.view = 'list'; renderApp(); },
  async saveForm(d) {
    const submit = d.submit === '1', f = S.form;
    if (submit && !confirm('إرسال الطلب إلى سلسلة الموافقات؟ لن تستطيع تعديله إلا إذا أُعيد إليك.')) return;
    const body = { ...f, submit, items: f.items.map(i => ({ ...i, qty: +i.qty || 0, price: +i.price || 0 })) };
    try {
      const res = f.id ? await api('PUT', '/api/requests/' + f.id, body) : await api('POST', '/api/requests', body);
      toast(submit ? `تم إرسال الطلب ${res.no} للموافقة` : `تم حفظ المسودة ${res.no}`);
      S.form = null; S.view = 'list';
      await refresh();
      openDetail(res.id);
    } catch (e) { toast('⚠ ' + e.message, true); }
  },
  edit(d) {
    const r = S.requests.find(x => x.id === d.id); if (!r) return;
    S.form = { id: r.id, no: r.no, requestDate: r.requestDate, neededBy: r.neededBy, title: r.title, department: r.department, category: r.category, priority: r.priority, supplier: r.supplier, currency: r.currency, justification: r.justification, notes: r.notes, items: r.items.map(i => ({ ...i })) };
    closeModal(); S.view = 'new'; renderApp(); window.scrollTo(0, 0);
  },
  submitExisting(d) {
    const r = S.requests.find(x => x.id === d.id); if (!r) return;
    if (!confirm('إرسال الطلب إلى سلسلة الموافقات؟')) return;
    run(() => api('PUT', '/api/requests/' + r.id, { ...r, submit: true }), 'تم إرسال الطلب للموافقة');
  },
  deleteDraft(d) {
    if (!confirm('حذف المسودة نهائياً؟')) return;
    run(async () => { await api('DELETE', '/api/requests/' + d.id); closeModal(); }, 'تم حذف المسودة');
  },
  decide(d) {
    const comment = ($('actComment') || {}).value || '';
    if (d.d !== 'approved' && comment.trim().length < 3) return toast('⚠ اكتب سبب ' + (d.d === 'rejected' ? 'الرفض' : 'الإعادة') + ' في خانة الملاحظات', true);
    if (!confirm({ approved: 'تأكيد الموافقة على الطلب؟', rejected: 'تأكيد رفض الطلب؟', returned: 'إعادة الطلب لمقدمه للتعديل؟' }[d.d])) return;
    run(() => api('POST', `/api/requests/${d.id}/decision`, { decision: d.d, comment }), { approved: 'تمت الموافقة', rejected: 'تم رفض الطلب', returned: 'أُعيد الطلب لمقدمه' }[d.d]);
  },
  cancelReq(d) {
    const comment = ($('actComment') || {}).value || '';
    if (comment.trim().length < 3) return toast('⚠ اكتب سبب الإلغاء في خانة الملاحظات', true);
    if (!confirm('إلغاء طلب الشراء نهائياً؟')) return;
    run(() => api('POST', `/api/requests/${d.id}/cancel`, { comment }), 'تم إلغاء الطلب');
  },
  issuePo(d) {
    run(() => api('POST', `/api/requests/${d.id}/po`, { no: $('poNo').value, supplier: $('poSupplier').value, amount: +$('poAmount').value || 0, date: $('poDate').value, expected: $('poExpected').value }), 'تم تسجيل أمر الشراء');
  },
  receive(d) {
    const complete = $('rcvType').value === 'full';
    if (complete && !confirm('تأكيد الاستلام الكامل وإغلاق الطلب؟')) return;
    run(() => api('POST', `/api/requests/${d.id}/receive`, { complete, date: $('rcvDate').value, invoice: $('rcvInvoice').value, note: $('rcvNote').value }), complete ? 'تم الاستلام وإغلاق الطلب' : 'تم تسجيل استلام جزئي');
  },
  delAtt(d) {
    if (!confirm('حذف المرفق؟')) return;
    run(() => api('DELETE', `/api/requests/${d.id}/attachments/${d.att}`), 'تم حذف المرفق');
  },
  stageMove(d) { const c = curChain(), i = +d.i, j = i + +d.dir; [c[i], c[j]] = [c[j], c[i]]; renderView(); },
  stageRemove(d) { const c = curChain(); if (c.length > 1) { c.splice(+d.i, 1); renderView(); } },
  stageAdd() { curChain().push({ key: 's' + Date.now(), title: 'مرحلة جديدة', approvers: [], minAmount: 0 }); renderView(); },
  chainDep(d) { S.chainDep = d.dep || ''; renderView(); },
  chainCreate() { S.draft.chains[S.chainDep] = JSON.parse(JSON.stringify(S.draft.chain)).map((x, i) => ({ ...x, key: 'd' + Date.now() + i })); renderView(); },
  chainDrop() { if (!confirm(`حذف سلسلة قسم ${S.chainDep} الخاصة؟ سيستخدم القسم السلسلة العامة بعد الحفظ.`)) return; delete S.draft.chains[S.chainDep]; renderView(); },
  resetDraft() { S.draft = null; renderView(); },
  saveSettings() {
    const { departments, categories, ...body } = S.draft;
    run(async () => { await api('PUT', '/api/settings', body); S.draft = null; }, 'تم حفظ الإعدادات');
  },
  async backup() {
    try { const r = await api('POST', '/api/backup', {}); alert('تم حفظ النسخة الاحتياطية في:\n' + r.file); }
    catch (e) { toast('⚠ ' + e.message, true); }
  },
  async dbTest(d, el) {
    const f = el.closest('form');
    dbMsg('جارٍ اختبار الاتصال…');
    try {
      const r = await api('POST', '/api/db-config/test', dbFormData(f));
      const note = r.dbExists ? 'قاعدة البيانات موجودة وسيستخدمها البرنامج.' : r.canCreate ? 'قاعدة البيانات غير موجودة وسيُنشئها البرنامج عند الحفظ.' : '⚠ قاعدة البيانات غير موجودة والحساب لا يملك صلاحية إنشائها — شغّل schema.sql أولاً أو استخدم حساباً آخر.';
      dbMsg(`✔ الاتصال ناجح — SQL Server ${esc(r.version)} (${esc(r.edition)})<br>${note}`, !r.dbExists && !r.canCreate);
    } catch (e) { dbMsg(esc(e.message), true); }
  },
  editUser(d) { editUserModal(d.id); },
  listAdd(d) {
    const el = $('add_' + d.list), v = el.value.trim();
    if (!v) return el.focus();
    if (S.settings[d.list].includes(v)) return toast('⚠ موجود مسبقاً', true);
    run(() => api('PUT', '/api/lists', { [d.list]: [...S.settings[d.list], v] }), 'تمت الإضافة');
  },
  listRemove(d) {
    const list = S.settings[d.list], v = list[+d.i];
    if (!confirm(`حذف "${v}" من القائمة؟`)) return;
    run(() => api('PUT', '/api/lists', { [d.list]: list.filter((_, i) => i !== +d.i) }), 'تم الحذف');
  },
  changePassword() {
    openModal('pw', 'تغيير كلمة المرور', `<form data-submit="changePw"><div class="formGroup"><label>كلمة المرور الحالية</label><input name="current" type="password" required autocomplete="current-password"></div>
      <div class="formGroup" style="margin-top:10px"><label>كلمة المرور الجديدة (6 أحرف على الأقل)</label><input name="next" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="actions"><button class="btn btn-primary" type="submit">حفظ</button></div></form>`, '', true);
  },
};
Object.assign(SUBMIT, {
  async addUser(f) {
    const b = Object.fromEntries(new FormData(f)); b.buyer = b.buyer === '1';
    const ok = await run(() => api('POST', '/api/users', b), 'تمت إضافة المستخدم');
    if (ok) S.view = 'users';
  },
  async saveUser(f) {
    const b = Object.fromEntries(new FormData(f));
    if (b.active !== undefined) b.active = b.active === '1';
    if (S.me.isOwner) b.buyer = b.buyer === '1';
    if (await run(() => api('PUT', '/api/users/' + f.dataset.id, b), 'تم حفظ المستخدم')) closeModal();
  },
  async changePw(f) {
    try { await api('POST', '/api/me/password', Object.fromEntries(new FormData(f))); closeModal(); toast('تم تغيير كلمة المرور'); }
    catch (e) { toast('⚠ ' + e.message, true); }
  },
});

document.addEventListener('click', e => {
  if (e.target.id === 'modal') return closeModal();
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el); }
});
document.addEventListener('submit', e => {
  const fn = SUBMIT[e.target.dataset.submit];
  if (fn) { e.preventDefault(); fn(e.target); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('add_')) { e.preventDefault(); ACT.listAdd({ list: e.target.id.slice(4) }); return; } if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });
document.addEventListener('wheel', e => { if (document.activeElement && document.activeElement.type === 'number' && e.target === document.activeElement) document.activeElement.blur(); }, { passive: true });
document.addEventListener('input', e => {
  const el = e.target, d = el.dataset;
  if (d.filter) { S.filters[d.filter] = el.value; return renderTable(); }
  if (d.f && S.form) { S.form[d.f] = el.value; if (d.f === 'currency') updateFormTotals(); return; }
  if (d.item !== undefined && S.form) {
    const it = S.form.items[+d.item]; if (!it) return;
    it[d.k] = el.value;
    if (d.k === 'qty' || d.k === 'price') { $('line' + d.item).textContent = fmt((+it.qty || 0) * (+it.price || 0)); updateFormTotals(); }
    return;
  }
  if (!S.draft) return;
  if (d.stage !== undefined) { const s = curChain()[+d.stage]; s[d.k] = d.k === 'minAmount' ? +el.value || 0 : el.value; return; }
  if (d.draft) { S.draft[d.draft] = d.draft === 'usdRate' ? +el.value || 0 : el.value; return; }
  if (d.draftList) { S.draft[d.draftList] = el.value.split('\n').map(x => x.trim()).filter(Boolean); }
});
document.addEventListener('change', e => {
  const el = e.target, d = el.dataset;
  if (d.upload) return uploadFile(d.upload, el);
  if (!S.draft) return;
  const toggle = (arr, v, on) => { const i = arr.indexOf(v); if (on && i < 0) arr.push(v); if (!on && i >= 0) arr.splice(i, 1); };
  if (d.stageUser !== undefined) { curChain()[+d.stageUser].approvers = el.value ? [el.value] : []; el.style.borderColor = el.value ? '' : '#f87171'; }
  else if (d.buyer !== undefined) toggle(S.draft.buyers, el.value, el.checked);
  else if (d.draftBool) S.draft[d.draftBool] = el.checked;
});
function uploadFile(id, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { input.value = ''; return toast('⚠ حجم الملف أكبر من 8 ميغابايت', true); }
  const reader = new FileReader();
  reader.onload = () => {
    const data = String(reader.result).split(',')[1] || '';
    toast('جارٍ رفع الملف…');
    run(() => api('POST', `/api/requests/${id}/attachments`, { name: file.name, type: file.type, data }), 'تم إرفاق الملف');
  };
  reader.readAsDataURL(file);
}

init();
