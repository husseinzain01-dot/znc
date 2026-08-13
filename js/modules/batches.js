// ── BATCH CRUD ──
function toggleLayerFields(){
  let isLayer=$('bType').value==='بياض';
  ['grpLayerSource'].forEach(id=>{if($(id))$(id).classList.toggle('hidden',!isLayer)});
  updateBirdStrainOptions();
  toggleLayerAge();
}
function updateBirdStrainOptions(){
  let sel=$('birdStrain');if(!sel)return;
  let isLayer=$('bType')&&$('bType').value==='بياض';
  let old=sel.value;
  let strains=isLayer?Object.keys(LAYER_WEIGHT_GUIDES):Object.keys(BROILER_WEIGHT_GUIDES);
  sel.innerHTML=strains.map(s=>`<option>${s}</option>`).join('');
  if(strains.includes(old))sel.value=old;
}
function toggleLayerAge(){
  let isLayer=$('bType')&&$('bType').value==='بياض';
  let isPurchased=isLayer&&$('layerSource')&&$('layerSource').value==='شراء';
  ['grpLayerAge','grpLayerAgeDays'].forEach(id=>{if($(id))$(id).classList.toggle('hidden',!isPurchased)});
}
function updateSetEggs(){
  let set=Math.max(0,num('eggs')-num('badEggs'));
  if($('setEggs'))$('setEggs').value=set;
}
function clearForm(){
  ['editId','bName','eggReceiveDate','hatchDate','eggs','setEggs','note','eggWeight','motherAge'].forEach(id=>$(id)&&($(id).value=''));
  if($('batchTargetField'))$('batchTargetField').value='';
  if($('birdStrain'))$('birdStrain').value='Ross 308';
  if($('batchSupplier'))$('batchSupplier').value='';
  if($('batchCompany'))$('batchCompany').value='';
  if($('badEggs'))$('badEggs').value=0;
  if($('bType'))$('bType').value='لحم';
  if($('layerSource'))$('layerSource').value='مفقس';
  if($('layerInitWeeks'))$('layerInitWeeks').value=0;
  if($('layerInitDays'))$('layerInitDays').value=0;
  toggleLayerFields();
}
function formBatch(){
  return{
    id:val('editId')?+val('editId'):null,
    name:val('bName'),eggReceiveDate:val('eggReceiveDate'),hatchDate:val('hatchDate'),
    targetField:val('batchTargetField'),
    birdStrain:val('birdStrain')||'Ross 308',
    supplier:val('batchSupplier'),
    company:val('batchCompany'),
    type:$('bType').value,
    eggs:num('eggs'),badEggs:num('badEggs'),setEggs:Math.max(0,num('eggs')-num('badEggs')),
    eggWeight:+($('eggWeight')&&$('eggWeight').value)||0,
    motherAge:+($('motherAge')&&$('motherAge').value)||0,
    alertAge:35,marketAge:35,note:val('note'),
    layerSource:$('layerSource')?$('layerSource').value:'مفقس',
    layerInitWeeks:$('layerInitWeeks')?num('layerInitWeeks'):0,
    layerInitDays:$('layerInitDays')?num('layerInitDays'):0
  };
}
function saveBatch(){
  if(!isAdmin())return;
  let b=formBatch();
  if(!validateBatchForm())return;
  if(b.id){
    let old=data.batches.find(x=>x.id===b.id);Object.assign(old,b);
  }else{
    b.id=Date.now();b.status='نشطة';b.transferDate='';b.fieldEntryDate='';
    b.field='';b.hall='';b.hatched='';b.vaccineDeaths=0;b.isolatedBirds=0;
    b.netHatch=0;b.fieldBirds=0;b.fixedHatchRate=0;
    data.batches.push(b);
  }
  clearForm();save();renderAll();
}
function editBatch(id){
  if(!isAdmin())return;
  let b=data.batches.find(x=>x.id===id);if(!b)return;
  $('editId').value=b.id;$('bName').value=b.name;$('hatchDate').value=b.hatchDate;
  if($('eggReceiveDate'))$('eggReceiveDate').value=b.eggReceiveDate||'';
  if($('batchTargetField'))$('batchTargetField').value=b.targetField||b.field||'';
  if($('birdStrain'))$('birdStrain').value=b.birdStrain||'Ross 308';
  if($('batchSupplier'))$('batchSupplier').value=b.supplier||'';
  if($('batchCompany'))$('batchCompany').value=b.company||'';
  $('bType').value=b.type||'لحم';$('eggs').value=b.eggs||0;$('badEggs').value=b.badEggs||0;
  updateSetEggs();
  $('note').value=b.note||'';
  if($('eggWeight'))$('eggWeight').value=b.eggWeight||'';
  if($('motherAge'))$('motherAge').value=b.motherAge||'';
  if($('layerSource'))$('layerSource').value=b.layerSource||'مفقس';
  if($('layerInitWeeks'))$('layerInitWeeks').value=b.layerInitWeeks||0;
  if($('layerInitDays'))$('layerInitDays').value=b.layerInitDays||0;
  toggleLayerFields();
  show('batch',null);
}
function deleteBatch(id){
  if(!isAdmin())return;
  let b=data.batches.find(x=>x.id===id);if(!b)return;
  if(b.transferDate){
    // الوجبة منقولة — اسأل هل يعيدها للمفقس أو يحذفها كلياً
    let choice=confirm('هذه الوجبة منقولة إلى الحقل.\nاضغط موافق لإعادتها إلى المفقس\nاضغط إلغاء لحذفها نهائياً مع كل سجلاتها');
    if(choice===null)return;
    if(choice){
      // إعادة للمفقس
      b.transferDate='';b.fieldEntryDate='';b.field='';b.hallId=null;b.hall='';
      b.hallAllocations=[];b.fieldBirds=0;b.transferBirdWeight=0;
      b.hatched='';b.vaccineDeaths=0;b.isolatedBirds=0;b.unfitBirds=0;
      b.netHatch=0;b.fixedHatchRate=0;b.status='نشطة';
      data.morts=(data.morts||[]).filter(m=>m.batchId!==id);
      data.markets=(data.markets||[]).filter(m=>m.batchId!==id);
      data.feeds=(data.feeds||[]).filter(f=>f.batchId!==id);
      data.meds=(data.meds||[]).filter(m=>m.batchId!==id);
      data.weights=(data.weights||[]).filter(w=>w.batchId!==id);
      if(selectedBatchId===id)selectedBatchId=null;
      save();renderAll();msg('تمت إعادة الوجبة إلى المفقس');
      return;
    }
  }
  if(!confirm('حذف الوجبة وكل سجلاتها (أعلاف، أدوية، أوزان، هلاك، تسويق) نهائياً؟'))return;
  data.batches=data.batches.filter(x=>x.id!==id);
  data.morts=(data.morts||[]).filter(m=>m.batchId!==id);
  data.markets=(data.markets||[]).filter(m=>m.batchId!==id);
  data.feeds=(data.feeds||[]).filter(f=>f.batchId!==id);
  data.meds=(data.meds||[]).filter(m=>m.batchId!==id);
  data.weights=(data.weights||[]).filter(w=>w.batchId!==id);
  if(selectedBatchId===id)selectedBatchId=null;
  save();renderAll();msg('تم حذف الوجبة وجميع سجلاتها');
}


