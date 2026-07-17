const { sql } = require('../db');
const { createCrudRouter } = require('./crud');

module.exports = createCrudRouter({
  table: 'dbo.mortalities',
  entity: 'mortalities',
  orderBy: 'date DESC',
  filters: ['batch_id', 'field_name'],
  columns: [
    { name: 'id', type: sql.BigInt, isId: true, required: true, label: 'المعرّف' },
    { name: 'batch_id', type: sql.BigInt },
    { name: 'field_name', type: sql.NVarChar(150) },
    { name: 'hall', type: sql.NVarChar(150) },
    { name: 'date', type: sql.Date, required: true, label: 'التاريخ' },
    { name: 'count', type: sql.Int, required: true, label: 'العدد' },
    { name: 'reason', type: sql.NVarChar(200) },
    { name: 'note', type: sql.NVarChar(500) },
    { name: 'created_at', type: sql.DateTime2, computed: true },
    { name: 'created_by', type: sql.NVarChar(100) },
  ],
});
