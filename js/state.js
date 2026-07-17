// ── STATE ──
let data={
  batches:[],morts:[],markets:[],fields:[],
  halls:[],            // [{id,fieldId,name,capacity,chickWeight,avgWeight,totalWeight}]
  weights:[],          // [{id,batchId,field,hallId,hall,date,avgWeight,expectedWeight,totalWeight,note}]
  feeds:[],            // [{id,date,field,hallId,hall,feedType,qty,note}]
  meds:[],             // [{id,date,field,hallId,hall,type,name,dose,qty,note}]
  subUsers:[],          // [{id,name,pass,role,fields:[fieldName,...]}]
  user:'admin',pass:'1234'  // المدير الرئيسي
};
let calDate=new Date();
let selectedBatchId=null;
let selectedFieldName=null;
let currentUser=null; // {name, role, fields} — set on login