function clearTransferForm(keepBatch=false){
  if(!keepBatch&&$('transferBatch')) $('transferBatch').selectedIndex=0;
  ['transferDate','transferCandle','transferDamaged','transferExamined','vaccineDeaths','isolatedBirds','unfitBirds','transferNet','transferIsolationRate','fieldBirds','transferBirdWeight','transferSupervisor','transferVet'].forEach(id=>{if($(id))$(id).value=''});
  if($('transferReadyNet'))$('transferReadyNet').textContent='—';
  if($('transferAlertAge'))$('transferAlertAge').value=35;
  if($('transferMarketAge'))$('transferMarketAge').value=35;
  if($('transferField')) $('transferField').selectedIndex=0;
  if($('transferHall')) $('transferHall').innerHTML='';
  if($('grpTransferHall')) $('grpTransferHall').classList.remove('hidden');
  if($('transferHall')) $('transferHall').innerHTML='';
  if($('grpTransferHall')) $('grpTransferHall').classList.remove('hidden');
  if($('fieldWarn')) {$('fieldWarn').className='warnBox';$('fieldWarn').textContent=''}
  if($('transferPreview')) $('transferPreview').innerHTML='';
  onTransferFieldChange();
}
function onTransferFieldChange(){
  // تحديث قائمة القاعات بناءً على الحقل المختار
  let fn=$('transferField').value;
  let grp=$('grpTransferHall');
  let hallSel=$('transferHall');
  if(!fn||!grp||!hallSel){checkFieldOccupancy();return;}
  let f=data.fields.find(x=>x.name===fn);
  let halls=data.halls.filter(h=>h.fieldId===(f?f.id:null));
  if(halls.length>0){
    hallSel.innerHTML=halls.map(h=>`<option value="${h.id}">${esc(h.name)}${h.capacity?' — سعة '+h.capacity:''}</option>`).join('');
    grp.classList.remove('hidden');
  }else{
    hallSel.innerHTML='<option value="">'+t('noHalls')+'</option>';
    grp.classList.add('hidden');
  }
  checkFieldOccupancy();
  renderHallAllocationRows();
  renderTransferAllocationsSummary();
}
function distributeToAllHalls(){
  if(!isAdmin())return;
  let batchId=+($('transferBatch')&&$('transferBatch').value)||0;
  let b=data.batches.find(x=>x.id===batchId);
  if(!b)return msg('⚠ '+t('errSelectBatch'));
  let fieldName=$('transferField')&&$('transferField').value;
  if(!fieldName)return msg('⚠ '+t('errSelectField'));
  let net=num('transferNet'),unfit=num('unfitBirds'),readyNet=Math.max(0,net-unfit);
  if(readyNet<=0)return msg('⚠ '+t('errEnterNet'));
  let f=data.fields.find(x=>x.name===fieldName);
  let halls=data.halls.filter(h=>h.fieldId===(f?f.id:null));
  if(!halls.length)return msg('⚠ '+t('noHalls'));
  if(!confirm('توزيع '+readyNet.toLocaleString()+' طير على '+halls.length+' قاعة بالتساوي؟'))return;

  let base=Math.floor(readyNet/halls.length);
  let remainder=readyNet%halls.length;

  let vac=num('vaccineDeaths'),iso=num('isolatedBirds'),eggs=+b.eggs||0;
  let hat=readyNet+vac+iso+unfit;
  let examined=num('transferExamined');
  let date=val('transferDate')||today();

  b.hatched=hat;
  b.examinedEggs=examined;
  b.fertileEggs=readyNet;
  b.vaccineDeaths=vac;
  b.isolatedBirds=iso;
  b.unfitBirds=unfit;
  b.netHatch=readyNet;
  b.fixedHatchRate=eggs?+((readyNet/eggs)*100).toFixed(2):0;
  b.candle=transferCandleRate(net,b,examined);
  b.isolationRate=transferIsolationRate(net,b);
  b.damagedAfterCandle=transferDamagedCount(net,examined);
  if(!b.transferDate)b.transferDate=date;
  if(!b.fieldEntryDate)b.fieldEntryDate=date;
  b.field=fieldName;
  if(!b.targetField)b.targetField=fieldName;
  b.transferBirdWeight=num('transferBirdWeight')||b.transferBirdWeight||0;
  if(num('transferAlertAge')>0)b.alertAge=num('transferAlertAge');
  if(num('transferMarketAge')>0)b.marketAge=num('transferMarketAge');

  b.hallAllocations=halls.map((h,i)=>({hallId:h.id,hall:h.name,birds:base+(i<remainder?1:0)}));
  b.fieldBirds=transferredBirdsFromBatch(b);
  let first=b.hallAllocations[0];
  b.hallId=first?+first.hallId:null;
  b.hall=first?first.hall:'';
  b.status=hatchAvailableForTransfer(b)>0?'نقل جزئي':'نشطة';

  save();renderAll();
  msg('تم توزيع '+readyNet.toLocaleString()+' طير على '+halls.length+' قاعة ('+base+' لكل قاعة'+(remainder?' والباقي '+remainder+' على أول قاعات)':')'));
}

