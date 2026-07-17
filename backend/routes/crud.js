const express = require('express');
const { sql, getPool, writeAudit } = require('../db');

// رسالة عامة للمستخدم النهائي - لا نكشف تفاصيل SQL
function publicError(err) {
  if (err && err.number === 2627) return 'البيانات مكررة (تعارض مع سجل موجود)';
  if (err && err.number === 547) return 'لا يمكن تنفيذ العملية بسبب ارتباط هذا السجل بسجلات أخرى';
  if (err && /Failed to connect|ETIMEOUT|ECONNREFUSED|ELOGIN/i.test(err.message || '')) {
    return 'تعذر الاتصال بقاعدة بيانات SQL Server. تحقق من تشغيل الخادم وإعدادات الاتصال.';
  }
  return 'حدث خطأ في الخادم أثناء معالجة الطلب';
}

function logServerError(context, err) {
  console.error(`[${context}]`, err && err.message, err && err.stack);
}

/**
 * إنشاء راوتر CRUD عام لجدول معيّن.
 * columns: [{name, type, required, isId}]
 * filters: أسماء أعمدة يمكن الفلترة عليها عبر query string (مثلاً ?batch_id=123)
 */
function createCrudRouter({ table, entity, columns, filters = [], orderBy }) {
  const router = express.Router();
  const idCol = columns.find((c) => c.isId);

  function bindInput(request, col, value) {
    if (value === undefined || value === '') {
      request.input(col.name, col.type, null);
    } else {
      request.input(col.name, col.type, value);
    }
  }

  // GET /  -> قائمة (مع فلاتر اختيارية)
  router.get('/', async (req, res) => {
    try {
      const pool = await getPool();
      const request = pool.request();
      const where = [];
      for (const f of filters) {
        if (req.query[f] !== undefined && req.query[f] !== '') {
          const col = columns.find((c) => c.name === f);
          request.input(f, col ? col.type : sql.NVarChar, req.query[f]);
          where.push(`${f} = @${f}`);
        }
      }
      const sqlText = `SELECT * FROM ${table}` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        (orderBy ? ` ORDER BY ${orderBy}` : '');
      const result = await request.query(sqlText);
      res.json({ data: result.recordset });
    } catch (err) {
      logServerError(`${entity}:list`, err);
      res.status(500).json({ error: publicError(err) });
    }
  });

  // GET /:id
  router.get('/:id', async (req, res) => {
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input(idCol.name, idCol.type, req.params.id)
        .query(`SELECT * FROM ${table} WHERE ${idCol.name} = @${idCol.name}`);
      if (!result.recordset.length) return res.status(404).json({ error: 'السجل غير موجود' });
      res.json({ data: result.recordset[0] });
    } catch (err) {
      logServerError(`${entity}:get`, err);
      res.status(500).json({ error: publicError(err) });
    }
  });

  // POST / -> إضافة
  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      // validation: تحقق من الحقول المطلوبة
      for (const col of columns) {
        if (col.required && (body[col.name] === undefined || body[col.name] === null || body[col.name] === '')) {
          return res.status(400).json({ error: `الحقل "${col.label || col.name}" مطلوب` });
        }
      }
      const pool = await getPool();
      const request = pool.request();
      const insertCols = [];
      const values = [];
      for (const col of columns) {
        if (col.computed) continue;
        if (body[col.name] === undefined && !col.isId) continue;
        bindInput(request, col, body[col.name]);
        insertCols.push(col.name);
        values.push(`@${col.name}`);
      }
      const result = await request.query(
        `INSERT INTO ${table} (${insertCols.join(',')}) OUTPUT INSERTED.* VALUES (${values.join(',')})`
      );
      const row = result.recordset[0];
      await writeAudit(pool, {
        username: body.updated_by || body.created_by || req.body.user || null,
        action: 'create', entity, entityId: row[idCol.name],
      });
      res.status(201).json({ data: row, message: 'تم الحفظ بنجاح' });
    } catch (err) {
      logServerError(`${entity}:create`, err);
      res.status(500).json({ error: publicError(err) });
    }
  });

  // PUT /:id -> تعديل
  router.put('/:id', async (req, res) => {
    try {
      const body = req.body || {};
      const pool = await getPool();
      const request = pool.request();
      const setParts = [];
      for (const col of columns) {
        if (col.isId || col.computed) continue;
        if (body[col.name] === undefined) continue;
        bindInput(request, col, body[col.name]);
        setParts.push(`${col.name} = @${col.name}`);
      }
      if (columns.some((c) => c.name === 'updated_at')) setParts.push('updated_at = SYSUTCDATETIME()');
      if (!setParts.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
      request.input(idCol.name, idCol.type, req.params.id);
      const result = await request.query(
        `UPDATE ${table} SET ${setParts.join(', ')} OUTPUT INSERTED.* WHERE ${idCol.name} = @${idCol.name}`
      );
      if (!result.recordset.length) return res.status(404).json({ error: 'السجل غير موجود' });
      await writeAudit(pool, {
        username: body.updated_by || req.body.user || null,
        action: 'update', entity, entityId: req.params.id,
      });
      res.json({ data: result.recordset[0], message: 'تم التحديث بنجاح' });
    } catch (err) {
      logServerError(`${entity}:update`, err);
      res.status(500).json({ error: publicError(err) });
    }
  });

  // DELETE /:id
  router.delete('/:id', async (req, res) => {
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input(idCol.name, idCol.type, req.params.id)
        .query(`DELETE FROM ${table} OUTPUT DELETED.* WHERE ${idCol.name} = @${idCol.name}`);
      if (!result.recordset.length) return res.status(404).json({ error: 'السجل غير موجود' });
      await writeAudit(pool, {
        username: (req.body && req.body.user) || req.query.user || null,
        action: 'delete', entity, entityId: req.params.id,
      });
      res.json({ message: 'تم الحذف بنجاح' });
    } catch (err) {
      logServerError(`${entity}:delete`, err);
      res.status(500).json({ error: publicError(err) });
    }
  });

  return router;
}

module.exports = { createCrudRouter, publicError, logServerError };
