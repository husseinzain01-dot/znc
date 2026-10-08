// طبقة قاعدة البيانات — SQL Server
'use strict';
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

// إعدادات الاتصال تُدخل من المتصفح وتُحفظ محلياً في data/config.json على هذا الجهاز
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_CONFIG = { server: 'localhost', instance: '', port: 1433, database: 'PurchaseRequestsDB', user: '', password: '', encrypt: false, trustCert: true };

function normalizeConfig(c = {}) {
  const out = {
    server: String(c.server || '').trim() || 'localhost',
    instance: String(c.instance || '').trim(),
    port: Math.min(65535, Math.max(1, parseInt(c.port, 10) || 1433)),
    database: String(c.database || '').trim() || 'PurchaseRequestsDB',
    user: String(c.user || '').trim(),
    password: String(c.password == null ? '' : c.password),
    encrypt: !!c.encrypt,
    trustCert: c.trustCert !== false,
  };
  // يدعم كتابة الخادم بصيغة localhost\SQLEXPRESS
  if (out.server.includes('\\')) { const [srv, inst] = out.server.split('\\'); out.server = srv || 'localhost'; out.instance = out.instance || inst; }
  return out;
}
function validateConfig(c) {
  if (!/^[A-Za-z0-9_]{1,100}$/.test(c.database)) return 'اسم قاعدة البيانات يجب أن يحتوي أحرفاً إنجليزية وأرقاماً و _ فقط';
  if (!c.user) return 'اسم مستخدم SQL Server مطلوب';
  if (!/^[A-Za-z0-9._\-]+$/.test(c.server)) return 'اسم الخادم غير صالح';
  if (c.instance && !/^[A-Za-z0-9_$\-]+$/.test(c.instance)) return 'اسم النسخة (Instance) غير صالح';
  return '';
}
// استيراد الإعدادات من ملف .env إن وُجد من نسخة سابقة
function readLegacyEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return null;
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!env.DB_USER || env.DB_PASSWORD === 'ChangeMe_StrongPassword') return null;
  return normalizeConfig({ server: env.DB_SERVER, port: env.DB_PORT, database: env.DB_DATABASE, user: env.DB_USER, password: env.DB_PASSWORD, encrypt: env.DB_ENCRYPT === 'true', trustCert: env.DB_TRUST_CERT !== 'false' });
}
function loadConfig() {
  try { return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); }
  catch (_) { return readLegacyEnv(); }
}
function saveConfig(c) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
}