function editTransferBatch(id){
  if(!enforcePermission(ACTIONS.EDIT_BATCH))return;
  let b=data.batches.find(x=>x.id===id);
  if(!b)return;
  $('transferBatch').value=b.id;
  $('transferDate').value=b.fieldEntryDate||b.transferDate||today();
  if($('transferField').querySelector('option[value="'+(b.field||'')+'"]')) $('transferField').value=b.field;
  onTransferFieldChange();
  // اختيار القاعة المحفوظة
  if(b.hallId&&$('transferHall')){
    setTimeout(()=>{if($('transferHall').querySelector('option[value="'+b.hallId+'"]'))$('transferHall').value=b.hallId;},50);
  }
  if($('transferNet'))$('transferNet').value=b.netHatch||'';
  if($('transferCandle'))$('transferCandle').value=b.candle?(+b.candle).toFixed(2):'';
  if($('transferDamaged'))$('transferDamaged').value=b.damagedAfterCandle||'';
  if($('transferExamined'))$('transferExamined').value=b.examinedEggs||'';
  if($('transferIsolationRate'))$('transferIsolationRate').value=b.isolationRate?(+b.isolationRate).toFixed(2):'';
  $('vaccineDeaths').value=b.vaccineDeaths||0;
  $('isolatedBirds').value=b.isolatedBirds||0;
  updateTransferAll();
  if($('fieldBirds'))$('fieldBirds').value=b.fieldBirds||'';
  if($('transferAlertAge'))$('transferAlertAge').value=b.alertAge||35;
  if($('transferMarketAge'))$('transferMarketAge').value=b.marketAge||35;
  fillTransferPreview(false);
  msg('تم جلب بيانات النقل للتعديل');
}


function editBatchAllocation(batchId,hallId){
  if(!enforcePermission(ACTIONS.EDIT_BATCH))return;
  let b=data.batches.find(x=>x.id===batchId);
  if(!b||!Array.isArray(b.hallAllocations))return;
  let a=b.hallAllocations.find(x=>+x.hallId===+hallId);
  if(!a)return;
  let old=+a.birds||0;
  let v=prompt('اكتب العدد الجديد لهذه القاعة', old);
  if(v===null)return;
  let newCount=+v;
  if(!Number.isFinite(newCount)||newCount<=0)return msg('⚠ '+t('errPositiveNum'));

  // احسب السعة مع تجاهل هذا التخصيص القديم مؤقتاً
  a.birds=0;
  let st=hallCapacityStatus(+hallId,newCount,null);
  if(!st.ok){
    a.birds=old;
    return msg('⚠ القاعة لا تتحمل العدد الجديد. المتاح: '+st.remaining.toLocaleString());
  }
  a.birds=newCount;
  b.hallAllocations=b.hallAllocations.filter(x=>(+x.birds||0)>0);
  b.fieldBirds=transferredBirdsFromBatch(b);
  let first=b.hallAllocations[0]||null;
  b.hallId=first?+first.hallId:null;
  b.hall=first?first.hall:'';
  save();renderAll();msg('تم تعديل توزيع القاعة');
}
function deleteBatchAllocation(batchId,hallId){
  if(!enforcePermission(ACTIONS.EDIT_BATCH))return;
  let b=data.batches.find(x=>x.id===batchId);
  if(!b||!Array.isArray(b.hallAllocations))return;
  let a=b.hallAllocations.find(x=>+x.hallId===+hallId);
  if(!a)return;
  if(!confirm('حذف توزيع هذه القاعة؟\nسيعود عددها إلى المتبقي بالمفقس.'))return;
  b.hallAllocations=b.hallAllocations.filter(x=>+x.hallId!==+hallId);
  b.fieldBirds=transferredBirdsFromBatch(b);
  if(!b.hallAllocations.length){
    b.transferDate='';
    b.fieldEntryDate='';
    b.field='';
    b.hallId=null;
    b.hall='';
    b.fieldBirds=0;
    b.transferBirdWeight=0;
    b.hatched='';
    b.vaccineDeaths=0;
    b.isolatedBirds=0;
    b.unfitBirds=0;
    b.netHatch=0;
    b.fixedHatchRate=0;
    b.status='نشطة';
  }else{
    let first=b.hallAllocations[0];
    b.hallId=+first.hallId;
    b.hall=first.hall||'';
    b.status=hatchAvailableForTransfer(b)>0?'نقل جزئي':'نشطة';
  }
  save();renderAll();msg('تم حذف توزيع القاعة');
}
function renderTransferFieldHallDetails(){renderTransferAllocationsSummary();}


