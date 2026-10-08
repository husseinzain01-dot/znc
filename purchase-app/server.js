// نظام طلبات الشراء وسلسلة الموافقات — خادم محلي يعمل على SQL Server
// التشغيل: start.bat على ويندوز (أو: node server.js)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const store = require('./db');

const PORT = +process.env.PORT || 4810;
const HOST = process.env.HOST || '127.0.0.1'; // محلي فقط: يعمل على هذا الجهاز ولا يظهر على الشبكة
const PUB = path.join(__dirname, 'public');
const SESSION_HOURS = 12;
const MAX_UPLOAD = 8 * 1024 * 1024;

const DEFAULT_SETTINGS = {
  chain: [
    { key: 's1', title: 'مدير القسم', approvers: [], minAmount: 0 },
    { key: 's2', title: 'مدير المشتريات', approvers: [], minAmount: 0 },
    { key: 's3', title: 'المدير المالي', approvers: [], minAmount: 0 },
    { key: 's4', title: 'المدير العام', approvers: [], minAmount: 0 },
  ],
  chains: {}, // سلسلة خاصة لكل قسم: { 'اسم القسم': [مراحل] } — الأقسام بدونها تستخدم السلسلة العامة
  buyers: [], usdRate: 1310,
  departments: ['الإدارة', 'المشتريات', 'المالية', 'الإنتاج', 'الصيانة', 'المخازن', 'أخرى'],
  categories: ['مواد خام', 'معدات وأجهزة', 'قطع غيار وصيانة', 'مستلزمات تشغيل', 'قرطاسية ومكتبية', 'خدمات', 'أخرى'],
};

// المستخدمون والإعدادات محفوظة في SQL Server ومنسوخة في الذاكرة (هذا الخادم هو الكاتب الوحيد)
const cache = { users: [], settings: { ...DEFAULT_SETTINGS }, company: '', ownerId: null };
const dbState = { error: '' };
async function reloadCache() {
  cache.users = await store.loadUsers();
  const s = await store.loadSettings();
  cache.settings = { ...DEFAULT_SETTINGS, ...(s.workflow || {}) };
  delete cache.settings.allowSelfApproval; // السلسلة إجبارية: لا استثناءات
  cache.company = s.company || '';
  cache.ownerId = s.owner || null;
  // ترحيل: إن لم يُحدَّد مالك، فهو أول مدير نظام أُنشئ
  if (!cache.users.some(u => u.id === cache.ownerId)) {
    const first = cache.users.find(u => u.role === 'admin');
    cache.ownerId = first ? first.id : null;
    if (first) await store.saveSetting('owner', first.id);
  }
}
const isSystemOwner = u => !!u && u.id === cache.ownerId;
const ownerOnly = user => { if (!isSystemOwner(user)) fail(403, 'هذه الإعدادات لمالك النظام فقط'); };

// كل عمليات الكتابة تُنفَّذ بالتسلسل لمنع تعارض التعديلات المتزامنة
let queue = Promise.resolve();
function exclusive(fn) { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; }

// ── أدوات ──
const now = () => new Date().toISOString();
const newId = () => crypto.randomBytes(8).toString('hex');
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const numv = v => { const n = +v; return Number.isFinite(n) && n >= 0 ? n : 0; };
const dateStr = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function checkPassword(user, pw) {
  const h = crypto.scryptSync(String(pw), user.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ── الجلسات ──
const sessions = new Map();
const loginFails = new Map();
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  const s = sid && sessions.get(sid);
  if (!s || s.exp < Date.now()) { if (sid) sessions.delete(sid); return null; }
  const u = cache.users.find(x => x.id === s.userId && x.active);
  if (!u) return null;
  s.exp = Date.now() + SESSION_HOURS * 3600e3;
  return u;
}
function startSession(res, user) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { userId: user.id, exp: Date.now() + SESSION_HOURS * 3600e3 });
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}
function endSessionsOf(userId) { for (const [sid, s] of sessions) if (s.userId === userId) sessions.delete(sid); }

