const express = require('express');
const { sql, getPool, writeAudit } = require('../db');
const { getGuideWeightByAge, achievementPct } = require('../logic');
const { publicError, logServerError } = require('./crud');

const router = express.Router();

// GET /api/weights?batch_id=&field_name=
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    const where = [];
    if (req.query.batch_id) { request.input('batch_id', sql.BigInt, req.query.batch_id); where.push('batch_id = @batch_id'); }
    if (req.query.field_name) { request.input('field_name', sql.NVarChar, req.query.field_name); where.push('field_name = @field_name'); }
    const result = await request.query(
      `SELECT * FROM dbo.weights ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC`
    );
    res.json({ data: result.recordset });
  } catch (err) {
    logServerError('weights:list', err);
    res.status(500).json({ error: publicError(err) });
  }
});

// POST /api/weights
// الوزن الفعلي بالغرام إلزامي. الكايد يُحسب من العمر فقط (لا يتأثر بالوزن الفعلي).
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const actual = Number(b.actual_weight_grams);
    if (!actual || actual <= 0) {
      return res.status(400).json({ error: 'الحقل "الوزن الفعلي بالغرام" مطلوب ويجب أن يكون أكبر من صفر' });
    }
    const ageDays = Number(b.age_days) || 0;
    const guide = getGuideWeightByAge(ageDays);
    const pct = achievementPct(actual, guide);

    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.BigInt, b.id || Date.now())
      .input('batch_id', sql.BigInt, b.batch_id || null)
      .input('field_name', sql.NVarChar(150), b.field_name || null)
      .input('hall_id', sql.Int, b.hall_id || null)
      .input('hall', sql.NVarChar(150), b.hall || null)
      .input('date', sql.Date, b.date || null)
      .input('age_days', sql.Int, ageDays)
      .input('actual_weight_grams', sql.Int, Math.round(actual))
      .input('guide_weight_grams', sql.Int, guide)
      .input('achievement_pct', sql.Decimal(6, 2), pct)
      .input('alive', sql.Int, b.alive || null)
      .input('total_weight_grams', sql.Int, b.total_weight_grams || null)
      .input('note', sql.NVarChar(500), b.note || null)
      .input('created_by', sql.NVarChar(100), b.user || b.created_by || null)
      .query(`INSERT INTO dbo.weights
        (id, batch_id, field_name, hall_id, hall, date, age_days, actual_weight_grams, guide_weight_grams, achievement_pct, alive, total_weight_grams, note, created_by)
        OUTPUT INSERTED.*
        VALUES
        (@id, @batch_id, @field_name, @hall_id, @hall, @date, @age_days, @actual_weight_grams, @guide_weight_grams, @achievement_pct, @alive, @total_weight_grams, @note, @created_by)`);

    const row = result.recordset[0];
    await writeAudit(pool, { username: b.user, action: 'create', entity: 'weights', entityId: row.id });
    res.status(201).json({ data: row, message: 'تم حفظ الوزن بنجاح' });
  } catch (err) {
    logServerError('weights:create', err);
    res.status(500).json({ error: publicError(err) });
  }
});

// GET /api/weights/guide?ageDays=21  -> كايد الوزن حسب العمر فقط
router.get('/guide', (req, res) => {
  const ageDays = Number(req.query.ageDays) || 0;
  res.json({ ageDays, guideWeightGrams: getGuideWeightByAge(ageDays) });
});

// DELETE /api/weights/:id
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.BigInt, req.params.id)
      .query('DELETE FROM dbo.weights OUTPUT DELETED.* WHERE id=@id');
    if (!result.recordset.length) return res.status(404).json({ error: 'السجل غير موجود' });
    await writeAudit(pool, { username: (req.body && req.body.user) || req.query.user, action: 'delete', entity: 'weights', entityId: req.params.id });
    res.json({ message: 'تم الحذف بنجاح' });
  } catch (err) {
    logServerError('weights:delete', err);
    res.status(500).json({ error: publicError(err) });
  }
});

module.exports = router;