function renderTransferAllocationsSummary(){
  let el=$('transferAllocationsSummary');if(!el)return;
  let fieldName=$('transferField')?$('transferField').value:'';
  if(!fieldName){el.innerHTML='';return;}
  let batches=data.batches.filter(b=>b.transferDate&&!calc(b).completed&&b.field===fieldName);
  let rows=[];
  batches.forEach(b=>{
    let arr=(Array.isArray(b.hallAllocations)&&b.hallAllocations.length)?b.hallAllocations:[];
    arr.forEach(a=>{
      rows.push(`<tr>
        <td>${esc(b.name)}</td>
        <td>${esc(a.hall||'—')}</td>
        <td><b>${(+a.birds||0).toLocaleString()}</b></td>
        <td>${hatchAvailableForTransfer(b).toLocaleString()}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="editBatchAllocation(${b.id},${+a.hallId})">تعديل</button> <button class="btn btn-danger btn-sm" onclick="deleteBatchAllocation(${b.id},${+a.hallId})">حذف</button></td>
      </tr>`);
    });
  });
  el.innerHTML=`<div class="detailPanel"><div class="dp-head"><span class="dp-title">📌 توزيع الوجبات على قاعات ${esc(fieldName)}</span></div>
    <div class="tableWrap"><table><thead><tr><th>${t('thBatch')}</th><th>${t('thHall')}</th><th>${t('thCount')}</th><th>${t('thRemainHatch')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows.join('')||'<tr><td colspan="5">'+t('noTransferredBatches')+'</td></tr>'}</tbody></table></div>
  </div>`;
}

function deleteTransfer(batchId){
  if(!enforcePermission(ACTIONS.EDIT_BATCH))return;
  let b=data.batches.find(x=>x.id===batchId);
  if(!b)return msg('⚠ '+t('errBatchNotFound'));
  if(!b.transferDate&&!b.fieldBirds&&!(b.hallAllocations||[]).length)return msg('⚠ '+t('errBatchNotTransferred'));
  if(!confirm('هل أنت متأكد من حذف عملية النقل؟\n\nسيتم إرجاع جميع الطيور إلى المفقس وإلغاء توزيع القاعات.'))return;

  b.transferDate='';
  b.fieldEntryDate='';
  b.field='';
  b.hallId=null;
  b.hall='';
  b.hallAllocations=[];
  b.fieldBirds=0;
  b.transferBirdWeight=0;
  b.hatched='';
  b.vaccineDeaths=0;
  b.isolatedBirds=0;
  b.unfitBirds=0;
  b.netHatch=0;
  b.fixedHatchRate=0;
  b.status='نشطة';

  selectedBatchId=b.id;
  save();
  renderAll();
  msg('تم حذف النقل وإرجاع الوجبة إلى المفقس');
}

