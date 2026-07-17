// ── VALIDATION ──
// تنظيف النصوص قبل العرض (أعمق من esc)
function sanitizeInput(str){
  if(str==null)return'';
  return String(str)
    .replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;')
    .replace(/\//g,'&#x2F;')
    .trim();
}

// التحقق من حقل مطلوب
function validateRequired(value, label){
  if(!value||String(value).trim()===''){
    msg('⚠ '+label+' مطلوب');
    return false;
  }
  return true;
}

// التحقق من رقم موجب ضمن نطاق
function validateNumber(value, label, min=0, max=Infinity){
  const n=Number(value);
  if(value===''||value==null||isNaN(n)){
    msg('⚠ '+label+' يجب أن يكون رقماً');
    return false;
  }
  if(n<min||n>max){
    msg('⚠ '+label+' يجب أن يكون بين '+min+' و '+max);
    return false;
  }
  return true;
}

// التحقق من صيغة التاريخ YYYY-MM-DD
function validateDate(str, label){
  if(!str||!/^\d{4}-\d{2}-\d{2}$/.test(str)){
    msg('⚠ '+(label||'التاريخ')+' غير صحيح');
    return false;
  }
  const d=new Date(str);
  if(isNaN(d.getTime())){
    msg('⚠ '+(label||'التاريخ')+' غير صالح');
    return false;
  }
  return true;
}

// التحقق من مجموعة حقول مطلوبة
// fields = [[elementId, label], ...]
function requireFields(fields){
  for(const [id,label] of fields){
    const el=$(id);
    if(!el)continue;
    const v=(el.value||'').trim();
    if(!v){
      msg('⚠ '+label+' مطلوب');
      try{el.focus()}catch(e){}
      return false;
    }
  }
  return true;
}

// تنظيف قيم كائن قبل الحفظ (إزالة مسافات زائدة، منع < >)
function sanitizeRecord(obj){
  const out={};
  for(const[k,v]of Object.entries(obj)){
    if(typeof v==='string'){
      out[k]=v.trim().replace(/[<>]/g,'');
    }else{
      out[k]=v;
    }
  }
  return out;
}

// التحقق من نموذج الوجبة
function validateBatchForm(){
  return requireFields([
    ['bName','اسم الوجبة'],
    ['hatchDate','تاريخ الترقيد']
  ]);
}

// التحقق من نموذج الوزن
function validateWeightForm(){
  return requireFields([
    ['wDate','تاريخ الوزن'],
    ['wBatch','الوجبة']
  ]);
}

// التحقق من نموذج الهلاك
function validateMortForm(){
  return requireFields([
    ['mortDate','تاريخ الهلاك'],
    ['mortBatch','الوجبة']
  ]);
}

// التحقق من نموذج التسويق
function validateMarketForm(){
  return requireFields([
    ['mktDate','تاريخ التسويق'],
    ['mktBatch','الوجبة']
  ]);
}

// منع XSS في قيمة نصية مُدخلة
function isSafeText(str){
  if(!str)return true;
  const dangerous=/[<>]|javascript:|data:|on\w+\s*=/i;
  return !dangerous.test(str);
}
