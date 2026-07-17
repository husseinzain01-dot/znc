// ── FEED & MEDS ──
function hallInfo(hallId){return data.halls.find(h=>+h.id===+hallId)||null}
function fieldHallsByName(fieldName){
  let f=data.fields.find(x=>x.name===fieldName);
  return f?data.halls.filter(h=>h.fieldId===f.id):[];
}
function feedTotalHall(hallId,date=null){
  return (data.feeds||[]).filter(x=>(+x.hallId||0)===+hallId&&(!date||x.date===date)).reduce((s,x)=>s+(+x.qty||0),0);
}
function feedTotalField(fieldName,date=null){
  return (data.feeds||[]).filter(x=>x.field===fieldName&&(!date||x.date===date)).reduce((s,x)=>s+(+x.qty||0),0);
}
function medsCountHall(hallId,date=null){
  return (data.meds||[]).filter(x=>(+x.hallId||0)===+hallId&&(!date||x.date===date)).length;
}
function medsCountField(fieldName,date=null){
  return (data.meds||[]).filter(x=>x.field===fieldName&&(!date||x.date===date)).length;
}
function lastMedHall(hallId){
  let list=(data.meds||[]).filter(x=>(+x.hallId||0)===+hallId).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return list[0]||null;
}
function activeBatchForHall(hallId){
  if(!hallId)return null;
  return (data.batches||[]).find(b=>batchAllocatedToHall(b,+hallId)>0&&b.status==='في الحقل')||
         (data.batches||[]).find(b=>batchAllocatedToHall(b,+hallId)>0);
}
function calcBirdAge(entryDate,date){
  if(!entryDate||!date)return null;
  return Math.max(0,Math.round((new Date(date)-new Date(entryDate))/(1000*60*60*24)));
}
function updateFeedAge(){
  let el=$('feedAge');if(!el)return;
  let hallId=$('feedHall')&&$('feedHall').value?+$('feedHall').value:0;
  let b=activeBatchForHall(hallId);
  let entryDate=b?(b.fieldEntryDate||b.transferDate||''):'';
  let date=val('feedDate')||today();
  let age=calcBirdAge(entryDate,date);
  el.value=age!==null?age:'';
}
function updateMedAge(){
  let el=$('medAge');if(!el)return;
  let hallId=$('medHall')&&$('medHall').value?+$('medHall').value:0;
  let b=activeBatchForHall(hallId);
  let entryDate=b?(b.fieldEntryDate||b.transferDate||''):'';
  let date=val('medDate')||today();
  let age=calcBirdAge(entryDate,date);
  el.value=age!==null?age:'';
}
function updateMarketAge(){
  let el=$('marketAge');if(!el)return;
  let id=$('marketBatch')?+$('marketBatch').value:0;
  let b=data.batches.find(x=>x.id===id);
  let entryDate=b?(b.fieldEntryDate||b.transferDate||''):'';
  let date=val('marketDate')||today();
  let age=calcBirdAge(entryDate,date);
  el.value=age!==null?age:'';
}
function onFeedFieldChange(){
  let field=val('feedField');
  let halls=fieldHallsByName(field);
  if($('feedHall'))$('feedHall').innerHTML=halls.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  updateFeedAge();
}
function onMedFieldChange(){
  let field=val('medField');
  let halls=fieldHallsByName(field);
  if($('medHall'))$('medHall').innerHTML=halls.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  updateMedAge();
}
function clearFeedForm(){
  if($('feedDate'))$('feedDate').value=today();
  if($('feedField'))$('feedField').selectedIndex=0;
  ['feedType','feedQty','feedNote'].forEach(id=>{if($(id))$(id).value=''});
  if($('feedAge'))$('feedAge').value='';
  onFeedFieldChange();
}
function clearMedForm(){
  if($('medDate'))$('medDate').value=today();
  if($('medField'))$('medField').selectedIndex=0;
  if($('medType'))$('medType').selectedIndex=0;
  ['medName','medDose','medQty','medNote'].forEach(id=>{if($(id))$(id).value=''});
  if($('medAge'))$('medAge').value='';
  onMedFieldChange();
}
function saveFeed(){
  let field=val('feedField'),hallId=$('feedHall')&&$('feedHall').value?+$('feedHall').value:null;
  let hall=hallInfo(hallId);
  if(!field||!hallId)return msg('⚠ اختر الحقل والقاعة أولاً');
  let qty=num('feedQty');
  if(qty<=0)return msg('⚠ أدخل كمية العلف');
  data.feeds=data.feeds||[];
  let feedAgeV=$('feedAge')&&$('feedAge').value!==''?+$('feedAge').value:null;
  data.feeds.push({id:Date.now(),date:val('feedDate')||today(),field,hallId,hall:hall?hall.name:'',feedType:val('feedType'),qty,note:val('feedNote'),ageDays:feedAgeV});
  save();renderAll();clearFeedForm();msg('تم حفظ استهلاك العلف');
}
function saveMed(){
  let field=val('medField'),hallId=$('medHall')&&$('medHall').value?+$('medHall').value:null;
  let hall=hallInfo(hallId);
  if(!field||!hallId)return msg('⚠ اختر الحقل والقاعة أولاً');
  if(!val('medName'))return msg('⚠ أدخل اسم المادة');
  data.meds=data.meds||[];
  let medAgeV=$('medAge')&&$('medAge').value!==''?+$('medAge').value:null;
  data.meds.push({id:Date.now(),date:val('medDate')||today(),field,hallId,hall:hall?hall.name:'',type:val('medType'),name:val('medName'),dose:val('medDose'),qty:num('medQty'),note:val('medNote'),ageDays:medAgeV});
  save();renderAll();clearMedForm();msg('تم حفظ الدواء/اللقاح');
}
function deleteFeed(id){
  if(!isAdmin())return;
  if(confirm('حذف سجل العلف؟')){
    data.feeds=(data.feeds||[]).filter(x=>x.id!==id);
    save();renderAll();msg('تم حذف سجل العلف');
  }
}
function deleteMed(id){
  if(!isAdmin())return;
  if(confirm('حذف سجل الدواء/اللقاح؟')){
    data.meds=(data.meds||[]).filter(x=>x.id!==id);
    save();renderAll();msg('تم حذف سجل الدواء/اللقاح');
  }
}
// ══════════════════════════════════════════════
// دوال الإدخال الجماعي — هلاك / علف / أدوية
// ══════════════════════════════════════════════

// ── مساعد مشترك: قاعات الوجبة في الحقل ──
function _bulkHalls(batchId, fieldName){
  let b=(data.batches||[]).find(x=>x.id===batchId);
  if(!b)return[];
  let fn=fieldName||(b.field||'');
  let f=data.fields.find(x=>x.name===fn);
  return f?data.halls.filter(h=>h.fieldId===f.id&&batchAllocatedToHall(b,h.id)>0):[];
}
