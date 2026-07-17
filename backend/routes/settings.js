const express = require('express');
const fs = require('fs');
const path = require('path');
const { getSqlConfig, resetPool, getPool } = require('../db');
const { publicError, logServerError } = require('./crud');

const router = express.Router();
const ENV_PATH = path.join(__dirname, '..', '..', '.env');

const KEYS = ['DB_SERVER', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD', 'DB_ENCRYPT', 'DB_TRUST_CERT'];

// GET /api/settings/db -> الإعدادات الحالية (بدون كشف كلمة المرور)
router.get('/db', (req, res) => {
  const cfg = getSqlConfig();
  res.json({
    data: {
      server: cfg.server,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      passwordSet: !!cfg.password,
      encrypt: cfg.options.encrypt,
      trustServerCertificate: cfg.options.trustServerCertificate,
    },
  });
});

// PUT /api/settings/db  body: {server, port, database, user, password?, encrypt, trustServerCertificate}
// يكتب .env ويعيد الاتصال فوراً دون الحاجة لإعادة تشغيل الخادم.
router.put('/db', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.server || !b.database || !b.user) {
      return res.status(400).json({ error: 'الحقول "السيرفر" و"قاعدة البيانات" و"المستخدم" مطلوبة' });
    }

    // اقرأ القيم الحالية
    let current = {};
    if (fs.existsSync(ENV_PATH)) {
      for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) current[m[1]] = m[2];
      }
    }

    current.DB_SERVER = b.server;
    current.DB_PORT = String(b.port || 1433);
    current.DB_DATABASE = b.database;
    current.DB_USER = b.user;
    if (b.password) current.DB_PASSWORD = b.password; // غيّر كلمة المرور فقط إذا أُدخلت
    current.DB_ENCRYPT = String(!!b.encrypt);
    current.DB_TRUST_CERT = String(b.trustServerCertificate !== false);

    const lines = Object.entries(current).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');

    // تطبيق فوري بدون إعادة تشغيل
    for (const k of KEYS) if (current[k] !== undefined) process.env[k] = current[k];
    resetPool();

    // اختبار الاتصال بالإعدادات الجديدة
    try {
      await getPool();
      res.json({ ok: true, message: 'تم تحديث إعدادات الاتصال والاتصال بنجاح بقاعدة البيانات الجديدة' });
    } catch (err) {
      res.json({ ok: false, message: 'تم حفظ الإعدادات، لكن تعذر الاتصال بقاعدة البيانات بهذه البيانات: ' + err.message });
    }
  } catch (err) {
    logServerError('settings:db', err);
    res.status(500).json({ error: publicError(err) });
  }
});

module.exports = router;
