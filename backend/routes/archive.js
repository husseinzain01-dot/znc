const { sql } = require('../db');
const { createCrudRouter } = require('./crud');

module.exports = createCrudRouter({
  table: 'dbo.archive',
  entity: 'archive',
  orderBy: 'created_at DESC',
  filters: ['batch_id', 'field_name'],
  columns: [
    { name: 'id', type: sql.BigInt, isId: true, required: true, label: 'المعرّف' },
    { name: 'batch_id', type: sql.BigInt },
    { name: 'field_name', type: sql.NVarChar(150) },
    { name: 'data_json', type: sql.NVarChar(sql.MAX) },
    { name: 'created_at', type: sql.DateTime2, computed: true },
    { name: 'created_by', type: sql.NVarChar(100) },
  ],
});