function renderTransferredBatches(){
  let el=$('transferredTable');if(!el)return;
  let rows=data.batches.filter(b=>b.transferDate).map(b=>{
    let c=calc(b);
    return `<tr class="selectable" onclick="editTransferBatch(${b.id})">
      <td><b>${esc(b.name)}</b></td>
      <td>${fmt(c.entryDate)}</td>
      <td>${esc(b.field||'—')}</td>
      <td>${Array.isArray(b.hallAllocations)&&b.hallAllocations.length?b.hallAllocations.map(a=>`${esc(a.hall)}: ${(+a.birds||0).toLocaleString()}`).join('<br>'):(esc(b.hall||'—'))}</td>
      <td>${(b.hatched||0).toLocaleString()}</td>
      <td>${b.candle?(+b.candle).toFixed(2)+'%':'0.00%'}</td>
      <td>${(+b.vaccineDeaths||0).toLocaleString()}</td>
      <td>${(+b.isolatedBirds||0).toLocaleString()}</td>
      <td><b>${(+b.fieldBirds||0).toLocaleString()}</b></td>
      <td>${hatchRate(b)}%</td>
      <td>${hatchAvailableForTransfer(b).toLocaleString()}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();editTransferBatch(${b.id})">تعديل</button> <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteTransfer(${b.id})">حذف النقل</button></td>
    </tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thBatch')}</th><th>${t('thEntryDate')}</th><th>${t('thField')}</th><th>${t('thHall')}</th><th>${t('thHatched')}</th><th>${t('thCandling')}</th><th>${t('thVaccMort')}</th><th>${t('thIsolation')}</th><th>${t('thNetTransfer')}</th><th>${t('thHatchRate')}</th><th>${t('thRemainHatch')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows}</tbody>`;
}



function transferredBirdsFromBatch(b){
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length){
    return b.hallAllocations.reduce((s,a)=>s+(+a.birds||0),0);
  }
  return +b.fieldBirds||0;
}
function hatchAvailableForTransfer(b){
  let c=calc(b);
  let source=(+b.netHatch||0)>0?+b.netHatch:c.netHatch;
  return Math.max(0,source-transferredBirdsFromBatch(b));
}
function mergeBatchAllocations(oldArr,newArr){
  let map=new Map();
  (oldArr||[]).forEach(a=>{
    if(!a||!a.hallId)return;
    map.set(+a.hallId,{hallId:+a.hallId,hall:a.hall||'',birds:+a.birds||0});
  });
  (newArr||[]).forEach(a=>{
    if(!a||!a.hallId)return;
    let id=+a.hallId;
    let old=map.get(id)||{hallId:id,hall:a.hall||'',birds:0};
    old.hall=a.hall||old.hall;
    old.birds=(+old.birds||0)+(+a.birds||0);
    map.set(id,old);
  });
  return [...map.values()].filter(a=>(+a.birds||0)>0);
}

function currentTransferHalls(){
  let fn=$('transferField')?$('transferField').value:'';
  let f=data.fields.find(x=>x.name===fn);
  return f?data.halls.filter(h=>h.fieldId===f.id):[];
}
function renderHallAllocationRows(rows=[]){return;}
function getHallAllocationsFromUI(){return [];}
function addHallAllocationRow(){
  let arr=getHallAllocationsFromUI();
  let halls=currentTransferHalls();
  let used=new Set(arr.map(x=>x.hallId));
  let next=halls.find(h=>!used.has(h.id))||halls[0];
  if(next)arr.push({hallId:next.id,birds:''});
  renderHallAllocationRows(arr);
}
function removeHallAllocationRow(i){
  let arr=getHallAllocationsFromUI();
  arr.splice(i,1);
  renderHallAllocationRows(arr);
}
function autoDistributeHalls(){
  let total=num('fieldBirds');
  if(total<=0)return msg('⚠ '+t('errEnterNet'));
  let halls=currentTransferHalls();
  let remaining=total, arr=[];
  for(const h of halls){
    if(remaining<=0)break;
    let st=hallCapacityStatus(h.id,0,null);
    let cap=st.cap?Math.max(0,st.remaining):remaining;
    let take=Math.min(remaining,cap);
    if(take>0){arr.push({hallId:h.id,birds:take});remaining-=take;}
  }
  if(remaining>0)return msg('⚠ سعة القاعات غير كافية. المتبقي: '+remaining.toLocaleString());
  renderHallAllocationRows(arr);
}
function checkAllocations(){return true;}
function batchAllocatedToHall(b,hallId){
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length){
    let a=b.hallAllocations.find(x=>+x.hallId===+hallId);
    return a?+a.birds||0:0;
  }
  return (+b.hallId===+hallId)?(+b.fieldBirds||0):0;
}
function batchHallMort(b,hallId){
  return(data.morts||[]).filter(m=>+m.batchId===b.id&&+m.hallId===hallId).reduce((s,m)=>s+(+m.count||0),0);
}
function batchHallSold(b,hallId){
  return(data.markets||[]).filter(m=>m.batchId==b.id&&+m.hallId===hallId).reduce((s,m)=>s+(+m.count||0),0);
}
function batchHallAlive(b,hallId){
  if(calc(b).completed)return 0;
  let alloc=batchAllocatedToHall(b,hallId);
  return Math.max(0,alloc-batchHallMort(b,hallId)-batchHallSold(b,hallId));
}

function selectHallDetail(bId,hallId){
  let b=(data.batches||[]).find(x=>x.id===+bId);if(!b)return;
  let upd=(f,v)=>document.querySelectorAll(`[data-dpbatch="${bId}"][data-dpfield="${f}"]`).forEach(el=>el.textContent=v);
  if(!+hallId){
    let c=calc(b);
    upd('hall',b.hall||'—');
    upd('birds',(c.fieldBirds||0).toLocaleString());
    upd('mort',c.mort.toLocaleString());
    upd('sold',c.sold.toLocaleString());
    upd('alive',c.alive.toLocaleString());
    return;
  }
  let hid=+hallId;
  let a=(b.hallAllocations||[]).find(x=>+x.hallId===hid)||{};
  upd('hall',a.hall||b.hall||'قاعة '+hid);
  upd('birds',batchAllocatedToHall(b,hid).toLocaleString());
  upd('mort',batchHallMort(b,hid).toLocaleString());
  upd('sold',batchHallSold(b,hid).toLocaleString());
  upd('alive',batchHallAlive(b,hid).toLocaleString());
}

