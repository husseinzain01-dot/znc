// Reads the tables we need from a حساباتي Access file (Units2026.accdb) and
// normalises them into plain objects with English field names, numbers and
// ISO date strings. Read-only: the file is never written.
//
// Access stores dates without a time zone; mdb-reader hands them back as UTC
// Date objects, so the UTC parts are the wall-clock values entered in Access.

const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const str = (v) => (v == null ? '' : String(v).trim());
const day = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '');
const stamp = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 19).replace('T', ' ') : '');

function rows(reader, name) {
  if (!reader.getTableNames().includes(name)) return [];
  return reader.getTable(name).getData();
}

export function loadDatabase(reader) {
  const items = rows(reader, 'madaCode').map((r) => ({
    id: r.ID,
    code: str(r.IDcode),
    cls: str(r.MadaClass),
    name: str(r.madaName),
    harig: num(r.harig),
    priceL1: num(r.price),
    priceL2: num(r.priceSeeat),
    fill: num(r.Fill),
    buyL1: num(r.BpriceL1),
    buyL2: num(r.BpriceL2),
    unitL1: str(r.UnitL1),
    unitL2: str(r.UnitL2),
    openL1: num(r.Pr),
    openL2: num(r.Pru),
  }));

  const sales = rows(reader, 'MasterOut').map((r) => ({
    id: r.idOut,
    no: str(r.InvoiceNo),
    customer: str(r.TOname),
    note: str(r.note),
    date: day(r.OutDate),
    time: stamp(r.timeS),
    type: str(r.OutType),
    paid: num(r.Paid),
    user: str(r.strUserName),
    rep: str(r.Mandob),
  }));

  const saleLines = rows(reader, 'subOut').map((r) => ({
    id: r.id,
    saleId: r.idOut,
    item: str(r.madaNameOut),
    qty: num(r.QuntOut),
    price: num(r.Price),
    unit: str(r.unit),
    buyL1: num(r.BpriceL1),
    buyL2: num(r.BpriceL2),
    note: str(r.note),
  }));

  const purchases = rows(reader, 'MasterIn').map((r) => ({
    id: r.IdIn,
    no: str(r.InvoiceNo),
    supplier: str(r.fromname),
    note: str(r.note),
    date: day(r.InvoiceDate),
    time: stamp(r.timeS),
    type: str(r.InType),
    user: str(r.strUserName),
  }));

  const purchaseLines = rows(reader, 'subIN').map((r) => ({
    id: r.id,
    purchaseId: r.IdIn,
    item: str(r.madaNameIn),
    qty: num(r.QuntIn),
    price: num(r.Price),
    unit: str(r.unit),
    expire: day(r.expireDate),
  }));

  const customers = rows(reader, 'bayeeCode').map((r) => ({
    id: r.id,
    name: str(r.bayeeCode),
    opening: num(r.MB),
    mobile: str(r.CMobile),
    address: str(r.Cadress),
    type: str(r.Ctype),
    group: str(r.Group),
    rep: str(r.Mandob),
    since: day(r.RegDate) || day(r.Cdate),
  }));

  const suppliers = rows(reader, 'shiraCode').map((r) => ({
    id: r.ID,
    name: str(r.shiraCode),
    opening: num(r.MB),
    mobile: str(r.CMobile),
    address: str(r.Cadress),
    since: day(r.RegDate) || day(r.Cdate),
  }));

  const money = (r, nameField) => ({
    id: r.idS,
    date: day(r.dataS),
    no: str(r.mostandNO),
    name: str(r[nameField]),
    cls: str(r.classS),
    amount: num(r.mablak),
    note: str(r.note),
    time: stamp(r.timeS),
    user: str(r.strUserName),
  });
  const receipts = rows(reader, 'mablakIn').map((r) => money(r, 'nameFrom'));
  const payments = rows(reader, 'mablakOut').map((r) => money(r, 'nameto'));

  const classes = (t) => rows(reader, t).map((r) => str(r.quodCode)).filter(Boolean);
  const classesIn = classes('quodCodeIn');
  const classesOut = classes('quodCodeOut');
  // Only the user names; the password column is never read.
  const userNames = reader.getTableNames().includes('Users')
    ? reader.getTable('Users').getData({ columns: ['UserName', 'Active'] }).filter((r) => r.Active !== false && r.Active !== 0).map((r) => str(r.UserName)).filter(Boolean)
    : [];

  return { items, sales, saleLines, purchases, purchaseLines, customers, suppliers, receipts, payments, classesIn, classesOut, userNames };
}
