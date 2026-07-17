const { sql } = require('../db');
const { createCrudRouter } = require('./crud');

module.exports = createCrudRouter({
  table: 'dbo.marketing',
  entity: 'marketing',
  orderBy: 'date DESC',
  filters: ['batch_id', 'field_name'],
  columns: [
    { name: 'id', type: sql.BigInt, isId: true, required: true, label: 'المعرّف' },
    { name: 'batch_id', type: sql.BigInt },
    { name: 'field_name', type: sql.NVarChar(150) },
    { name: 'date', type: sql.Date, required: true, label: 'التاريخ' },
    { name: 'quantity', type: sql.Int },
    { name: 'weight_grams', type: sql.BigInt },
    { name: 'price', type: sql.Decimal(14, 2) },
    { name: 'buyer', type: sql.NVarChar(200) },
    { name: 'note', type: sql.NVarChar(500) },
    { name: 'created_at', type: sql.DateTime2, computed: true },
    { name: 'created_by', type: sql.NVarChar(100) },
  ],
});