// ── قواعد سير العمل (تُطبَّق في الخادم فلا يمكن تجاوزها من المتصفح) ──
const ref = u => ({ id: u.id, name: u.name });
const isAdmin = u => u.role === 'admin';
const isBuyer = u => isAdmin(u) || cache.settings.buyers.includes(u.id);
const isOwner = (u, r) => r.createdBy.id === u.id;
const curStep = r => (r.status === 'pending' ? r.chain[r.currentStep] : null);
// معتمد المرحلة: المستخدم المحدد لها (مراحل الطلبات القديمة بدون معتمد يعتمدها مدير النظام)
const stepApprover = (u, s) => (s.approvers.length ? s.approvers.includes(u.id) : isSystemOwner(u));
const REACHED = ['pending', 'approved', 'rejected', 'returned'];
function canApprove(u, r) {
  const step = curStep(r);
  if (!step) return false;
  if (isOwner(u, r)) return false; // لا أحد يعتمد طلبه بنفسه
  return stepApprover(u, step);
}
// المعتمد لا يرى الطلب إلا بعد وصوله إلى مرحلته (أي بعد موافقة المراحل التي قبله)
function canSee(u, r) {
  if (isOwner(u, r)) return true;
  if (r.status === 'draft') return false;
  if (u.role === 'viewer') return true;
  if (r.chain.some(s => REACHED.includes(s.status) && stepApprover(u, s))) return true;
  return isBuyer(u) && ['approved', 'ordered', 'partial', 'received'].includes(r.status);
}
// تقدّم الطلب إلى المرحلة التالية غير المتخطاة
function advance(r, from) {
  for (let i = from; i < r.chain.length; i++) {
    if (r.chain[i].status === 'skipped') continue;
    r.currentStep = i;
    Object.assign(r.chain[i], { status: 'pending', startedAt: now() });
    return true;
  }
  return false;
}
function log(r, u, action, comment) { r.history.push({ at: now(), by: ref(u), action, comment: comment || '', _new: true }); r.updatedAt = now(); }
// سلسلة من مستخدم إلى مستخدم: لكل مرحلة معتمد واحد محدد
// سلسلة القسم الخاصة إن وُجدت، وإلا السلسلة العامة
const chainFor = dep => (dep && cache.settings.chains && Array.isArray(cache.settings.chains[dep]) && cache.settings.chains[dep].length ? cache.settings.chains[dep] : cache.settings.chain);
function buildChain(total, requester) {
  const base = chainFor(requester.department);
  let stages = base.filter(s => total >= (+s.minAmount || 0));
  if (!stages.length) stages = [base[0]];
  const active = new Set(cache.users.filter(x => x.active).map(x => x.id));
  const missing = stages.find(s => !s.approvers.length || !active.has(s.approvers[0]));
  if (missing) fail(400, `مرحلة "${missing.title}" ليس لها معتمد فعّال — يجب على مالك النظام تحديد معتمد لكل مرحلة في إعدادات سلسلة الموافقات`);
  // كل المراحل إجبارية: إذا كان مقدم الطلب هو معتمد المرحلة، يعتمدها مالك النظام بدلاً عنه
  const chain = stages.map(s => {
    let approver = s.approvers[0], comment = '';
    if (approver === requester.id) {
      if (!cache.ownerId || cache.ownerId === requester.id) fail(400, `أنت معتمد مرحلة "${s.title}" ولا يوجد من يعتمدها بدلاً عنك — عيّن معتمداً آخر لها في إعدادات سلسلة الموافقات`);
      const owner = cache.users.find(x => x.id === cache.ownerId);
      approver = cache.ownerId;
      comment = `يعتمدها مالك النظام (${owner ? owner.name : ''}) بدلاً عن مقدم الطلب`;
    }
    return { key: s.key, title: s.title, approvers: [approver], minAmount: +s.minAmount || 0, status: 'waiting', by: null, at: null, comment, startedAt: null };
  });
  return chain;
}
function cleanRequestFields(b) {
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200).map(i => ({
    name: str(i.name, 200), spec: str(i.spec, 300), unit: str(i.unit, 30), qty: numv(i.qty), price: numv(i.price),
  })).filter(i => i.name || i.qty || i.price);
  const f = {
    title: str(b.title, 150), requestDate: dateStr(b.requestDate) || now().slice(0, 10), neededBy: dateStr(b.neededBy),
    department: str(b.department, 80), category: str(b.category, 80), priority: ['normal', 'urgent', 'emergency'].includes(b.priority) ? b.priority : 'normal',
    supplier: str(b.supplier, 150), currency: b.currency === 'USD' ? 'USD' : 'IQD', justification: str(b.justification, 3000), notes: str(b.notes, 3000),
    items, total: Math.round(items.reduce((s, i) => s + i.qty * i.price, 0) * 100) / 100,
  };
  if (!f.items.length || f.items.some(i => !i.name)) fail(400, 'أضف صنفاً واحداً على الأقل مع اسمه');
  return f;
}
function submit(u, r) {
  if (!r.title) fail(400, 'موضوع الطلب مطلوب');
  if (r.items.some(i => !(i.qty > 0))) fail(400, 'الكمية يجب أن تكون أكبر من صفر لكل صنف');
  if (r.justification.length < 10) fail(400, 'اكتب مبرراً واضحاً للطلب (10 أحرف على الأقل)');
  if (r.neededBy && r.neededBy < r.requestDate) fail(400, 'تاريخ الحاجة لا يمكن أن يسبق تاريخ الطلب');
  const wasReturned = r.status === 'returned';
  const requester = cache.users.find(x => x.id === r.createdBy.id) || u;
  r.department = requester.department || '';
  r.chain = buildChain(r.currency === 'USD' ? r.total * (+cache.settings.usdRate || 1) : r.total, requester);
  advance(r, 0); r.status = 'pending'; r.submittedAt = now();
  log(r, u, wasReturned ? 'resubmitted' : 'submitted');
}
async function findRequest(u, id) {
  const r = (await store.loadRequests(String(id).slice(0, 32)))[0];
  if (!r || !canSee(u, r)) fail(404, 'الطلب غير موجود');
  return r;
}
// تحميل الطلب ثم تعديله وحفظه كاملاً داخل معاملة SQL واحدة
function mutate(u, id, fn) {
  return exclusive(async () => {
    const r = await findRequest(u, id);
    await store.inTransaction(async tx => { await fn(r, tx); await store.saveRequest(tx, r, false); });
    return { ok: true };
  });
}
function publicUser(u, full) {
  const o = { id: u.id, name: u.name, department: u.department || '', role: u.role, active: u.active, isOwner: isSystemOwner(u) };
  if (full) o.username = u.username;
  return o;
}

