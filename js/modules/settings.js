// ── SETTINGS ──
function saveCreds(){if(!isAdmin())return;if(!val('newUser')||!val('newPass'))return msg('⚠ أدخل اسم المستخدم وكلمة المرور');data.user=val('newUser');data.pass=val('newPass');save();msg('تم حفظ بيانات الدخول')}
function wipeAll(){if(!isAdmin())return;if(confirm('مسح كل البيانات نهائياً؟ لا يمكن التراجع.')){data.batches=[];data.morts=[];data.markets=[];data.fields=[];data.halls=[];data.weights=[];data.subUsers=[];selectedBatchId=null;save();renderAll()}}

function onFixBatchChange(){
  let bId=$('fixBatch')&&$('fixBatch').value?+$('fixBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  let cur=b?(b.fieldEntryDate||b.transferDate||''):'';
  if($('fixCurrentDate'))$('fixCurrentDate').value=cur;
  if($('fixNewDate'))$('fixNewDate').value=cur;
  if($('fixResult'))$('fixResult').textContent='';
}
function renderFixBatchSelect(){
  let opts=(data.batches||[]).map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
  let placeholder='<option value="">-- اختر الوجبة --</option>';
  let sel=$('fixBatch');
  if(sel){sel.innerHTML=placeholder+opts;if($('fixCurrentDate'))$('fixCurrentDate').value='';if($('fixNewDate'))$('fixNewDate').value='';if($('fixResult'))$('fixResult').textContent='';}
  let sel2=$('editInfoBatch');
  if(sel2){sel2.innerHTML=placeholder+opts;if($('editInfoSupervisor'))$('editInfoSupervisor').value='';if($('editInfoVet'))$('editInfoVet').value='';if($('editInfoEggWeight'))$('editInfoEggWeight').value='';if($('editInfoResult'))$('editInfoResult').textContent='';}
}
function onEditInfoBatchChange(){
  let bId=$('editInfoBatch')&&$('editInfoBatch').value?+$('editInfoBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if($('editInfoSupervisor'))$('editInfoSupervisor').value=b?(b.supervisor||''):'';
  if($('editInfoVet'))$('editInfoVet').value=b?(b.vet||''):'';
  if($('editInfoEggWeight'))$('editInfoEggWeight').value=b&&b.eggWeight?b.eggWeight:'';
  if($('editInfoResult'))$('editInfoResult').textContent='';
}
function applyEditBatchInfo(){
  if(!isAdmin())return;
  let bId=$('editInfoBatch')&&$('editInfoBatch').value?+$('editInfoBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b)return msg('⚠ اختر الوجبة أولاً');
  b.supervisor=($('editInfoSupervisor')&&$('editInfoSupervisor').value)||'';
  b.vet=($('editInfoVet')&&$('editInfoVet').value)||'';
  b.eggWeight=$('editInfoEggWeight')&&$('editInfoEggWeight').value?+$('editInfoEggWeight').value:b.eggWeight||0;
  save();renderAll();
  if($('editInfoResult'))$('editInfoResult').textContent='✅ تم حفظ التعديلات بنجاح';
}
function applyFixEntryDate(){
  if(!isAdmin())return;
  let bId=$('fixBatch')&&$('fixBatch').value?+$('fixBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b)return msg('⚠ اختر الوجبة أولاً');
  let newDate=val('fixNewDate');
  if(!newDate)return msg('⚠ أدخل تاريخ الدخول الصحيح');
  let oldDate=b.fieldEntryDate||b.transferDate||'';
  if(newDate===oldDate)return msg('⚠ التاريخ الجديد مطابق للحالي');
  if(!confirm(`سيتم تغيير تاريخ الدخول من ${oldDate||'غير محدد'} إلى ${newDate}\nوإعادة حساب عمر الطير في جميع السجلات.\nهل أنت متأكد؟`))return;

  // تحديث التاريخ في الوجبة
  if(b.fieldEntryDate)b.fieldEntryDate=newDate;
  if(b.transferDate)b.transferDate=newDate;

  let counts={feeds:0,meds:0,morts:0,weights:0};

  // إعادة حساب ageDays في الأعلاف
  (data.feeds||[]).filter(x=>x.batchId===b.id).forEach(x=>{
    let age=calcBirdAge(newDate,x.date);
    x.ageDays=age!=null?age:undefined;
    counts.feeds++;
  });

  // إعادة حساب ageDays في الأدوية
  (data.meds||[]).filter(x=>x.batchId===b.id).forEach(x=>{
    let age=calcBirdAge(newDate,x.date);
    x.ageDays=age!=null?age:undefined;
    counts.meds++;
  });

  // إعادة حساب ageDays في الهلاك
  (data.morts||[]).filter(x=>x.batchId===b.id).forEach(x=>{
    let age=calcBirdAge(newDate,x.date);
    x.ageDays=age!=null?age:undefined;
    counts.morts++;
  });

  // إعادة حساب الأوزان + الكايد
  (data.weights||[]).filter(x=>x.batchId===b.id).forEach(x=>{
    let age=calcBirdAge(newDate,x.date);
    if(age==null)return;
    x.ageDays=age;
    let guideG=Math.round(expectedWeightForBatch(b,age)*1000);
    x.guideWeightGrams=guideG;
    x.expectedWeight=+(guideG/1000).toFixed(3);
    let actualG=+x.actual_weight_grams||0;
    x.achievementPct=guideG&&actualG?+(actualG/guideG*100).toFixed(1):0;
    x.diff=+(x.achievementPct-100).toFixed(1);
    counts.weights++;
  });

  save();renderAll();
  if($('fixResult'))$('fixResult').textContent=`✅ تم التحديث: ${counts.feeds} علف، ${counts.meds} دواء/لقاح، ${counts.morts} هلاك، ${counts.weights} وزن`;
  if($('fixCurrentDate'))$('fixCurrentDate').value=newDate;
}
