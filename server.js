const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultData() {
  return {
    batches: [],
    morts: [],
    markets: [],
    settings: { user: 'admin', pass: '1234' },
    counters: { batches: 1, morts: 1, markets: 1 }
  };
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeDb(defaultData());
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    db.batches ||= [];
    db.morts ||= [];
    db.markets ||= [];
    db.settings ||= { user: 'admin', pass: '1234' };
    db.counters ||= { batches: 1, morts: 1, markets: 1 };
    return db;
  } catch (e) {
    const db = defaultData();
    writeDb(db);
    return db;
  }
}

function writeDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function publicData(db) {
  return {
    batches: db.batches,
    morts: db.morts,
    markets: db.markets,
    settings: db.settings
  };
}

function toNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeBatch(body, old = {}) {
  return {
    ...old,
    name: String(body.name || '').trim(),
    hatchDate: String(body.hatchDate || '').slice(0, 10),
    type: String(body.type || 'لحم'),
    eggs: toNumber(body.eggs),
    badEggs: toNumber(body.badEggs),
    candle: toNumber(body.candle, 90),
    hatched: body.hatched === null || body.hatched === '' || body.hatched === undefined ? null : toNumber(body.hatched),
    alertAge: toNumber(body.alertAge, 35),
    marketAge: toNumber(body.marketAge, 35),
    field: String(body.field || ''),
    status: String(body.status || 'نشطة'),
    note: String(body.note || '')
  };
}

app.get('/health', (req, res) => res.json({ ok: true, storage: 'json-file' }));

app.get('/api/data', (req, res) => {
  const db = readDb();
  res.json(publicData(db));
});

app.post('/api/login', (req, res) => {
  const db = readDb();
  const user = String(req.body.user || '');
  const pass = String(req.body.pass || '');
  res.json({ ok: user === db.settings.user && pass === db.settings.pass });
});

app.post('/api/settings', (req, res) => {
  const db = readDb();
  const user = String(req.body.user || '').trim();
  const pass = String(req.body.pass || '').trim();
  if (!user || !pass) return res.status(400).json({ error: 'اكتب اليوزر والباسورد' });
  db.settings = { user, pass };
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/batches', (req, res) => {
  const db = readDb();
  const b = normalizeBatch(req.body);
  if (!b.name || !b.hatchDate) return res.status(400).json({ error: 'اسم الوجبة وتاريخ دخول البيض مطلوبان' });
  b.id = db.counters.batches++;
  b.createdAt = new Date().toISOString();
  db.batches.push(b);
  writeDb(db);
  res.json({ ok: true, batch: b });
});

app.put('/api/batches/:id', (req, res) => {
  const db = readDb();
  const id = toNumber(req.params.id);
  const i = db.batches.findIndex(x => Number(x.id) === id);
  if (i < 0) return res.status(404).json({ error: 'الوجبة غير موجودة' });
  const updated = normalizeBatch(req.body, db.batches[i]);
  if (!updated.name || !updated.hatchDate) return res.status(400).json({ error: 'اسم الوجبة وتاريخ دخول البيض مطلوبان' });
  updated.id = id;
  updated.updatedAt = new Date().toISOString();
  db.batches[i] = updated;
  writeDb(db);
  res.json({ ok: true, batch: updated });
});

app.delete('/api/batches/:id', (req, res) => {
  const db = readDb();
  const id = toNumber(req.params.id);
  db.batches = db.batches.filter(x => Number(x.id) !== id);
  db.morts = db.morts.filter(x => Number(x.batchId) !== id);
  db.markets = db.markets.filter(x => Number(x.batchId) !== id);
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/mortality', (req, res) => {
  const db = readDb();
  const row = {
    id: db.counters.morts++,
    batchId: toNumber(req.body.batchId),
    date: String(req.body.date || '').slice(0, 10),
    count: toNumber(req.body.count),
    reason: String(req.body.reason || '')
  };
  if (!row.batchId || !row.date || row.count <= 0) return res.status(400).json({ error: 'اختر وجبة واكتب التاريخ وعدد الهلاك' });
  db.morts.push(row);
  writeDb(db);
  res.json({ ok: true, row });
});

app.delete('/api/mortality/:id', (req, res) => {
  const db = readDb();
  const id = toNumber(req.params.id);
  db.morts = db.morts.filter(x => Number(x.id) !== id);
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/marketing', (req, res) => {
  const db = readDb();
  const row = {
    id: db.counters.markets++,
    batchId: toNumber(req.body.batchId),
    date: String(req.body.date || '').slice(0, 10),
    count: toNumber(req.body.count),
    status: String(req.body.status || 'بيعت جزئياً'),
    note: String(req.body.note || '')
  };
  if (!row.batchId || !row.date) return res.status(400).json({ error: 'اختر وجبة واكتب التاريخ' });
  db.markets.push(row);

  const b = db.batches.find(x => Number(x.id) === row.batchId);
  if (b && row.status) b.status = row.status;

  writeDb(db);
  res.json({ ok: true, row });
});

app.delete('/api/marketing/:id', (req, res) => {
  const db = readDb();
  const id = toNumber(req.params.id);
  db.markets = db.markets.filter(x => Number(x.id) !== id);
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/wipe', (req, res) => {
  const db = readDb();
  db.batches = [];
  db.morts = [];
  db.markets = [];
  db.counters = { batches: 1, morts: 1, markets: 1 };
  writeDb(db);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureDb();
app.listen(PORT, () => {
  console.log(`Poultry app running on port ${PORT}`);
});