// ── المسارات ──
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

route('GET', '/api/status', ({ user }) => ({
  dbConfigured: !!store.loadConfig(), dbReady: store.isConnected(), dbError: dbState.error,
  needsSetup: cache.users.length === 0, company: cache.company, loggedIn: !!user,
}), { public: true, noDb: true });

// ── إعدادات الاتصال بـ SQL Server (من المتصفح) ──
// مسموحة قبل الاتصال أو قبل إنشاء أول حساب (الجهاز محلي فقط)، وبعدها لمدير النظام فقط
function dbConfigAllowed(user) {
  if (!store.isConnected() || cache.users.length === 0) return;
  if (!user) fail(401, 'سجّل الدخول بحساب مالك النظام لتغيير إعدادات قاعدة البيانات');
  if (!isSystemOwner(user)) fail(403, 'تغيير إعدادات قاعدة البيانات لمالك النظام فقط');
}
function configFromBody(body) {
  const saved = store.loadConfig();
  const c = store.normalizeConfig(body);
  // كلمة المرور لا تُرسل للمتصفح أبداً؛ تركها فارغة يعني الإبقاء على المحفوظة
  if (!body.password && saved && !body.clearPassword) c.password = saved.password;
  const err = store.validateConfig(c);
  if (err) fail(400, err);
  return c;
}
route('GET', '/api/db-config', ({ user }) => {
  dbConfigAllowed(user);
  const c = store.loadConfig() || store.DEFAULT_CONFIG;
  return { ...c, password: '', hasPassword: !!c.password, connected: store.isConnected(), serverLabel: store.serverLabel(), database: c.database };
}, { public: true, noDb: true });
route('POST', '/api/db-config/test', async ({ user, body }) => {
  dbConfigAllowed(user);
  try { return { ok: true, ...(await store.testConnection(configFromBody(body))) }; }
  catch (e) { if (e instanceof HttpError) throw e; fail(400, e.message); }
}, { public: true, noDb: true });
route('POST', '/api/db-config', ({ user, body }) => exclusive(async () => {
  dbConfigAllowed(user);
  const c = configFromBody(body);
  const old = store.loadConfig();
  try { await store.connect(c); } catch (e) { fail(400, e.message); }
  store.saveConfig(c);
  dbState.error = '';
  await reloadCache();
  // الانتقال إلى خادم أو قاعدة بيانات أخرى يُنهي الجلسات الحالية
  if (!old || old.server !== c.server || old.instance !== c.instance || old.port !== c.port || old.database !== c.database) sessions.clear();
  console.log(`Connected to ${store.DB_NAME} on ${store.serverLabel()}`);
  return { ok: true, needsSetup: cache.users.length === 0 };
}), { public: true, noDb: true });

