const { sql } = require('../db');
const { createCrudRouter } = require('./crud');

module.exports = createCrudRouter({
  table: 'dbo.fields',
  entity: 'fields',
  orderBy: 'name',
  columns: [
    { name: 'id', type: sql.Int, isId: true, computed: true },
    { name: 'name', type: sql.NVarChar(150), required: true, label: 'اسم الحقل' },
    { name: 'created_at', type: sql.DateTime2, computed: true },
    { name: 'updated_at', type: sql.DateTime2, computed: true },
    { name: 'updated_by', type: sql.NVarChar(100) },
  ],
});