// ── TRANSFER ──
function transferCandleRate(net=null,batch=null,examined=null){
  let b=batch;
  if(!b&&$('transferBatch')){
    let id=+$('transferBatch').value;
    b=data.batches.find(x=>x.id===id);
  }
  let n=net===null?num('transferNet'):+net||0;
  let exm=examined===null?num('transferExamined'):+examined||0;
  if(!exm&&b)exm=(+b.setEggs||0)>0?+b.setEggs:Math.max(0,(+b.eggs||0)-(+b.badEggs||0));
  return exm?+((n/exm)*100).toFixed(2):0;
}
function transferDamagedCount(net=null,examined=null){
  let n=net===null?num('transferNet'):+net||0;
  let exm=examined===null?num('transferExamined'):+examined||0;
  return Math.max(0,exm-n);
}
function updateTransferCandle(){
  if($('transferCandle'))$('transferCandle').value=transferCandleRate()?(+transferCandleRate()).toFixed(2):'';
  if($('transferDamaged'))$('transferDamaged').value=transferDamagedCount()||'';
}
function transferIsolationRate(net=null,batch=null){
  let b=batch;
  if(!b&&$('transferBatch')){
    let id=+$('transferBatch').value;
    b=data.batches.find(x=>x.id===id);
  }
  let n=net===null?num('transferNet'):+net||0;
  let setEggs=b?((+b.setEggs||0)>0?+b.setEggs:Math.max(0,(+b.eggs||0)-(+b.badEggs||0))):0;
  return setEggs?+(((setEggs-n)/setEggs)*100).toFixed(2):0;
}
function updateTransferAll(){
  updateTransferCandle();
  updateTransferIsolation();
  checkFieldOccupancy();
}
function updateTransferIsolation(){
  let net=num('transferNet'),unfit=num('unfitBirds');
  let readyNet=Math.max(0,net-unfit);
  if($('transferReadyNet'))$('transferReadyNet').textContent=readyNet?readyNet.toLocaleString():'—';
  if($('transferIsolationRate'))$('transferIsolationRate').value=transferIsolationRate(net)?(+transferIsolationRate(net)).toFixed(2):'';
}
function fillTransferPreview(showMsg=true){
  if(!$('transferBatch'))return;
  let id=+$('transferBatch').value;if(!id){$('transferPreview').innerHTML='';return}
  let b=data.batches.find(x=>x.id===id);let c=calc(b);
  if(!$('transferDate').value)$('transferDate').value=today();
  let preferredField=b.targetField||b.field||'';
  if(preferredField&&$('transferField').querySelector('option[value="'+preferredField+'"]')){
    $('transferField').value=preferredField;
    onTransferFieldChange();
  }
  if($('transferExamined'))$('transferExamined').value=$('transferExamined').value||b.examinedEggs||((+b.setEggs||0)>0?+b.setEggs:Math.max(0,(+b.eggs||0)-(+b.badEggs||0)))||'';
  let storedNet=(+b.netHatch||0)+(+b.unfitBirds||0);
  if($('transferNet'))$('transferNet').value=$('transferNet').value||(storedNet||b.netHatch)||'';
  $('vaccineDeaths').value=$('vaccineDeaths').value||b.vaccineDeaths||0;
  $('isolatedBirds').value=$('isolatedBirds').value||b.isolatedBirds||0;
  if($('unfitBirds'))$('unfitBirds').value=$('unfitBirds').value||b.unfitBirds||0;
  $('fieldBirds').value=$('fieldBirds').value||'';
  updateTransferAll();
  if($('transferBirdWeight'))$('transferBirdWeight').value=$('transferBirdWeight').value||b.transferBirdWeight||'';
  if($('transferAlertAge'))$('transferAlertAge').value=b.alertAge||35;
  if($('transferMarketAge'))$('transferMarketAge').value=b.marketAge||35;
  checkFieldOccupancy();
  let alertHtml=c.hatchLate?`<div style="background:var(--red2);border:1px solid #fecaca;border-radius:var(--r2);padding:10px 14px;font-size:12px;color:var(--red);font-weight:600;margin-bottom:10px">⚠️ متأخرة عن النقل</div>`:c.hatchComplete?`<div style="background:var(--amber2);border:1px solid #fcd34d;border-radius:var(--r2);padding:10px 14px;font-size:12px;color:#78350f;font-weight:600;margin-bottom:10px">🔔 الفقسة اكتملت — انقلها للحقل</div>`:'';
  $('transferPreview').innerHTML=alertHtml+`<div class="detailGrid" style="grid-template-columns:repeat(4,1fr)"><div class="dCell"><div class="dc-label">موعد النقل</div><div class="dc-val">${fmt(c.expectedTransfer)}</div></div><div class="dCell"><div class="dc-label">عمر التفقيس</div><div class="dc-val">${c.hatchAge}/21</div></div><div class="dCell dc-accent"><div class="dc-label">البيض المرقد</div><div class="dc-val">${c.est.toLocaleString()}</div></div><div class="dCell"><div class="dc-label">المنقول سابقاً</div><div class="dc-val">${transferredBirdsFromBatch(b).toLocaleString()}</div></div><div class="dCell dc-accent"><div class="dc-label">المتبقي بالمفقس</div><div class="dc-val">${hatchAvailableForTransfer(b).toLocaleString()}</div></div></div>`;
  if(showMsg)msg(c.hatchComplete?'الفقسة جاهزة للنقل':'تم جلب بيانات الوجبة');
}
function saveTransfer(){
  if(!isAdmin())return;
  let id=+$('transferBatch').value,b=data.batches.find(x=>x.id===id);
  if(!b)return msg('⚠ اختر الوجبة أولاً');
  if(!val('transferDate'))return msg('⚠ أدخل تاريخ دخول الحقل');

  let fieldName=$('transferField').value;
  if(!fieldName)return msg('⚠ اختر الحقل');

  let hallId=$('transferHall')&&$('transferHall').value?+$('transferHall').value:null;
  if(!hallId)return msg('⚠ اختر القاعة');

  let hallObj=data.halls.find(h=>h.id===hallId);
  if(!hallObj)return msg('⚠ القاعة المختارة غير موجودة');

  updateTransferAll();
  let vac=num('vaccineDeaths'),iso=num('isolatedBirds'),unfit=num('unfitBirds'),net=num('transferNet'),readyNet=Math.max(0,net-unfit),moveCount=num('fieldBirds');
  if(net<=0)return msg('⚠ أدخل صافي عدد الطير');
  if(moveCount<=0)return msg('⚠ أدخل عدد الطير المراد نقله الآن');

  let previousTransferred=transferredBirdsFromBatch(b);
  let available=Math.max(0,readyNet-previousTransferred);
  if(moveCount>available)return msg('⚠ العدد أكبر من المتبقي. المتبقي: '+available.toLocaleString());

  let capCheck=hallCapacityStatus(hallId,moveCount,null);
  if(!capCheck.ok)return msg('⚠ القاعة لا تتحمل هذا العدد. المتاح: '+capCheck.remaining.toLocaleString()+' طير');

  let eggs=+b.eggs||0;
  let allocation={hallId:hallId,hall:hallObj.name,birds:moveCount};

  let examined=num('transferExamined');
  let hat=readyNet+vac+iso+unfit;
  b.hatched=hat;
  b.examinedEggs=examined;
  b.fertileEggs=readyNet;
  b.damagedAfterCandle=transferDamagedCount(net,examined);
  b.candle=transferCandleRate(net,b,examined);
  b.isolationRate=transferIsolationRate(net,b);
  b.vaccineDeaths=vac;
  b.isolatedBirds=iso;
  b.unfitBirds=unfit;
  b.netHatch=readyNet;
  b.transferBirdWeight=num('transferBirdWeight')||b.transferBirdWeight||0;
  b.hallAllocations=mergeBatchAllocations(b.hallAllocations||[],[allocation]);
  b.fieldBirds=transferredBirdsFromBatch(b);
  b.fixedHatchRate=eggs?+((readyNet/eggs)*100).toFixed(2):0;

  if(!b.transferDate)b.transferDate=val('transferDate');
  if(!b.fieldEntryDate)b.fieldEntryDate=val('transferDate');
  b.field=fieldName;
  if(!b.targetField)b.targetField=fieldName;

  let first=b.hallAllocations[0]||null;
  b.hallId=first?+first.hallId:null;
  b.hall=first?first.hall:'';

  b.status=hatchAvailableForTransfer(b)>0?'نقل جزئي':'نشطة';
  if($('transferAlertAge')&&num('transferAlertAge')>0)b.alertAge=num('transferAlertAge');
  if($('transferMarketAge')&&num('transferMarketAge')>0)b.marketAge=num('transferMarketAge');
  if(val('transferSupervisor'))b.supervisor=val('transferSupervisor');
  if(val('transferVet'))b.vet=val('transferVet');

  selectedBatchId=b.id;
  save();

  // تسجيل وزن تلقائي بعمر يوم 0 عند النقل
  let birdW=b.transferBirdWeight||0;
  if(birdW>0){
    data.weights=data.weights||[];
    let alreadyDay0=data.weights.find(w=>w.batchId===b.id&&+w.ageDays===0&&+w.hallId===hallId);
    if(!alreadyDay0){
      let guideW0=Math.round(expectedWeightForBatch(b,0)*1000);
      let achv0=guideW0?+(birdW/guideW0*100).toFixed(1):0;
      data.weights.push({
        id:Date.now()+2,batchId:b.id,field:fieldName,hallId:hallId,hall:hallObj.name,
        date:val('transferDate'),ageDays:0,alive:moveCount,
        actual_weight_grams:birdW,guideWeightGrams:guideW0,achievementPct:achv0,
        avgWeight:+(birdW/1000).toFixed(3),expectedWeight:+(guideW0/1000).toFixed(3),
        totalWeight:Math.round(birdW*moveCount),diff:+(achv0-100).toFixed(1),
        note:'وزن الطير عند النقل — يوم 0'
      });
      save();
    }
  }

  renderAll();
  clearTransferForm();
  msg('تم نقل '+moveCount.toLocaleString()+' طير إلى '+hallObj.name+'، المتبقي بالمفقس '+hatchAvailableForTransfer(b).toLocaleString());
}