route('POST', '/api/setup', ({ body, res }) => exclusive(async () => {
  if (cache.users.length) fail(400, 'تم الإعداد مسبقاً');
  const name = str(body.name, 80), username = str(body.username, 60).toLowerCase();
  if (!name || !username) fail(400, 'الاسم واسم المستخدم مطلوبان');
  if (!/^[a-z0-9._@-]+$/.test(username)) fail(400, 'اسم المستخدم بالأحرف الإنجليزية والأرقام فقط');
  if (String(body.password || '').length < 6) fail(400, 'كلمة المرور يجب ألا تقل عن 6 أحرف');
  const user = { id: newId(), name, username, role: 'admin', department: str(body.department, 80) || 'الإدارة', active: true, ...hashPassword(body.password) };
  await store.saveUser(user);
  await store.saveSetting('company', str(body.company, 120));
  await store.saveSetting('owner', user.id);
  await store.saveSetting('workflow', DEFAULT_SETTINGS);
  await reloadCache();
  startSession(res, user);
  return { ok: true };
}), { public: true });

route('POST', '/api/login', ({ body, res }) => {
  const username = str(body.username, 60).toLowerCase();
  const f = loginFails.get(username);
  if (f && f.count >= 5 && Date.now() - f.at < 60e3) fail(429, 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة');
  const user = cache.users.find(x => x.username === username && x.active);
  if (!user || !checkPassword(user, body.password || '')) {
    loginFails.set(username, { count: (f && Date.now() - f.at < 60e3 ? f.count : 0) + 1, at: Date.now() });
    fail(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  loginFails.delete(username);
  startSession(res, user);
  return { ok: true };
}, { public: true });

route('POST', '/api/logout', ({ req, res }) => {
  const sid = parseCookies(req).sid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return { ok: true };
}, { public: true, noDb: true });

route('GET', '/api/bootstrap', async ({ user }) => ({
  me: { ...publicUser(user, true), isBuyer: isBuyer(user) },
  company: cache.company,
  settings: cache.settings,
  users: cache.users.map(x => publicUser(x, isAdmin(user))),
  requests: (await store.loadRequests()).filter(r => canSee(user, r)),
}));

route('POST', '/api/me/password', ({ user, body }) => exclusive(async () => {
  if (!checkPassword(user, body.current || '')) fail(400, 'كلمة المرور الحالية غير صحيحة');
  if (String(body.next || '').length < 6) fail(400, 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف');
  await store.saveUser({ ...user, ...hashPassword(body.next) });
  await reloadCache();
  return { ok: true };
}));

// ── طلبات الشراء ──
route('POST', '/api/requests', ({ user, body }) => exclusive(async () => {
  if (user.role === 'viewer') fail(403, 'حساب المشاهدة لا يمكنه إنشاء طلبات');
  const f = cleanRequestFields(body);
  const r = { id: newId(), no: '', createdAt: now(), createdBy: ref(user), status: 'draft', chain: [], currentStep: 0, history: [], receipts: [], attachments: [], po: null, ...f, department: user.department || '' };
  log(r, user, 'created');
  if (body.submit) submit(user, r);
  await store.inTransaction(async tx => { r.no = await store.nextNumber(tx); await store.saveRequest(tx, r, true); });
  return { id: r.id, no: r.no };
}));

route('PUT', '/api/requests/:id', ({ user, body, params }) => mutate(user, params.id, r => {
  if (!(isOwner(user, r) || isAdmin(user))) fail(403, 'لا يمكنك تعديل هذا الطلب');
  if (!['draft', 'returned'].includes(r.status)) fail(400, 'لا يمكن تعديل الطلب في حالته الحالية');
  Object.assign(r, cleanRequestFields(body), { department: r.department });
  log(r, user, 'edited');
  if (body.submit) submit(user, r);
}));

route('DELETE', '/api/requests/:id', ({ user, params }) => exclusive(async () => {
  const r = await findRequest(user, params.id);
  if (r.status !== 'draft' || !(isOwner(user, r) || isAdmin(user))) fail(400, 'يمكن حذف المسودات فقط');
  await store.inTransaction(tx => store.deleteRequest(tx, r.id));
  return { ok: true };
}));

route('POST', '/api/requests/:id/decision', ({ user, body, params }) => mutate(user, params.id, r => {
  const decision = body.decision, comment = str(body.comment, 1000);
  if (!['approved', 'rejected', 'returned'].includes(decision)) fail(400, 'قرار غير صالح');
  if (!canApprove(user, r)) fail(409, 'لم يعد هذا الطلب بانتظار موافقتك (ربما اتخذ مستخدم آخر إجراءً عليه)');
  if (decision !== 'approved' && comment.length < 3) fail(400, 'اكتب سبب ' + (decision === 'rejected' ? 'الرفض' : 'الإعادة'));
  const step = r.chain[r.currentStep];
  Object.assign(step, { status: decision, by: ref(user), at: now(), comment });
  log(r, user, decision, step.title + (comment ? ' — ' + comment : ''));
  if (decision === 'approved') {
    if (!advance(r, r.currentStep + 1)) { r.status = 'approved'; r.approvedAt = now(); }
  } else {
    r.status = decision;
    r.chain.forEach((s, i) => { if (i > r.currentStep && s.status === 'waiting') s.status = 'skipped'; });
  }
}));

route('POST', '/api/requests/:id/cancel', ({ user, body, params }) => mutate(user, params.id, r => {
  const comment = str(body.comment, 1000);
  if (!(isOwner(user, r) || isAdmin(user)) || !['pending', 'returned', 'approved'].includes(r.status)) fail(400, 'لا يمكن إلغاء الطلب في حالته الحالية');
  if (comment.length < 3) fail(400, 'اكتب سبب الإلغاء');
  r.chain.forEach(s => { if (s.status === 'pending' || s.status === 'waiting') s.status = 'skipped'; });
  r.status = 'cancelled';
  log(r, user, 'cancelled', comment);
}));

route('POST', '/api/requests/:id/po', ({ user, body, params }) => mutate(user, params.id, r => {
  if (!isBuyer(user) || r.status !== 'approved') fail(400, 'لا يمكن إصدار أمر شراء لهذا الطلب');
  const po = { no: str(body.no, 60), supplier: str(body.supplier, 150), amount: numv(body.amount), date: dateStr(body.date) || now().slice(0, 10), expected: dateStr(body.expected) };
  if (!po.no) fail(400, 'رقم أمر الشراء مطلوب');
  if (!po.supplier) fail(400, 'اسم المورد مطلوب');
  if (!(po.amount > 0)) fail(400, 'أدخل المبلغ الفعلي لأمر الشراء');
  r.po = { ...po, by: ref(user), at: now() };
  r.status = 'ordered';
  const diff = r.total ? (po.amount - r.total) / r.total * 100 : 0;
  log(r, user, 'ordered', `أمر ${po.no} — ${po.supplier} — ${po.amount.toLocaleString('en-US')}${Math.abs(diff) >= 0.5 ? ` (${diff > 0 ? '+' : ''}${diff.toFixed(1)}% عن التقدير)` : ''}`);
}));

route('POST', '/api/requests/:id/receive', ({ user, body, params }) => mutate(user, params.id, r => {
  if (!(isBuyer(user) || isOwner(user, r)) || !['ordered', 'partial'].includes(r.status)) fail(400, 'لا يمكن تسجيل الاستلام لهذا الطلب');
  const rc = { complete: !!body.complete, date: dateStr(body.date) || now().slice(0, 10), invoice: str(body.invoice, 60), note: str(body.note, 1000) };
  if (!rc.complete && !rc.note) fail(400, 'وضّح في الملاحظة ما تم استلامه وما تبقى');
  r.receipts.push({ ...rc, by: ref(user), at: now(), _new: true });
  r.status = rc.complete ? 'received' : 'partial';
  if (rc.complete) r.closedAt = now();
  log(r, user, rc.complete ? 'received' : 'partial', [rc.invoice && 'فاتورة ' + rc.invoice, rc.note].filter(Boolean).join(' — '));
}));

// المرفقات (عروض أسعار، فواتير...) تُحفظ داخل SQL Server
route('POST', '/api/requests/:id/attachments', ({ user, body, params }) => mutate(user, params.id, async (r, tx) => {
  if (!(isOwner(user, r) || isAdmin(user) || isBuyer(user)) || ['rejected', 'cancelled', 'received'].includes(r.status)) fail(403, 'لا يمكنك إضافة مرفق لهذا الطلب');
  const buf = Buffer.from(String(body.data || ''), 'base64');
  if (!buf.length) fail(400, 'الملف فارغ');
  if (buf.length > MAX_UPLOAD) fail(400, 'حجم الملف أكبر من 8 ميغابايت');
  if (r.attachments.length >= 15) fail(400, 'الحد الأقصى 15 مرفقاً للطلب');
  const att = { id: newId(), name: str(body.name, 150).replace(/[\\/:*?"<>|]/g, '_') || 'file', type: str(body.type, 100) || 'application/octet-stream', size: buf.length, by: ref(user), at: now() };
  await store.insertAttachment(tx, r.id, att, buf);
  log(r, user, 'attached', att.name);
}), { maxBody: MAX_UPLOAD * 1.4 + 1e4 });

route('GET', '/api/requests/:id/attachments/:att', async ({ user, params, res }) => {
  const r = await findRequest(user, params.id);
  const a = r.attachments.find(x => x.id === params.att);
  const content = a && await store.attachmentContent(r.id, a.id);
  if (!content) fail(404, 'المرفق غير موجود');
  const inline = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(a.type);
  res.writeHead(200, {
    'Content-Type': inline ? a.type : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  res.end(content);
  return undefined;
});

route('DELETE', '/api/requests/:id/attachments/:att', ({ user, params }) => mutate(user, params.id, async (r, tx) => {
  const a = r.attachments.find(x => x.id === params.att);
  if (!a) fail(404, 'المرفق غير موجود');
  if (!(isAdmin(user) || (a.by.id === user.id && !['rejected', 'cancelled', 'received'].includes(r.status)))) fail(403, 'لا يمكنك حذف هذا المرفق');
  await store.deleteAttachment(tx, r.id, a.id);
  log(r, user, 'detached', a.name);
}));

// ── الإعدادات والمستخدمون (للمدير فقط) ──
const adminOnly = user => { if (!isAdmin(user)) fail(403, 'هذه العملية للمدير فقط'); };
route('PUT', '/api/settings', ({ user, body }) => exclusive(async () => {
  ownerOnly(user);
  const ids = new Set(cache.users.filter(u => u.active).map(u => u.id));
  const cleanChain = (raw, label) => {
    const chain = (Array.isArray(raw) ? raw : []).slice(0, 12).map((s, i) => ({
      key: str(s.key, 40) || `s${Date.now()}${i}`, title: str(s.title, 80), minAmount: numv(s.minAmount),
      approvers: (Array.isArray(s.approvers) ? s.approvers : []).filter(id => ids.has(id)).slice(0, 1),
    }));
    if (!chain.length || chain.some(s => !s.title)) fail(400, `${label}: اسم كل مرحلة مطلوب`);
    const noUser = chain.find(s => !s.approvers.length);
    if (noUser) fail(400, `${label}: حدّد المعتمد لمرحلة "${noUser.title}" — كل مرحلة تنتقل إلى مستخدم محدد`);
    if (!chain.some(s => !(s.minAmount > 0))) fail(400, `${label}: يجب أن تكون مرحلة واحدة على الأقل بحد أدنى 0 حتى تمر عليها كل الطلبات`);
    return chain;
  };
  const chain = cleanChain(body.chain, 'السلسلة العامة');
  const chains = {};
  for (const [dep, raw] of Object.entries(body.chains && typeof body.chains === 'object' ? body.chains : {})) {
    const name = str(dep, 80);
    if (!name || !cache.settings.departments.includes(name)) continue;
    chains[name] = cleanChain(raw, `سلسلة قسم ${name}`);
  }
  const list = (v, d) => { const a = (Array.isArray(v) ? v : []).map(x => str(x, 80)).filter(Boolean); return a.length ? a : d; };
  await store.saveSetting('workflow', {
    chain, chains, buyers: (Array.isArray(body.buyers) ? body.buyers : []).filter(id => ids.has(id)),
    usdRate: numv(body.usdRate) || 1310,
    departments: body.departments ? list(body.departments, cache.settings.departments) : cache.settings.departments,
    categories: body.categories ? list(body.categories, cache.settings.categories) : cache.settings.categories,
  });
  if (body.company !== undefined) await store.saveSetting('company', str(body.company, 120));
  await reloadCache();
  return { ok: true };
}));

// الأقسام وفئات المشتريات — يديرها مدير النظام
async function saveWorkflow(patch) { await store.saveSetting('workflow', { ...cache.settings, ...patch }); await reloadCache(); }
const cleanList = v => [...new Set((Array.isArray(v) ? v : []).map(x => str(x, 80)).filter(Boolean))].slice(0, 100);
route('PUT', '/api/lists', ({ user, body }) => exclusive(async () => {
  adminOnly(user);
  const patch = {};
  if (body.departments) {
    patch.departments = cleanList(body.departments);
    if (!patch.departments.length) fail(400, 'يجب أن يبقى قسم واحد على الأقل');
    const removed = cache.settings.departments.filter(d => !patch.departments.includes(d));
    const used = removed.find(d => cache.users.some(u => u.active && u.department === d));
    if (used) fail(400, `لا يمكن حذف قسم "${used}" لأن فيه مستخدمين فعّالين — انقلهم إلى قسم آخر أولاً`);
    if (removed.some(d => (cache.settings.chains || {})[d])) {
      patch.chains = { ...cache.settings.chains };
      removed.forEach(d => delete patch.chains[d]);
    }
  }
  if (body.categories) { patch.categories = cleanList(body.categories); if (!patch.categories.length) fail(400, 'يجب أن تبقى فئة واحدة على الأقل'); }
  await saveWorkflow(patch);
  return { ok: true };
}));
// موظفو المشتريات جزء من سير العمل، فيحددهم مالك النظام فقط
async function applyBuyerFlag(user, userId, flag) {
  if (flag === undefined) return;
  const has = cache.settings.buyers.includes(userId);
  if (!!flag === has) return;
  ownerOnly(user);
  await saveWorkflow({ buyers: flag ? [...cache.settings.buyers, userId] : cache.settings.buyers.filter(x => x !== userId) });
}
async function ensureDepartment(dep) {
  if (dep && !cache.settings.departments.includes(dep)) await saveWorkflow({ departments: [...cache.settings.departments, dep] });
}

route('POST', '/api/users', ({ user, body }) => exclusive(async () => {
  adminOnly(user);
  const username = str(body.username, 60).toLowerCase();
  if (!str(body.name) || !username) fail(400, 'الاسم واسم المستخدم مطلوبان');
  if (!/^[a-z0-9._@-]+$/.test(username)) fail(400, 'اسم المستخدم بالأحرف الإنجليزية والأرقام فقط');
  if (cache.users.some(u => u.username === username)) fail(400, 'اسم المستخدم مستخدم مسبقاً');
  if (String(body.password || '').length < 6) fail(400, 'كلمة المرور يجب ألا تقل عن 6 أحرف');
  if (body.buyer && !isSystemOwner(user)) fail(403, 'تحديد موظفي المشتريات لمالك النظام فقط');
  if (!str(body.department, 80)) fail(400, 'حدّد قسم المستخدم — سلسلة الموافقات تُحدَّد حسب القسم');
  const id = newId();
  await store.saveUser({ id, name: str(body.name, 80), username, role: ['admin', 'user', 'viewer'].includes(body.role) ? body.role : 'user', department: str(body.department, 80), active: true, ...hashPassword(body.password) });
  await reloadCache();
  await ensureDepartment(str(body.department, 80));
  await applyBuyerFlag(user, id, body.buyer ? true : undefined);
  return { ok: true };
}));

route('PUT', '/api/users/:id', ({ user, body, params }) => exclusive(async () => {
  adminOnly(user);
  const u = cache.users.find(x => x.id === params.id);
  if (!u) fail(404, 'المستخدم غير موجود');
  if (isSystemOwner(u) && !isSystemOwner(user)) fail(403, 'لا يمكن تعديل حساب مالك النظام إلا من صاحبه');
  const next = { ...u };
  if (isSystemOwner(u) && ((body.role && body.role !== 'admin') || body.active === false)) fail(400, 'حساب مالك النظام يبقى مدير نظام فعّالاً دائماً');
  next.role = ['admin', 'user', 'viewer'].includes(body.role) ? body.role : u.role;
  next.active = body.active !== undefined ? !!body.active : u.active;
  const otherAdmins = cache.users.filter(x => x.id !== u.id && x.role === 'admin' && x.active).length;
  if ((next.role !== 'admin' || !next.active) && !otherAdmins) fail(400, 'يجب أن يبقى مدير نظام فعّال واحد على الأقل');
  const where = [['السلسلة العامة', cache.settings.chain], ...Object.entries(cache.settings.chains || {}).map(([d, c]) => ['سلسلة قسم ' + d, c])]
    .map(([label, c]) => { const st = c.find(x => x.approvers.includes(u.id)); return st && `"${st.title}" في ${label}`; }).find(Boolean);
  if (!next.active && where) fail(400, `هذا المستخدم معتمد مرحلة ${where} — عيّن معتمداً آخر لها في إعدادات سلسلة الموافقات قبل إيقافه`);
  if (body.name !== undefined) next.name = str(body.name, 80) || u.name;
  if (body.department !== undefined) next.department = str(body.department, 80);
  if (body.password) {
    if (String(body.password).length < 6) fail(400, 'كلمة المرور يجب ألا تقل عن 6 أحرف');
    Object.assign(next, hashPassword(body.password));
  }
  if (body.buyer !== undefined && !!body.buyer !== cache.settings.buyers.includes(u.id)) ownerOnly(user);
  await store.saveUser(next);
  if (body.password || !next.active) endSessionsOf(u.id);
  await reloadCache();
  await ensureDepartment(next.department);
  await applyBuyerFlag(user, u.id, body.buyer);
  return { ok: true };
}));

route('POST', '/api/backup', ({ user }) => exclusive(async () => {
  adminOnly(user);
  try { return { ok: true, file: await store.backupDatabase() }; }
  catch (e) { fail(400, 'تعذر أخذ النسخة الاحتياطية: ' + e.message + ' — يحتاج حساب قاعدة البيانات صلاحية BACKUP DATABASE (أو خذ النسخة من SQL Server Management Studio)'); }
}));

// ── الخادم ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
};
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new HttpError(413, 'حجم البيانات كبير جداً')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (_) { reject(new HttpError(400, 'بيانات غير صالحة')); } });
    req.on('error', reject);
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function serveStatic(res, urlPath) {
  let rel;
  try { rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, ''); } catch (_) { rel = ''; }
  const file = path.normalize(path.join(PUB, rel));
  if (!rel || !file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') fail(405, 'Method not allowed');
      return serveStatic(res, url.pathname);
    }
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) fail(404, 'غير موجود');
    const params = url.pathname.match(r.re).groups || {};
    if (req.method !== 'GET' && req.method !== 'DELETE' && !(req.headers['content-type'] || '').includes('application/json')) fail(415, 'نوع الطلب غير مدعوم');
    const user = currentUser(req);
    if (!r.noDb && !store.isConnected()) fail(503, 'البرنامج غير متصل بقاعدة البيانات — أدخل إعدادات SQL Server');
    if (!r.public && !user) fail(401, 'انتهت الجلسة، سجّل الدخول من جديد');
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req, r.maxBody || 1e6);
    const out = await r.handler({ req, res, user, body, params });
    if (out !== undefined) sendJson(res, 200, out);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'حدث خطأ غير متوقع في الخادم — راجع نافذة البرنامج' });
  }
});

