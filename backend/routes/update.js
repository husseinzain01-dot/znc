const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const router = express.Router();
const ROOT = path.join(__dirname, '..', '..');
const FRONTEND_PATH = path.join(ROOT, 'frontend', 'index.html');
const BACKUP_DIR = path.join(ROOT, 'frontend', 'backups');
const PKG_BACKUP_DIR = path.join(ROOT, 'update_backups');

// مجلدات/ملفات لا يجب أبداً استبدالها أو حذفها من الباقة (تحتوي إعدادات/بيانات محلية)
const PROTECTED = ['.env', 'node_modules', '.git', 'update_backups', 'frontend/backups'];

function isProtected(relPath) {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return PROTECTED.some((p) => norm === p || norm.startsWith(p + '/'));
}

// POST /api/update/frontend
// body: نص HTML كامل (الملف الجديد لـ frontend/index.html)
// يأخذ نسخة احتياطية من الملف القديم قبل الاستبدال (بدون حذفها).
router.post('/frontend', express.text({ limit: '30mb', type: '*/*' }), (req, res) => {
  try {
    const newHtml = req.body;
    if (!newHtml || typeof newHtml !== 'string' || newHtml.trim().length < 100) {
      return res.status(400).json({ error: 'الملف المرسل فارغ أو غير صالح' });
    }
    if (!/<html|<!doctype html/i.test(newHtml)) {
      return res.status(400).json({ error: 'الملف المرسل لا يبدو ملف HTML صالح' });
    }

    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // نسخة احتياطية من النسخة الحالية قبل الاستبدال
    if (fs.existsSync(FRONTEND_PATH)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(FRONTEND_PATH, path.join(BACKUP_DIR, `index_${stamp}.html`));
    }

    fs.writeFileSync(FRONTEND_PATH, newHtml, 'utf8');
    res.json({ ok: true, message: 'تم تحديث الواجهة بنجاح. أعد تحميل الصفحة (F5) لتطبيق التحديث.' });
  } catch (err) {
    console.error('[update:frontend]', err);
    res.status(500).json({ error: 'تعذر تحديث ملف الواجهة على الخادم: ' + err.message });
  }
});

// POST /api/update/package
// body: ملف ZIP يحتوي على المشروع المحدّث (frontend/, backend/, db/, package.json ...)
// - يأخذ نسخة احتياطية كاملة من المشروع الحالي (عدا node_modules) قبل أي استبدال.
// - لا يلمس .env ولا node_modules ولا قاعدة البيانات.
// - بعد الاستخراج يطلب من الخادم إعادة التشغيل (يحتاج start.bat / pm2 لإعادة التشغيل تلقائياً).
router.post('/package', express.raw({ limit: '200mb', type: '*/*' }), (req, res) => {
  try {
    const buf = req.body;
    if (!buf || !buf.length) {
      return res.status(400).json({ error: 'لم يتم استلام أي ملف' });
    }

    let zip;
    try {
      zip = new AdmZip(buf);
    } catch (e) {
      return res.status(400).json({ error: 'الملف المرسل ليس ملف ZIP صالح' });
    }

    const entries = zip.getEntries();
    if (!entries.length) return res.status(400).json({ error: 'ملف ZIP فارغ' });

    // تحقق أن الباقة تحتوي على بنية المشروع المتوقعة
    const names = entries.map((e) => e.entryName.replace(/\\/g, '/'));
    const hasFrontend = names.some((n) => n.includes('frontend/index.html'));
    const hasBackend = names.some((n) => n.includes('backend/server.js'));
    if (!hasFrontend && !hasBackend) {
      return res.status(400).json({ error: 'الملف المضغوط لا يحتوي على ملفات المشروع المتوقعة (frontend/index.html أو backend/server.js)' });
    }

    // إن كانت الباقة بداخل مجلد جذر واحد (مثال: project-v2/...) أزل هذا المسار
    let prefix = '';
    const top = names[0].split('/')[0];
    if (top && names.every((n) => n.startsWith(top + '/'))) prefix = top + '/';

    // ── نسخة احتياطية كاملة من المشروع الحالي قبل التحديث ──
    if (!fs.existsSync(PKG_BACKUP_DIR)) fs.mkdirSync(PKG_BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupTarget = path.join(PKG_BACKUP_DIR, `backup_${stamp}`);
    fs.mkdirSync(backupTarget, { recursive: true });
    for (const item of ['frontend', 'backend', 'db', 'package.json', 'README.md']) {
      const src = path.join(ROOT, item);
      if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(backupTarget, item), { recursive: true });
      }
    }

    // ── استخراج الملفات الجديدة (بدون لمس .env / node_modules / النسخ الاحتياطية) ──
    let written = 0, skipped = 0;
    for (const entry of entries) {
      let rel = entry.entryName.replace(/\\/g, '/');
      if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length);
      if (!rel) continue;
      if (isProtected(rel)) { skipped++; continue; }
      if (entry.isDirectory) continue;

      const destPath = path.join(ROOT, rel);
      if (!destPath.startsWith(ROOT)) continue; // حماية من Zip Slip
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, entry.getData());
      written++;
    }

    const needsNpmInstall = names.some((n) => n.endsWith('package.json'));

    res.json({
      ok: true,
      message: `تم تحديث ${written} ملف بنجاح (تم تجاهل ${skipped} ملف محمي مثل .env). ` +
        (needsNpmInstall ? 'تم تحديث package.json - شغّل "npm install" ثم ' : '') +
        'أعد تشغيل الخادم (npm start) لتطبيق تحديثات الـ Backend.',
      backup: path.basename(backupTarget),
      restartRequired: true,
    });

    // إعادة تشغيل ذاتية بعد إرسال الرد (يحتاج start.bat ليعيد تشغيل العملية تلقائياً)
    setTimeout(() => process.exit(0), 800);
  } catch (err) {
    console.error('[update:package]', err);
    res.status(500).json({ error: 'تعذر تنفيذ التحديث: ' + err.message });
  }
});

// GET /api/update/backups -> قائمة النسخ الاحتياطية المتوفرة
router.get('/backups', (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json({ data: [] });
    const files = fs.readdirSync(BACKUP_DIR).sort().reverse();
    res.json({ data: files });
  } catch (err) {
    res.status(500).json({ error: 'تعذر قراءة النسخ الاحتياطية' });
  }
});

module.exports = router;