function clearMortForm(){
  if($('mortField')) $('mortField').selectedIndex=0;
  if($('mortBatch')) $('mortBatch').selectedIndex=0;
  if($('mortHall')) $('mortHall').innerHTML='';
  if($('mortDate')) $('mortDate').value=today();
  if($('mortAge')) $('mortAge').value='';
  if($('mortCount')) $('mortCount').value='';
  if($('mortReason')) $('mortReason').value='';
  onMortFieldChange();
}
function clearMarketForm(){
  if($('marketBatch')) $('marketBatch').selectedIndex=0;
  if($('marketHall')) $('marketHall').innerHTML='';
  if($('marketDate')) $('marketDate').value=today();
  if($('marketCount')) $('marketCount').value='';
  if($('marketStatus')) $('marketStatus').selectedIndex=0;
  if($('marketNote')) $('marketNote').value='';
  fillMarketHalls();
}


// ── LAYER PURCHASE ──
function clearLayerPurchaseForm(){
  ['lpName','lpBirds','lpWeeks','lpDays','lpChickWeight','lpAvgWeight','lpNote'].forEach(id=>{if($(id))$(id).value=''});
  if($('lpDate'))$('lpDate').value=today();
  if($('lpField'))$('lpField').selectedIndex=0;
  onLayerPurchaseFieldChange();
  if($('lpWarn')){$('lpWarn').className='warnBox';$('lpWarn').textContent=''}
}
function onLayerPurchaseFieldChange(){
  let fn=$('lpField')?$('lpField').value:'';
  let f=data.fields.find(x=>x.name===fn);
  let halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
  if($('lpHall'))$('lpHall').innerHTML=halls.map(h=>`<option value="${h.id}">${esc(h.name)}${h.capacity?' — سعة '+h.capacity:''}</option>`).join('');
  checkLayerPurchaseCapacity();
}
function checkLayerPurchaseCapacity(){
  let warn=$('lpWarn');if(!warn)return;
  let hallId=$('lpHall')&&$('lpHall').value?+$('lpHall').value:null;
  let birds=num('lpBirds');
  if(!hallId){warn.className='warnBox';warn.textContent='';return true}
  let st=hallCapacityStatus(hallId,birds,null);
  if(!st.cap){warn.className='warnBox free';warn.textContent='✅ القاعة بدون سعة محددة، يسمح بالحفظ';return true}
  if(st.ok){warn.className='warnBox free';warn.textContent=`✅ متاح في القاعة: ${st.remaining.toLocaleString()} طير`;return true}
  warn.className='warnBox busy';warn.textContent=`⚠️ العدد أكبر من طاقة القاعة. المشغول: ${st.used.toLocaleString()} / ${st.cap.toLocaleString()}، المتاح: ${st.remaining.toLocaleString()}`;
  return false;
}
function saveLayerPurchase(){
  if(!isAdmin())return;
  let name=val('lpName'),date=val('lpDate'),field=val('lpField'),hallId=$('lpHall')&&$('lpHall').value?+$('lpHall').value:null,birds=num('lpBirds');
  if(!name||!date||!field||!hallId||birds<=0)return msg('⚠ أدخل اسم الوجبة والتاريخ والحقل والقاعة والعدد');
  if(!checkLayerPurchaseCapacity())return;
  let hall=data.halls.find(h=>h.id===hallId);
  let b={id:Date.now(),name,hatchDate:date,type:'بياض',birdStrain:'بياض تجاري',eggs:0,badEggs:0,candle:0,alertAge:980,marketAge:980,note:val('lpNote'),status:'نشطة',
    transferDate:date,fieldEntryDate:date,field,hallId,hall:hall?hall.name:'',hatched:0,vaccineDeaths:0,isolatedBirds:0,netHatch:0,
    fieldBirds:birds,fixedHatchRate:0,layerSource:'شراء',layerInitWeeks:num('lpWeeks')||0,layerInitDays:num('lpDays')||0};
  data.batches.push(b);
  let avg=+($('lpAvgWeight').value||0),cw=num('lpChickWeight')||0;
  if(avg||cw){
    data.weights=data.weights||[];
    data.weights.push({id:Date.now()+1,batchId:b.id,field,hallId,hall:b.hall,date,avgWeight:avg||0,expectedWeight:expectedWeightForBatch(b,calc(b,date).flockAge),totalWeight:avg?+(avg*birds).toFixed(2):0,note:'وزن الدخول / شراء البياض'});
    if(hall){hall.chickWeight=cw||hall.chickWeight||0;hall.avgWeight=avg||hall.avgWeight||0;hall.totalWeight=avg?+(avg*birds).toFixed(2):(hall.totalWeight||0);}
  }
  selectedBatchId=b.id;save();renderAll();clearLayerPurchaseForm();msg('تم حفظ شراء البياض');
}
function renderLayerPurchase(){
  let el=$('layerPurchaseTable');if(!el)return;
  let rows=data.batches.filter(b=>b.type==='بياض'&&b.layerSource==='شراء').map(b=>{
    let c=calc(b),lw=latestWeightForBatch(b.id);
    return `<tr class="selectable" onclick="selectBatch(${b.id});show('dash',document.querySelectorAll('.nav')[0])">
      <td><b>${esc(b.name)}</b></td><td>${fmt(c.entryDate)}</td><td>${esc(b.field||'—')}</td><td>${esc(b.hall||'—')}</td>
      <td>${(+b.fieldBirds||0).toLocaleString()}</td><td>${fmtLayerAge(c.flockAge)}</td><td>${lw?lw.avgWeight+' كغ':'—'}</td><td>${c.alive.toLocaleString()}</td>
    </tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thBatch')}</th><th>${t('thEntryDate')}</th><th>${t('thField')}</th><th>${t('thHall')}</th><th>${t('thCount')}</th><th>${t('thAge')}</th><th>${t('thLastWeight')}</th><th>${t('thAlive')}</th></tr></thead><tbody>${rows}</tbody>`;
}