function openBrowser(url) {
  if (process.env.OPEN_APP !== '1') return;
  if (process.platform === 'win32') exec(`start "" "${url}"`);
  else if (process.platform === 'darwin') exec(`open "${url}"`);
}

// استرجاع كلمة مرور مالك النظام: reset-owner-password.bat
async function resetOwnerPassword() {
  const cfg = store.loadConfig();
  if (!cfg) { console.log('No database settings yet.'); process.exit(1); }
  await store.connect(cfg); await reloadCache();
  const owner = cache.users.find(u => u.id === cache.ownerId);
  if (!owner) { console.log('No owner account found.'); process.exit(1); }
  const temp = crypto.randomBytes(4).toString('hex');
  await store.saveUser({ ...owner, active: true, role: 'admin', ...hashPassword(temp) });
  console.log('\n Owner username:      ' + owner.username);
  console.log(' Temporary password:  ' + temp);
  console.log(' Log in and change it from the key button (top bar).\n');
  process.exit(0);
}

(async () => {
  if (process.argv.includes('--reset-owner')) return resetOwnerPassword().catch(e => { console.error(e.message); process.exit(1); });
  const cfg = store.loadConfig();
  if (cfg) {
    console.log(`Connecting to SQL Server (${cfg.server}${cfg.instance ? '\\' + cfg.instance : ':' + cfg.port}) ...`);
    try {
      await store.connect(cfg);
      await reloadCache();
      if (!fs.existsSync(path.join(__dirname, 'data', 'config.json'))) store.saveConfig(cfg); // ترحيل من .env
    } catch (e) {
      dbState.error = e.message;
      console.error('[!] Could not connect to SQL Server. Fix the connection settings in the browser.');
    }
  } else {
    console.log('No database settings yet. Enter your SQL Server details in the browser.');
  }
  server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    console.log('==============================================');
    console.log(' Purchase Requests app is running');
    console.log(` Open in your browser:  ${url}`);
    if (store.isConnected()) console.log(` Database:  ${store.DB_NAME} on ${store.serverLabel()}`);
    console.log(' Keep this window open. Close it to stop the app.');
    console.log('==============================================');
    openBrowser(url);
  });
})();
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — the app is probably already running. Open http://localhost:${PORT}`);
    openBrowser(`http://localhost:${PORT}`);
  } else console.error(e);
  setTimeout(() => process.exit(1), 1500);
});
