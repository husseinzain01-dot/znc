const path = require('path');
const express = require('express');
const { getPool } = require('./db');

const stateRouter = require('./routes/state');
const fieldsRouter = require('./routes/fields');
const batchesRouter = require('./routes/batches');
const mortalitiesRouter = require('./routes/mortalities');
const weightsRouter = require('./routes/weights');
const medicinesRouter = require('./routes/medicines');
const vaccinesRouter = require('./routes/vaccines');
const marketingRouter = require('./routes/marketing');
const archiveRouter = require('./routes/archive');
const usersRouter = require('./routes/users');
const settingsRouter = require('./routes/settings');
const updateRouter = require('./routes/update');
const aiRouter = require('./routes/ai');
const wa = require('./whatsapp');

function createServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  // CORS - الواجهة قد تُفتح من جهاز آخر على نفس الشبكة
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // فحص الاتصال بقاعدة البيانات
  app.get('/api/health', async (req, res) => {
    try {
      await getPool();
      res.json({ ok: true, message: 'الاتصال بقاعدة بيانات SQL Server يعمل بنجاح' });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'فشل الاتصال بقاعدة بيانات SQL Server. تحقق من إعدادات .env وتشغيل الخادم.' });
    }
  });

  // --- API ---
  app.use('/api/state', stateRouter);          // توافق مع طريقة التخزين الحالية (JSON كامل)
  app.use('/api/fields', fieldsRouter);
  app.use('/api/batches', batchesRouter);
  app.use('/api/mortalities', mortalitiesRouter);
  app.use('/api/weights', weightsRouter);
  app.use('/api/medicines', medicinesRouter);
  app.use('/api/vaccines', vaccinesRouter);
  app.use('/api/marketing', marketingRouter);
  app.use('/api/archive', archiveRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/update', updateRouter);
  app.use('/api/ai', aiRouter);

  // واتساب — حالة الاتصال + QR
  app.get('/api/wa/status', (req, res) => res.json({ status: wa.getStatus() }));
  app.get('/api/wa/qr', (req, res) => {
    const qr = wa.getQR();
    if (!qr) return res.json({ status: wa.getStatus(), qr: null });
    res.json({ status: 'qr', qr });
  });
  app.post('/api/wa/send', async (req, res) => {
    try {
      const { phone, message } = req.body || {};
      if (!phone || !message) return res.status(400).json({ error: 'phone و message مطلوبان' });
      const jid = phone.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      await wa.sendMessage(jid, message);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // الواجهة (Frontend) - ملفات ثابتة (بدون كاش حتى تظهر التحديثات فوراً)
  app.use(express.static(path.join(__dirname, '..', 'frontend'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    },
  }));

  // معالج أخطاء عام - لا يكشف تفاصيل داخلية للمستخدم النهائي
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم' });
  });

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 4790;
  createServer().listen(port, () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
  wa.startWhatsApp().catch((e) => console.warn('[WhatsApp] فشل التشغيل:', e.message));
}

module.exports = { createServer };