function poolConfig(c, database) {
  const cfg = {
    server: c.server, database, user: c.user, password: c.password,
    options: { encrypt: c.encrypt, trustServerCertificate: c.trustCert, useUTC: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 12000, requestTimeout: 30000,
  };
  if (c.instance) cfg.options.instanceName = c.instance;
  else cfg.port = c.port;
  return cfg;
}

// رسالة مفهومة لأخطاء الاتصال الشائعة
function explainError(e) {
  const code = e && (e.code || (e.originalError && e.originalError.code));
  const raw = String((e && e.message) || e);
  if (code === 'ELOGIN') return 'رفض SQL Server تسجيل الدخول: اسم المستخدم أو كلمة المرور غير صحيحة، أو أن الدخول بحساب SQL (SQL Server Authentication) غير مفعّل على الخادم.';
  if (code === 'EINSTLOOKUP' || /instance/i.test(raw) && /lookup|find/i.test(raw)) return 'لم يتم العثور على النسخة (Instance). تأكد من اسمها (مثل SQLEXPRESS) وأن خدمة "SQL Server Browser" تعمل، أو اترك اسم النسخة فارغاً واكتب رقم المنفذ.';
  if (code === 'ESOCKET' || code === 'ETIMEOUT' || /ECONNREFUSED|ETIMEDOUT|getaddrinfo|Failed to connect/i.test(raw)) return 'تعذر الوصول إلى SQL Server. تأكد أن خدمة SQL Server تعمل، وأن بروتوكول TCP/IP مفعّل من SQL Server Configuration Manager، وأن اسم الخادم ورقم المنفذ صحيحان.';
  if (/permission|denied/i.test(raw)) return 'الحساب لا يملك الصلاحيات الكافية: ' + raw;
  return raw;
}

// اختبار الاتصال دون تغيير الاتصال الحالي
async function testConnection(c) {
  let p;
  try {
    p = await new sql.ConnectionPool(poolConfig(c, 'master')).connect();
    const r = (await p.request().input('db', sql.NVarChar(128), c.database).query(
      "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS ver, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100)) AS edition, DB_ID(@db) AS dbid, IS_SRVROLEMEMBER('dbcreator') AS cancreate, IS_SRVROLEMEMBER('sysadmin') AS sa"
    )).recordset[0];
    return { version: r.ver, edition: r.edition, dbExists: r.dbid != null, canCreate: !!(r.cancreate || r.sa) };
  } catch (e) { throw new Error(explainError(e)); }
  finally { if (p) await p.close().catch(() => {}); }
}

const SCHEMA = [
  `IF OBJECT_ID('dbo.users','U') IS NULL CREATE TABLE dbo.users(
    id NVARCHAR(32) NOT NULL PRIMARY KEY,
    name NVARCHAR(80) NOT NULL,
    username NVARCHAR(60) NOT NULL UNIQUE,
    role NVARCHAR(10) NOT NULL DEFAULT 'user',
    department NVARCHAR(80) NULL,
    active BIT NOT NULL DEFAULT 1,
    pass_hash NVARCHAR(128) NOT NULL,
    pass_salt NVARCHAR(32) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
  `IF OBJECT_ID('dbo.settings','U') IS NULL CREATE TABLE dbo.settings(
    [key] NVARCHAR(50) NOT NULL PRIMARY KEY,
    value NVARCHAR(MAX) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
  `IF OBJECT_ID('dbo.number_seq','U') IS NULL CREATE TABLE dbo.number_seq(
    [year] INT NOT NULL PRIMARY KEY,
    last_no INT NOT NULL)`,
  `IF OBJECT_ID('dbo.purchase_requests','U') IS NULL CREATE TABLE dbo.purchase_requests(
    id NVARCHAR(32) NOT NULL PRIMARY KEY,
    request_no NVARCHAR(20) NOT NULL UNIQUE,
    title NVARCHAR(150) NULL,
    request_date DATE NOT NULL,
    needed_by DATE NULL,
    department NVARCHAR(80) NULL,
    category NVARCHAR(80) NULL,
    priority NVARCHAR(10) NOT NULL DEFAULT 'normal',
    supplier NVARCHAR(150) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'IQD',
    justification NVARCHAR(MAX) NULL,
    notes NVARCHAR(MAX) NULL,
    total DECIMAL(18,2) NOT NULL DEFAULT 0,
    status NVARCHAR(12) NOT NULL,
    current_step INT NOT NULL DEFAULT 0,
    created_by_id NVARCHAR(32) NOT NULL,
    created_by_name NVARCHAR(80) NOT NULL,
    created_at DATETIME2 NOT NULL,
    submitted_at DATETIME2 NULL,
    approved_at DATETIME2 NULL,
    closed_at DATETIME2 NULL,
    updated_at DATETIME2 NULL,
    po_no NVARCHAR(60) NULL,
    po_supplier NVARCHAR(150) NULL,
    po_amount DECIMAL(18,2) NULL,
    po_date DATE NULL,
    po_expected DATE NULL,
    po_by_id NVARCHAR(32) NULL,
    po_by_name NVARCHAR(80) NULL,
    po_at DATETIME2 NULL)`,
  `IF OBJECT_ID('dbo.request_items','U') IS NULL CREATE TABLE dbo.request_items(
    id INT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    line_no INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    spec NVARCHAR(300) NULL,
    unit NVARCHAR(30) NULL,
    qty DECIMAL(18,3) NOT NULL DEFAULT 0,
    price DECIMAL(18,2) NOT NULL DEFAULT 0)`,
  `IF OBJECT_ID('dbo.approval_steps','U') IS NULL CREATE TABLE dbo.approval_steps(
    id INT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    step_no INT NOT NULL,
    step_key NVARCHAR(40) NULL,
    title NVARCHAR(80) NOT NULL,
    approvers_json NVARCHAR(MAX) NULL,
    min_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    status NVARCHAR(10) NOT NULL,
    by_id NVARCHAR(32) NULL,
    by_name NVARCHAR(80) NULL,
    decided_at DATETIME2 NULL,
    comment NVARCHAR(1000) NULL,
    started_at DATETIME2 NULL)`,
  `IF OBJECT_ID('dbo.request_history','U') IS NULL CREATE TABLE dbo.request_history(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    at DATETIME2 NOT NULL,
    by_id NVARCHAR(32) NOT NULL,
    by_name NVARCHAR(80) NOT NULL,
    action NVARCHAR(20) NOT NULL,
    comment NVARCHAR(2000) NULL)`,
  `IF OBJECT_ID('dbo.request_receipts','U') IS NULL CREATE TABLE dbo.request_receipts(
    id INT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    complete BIT NOT NULL,
    receipt_date DATE NOT NULL,
    invoice NVARCHAR(60) NULL,
    note NVARCHAR(1000) NULL,
    by_id NVARCHAR(32) NOT NULL,
    by_name NVARCHAR(80) NOT NULL,
    at DATETIME2 NOT NULL)`,
  `IF OBJECT_ID('dbo.request_attachments','U') IS NULL CREATE TABLE dbo.request_attachments(
    id NVARCHAR(32) NOT NULL PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    name NVARCHAR(150) NOT NULL,
    mime NVARCHAR(100) NOT NULL,
    size INT NOT NULL,
    content VARBINARY(MAX) NOT NULL,
    by_id NVARCHAR(32) NOT NULL,
    by_name NVARCHAR(80) NOT NULL,
    at DATETIME2 NOT NULL)`,
  `IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_items_request') CREATE INDEX IX_items_request ON dbo.request_items(request_id)`,
  `IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_steps_request') CREATE INDEX IX_steps_request ON dbo.approval_steps(request_id)`,
  `IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_history_request') CREATE INDEX IX_history_request ON dbo.request_history(request_id)`,
  `IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_receipts_request') CREATE INDEX IX_receipts_request ON dbo.request_receipts(request_id)`,
  `IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_att_request') CREATE INDEX IX_att_request ON dbo.request_attachments(request_id)`,
];

let pool = null;
let DB_NAME = DEFAULT_CONFIG.database;
let SERVER_LABEL = '';
async function connect(c) {
  // إنشاء قاعدة البيانات إن لم تكن موجودة (يحتاج صلاحية dbcreator، وإلا نفّذ schema.sql يدوياً)
  let next;
  try {
    const master = await new sql.ConnectionPool(poolConfig(c, 'master')).connect();
    try { await master.request().query(`IF DB_ID('${c.database}') IS NULL CREATE DATABASE [${c.database}]`); }
    catch (e) { console.warn('Could not create database automatically:', e.message); }
    finally { await master.close().catch(() => {}); }
    next = await new sql.ConnectionPool(poolConfig(c, c.database)).connect();
    for (const stmt of SCHEMA) await next.request().query(stmt);
  } catch (e) {
    if (next) await next.close().catch(() => {});
    if (/Cannot open database/i.test(e.message)) throw new Error(`قاعدة البيانات ${c.database} غير موجودة والحساب لا يملك صلاحية إنشائها. أنشئها بتشغيل ملف schema.sql في SQL Server Management Studio، أو استخدم حساباً بصلاحيات أعلى.`);
    throw new Error(explainError(e));
  }
  const old = pool;
  pool = next;
  DB_NAME = c.database;
  SERVER_LABEL = c.server + (c.instance ? '\\' + c.instance : ':' + c.port);
  if (old) await old.close().catch(() => {});
  return pool;
}
const isConnected = () => !!pool;

// تنفيذ استعلام بمعاملات: params = { name: [sql.Type, value] }
async function q(target, text, params = {}) {
  const rq = (target || pool).request();
  for (const [k, [t, v]] of Object.entries(params)) rq.input(k, t, v);
  return (await rq.query(text)).recordset || [];
}
async function inTransaction(fn) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try { const out = await fn(tx); await tx.commit(); return out; }
  catch (e) { try { await tx.rollback(); } catch (_) { /* ignore */ } throw e; }
}

// ── تحويلات ──
const iso = d => (d ? new Date(d).toISOString() : null);
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
const dateOrNull = s => (s ? new Date(s.length === 10 ? s + 'T00:00:00Z' : s) : null);
const ref = (id, name) => (id ? { id, name } : null);

// ── المستخدمون والإعدادات ──
async function loadUsers() {
  return (await q(null, 'SELECT * FROM dbo.users ORDER BY created_at')).map(u => ({
    id: u.id, name: u.name, username: u.username, role: u.role, department: u.department || '',
    active: !!u.active, hash: u.pass_hash, salt: u.pass_salt, createdAt: iso(u.created_at),
  }));
}
async function saveUser(u) {
  await q(null, `MERGE dbo.users AS t USING (SELECT @id AS id) s ON t.id=s.id
    WHEN MATCHED THEN UPDATE SET name=@name, role=@role, department=@dep, active=@active, pass_hash=@hash, pass_salt=@salt
    WHEN NOT MATCHED THEN INSERT(id,name,username,role,department,active,pass_hash,pass_salt) VALUES(@id,@name,@username,@role,@dep,@active,@hash,@salt);`, {
    id: [sql.NVarChar(32), u.id], name: [sql.NVarChar(80), u.name], username: [sql.NVarChar(60), u.username], role: [sql.NVarChar(10), u.role],
    dep: [sql.NVarChar(80), u.department || ''], active: [sql.Bit, u.active !== false], hash: [sql.NVarChar(128), u.hash], salt: [sql.NVarChar(32), u.salt],
  });
}
async function loadSettings() {
  const out = {};
  for (const r of await q(null, 'SELECT [key], value FROM dbo.settings')) { try { out[r.key] = JSON.parse(r.value); } catch (_) { /* ignore */ } }
  return out;
}
async function saveSetting(key, value) {
  await q(null, `MERGE dbo.settings AS t USING (SELECT @k AS [key]) s ON t.[key]=s.[key]
    WHEN MATCHED THEN UPDATE SET value=@v, updated_at=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT([key],value) VALUES(@k,@v);`, { k: [sql.NVarChar(50), key], v: [sql.NVarChar(sql.MAX), JSON.stringify(value)] });
}
async function nextNumber(tx) {
  const y = new Date().getFullYear();
  const rows = await q(tx, `UPDATE dbo.number_seq WITH (UPDLOCK, HOLDLOCK) SET last_no=last_no+1 WHERE [year]=@y;
    IF @@ROWCOUNT=0 INSERT INTO dbo.number_seq([year],last_no) VALUES(@y,1);
    SELECT last_no FROM dbo.number_seq WHERE [year]=@y;`, { y: [sql.Int, y] });
  return `PR-${y}-${String(rows[0].last_no).padStart(4, '0')}`;
}

// ── طلبات الشراء ──
function groupBy(rows) { const m = new Map(); for (const r of rows) { if (!m.has(r.request_id)) m.set(r.request_id, []); m.get(r.request_id).push(r); } return m; }

async function loadRequests(id) {
  const where = id ? 'WHERE request_id=@id' : '';
  const p = id ? { id: [sql.NVarChar(32), id] } : {};
  const [reqs, items, steps, hist, rcpts, atts] = [
    await q(null, `SELECT * FROM dbo.purchase_requests ${id ? 'WHERE id=@id' : ''}`, p),
    await q(null, `SELECT * FROM dbo.request_items ${where} ORDER BY line_no`, p),
    await q(null, `SELECT * FROM dbo.approval_steps ${where} ORDER BY step_no`, p),
    await q(null, `SELECT * FROM dbo.request_history ${where} ORDER BY id`, p),
    await q(null, `SELECT * FROM dbo.request_receipts ${where} ORDER BY id`, p),
    await q(null, `SELECT id,request_id,name,mime,size,by_id,by_name,at FROM dbo.request_attachments ${where} ORDER BY at`, p),
  ];
  const gi = groupBy(items), gs = groupBy(steps), gh = groupBy(hist), gr = groupBy(rcpts), ga = groupBy(atts);
  return reqs.map(r => ({
    id: r.id, no: r.request_no, title: r.title || '', requestDate: day(r.request_date), neededBy: day(r.needed_by),
    department: r.department || '', category: r.category || '', priority: r.priority, supplier: r.supplier || '',
    currency: r.currency, justification: r.justification || '', notes: r.notes || '', total: +r.total,
    status: r.status, currentStep: r.current_step, createdBy: ref(r.created_by_id, r.created_by_name),
    createdAt: iso(r.created_at), submittedAt: iso(r.submitted_at), approvedAt: iso(r.approved_at), closedAt: iso(r.closed_at), updatedAt: iso(r.updated_at),
    po: r.po_no ? { no: r.po_no, supplier: r.po_supplier, amount: +r.po_amount, date: day(r.po_date), expected: day(r.po_expected), by: ref(r.po_by_id, r.po_by_name), at: iso(r.po_at) } : null,
    items: (gi.get(r.id) || []).map(i => ({ name: i.name, spec: i.spec || '', unit: i.unit || '', qty: +i.qty, price: +i.price })),
    chain: (gs.get(r.id) || []).map(s => ({
      key: s.step_key, title: s.title, approvers: JSON.parse(s.approvers_json || '[]'), minAmount: +s.min_amount, status: s.status,
      by: ref(s.by_id, s.by_name), at: iso(s.decided_at), comment: s.comment || '', startedAt: iso(s.started_at),
    })),
    history: (gh.get(r.id) || []).map(h => ({ at: iso(h.at), by: ref(h.by_id, h.by_name), action: h.action, comment: h.comment || '' })),
    receipts: (gr.get(r.id) || []).map(x => ({ complete: !!x.complete, date: day(x.receipt_date), invoice: x.invoice || '', note: x.note || '', by: ref(x.by_id, x.by_name), at: iso(x.at) })),
    attachments: (ga.get(r.id) || []).map(a => ({ id: a.id, name: a.name, type: a.mime, size: a.size, by: ref(a.by_id, a.by_name), at: iso(a.at) })),
  })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// حفظ الطلب كاملاً داخل معاملة: الصف الرئيسي + الأصناف + المراحل، وإضافة السجلات الجديدة فقط
async function saveRequest(tx, r, isNew) {
  const P = {
    id: [sql.NVarChar(32), r.id], no: [sql.NVarChar(20), r.no], title: [sql.NVarChar(150), r.title], rd: [sql.Date, dateOrNull(r.requestDate)],
    nb: [sql.Date, dateOrNull(r.neededBy)], dep: [sql.NVarChar(80), r.department], cat: [sql.NVarChar(80), r.category], pri: [sql.NVarChar(10), r.priority],
    sup: [sql.NVarChar(150), r.supplier], cur: [sql.Char(3), r.currency], just: [sql.NVarChar(sql.MAX), r.justification], notes: [sql.NVarChar(sql.MAX), r.notes],
    total: [sql.Decimal(18, 2), r.total], st: [sql.NVarChar(12), r.status], cs: [sql.Int, r.currentStep], cbi: [sql.NVarChar(32), r.createdBy.id],
    cbn: [sql.NVarChar(80), r.createdBy.name], ca: [sql.DateTime2, dateOrNull(r.createdAt)], sa: [sql.DateTime2, dateOrNull(r.submittedAt)],
    aa: [sql.DateTime2, dateOrNull(r.approvedAt)], cla: [sql.DateTime2, dateOrNull(r.closedAt)], ua: [sql.DateTime2, new Date()],
    pon: [sql.NVarChar(60), r.po && r.po.no], pos: [sql.NVarChar(150), r.po && r.po.supplier], poa: [sql.Decimal(18, 2), r.po ? r.po.amount : null],
    pod: [sql.Date, dateOrNull(r.po && r.po.date)], poe: [sql.Date, dateOrNull(r.po && r.po.expected)], pobi: [sql.NVarChar(32), r.po && r.po.by && r.po.by.id],
    pobn: [sql.NVarChar(80), r.po && r.po.by && r.po.by.name], poat: [sql.DateTime2, dateOrNull(r.po && r.po.at)],
  };
  if (isNew) {
    await q(tx, `INSERT INTO dbo.purchase_requests(id,request_no,title,request_date,needed_by,department,category,priority,supplier,currency,justification,notes,total,status,current_step,created_by_id,created_by_name,created_at,submitted_at,approved_at,closed_at,updated_at)
      VALUES(@id,@no,@title,@rd,@nb,@dep,@cat,@pri,@sup,@cur,@just,@notes,@total,@st,@cs,@cbi,@cbn,@ca,@sa,@aa,@cla,@ua)`, P);
  } else {
    await q(tx, `UPDATE dbo.purchase_requests SET title=@title,request_date=@rd,needed_by=@nb,department=@dep,category=@cat,priority=@pri,supplier=@sup,currency=@cur,
      justification=@just,notes=@notes,total=@total,status=@st,current_step=@cs,submitted_at=@sa,approved_at=@aa,closed_at=@cla,updated_at=@ua,
      po_no=@pon,po_supplier=@pos,po_amount=@poa,po_date=@pod,po_expected=@poe,po_by_id=@pobi,po_by_name=@pobn,po_at=@poat WHERE id=@id`, P);
  }
  const id = [sql.NVarChar(32), r.id];
  await q(tx, 'DELETE FROM dbo.request_items WHERE request_id=@id', { id });
  for (const [n, i] of r.items.entries()) {
    await q(tx, 'INSERT INTO dbo.request_items(request_id,line_no,name,spec,unit,qty,price) VALUES(@id,@n,@name,@spec,@unit,@qty,@price)', {
      id, n: [sql.Int, n + 1], name: [sql.NVarChar(200), i.name], spec: [sql.NVarChar(300), i.spec], unit: [sql.NVarChar(30), i.unit],
      qty: [sql.Decimal(18, 3), i.qty], price: [sql.Decimal(18, 2), i.price],
    });
  }
  await q(tx, 'DELETE FROM dbo.approval_steps WHERE request_id=@id', { id });
  for (const [n, s] of r.chain.entries()) {
    await q(tx, `INSERT INTO dbo.approval_steps(request_id,step_no,step_key,title,approvers_json,min_amount,status,by_id,by_name,decided_at,comment,started_at)
      VALUES(@id,@n,@k,@t,@ap,@min,@st,@bi,@bn,@at,@c,@sa)`, {
      id, n: [sql.Int, n], k: [sql.NVarChar(40), s.key], t: [sql.NVarChar(80), s.title], ap: [sql.NVarChar(sql.MAX), JSON.stringify(s.approvers || [])],
      min: [sql.Decimal(18, 2), s.minAmount || 0], st: [sql.NVarChar(10), s.status], bi: [sql.NVarChar(32), s.by && s.by.id], bn: [sql.NVarChar(80), s.by && s.by.name],
      at: [sql.DateTime2, dateOrNull(s.at)], c: [sql.NVarChar(1000), s.comment || ''], sa: [sql.DateTime2, dateOrNull(s.startedAt)],
    });
  }
  for (const h of r.history.filter(x => x._new)) {
    await q(tx, 'INSERT INTO dbo.request_history(request_id,at,by_id,by_name,action,comment) VALUES(@id,@at,@bi,@bn,@a,@c)', {
      id, at: [sql.DateTime2, dateOrNull(h.at)], bi: [sql.NVarChar(32), h.by.id], bn: [sql.NVarChar(80), h.by.name], a: [sql.NVarChar(20), h.action], c: [sql.NVarChar(2000), h.comment || ''],
    });
  }
  for (const x of r.receipts.filter(x => x._new)) {
    await q(tx, 'INSERT INTO dbo.request_receipts(request_id,complete,receipt_date,invoice,note,by_id,by_name,at) VALUES(@id,@c,@d,@inv,@note,@bi,@bn,@at)', {
      id, c: [sql.Bit, x.complete], d: [sql.Date, dateOrNull(x.date)], inv: [sql.NVarChar(60), x.invoice], note: [sql.NVarChar(1000), x.note],
      bi: [sql.NVarChar(32), x.by.id], bn: [sql.NVarChar(80), x.by.name], at: [sql.DateTime2, dateOrNull(x.at)],
    });
  }
}
async function deleteRequest(tx, id) { await q(tx, 'DELETE FROM dbo.purchase_requests WHERE id=@id', { id: [sql.NVarChar(32), id] }); }

async function insertAttachment(tx, requestId, a, buf) {
  await q(tx, 'INSERT INTO dbo.request_attachments(id,request_id,name,mime,size,content,by_id,by_name,at) VALUES(@id,@rid,@name,@mime,@size,@content,@bi,@bn,@at)', {
    id: [sql.NVarChar(32), a.id], rid: [sql.NVarChar(32), requestId], name: [sql.NVarChar(150), a.name], mime: [sql.NVarChar(100), a.type],
    size: [sql.Int, a.size], content: [sql.VarBinary(sql.MAX), buf], bi: [sql.NVarChar(32), a.by.id], bn: [sql.NVarChar(80), a.by.name], at: [sql.DateTime2, dateOrNull(a.at)],
  });
}
async function attachmentContent(requestId, id) {
  const rows = await q(null, 'SELECT content FROM dbo.request_attachments WHERE id=@id AND request_id=@rid', { id: [sql.NVarChar(32), id], rid: [sql.NVarChar(32), requestId] });
  return rows[0] ? rows[0].content : null;
}
async function deleteAttachment(tx, requestId, id) {
  await q(tx, 'DELETE FROM dbo.request_attachments WHERE id=@id AND request_id=@rid', { id: [sql.NVarChar(32), id], rid: [sql.NVarChar(32), requestId] });
}

// نسخة احتياطية كاملة في مجلد النسخ الافتراضي لـ SQL Server
async function backupDatabase() {
  const dir = ((await q(null, "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400)) AS d"))[0] || {}).d || '';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const sep = dir.includes('\\') ? '\\' : '/';
  const file = (dir ? dir.replace(/[\\/]$/, '') + sep : '') + `${DB_NAME}-${stamp}.bak`;
  await q(null, `BACKUP DATABASE [${DB_NAME}] TO DISK = @f WITH COPY_ONLY, INIT, NAME = @n`, { f: [sql.NVarChar(400), file], n: [sql.NVarChar(100), 'Purchase requests backup'] });
  return file;
}

module.exports = {
  backupDatabase, DEFAULT_CONFIG, normalizeConfig, validateConfig, loadConfig, saveConfig, testConnection, isConnected,
  get DB_NAME() { return DB_NAME; },
  connect, inTransaction, loadUsers, saveUser, loadSettings, saveSetting, nextNumber,
  loadRequests, saveRequest, deleteRequest, insertAttachment, attachmentContent, deleteAttachment,
  serverLabel: () => SERVER_LABEL,
};
