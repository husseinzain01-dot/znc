const express = require('express');
const { sql, getPool } = require('../db');

const router = express.Router();

// GET /api/state -> { data: {...} }
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar, 'main')
      .query('SELECT data_json FROM dbo.app_state WHERE id=@id');

    if (!result.recordset.length) {
      return res.json({ data: {} });
    }
    res.json({ data: JSON.parse(result.recordset[0].data_json || '{}') });
  } catch (err) {
    res.status(500).json({ error: 'تعذر الاتصال بقاعدة البيانات SQL Server: ' + err.message });
  }
});

// PUT /api/state  body: { data, user }
router.put('/', async (req, res) => {
  try {
    const { data, user } = req.body || {};
    if (!data) return res.status(400).json({ error: 'لا توجد بيانات للحفظ' });

    const pool = await getPool();
    await pool.request()
      .input('id', sql.NVarChar, 'main')
      .input('data_json', sql.NVarChar(sql.MAX), JSON.stringify(data))
      .input('updated_by', sql.NVarChar, user || null)
      .query(`
        MERGE dbo.app_state AS target
        USING (SELECT @id AS id) AS src
        ON target.id = src.id
        WHEN MATCHED THEN UPDATE SET data_json=@data_json, updated_at=SYSUTCDATETIME(), updated_by=@updated_by
        WHEN NOT MATCHED THEN INSERT (id, data_json, updated_by) VALUES (@id, @data_json, @updated_by);
      `);

    await pool.request()
      .input('username', sql.NVarChar, user || null)
      .input('action', sql.NVarChar, 'save')
      .input('entity', sql.NVarChar, 'app_state')
      .query("INSERT INTO dbo.audit_logs(username, action, entity) VALUES (@username, @action, @entity)");

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'تعذر الحفظ في قاعدة البيانات SQL Server: ' + err.message });
  }
});

module.exports = router;
