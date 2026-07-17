const express = require('express');
const bcrypt = require('bcryptjs');
const { sql, getPool, writeAudit } = require('../db');
const { publicError, logServerError } = require('./crud');

const router = express.Router();

function sanitizeUser(row) {
  if (!row) return row;
  const { password, ...rest } = row;
  return rest;
}

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.username, u.role_id, r.name AS role_name, u.fields_json,
             u.created_at, u.updated_at, u.updated_by
      FROM dbo.users u LEFT JOIN dbo.roles r ON r.id = u.role_id
      ORDER BY u.username`);
    res.json({ data: result.recordset });
  } catch (err) {
    logServerError('users:list', err);
    res.status(500).json({ error: publicError(err) });
  }
});

// POST /api/users  { username, password, role, fields }
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.username) return res.status(400).json({ error: 'الحقل "اسم المستخدم" مطلوب' });
    if (!b.password) return res.status(400).json({ error: 'الحقل "كلمة المرور" مطلوب' });

    const hash = await bcrypt.hash(String(b.password), 10);
    const pool = await getPool();

    let roleId = b.role_id || null;
    if (!roleId && b.role) {
      const r = await pool.request().input('name', sql.NVarChar, b.role)
        .query('SELECT id FROM dbo.roles WHERE name=@name');
      roleId = r.recordset[0] ? r.recordset[0].id : null;
    }

    const result = await pool.request()
      .input('username', sql.NVarChar(100), b.username)
      .input('password', sql.NVarChar(200), hash)
      .input('role_id', sql.Int, roleId)
      .input('fields_json', sql.NVarChar(sql.MAX), b.fields ? JSON.stringify(b.fields) : null)
      .input('updated_by', sql.NVarChar(100), b.user || null)
      .query(`INSERT INTO dbo.users (username, password, role_id, fields_json, updated_by)
              OUTPUT INSERTED.id, INSERTED.username, INSERTED.role_id, INSERTED.fields_json, INSERTED.created_at
              VALUES (@username, @password, @role_id, @fields_json, @updated_by)`);

    await writeAudit(pool, { username: b.user, action: 'create', entity: 'users', entityId: result.recordset[0].id });
    res.status(201).json({ data: result.recordset[0], message: 'تم إنشاء المستخدم بنجاح' });
  } catch (err) {
    logServerError('users:create', err);
    res.status(500).json({ error: publicError(err) });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const pool = await getPool();
    const sets = [];
    const request = pool.request().input('id', sql.Int, req.params.id);

    if (b.username) { request.input('username', sql.NVarChar(100), b.username); sets.push('username=@username'); }
    if (b.password) { request.input('password', sql.NVarChar(200), await bcrypt.hash(String(b.password), 10)); sets.push('password=@password'); }
    if (b.role_id) { request.input('role_id', sql.Int, b.role_id); sets.push('role_id=@role_id'); }
    if (b.fields !== undefined) { request.input('fields_json', sql.NVarChar(sql.MAX), JSON.stringify(b.fields)); sets.push('fields_json=@fields_json'); }
    request.input('updated_by', sql.NVarChar(100), b.user || null);
    sets.push('updated_by=@updated_by', 'updated_at=SYSUTCDATETIME()');

    if (!sets.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });

    const result = await request.query(
      `UPDATE dbo.users SET ${sets.join(', ')} OUTPUT INSERTED.id, INSERTED.username, INSERTED.role_id, INSERTED.fields_json WHERE id=@id`
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await writeAudit(pool, { username: b.user, action: 'update', entity: 'users', entityId: req.params.id });
    res.json({ data: result.recordset[0], message: 'تم التحديث بنجاح' });
  } catch (err) {
    logServerError('users:update', err);
    res.status(500).json({ error: publicError(err) });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, req.params.id)
      .query('DELETE FROM dbo.users OUTPUT DELETED.id WHERE id=@id');
    if (!result.recordset.length) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await writeAudit(pool, { username: (req.body && req.body.user), action: 'delete', entity: 'users', entityId: req.params.id });
    res.json({ message: 'تم الحذف بنجاح' });
  } catch (err) {
    logServerError('users:delete', err);
    res.status(500).json({ error: publicError(err) });
  }
});

// POST /api/users/login  { username, password }
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });

    const pool = await getPool();
    const result = await pool.request().input('username', sql.NVarChar, username)
      .query(`SELECT u.*, r.name AS role_name FROM dbo.users u LEFT JOIN dbo.roles r ON r.id=u.role_id WHERE u.username=@username`);
    const user = result.recordset[0];
    if (!user) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    await writeAudit(pool, { username, action: 'login', entity: 'users', entityId: user.id });
    res.json({ data: { id: user.id, username: user.username, role: user.role_name, fields: user.fields_json ? JSON.parse(user.fields_json) : [] } });
  } catch (err) {
    logServerError('users:login', err);
    res.status(500).json({ error: publicError(err) });
  }
});

module.exports = router;
