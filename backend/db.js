const path = require('path');
const fs = require('fs');
const sql = require('mssql');

// تحميل .env إن وُجد (بدون فرض تثبيت حزمة dotenv كاعتمادية صلبة)
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
})();

function getSqlConfig() {
  return {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || 'ChickenFieldDB',
    port: +(process.env.DB_PORT || 1433),
    options: {
      encrypt: String(process.env.DB_ENCRYPT).toLowerCase() === 'true',
      trustServerCertificate: String(process.env.DB_TRUST_CERT).toLowerCase() !== 'false',
    },
  };
}

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(getSqlConfig())
      .connect()
      .catch((err) => {
        poolPromise = null; // اسمح بإعادة المحاولة في الطلب التالي
        throw err;
      });
  }
  return poolPromise;
}

// إعادة تعيين الاتصال (تُستخدم بعد تغيير إعدادات .env من واجهة الإعدادات)
function resetPool() {
  if (poolPromise) {
    poolPromise.then((p) => p.close()).catch(() => {});
  }
  poolPromise = null;
}

// تسجيل عملية في audit_logs دون إيقاف الطلب الأساسي عند الفشل
async function writeAudit(pool, { username, action, entity, entityId, details }) {
  try {
    await pool.request()
      .input('username', sql.NVarChar, username || null)
      .input('action', sql.NVarChar, action)
      .input('entity', sql.NVarChar, entity || null)
      .input('entity_id', sql.NVarChar, entityId != null ? String(entityId) : null)
      .input('details', sql.NVarChar(sql.MAX), details ? JSON.stringify(details) : null)
      .query(`INSERT INTO dbo.audit_logs(username, action, entity, entity_id, details)
              VALUES (@username, @action, @entity, @entity_id, @details)`);
  } catch (e) {
    console.warn('audit log failed:', e.message);
  }
}

module.exports = { sql, getPool, getSqlConfig, writeAudit, resetPool };
