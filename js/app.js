// ── BOOT ──
let _sess=sessionStorage.getItem('cf_logged');
let _user=sessionStorage.getItem('cf_user');
if(_sess==='1'&&_user){
  try{currentUser=JSON.parse(_user)}catch(e){currentUser=null}
  if(currentUser){
    $('loginBox').classList.add('hidden');
    $('app').classList.remove('hidden');
    load();buildNav();updateUserChip();applyLang();
    pullCloud().then(()=>startRealtimeSync());
  // استرجاع حالة الشريط الجانبي
  if(sessionStorage.getItem('sideCollapsed')==='1')$('app').classList.add('collapsed');
  // زر الرجوع بالمتصفح
  history.replaceState({page:'dash',title:'لوحة المعلومات'},'',window.location.pathname+'#dash');
  window.addEventListener('popstate',function(e){
    let pg=(e.state&&e.state.page)||'dash';
    show(pg,null,true);
  });
  }
}

// Override: فحص إشغال القاعة في نقل الفقسة
function checkFieldOccupancy(){
  let warn=$('fieldWarn');if(!warn)return true;
  let hallId=$('transferHall')&&$('transferHall').value?+$('transferHall').value:null;
  let birds=num('fieldBirds')||num('transferNet')||0;
  if(!hallId){
    warn.className='warnBox';
    warn.textContent='';
    return true;
  }
  let st=hallCapacityStatus(hallId,birds,null);
  if(!st.cap){
    warn.className='warnBox free';
    warn.textContent='✅ القاعة بدون سعة محددة';
    return true;
  }
  if(st.ok){
    warn.className='warnBox free';
    warn.textContent=`✅ متاح في القاعة: ${st.remaining.toLocaleString()} طير`;
    return true;
  }
  warn.className='warnBox busy';
  warn.textContent=`⚠️ العدد أكبر من طاقة القاعة. المشغول: ${st.used.toLocaleString()} / ${st.cap.toLocaleString()}، المتاح: ${st.remaining.toLocaleString()}`;
  return false;
}


// V39.1 safe override: حساب القاعة حسب حصتها فقط بدون كسر الواجهة
function batchAllocatedToHall(b,hallId){
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length){
    let a=b.hallAllocations.find(x=>+x.hallId===+hallId);
    return a?+a.birds||0:0;
  }
  return (+b.hallId===+hallId)?(+b.fieldBirds||0):0;
}
function batchHallAlive(b,hallId){
  let alloc=batchAllocatedToHall(b,hallId);
  let c=calc(b),base=c.fieldBirds||0;
  if(!alloc||!base)return 0;
  let ratio=alloc/base;
  let loss=Math.round((c.mort+c.sold)*ratio);
  return Math.max(0,alloc-loss);
}
function batchHallMort(b,hallId){
  let alloc=batchAllocatedToHall(b,hallId),c=calc(b),base=c.fieldBirds||0;
  return base?Math.round(c.mort*(alloc/base)):0;
}
function batchHallSold(b,hallId){
  let alloc=batchAllocatedToHall(b,hallId),c=calc(b),base=c.fieldBirds||0;
  return base?Math.round(c.sold*(alloc/base)):0;
}
function hallUsedBirds(hallId,ignoreBatchId=null){
  return data.batches.filter(b=>b.id!==ignoreBatchId&&!calc(b).completed&&b.transferDate)
    .reduce((s,b)=>s+batchAllocatedToHall(b,hallId),0);
}


// V40: حساب الحقل والقاعات والهلاك حسب القاعة
function batchAllocatedToHall(b,hallId){
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length){
    let a=b.hallAllocations.find(x=>+x.hallId===+hallId);
    return a?+a.birds||0:0;
  }
  return (+b.hallId===+hallId)?(+b.fieldBirds||0):0;
}
function mortalityForBatchHall(batchId,hallId){
  return (data.morts||[]).filter(m=>+m.batchId===+batchId&&(+m.hallId||0)===+hallId).reduce((s,m)=>s+(+m.count||0),0);
}
function mortalityForBatchUnassigned(batchId){
  return (data.morts||[]).filter(m=>+m.batchId===+batchId&&!(+m.hallId||0)).reduce((s,m)=>s+(+m.count||0),0);
}
function marketForBatchHall(batchId,hallId){
  return (data.markets||[]).filter(m=>+m.batchId===+batchId&&(+m.hallId||0)===+hallId).reduce((s,m)=>s+(+m.count||0),0);
}
function marketForBatchUnassigned(batchId){
  return (data.markets||[]).filter(m=>+m.batchId===+batchId&&!(+m.hallId||0)).reduce((s,m)=>s+(+m.count||0),0);
}
function batchHallMort(b,hallId){
  let assigned=mortalityForBatchHall(b.id,hallId);
  let unassigned=mortalityForBatchUnassigned(b.id);
  if(!unassigned)return assigned;
  let alloc=batchAllocatedToHall(b,hallId),base=calc(b).fieldBirds||0;
  return assigned+(base?Math.round(unassigned*(alloc/base)):0);
}
function batchHallSold(b,hallId){
  let assigned=marketForBatchHall(b.id,hallId);
  let unassigned=marketForBatchUnassigned(b.id);
  if(!unassigned)return assigned;
  let alloc=batchAllocatedToHall(b,hallId),base=calc(b).fieldBirds||0;
  return assigned+(base?Math.round(unassigned*(alloc/base)):0);
}
function batchHallAlive(b,hallId){
  let alloc=batchAllocatedToHall(b,hallId);
  return alloc-batchHallMort(b,hallId)-batchHallSold(b,hallId);
}
function batchHallAliveBeforeDate(b,hallId,date){
  let alloc=batchAllocatedToHall(b,hallId);
  let mortBefore=(data.morts||[]).filter(m=>m.batchId===b.id&&+m.hallId===hallId&&m.date<date).reduce((s,m)=>s+(+m.count||0),0);
  let unassignedMortBefore=(data.morts||[]).filter(m=>m.batchId===b.id&&!m.hallId&&m.date<date).reduce((s,m)=>s+(+m.count||0),0);
  let base=calc(b).fieldBirds||0;
  if(unassignedMortBefore&&base)mortBefore+=Math.round(unassignedMortBefore*(alloc/base));
  let soldBefore=(data.markets||[]).filter(m=>m.batchId===b.id&&m.date<date).reduce((s,m)=>s+(+m.count||0),0);
  let soldHallBefore=base?Math.round(soldBefore*(alloc/base)):0;
  return Math.max(0,alloc-mortBefore-soldHallBefore);
}
function hallUsedBirds(hallId,ignoreBatchId=null){
  return data.batches.filter(b=>b.id!==ignoreBatchId&&!calc(b).completed&&b.transferDate)
    .reduce((s,b)=>s+batchAllocatedToHall(b,hallId),0);
}
function fieldTotals(fieldName){
  let f=data.fields.find(x=>x.name===fieldName);
  let halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
  let batches=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&b.field===fieldName);
  let allocated=0,alive=0,mort=0,sold=0,cap=0,totalWeight=0,weightCount=0,weightSum=0;
  halls.forEach(h=>{
    cap+=+h.capacity||0;
    batches.forEach(b=>{
      allocated+=batchAllocatedToHall(b,h.id);
      alive+=batchHallAlive(b,h.id);
      mort+=batchHallMort(b,h.id);
      sold+=batchHallSold(b,h.id);
    });
  });
  batches.forEach(b=>{
    let lw=latestWeightForBatch(b.id);
    if(lw){weightCount++;weightSum+=+lw.avgWeight||0;totalWeight+=+lw.totalWeight||0;}
  });
  return {field:f,halls,batches,allocated,alive,mort,sold,cap,avgWeight:weightCount?+(weightSum/weightCount).toFixed(2):0,totalWeight};
}
function renderBatchHallsPanel(b){
  let el=$('batchHallsPanel');if(!el)return;
  if(!b||!b.field){el.innerHTML='';return;}
  let ft=fieldTotals(b.field);
  let rows=ft.halls.map(h=>{
    let batches=visibleBatches().filter(x=>x.transferDate&&!calc(x).completed&&batchAllocatedToHall(x,h.id)>0);
    let allocated=batches.reduce((s,x)=>s+batchAllocatedToHall(x,h.id),0);
    let alive=batches.reduce((s,x)=>s+batchHallAlive(x,h.id),0);
    let mort=batches.reduce((s,x)=>s+batchHallMort(x,h.id),0);
    let sold=batches.reduce((s,x)=>s+batchHallSold(x,h.id),0);
    let cap=+h.capacity||0;
    let remain=cap?Math.max(0,cap-allocated):'—';
    let occ=cap?((allocated/cap)*100).toFixed(1)+'%':'—';
    let lwList=batches.map(x=>latestWeightForBatch(x.id)).filter(Boolean);
    let avg=lwList.length?+(lwList.reduce((s,w)=>s+(+w.avgWeight||0),0)/lwList.length).toFixed(2):'—';
    return `<tr class="selectable" onclick="showHallDetailsInBatch(${h.id})">
      <td><b>${esc(h.name)}</b></td><td>${cap?cap.toLocaleString():'—'}</td><td>${allocated.toLocaleString()}</td>
      <td><b>${alive.toLocaleString()}</b></td><td>${remain.toLocaleString?remain.toLocaleString():remain}</td><td>${occ}</td>
      <td>${mort.toLocaleString()}</td><td>${sold.toLocaleString()}</td><td>${avg==='—'?'—':avg+' كغ'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showHallDetailsInBatch(${h.id})">تفاصيل</button></td>
    </tr>`;
  }).join('');
  let summary=`<div class="detailPanel" style="margin-bottom:12px">
    <div class="dp-head"><span class="dp-title">🏡 مجموع الحقل: ${esc(b.field)}</span></div>
    <div class="detailGrid">
      <div class="dCell"><div class="dc-label">عدد القاعات</div><div class="dc-val">${ft.halls.length}</div></div>
      <div class="dCell"><div class="dc-label">السعة الكلية</div><div class="dc-val">${ft.cap?ft.cap.toLocaleString():'—'}</div></div>
      <div class="dCell"><div class="dc-label">مجموع الطيور</div><div class="dc-val">${ft.allocated.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">الحي الكلي</div><div class="dc-val">${ft.alive.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">هلاك كل القاعات</div><div class="dc-val">${ft.mort.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">المسوق</div><div class="dc-val">${ft.sold.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">معدل الوزن</div><div class="dc-val">${ft.avgWeight?ft.avgWeight+' كغ':'—'}</div></div>
    </div>
  </div>`;
  el.innerHTML=`<div class="card"><div class="cardTitle"><span class="material-symbols-outlined ct-icon">meeting_room</span> تفاصيل قاعات ${esc(b.field)}</div>${summary}
    <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thCapacity')}</th><th>${t('thCount')}</th><th>${t('thAlive')}</th><th>${t('thAvailable')}</th><th>${t('thOccupancy')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thLastWeight')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows||'<tr><td colspan="10">'+t('noHalls')+'</td></tr>'}</tbody></table></div></div>`;
}
function showHallDetailsInBatch(hallId){
  let h=data.halls.find(x=>x.id===+hallId);if(!h)return;
  let f=data.fields.find(x=>x.id===h.fieldId);
  let batches=visibleBatches().filter(x=>x.transferDate&&!calc(x).completed&&batchAllocatedToHall(x,h.id)>0);
  let allocated=batches.reduce((s,x)=>s+batchAllocatedToHall(x,h.id),0);
  let alive=batches.reduce((s,x)=>s+batchHallAlive(x,h.id),0);
  let mort=batches.reduce((s,x)=>s+batchHallMort(x,h.id),0);
  let sold=batches.reduce((s,x)=>s+batchHallSold(x,h.id),0);
  let cap=+h.capacity||0,remain=cap?Math.max(0,cap-allocated):'—',occ=cap?((allocated/cap)*100).toFixed(1)+'%':'—';
  let mortRate=allocated>0?+(mort/allocated*100).toFixed(1):null;
  let hallWts=(data.weights||[]).filter(w=>+w.hallId===h.id&&weightActualGrams(w)>0).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let lwhall=hallWts[0]||null;
  let avgActual=lwhall?weightActualGrams(lwhall):0;
  let avgGuide=lwhall?weightGuideGrams(lwhall):0;
  let allWeights=batches.map(x=>latestWeightForBatch(x.id)).filter(Boolean);
  let expected=allWeights.length?+(allWeights.reduce((s,w)=>s+(+w.expectedWeight||0),0)/allWeights.length).toFixed(2):'—';
  let total=allWeights.reduce((s,w)=>s+(+w.totalWeight||0),0);
  let lm=lastMedHall(h.id);
  let cells=[
    ['الحقل',f?esc(f.name):'—'],['القاعة',esc(h.name)],['السعة',cap?cap.toLocaleString():'—'],['الإشغال',occ],
    ['عدد القاعة',allocated.toLocaleString()],['الحي داخل القاعة',alive.toLocaleString()],['المتاح',remain.toLocaleString?remain.toLocaleString():remain],
    ['هلاك القاعة',mort.toLocaleString()],['% الهلاك',mortRate!=null?mortRate+'%':'—'],['المسوق',sold.toLocaleString()],
    ['علف اليوم',feedTotalHall(h.id,today()).toLocaleString()+' كغم'],['مجموع العلف',feedTotalHall(h.id).toLocaleString()+' كغم'],
    ['لقاحات/أدوية اليوم',medsCountHall(h.id,today())],['آخر مادة',lm?esc(lm.name):'—'],
    ['آخر وزن قاعة',avgActual?avgActual+' غم':'—'],['الكايد المتوقع',avgGuide?avgGuide+' غم':'—'],
    ['فرق الوزن',(avgActual&&avgGuide)?((avgActual-avgGuide)+' غم'):'—'],
    ['الوزن المتوقع (كلي)',expected==='—'?'—':expected+' كغ'],['مجموع الوزن',total?total.toLocaleString()+' كغ':'—']
  ];
  let rows=batches.map(x=>{let c=calc(x),lw=latestWeightForBatch(x.id);return `<tr><td>${esc(x.name)}</td><td>${fmt(c.entryDate)}</td><td>${c.isLayer?fmtLayerAge(c.flockAge):c.flockAge+'/40'}</td><td>${batchAllocatedToHall(x,h.id).toLocaleString()}</td><td>${batchHallAlive(x,h.id).toLocaleString()}</td><td>${batchHallMort(x,h.id).toLocaleString()}</td><td>${batchHallSold(x,h.id).toLocaleString()}</td><td>${lw?lw.avgWeight+' كغ':'—'}</td></tr>`}).join('');
  let el=$('batchHallsPanel');if(!el)return;
  let prev=el.querySelector('#_hallDetailInner');if(prev)prev.remove();
  let div=document.createElement('div');
  div.id='_hallDetailInner';
  div.innerHTML=`<div class="detailPanel" style="margin-bottom:12px;border:1.5px solid var(--p,#0d9488)">
    <div class="dp-head"><span class="dp-title">🚪 تفاصيل القاعة: ${esc(h.name)}</span><button class="btn btn-secondary btn-sm" onclick="document.getElementById('_hallDetailInner').remove()">إغلاق ✕</button></div>
    <div class="detailGrid">${cells.map(x=>`<div class="dCell"><div class="dc-label">${x[0]}</div><div class="dc-val">${x[1]}</div></div>`).join('')}</div>
    <div class="dp-sub">الوجبات داخل القاعة</div>
    <div class="tableWrap"><table><thead><tr><th>${t('thBatch')}</th><th>${t('thEntryDate')}</th><th>${t('thAge')}</th><th>${t('thCount')}</th><th>${t('thAlive')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thLastWeight')}</th></tr></thead><tbody>${rows||'<tr><td colspan="8">'+t('noActiveBatches')+'</td></tr>'}</tbody></table></div>
  </div>`;
  let card=el.querySelector('.card');
  if(card)card.insertBefore(div,card.children[1]||null);else el.prepend(div);
  div.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function restoreSelectedBatchDetails(){
  let b=data.batches.find(x=>x.id===selectedBatchId);
  if(b&&$('statsDetail'))$('statsDetail').innerHTML=selectedDetails(b);
}
function fillMortHalls(){
  let id=+$('mortBatch').value,b=data.batches.find(x=>x.id===id);
  let sel=$('mortHall');if(!sel)return;
  if(!b){sel.innerHTML='';return;}
  let arr=(Array.isArray(b.hallAllocations)&&b.hallAllocations.length)?b.hallAllocations:(b.hallId?[{hallId:b.hallId,hall:b.hall,birds:b.fieldBirds}]:[]);
  sel.innerHTML=arr.map(a=>`<option value="${a.hallId}">${esc(a.hall||'قاعة')} — عدد ${(+a.birds||0).toLocaleString()}</option>`).join('');
}


// V40.1 تثبيت خيار القاعة المستهدفة دائماً في نقل الفقسة
function onTransferFieldChange(){
  let fn=$('transferField')?$('transferField').value:'';
  let f=data.fields.find(x=>x.name===fn);
  let halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
  let grp=$('grpTransferHall'),sel=$('transferHall');

  if(grp)grp.classList.remove('hidden');
  if(!sel)return;

  if(halls.length){
    sel.innerHTML=halls.map(h=>`<option value="${h.id}">${esc(h.name)}${h.capacity?' — سعة '+(+h.capacity).toLocaleString():''}</option>`).join('');
  }else{
    sel.innerHTML='<option value="">'+t('noHalls')+'</option>';
  }

  checkFieldOccupancy();
  if(typeof renderTransferAllocationsSummary==='function')renderTransferAllocationsSummary();
}


// V40.2 ربط الهلاك بالقاعة المختارة
function mortBatchesForField(fieldName){
  return visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&(!fieldName||b.field===fieldName));
}
function mortHallOptionsForBatch(b,fieldName=''){
  if(!b)return [];
  let arr=[];
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length){
    arr=b.hallAllocations;
  }else if(b.hallId){
    arr=[{hallId:b.hallId,hall:b.hall,birds:b.fieldBirds}];
  }else if(fieldName){
    let f=data.fields.find(x=>x.name===fieldName);
    let halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
    arr=halls.map(h=>({hallId:h.id,hall:h.name,birds:batchHallAlive(b,h.id)}));
  }
  if(fieldName){
    let allowed=new Set(fieldHallsByName(fieldName).map(h=>+h.id));
    arr=arr.filter(a=>allowed.has(+a.hallId));
  }
  return arr;
}
function onMortFieldChange(){
  let field=$('mortField')?$('mortField').value:'';
  let batches=mortBatchesForField(field);
  if($('mortBatch')){
    let old=$('mortBatch').value;
    $('mortBatch').innerHTML=batches.length
      ?batches.map(b=>`<option value="${b.id}">${esc(b.name)} — ${esc(b.field||'')}</option>`).join('')
      :t('noTransferredBatches');
    if(old&&batches.some(b=>String(b.id)===String(old)))$('mortBatch').value=old;
  }
  onMortBatchChange(false);
}
function onMortBatchChange(syncField=true){
  let id=$('mortBatch')?+$('mortBatch').value:0;
  let b=data.batches.find(x=>x.id===id);
  let sel=$('mortHall');if(!sel)return;
  if(!b){sel.innerHTML='<option value="">اختر الوجبة أولاً</option>';updateMortAge();return;}
  if(syncField&&$('mortField')&&b.field&&$('mortField').value!==b.field){
    $('mortField').value=b.field;
  }
  let field=$('mortField')?$('mortField').value:(b.field||'');
  let arr=mortHallOptionsForBatch(b,field);
  sel.innerHTML=arr.length
    ?arr.map(a=>`<option value="${a.hallId}">${esc(a.hall||'قاعة')} — عدد ${(+a.birds||0).toLocaleString()}</option>`).join('')
    :'<option value="">لا توجد قاعات منقولة لهذه الوجبة</option>';
  updateMortAge();
}
function fillMortHalls(){onMortBatchChange(true);}
function updateMortAge(){
  let id=$('mortBatch')?+$('mortBatch').value:0;
  let b=data.batches.find(x=>x.id===id);
  let el=$('mortAge');if(!el)return;
  let entryDate=b?(b.fieldEntryDate||b.transferDate||''):'';
  if(!entryDate){el.value='';return;}
  let date=val('mortDate')||today();
  let diff=Math.max(0,Math.round((new Date(date)-new Date(entryDate))/(1000*60*60*24)));
  el.value=diff;
}
function addMort(){
  let id=+$('mortBatch').value;
  if(!id)return msg('⚠ اختر الوجبة أولاً');
  let b=data.batches.find(x=>x.id===id);
  let field=$('mortField')?$('mortField').value:'';
  if(!field)return msg('⚠ اختر الحقل');
  if(b&&b.field&&field!==b.field)return msg('⚠ الوجبة لا تتبع الحقل المختار');
  let hallId=$('mortHall')&&$('mortHall').value?+$('mortHall').value:null;
  let hallObj=hallId?data.halls.find(h=>h.id===hallId):null;
  let allowedHalls=new Set(fieldHallsByName(field).map(h=>+h.id));
  if(hallId&&!allowedHalls.has(hallId))return msg('⚠ القاعة لا تتبع الحقل المختار');
  if(b&&b.transferDate&&!hallId)return msg('⚠ اختر القاعة التي حدث بها الهلاك');
  let ageDays=$('mortAge')&&$('mortAge').value!==''?+$('mortAge').value:null;
  data.morts.push({
    id:Date.now(),
    batchId:id,
    hallId:hallId,
    hall:hallObj?hallObj.name:'',
    date:val('mortDate')||today(),
    ageDays:ageDays,
    count:num('mortCount'),
    reason:val('mortReason')
  });
  save();renderAll();clearMortForm();
}


// V41: عرض العلف واللقاحات في داشبورد الحقل والقاعة
function fieldTotals(fieldName){
  let f=data.fields.find(x=>x.name===fieldName);
  let halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
  let batches=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&b.field===fieldName);
  let allocated=0,alive=0,mort=0,sold=0,cap=0,totalWeight=0,weightCount=0,weightSum=0;
  halls.forEach(h=>{
    cap+=+h.capacity||0;
    batches.forEach(b=>{
      allocated+=batchAllocatedToHall(b,h.id);
      alive+=batchHallAlive(b,h.id);
      mort+=batchHallMort(b,h.id);
      sold+=batchHallSold(b,h.id);
    });
  });
  // معدل الوزن والكايد للحقل = متوسط آخر قراءة لكل قاعة (وليس لكل وجبة)
  let hallWeightCount=0,hallWeightSum=0,hallGuideSum=0;
  halls.forEach(h=>{
    let hallBatches=batches.filter(b=>(+b.hallId||0)===h.id);
    let lws=hallBatches.map(b=>latestWeightForBatch(b.id)).filter(Boolean);
    lws.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    let lw=lws[0];
    if(lw){hallWeightCount++;hallWeightSum+=weightActualGrams(lw);hallGuideSum+=weightGuideGrams(lw);}
    hallBatches.forEach(b=>{let blw=latestWeightForBatch(b.id);if(blw){weightCount++;weightSum+=weightActualGrams(blw);totalWeight+=+blw.totalWeight||0;}});
  });
  return {field:f,halls,batches,allocated,alive,mort,sold,cap,avgWeight:hallWeightCount?Math.round(hallWeightSum/hallWeightCount):0,guideWeight:hallWeightCount?Math.round(hallGuideSum/hallWeightCount):0,totalWeight,feedToday:feedTotalField(fieldName,today()),feedTotal:feedTotalField(fieldName),medsToday:medsCountField(fieldName,today()),medsTotal:medsCountField(fieldName)};
}
function renderBatchHallsPanel(b){
  let el=$('batchHallsPanel');if(!el)return;
  if(!b||!b.field){el.innerHTML='';return;}
  let ft=fieldTotals(b.field);
  let rows=ft.halls.map(h=>{
    let batches=visibleBatches().filter(x=>x.transferDate&&!calc(x).completed&&batchAllocatedToHall(x,h.id)>0);
    let allocated=batches.reduce((s,x)=>s+batchAllocatedToHall(x,h.id),0);
    let alive=batches.reduce((s,x)=>s+batchHallAlive(x,h.id),0);
    let mort=batches.reduce((s,x)=>s+batchHallMort(x,h.id),0);
    let sold=batches.reduce((s,x)=>s+batchHallSold(x,h.id),0);
    // نسبة الهلاك
    let mortRate=allocated>0?+(mort/allocated*100).toFixed(1):null;
    let mortColor=mortRate==null?'var(--ink3)':mortRate<=3?'#16a34a':mortRate<=6?'#f59e0b':'#dc2626';
    // آخر وزن للقاعة تحديداً
    let hallWts=(data.weights||[]).filter(w=>+w.hallId===h.id&&weightActualGrams(w)>0).sort((a,bx)=>String(bx.date).localeCompare(String(a.date)));
    let lwhall=hallWts[0]||null;
    let lastActualG=lwhall?weightActualGrams(lwhall):0;
    let lastGuideG=lwhall?weightGuideGrams(lwhall):0;
    // نسبة الكايد
    let guideSucc=lastActualG&&lastGuideG?+(lastActualG/lastGuideG*100).toFixed(1):null;
    let guideColor=guideSucc==null?'var(--ink3)':guideSucc>=100?'#16a34a':'#dc2626';
    // نسبة الرياضي
    let mb=batches[0]||null;let ratio=1;
    if(mb){let d0g=Math.round(expectedWeightForBatch(mb,0)*1000);if(mb.transferBirdWeight&&d0g>0)ratio=mb.transferBirdWeight/d0g;else if(mb.eggWeight&&d0g>0)ratio=(mb.eggWeight*0.67)/d0g;else{let bw=(data.weights||[]).filter(w=>w.batchId===mb.id&&weightActualGrams(w)>0&&weightGuideGrams(w)>0);if(bw.length)ratio=bw.reduce((s,w)=>s+weightActualGrams(w)/weightGuideGrams(w),0)/bw.length;}}
    let mathPred=lastGuideG?Math.round(lastGuideG*ratio):0;
    let mathSucc=lastActualG&&mathPred?+(lastActualG/mathPred*100).toFixed(1):null;
    let mathColor=mathSucc==null?'var(--ink3)':mathSucc>=100?'#7c3aed':'#f59e0b';
    return `<tr class="selectable" data-hallid="${h.id}" onclick="showHallDetailsInBatch(${h.id})">
      <td><b>${esc(h.name)}</b></td>
      <td>${allocated.toLocaleString()}</td>
      <td><b>${alive.toLocaleString()}</b></td>
      <td>${mort.toLocaleString()}</td>
      <td><span style="font-weight:700;color:${mortColor}">${mortRate!=null?mortRate+'%':'—'}</span></td>
      <td>${sold.toLocaleString()}</td>
      <td>${feedTotalHall(h.id,today()).toLocaleString()} / ${feedTotalHall(h.id).toLocaleString()} كغم</td>
      <td>${medsCountHall(h.id,today()).toLocaleString()} اليوم</td>
      <td>${lastActualG?lastActualG+' غم':'—'}</td>
      <td><span style="font-weight:700;color:${guideColor}">${guideSucc!=null?guideSucc+'%':'—'}</span></td>
      <td><span style="font-weight:700;color:${mathColor}">${mathSucc!=null?mathSucc+'%':'—'}</span></td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showHallDetailsInBatch(${h.id})">تفاصيل</button></td>
    </tr>`;
  }).join('');
  window._batchHallsPanelBatch=b;
  let fieldGridHtml=`
    <div class="dCell"><div class="dc-label">عدد القاعات</div><div class="dc-val">${ft.halls.length}</div></div>
    <div class="dCell"><div class="dc-label">مجموع الطيور</div><div class="dc-val">${ft.allocated.toLocaleString()}</div></div>
    <div class="dCell"><div class="dc-label">الحي الكلي</div><div class="dc-val">${ft.alive.toLocaleString()}</div></div>
    <div class="dCell"><div class="dc-label">هلاك كل القاعات</div><div class="dc-val">${ft.mort.toLocaleString()}</div></div>
    <div class="dCell"><div class="dc-label">علف اليوم</div><div class="dc-val">${ft.feedToday.toLocaleString()} كغم</div></div>
    <div class="dCell"><div class="dc-label">مجموع العلف</div><div class="dc-val">${ft.feedTotal.toLocaleString()} كغم</div></div>
    <div class="dCell"><div class="dc-label">لقاحات/أدوية اليوم</div><div class="dc-val">${ft.medsToday}</div></div>
    <div class="dCell"><div class="dc-label">مجموع اللقاحات/الأدوية</div><div class="dc-val">${ft.medsTotal}</div></div>`;
  el.innerHTML=`<div class="card"><div class="cardTitle"><span class="material-symbols-outlined ct-icon">meeting_room</span> تفاصيل قاعات ${esc(b.field)}</div>
    <div class="detailPanel" id="_hallSummaryPanel" style="margin-bottom:12px">
      <div class="dp-head">
        <span class="dp-title" id="_hallSummaryTitle">🏡 مجموع الحقل: ${esc(b.field)}</span>
        <button id="_hallSummaryBack" class="btn btn-secondary btn-sm" style="display:none" onclick="resetHallSummaryToField()">↩ مجموع الحقل</button>
      </div>
      <div class="detailGrid" id="_hallSummaryGrid">${fieldGridHtml}</div>
    </div>
    <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thCount')}</th><th>${t('thAlive')}</th><th>${t('thMort')}</th><th>% الهلاك</th><th>${t('thSold')}</th><th>${t('thFeedTodayTotal')}</th><th>${t('thVaccToday')}</th><th>آخر وزن/قاعة</th><th>% كايد</th><th>% رياضي</th><th>${t('thAction')}</th></tr></thead><tbody>${rows||'<tr><td colspan="12">'+t('noHalls')+'</td></tr>'}</tbody></table></div></div>`;
}
function showHallDetailsInBatch(hallId){
  let titleEl=$('_hallSummaryTitle'),gridEl=$('_hallSummaryGrid'),backEl=$('_hallSummaryBack'),panel=$('_hallSummaryPanel');
  if(!titleEl||!gridEl)return;
  let h=data.halls.find(x=>x.id===+hallId);if(!h)return;
  let f=data.fields.find(x=>x.id===h.fieldId);
  let cb=window._batchHallsPanelBatch;
  let batches=cb?[cb].filter(x=>batchAllocatedToHall(x,h.id)>0):[];
  let allocated=batches.reduce((s,x)=>s+batchAllocatedToHall(x,h.id),0);
  let alive=batches.reduce((s,x)=>s+batchHallAlive(x,h.id),0);
  let mort=batches.reduce((s,x)=>s+batchHallMort(x,h.id),0);
  let sold=batches.reduce((s,x)=>s+batchHallSold(x,h.id),0);
  let mortRate=allocated>0?+(mort/allocated*100).toFixed(1):null;
  let hallWts=(data.weights||[]).filter(w=>+w.hallId===h.id&&(cb?+w.batchId===cb.id:true)&&weightActualGrams(w)>0).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let lwhall=hallWts[0]||null;
  let avgActual=lwhall?weightActualGrams(lwhall):0;
  let avgGuide=lwhall?weightGuideGrams(lwhall):0;
  let lm=lastMedHall(h.id);
  let cells=[
    ['الحقل',f?esc(f.name):'—'],['القاعة',`<b>${esc(h.name)}</b>`],
    ['عدد القاعة',allocated.toLocaleString()],['الحي داخل القاعة',alive.toLocaleString()],
    ['هلاك القاعة',mort.toLocaleString()],['% الهلاك',mortRate!=null?`<b style="color:${mortRate<=3?'#16a34a':mortRate<=6?'#f59e0b':'#dc2626'}">${mortRate}%</b>`:'—'],
    ['المسوق',sold.toLocaleString()],
    ['علف اليوم',feedTotalHall(h.id,today()).toLocaleString()+' كغم'],['مجموع العلف',feedTotalHall(h.id).toLocaleString()+' كغم'],
    ['لقاحات/أدوية اليوم',medsCountHall(h.id,today())],['آخر مادة',lm?esc(lm.name):'—'],
    ['آخر وزن/قاعة',avgActual?avgActual+' غم':'—'],['الكايد (المتوقع)',avgGuide?avgGuide+' غم':'—'],
    ['فرق الوزن',(avgActual&&avgGuide)?`<b style="color:${avgActual>=avgGuide?'#16a34a':'#dc2626'}">${avgActual-avgGuide} غم</b>`:'—']
  ];
  titleEl.textContent='🚪 تفاصيل القاعة: '+h.name;
  gridEl.innerHTML=cells.map(x=>`<div class="dCell"><div class="dc-label">${x[0]}</div><div class="dc-val">${x[1]}</div></div>`).join('');
  if(backEl)backEl.style.display='';
  if(panel)panel.style.borderColor='var(--p,#0d9488)';
  // highlight selected row
  let tbl=$('batchHallsPanel');
  if(tbl)tbl.querySelectorAll('tr[data-hallid]').forEach(r=>{r.classList.remove('selectedRow');if(r.dataset.hallid==hallId)r.classList.add('selectedRow');});
}
function resetHallSummaryToField(){
  let b=window._batchHallsPanelBatch;if(!b)return;
  let titleEl=$('_hallSummaryTitle'),gridEl=$('_hallSummaryGrid'),backEl=$('_hallSummaryBack'),panel=$('_hallSummaryPanel');
  if(!titleEl||!gridEl)return;
  let ft=fieldTotals(b.field);
  titleEl.textContent='🏡 مجموع الحقل: '+b.field;
  gridEl.innerHTML=`
    <div class="dCell"><div class="dc-label">عدد القاعات</div><div class="dc-val">${ft.halls.length}</div></div>
    <div class="dCell"><div class="dc-label">مجموع الطيور</div><div class="dc-val">${ft.allocated.toLocaleString()}</div></div>
    <div class="dCell"><div class="dc-label">الحي الكلي</div><div class="dc-val">${ft.alive.toLocaleString()}</div></div>
    <div class="dCell"><div class="dc-label">هلاك كل القاعات</div><div class="dc-val">${ft.mort.toLocaleString()}</div></div>
    <div class="dCell"><div class="dc-label">علف اليوم</div><div class="dc-val">${ft.feedToday.toLocaleString()} كغم</div></div>
    <div class="dCell"><div class="dc-label">مجموع العلف</div><div class="dc-val">${ft.feedTotal.toLocaleString()} كغم</div></div>
    <div class="dCell"><div class="dc-label">لقاحات/أدوية اليوم</div><div class="dc-val">${ft.medsToday}</div></div>
    <div class="dCell"><div class="dc-label">مجموع اللقاحات/الأدوية</div><div class="dc-val">${ft.medsTotal}</div></div>`;
  if(backEl)backEl.style.display='none';
  if(panel)panel.style.borderColor='';
  let tbl=$('batchHallsPanel');if(tbl)tbl.querySelectorAll('tr[data-hallid].selectedRow').forEach(r=>r.classList.remove('selectedRow'));
}

function fieldMorts(fieldName){
  return (data.morts||[]).filter(m=>{
    let b=data.batches.find(x=>x.id===m.batchId);
    return b&&b.field===fieldName;
  });
}
function fieldMarkets(fieldName){
  return (data.markets||[]).filter(m=>{
    let b=data.batches.find(x=>x.id===m.batchId);
    return b&&b.field===fieldName;
  });
}
function lastNDays(n=10){
  let arr=[];
  for(let i=n-1;i>=0;i--){
    let d=new Date();
    d.setDate(d.getDate()-i);
    arr.push(d.toISOString().slice(0,10));
  }
  return arr;
}
function fieldWeightAvgOn(fieldName,date,hallId){
  let ws=(data.weights||[]).filter(w=>w.field===fieldName&&w.date===date&&+w.avgWeight>0&&(!hallId||+w.hallId===+hallId));
  return ws.length?+(ws.reduce((s,w)=>s+(+w.avgWeight||0),0)/ws.length).toFixed(2):0;
}
function renderFieldChart(fieldName,hallId){
  let el=$('fieldChartPanel');if(!el)return;
  if(!fieldName){el.innerHTML='';return;}
  let days=lastNDays(10);
  let feeds=days.map(d=>feedTotalField(fieldName,d));
  let morts=days.map(d=>fieldMorts(fieldName).filter(m=>m.date===d).reduce((s,m)=>s+(+m.count||0),0));
  let weights=days.map(d=>fieldWeightAvgOn(fieldName,d,hallId));
  let hasData=[...feeds,...morts,...weights].some(v=>+v>0);
  let maxFeed=Math.max(1,...feeds),maxMort=Math.max(1,...morts),maxWeight=Math.max(1,...weights);
  let W=680,H=220,pad=34,plotW=W-pad*2,plotH=150,base=178;
  let x=i=>pad+(plotW/(days.length-1))*i;
  let points=(arr,max)=>arr.map((v,i)=>`${x(i)},${base-(v/max)*plotH}`).join(' ');
  let bars=feeds.map((v,i)=>{let h=(v/maxFeed)*plotH;return `<rect x="${x(i)-10}" y="${base-h}" width="20" height="${h}" rx="4" fill="#99f6e4"></rect>`}).join('');
  let labels=days.map((d,i)=>`<text x="${x(i)}" y="208" text-anchor="middle" font-size="10" fill="#64748b">${d.slice(5)}</text>`).join('');
  el.innerHTML=`<div class="card">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">bar_chart</span> حالة الحقل: ${fieldName} <span class="chartHint">آخر 10 أيام - العلف والهلاك والأوزان</span></div>
    ${hasData?'':'<div class="warnBox free" style="display:block;margin-bottom:10px">'+t('noData')+' علف أو هلاك أو أوزان خلال آخر 10 أيام، لذلك يظهر الرسم بدون حركة.</div>'}
    <div class="chartWrap"><svg class="fieldChartSvg" viewBox="0 0 ${W} ${H}" role="img">
      <line x1="${pad}" y1="${base}" x2="${W-pad}" y2="${base}" stroke="#cbd5e1"></line>
      <line x1="${pad}" y1="${base-plotH}" x2="${pad}" y2="${base}" stroke="#cbd5e1"></line>
      ${bars}
      <polyline points="${points(morts,maxMort)}" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <polyline points="${points(weights,maxWeight)}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
      ${morts.map((v,i)=>`<circle cx="${x(i)}" cy="${base-(v/maxMort)*plotH}" r="4" fill="#ef4444"><title>هلاك ${v}</title>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/></circle>`).join('')}
      ${weights.map((v,i)=>`<circle cx="${x(i)}" cy="${base-(v/maxWeight)*plotH}" r="4" fill="#2563eb"><title>وزن ${v} كغ</title>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/></circle>`).join('')}
      ${labels}
      <text x="${pad}" y="18" font-size="11" fill="#64748b">علف: ${maxFeed.toLocaleString()} كغم كحد أعلى</text>
      <text x="${W-pad}" y="18" text-anchor="end" font-size="11" fill="#64748b">هلاك: ${maxMort.toLocaleString()} / وزن: ${maxWeight} كغ</text>
    </svg></div>
    <div class="chartLegend">
      <span><i class="legendDot" style="background:#99f6e4"></i>العلف المستهلك</span>
      <span><i class="legendDot" style="background:#ef4444"></i>الهلاك</span>
      <span><i class="legendDot" style="background:#2563eb"></i>معدل الوزن</span>
    </div>
  </div>
  ${renderWeightGuideChartHtml(fieldName,hallId)}`;
}

// مخطط: الوزن الفعلي مقابل الوزن القياسي (الكايد) حسب عمر الطير
function renderWeightGuideChartHtml(fieldName,hallId){
  let recs=(data.weights||[])
    .filter(w=>w.field===fieldName&&w.ageDays!=null&&weightActualGrams(w)>0&&(!hallId||+w.hallId===+hallId))
    .sort((a,b)=>(+a.ageDays)-(+b.ageDays));
  if(!recs.length){
    return `<div class="card" style="margin-top:16px">
      <div class="cardTitle"><span class="material-symbols-outlined ct-icon">scale</span> معدل الوزن الفعلي مقابل الكايد</div>
      <div class="warnBox free" style="display:block">'+t('noRecords')+'أوزان بها عمر للطير في هذا الحقل${hallId?' لهذه القاعة':''} بعد.</div>
    </div>`;
  }
  let actuals=recs.map(weightActualGrams);
  let guides=recs.map(weightGuideGrams);
  let ages=recs.map(w=>+w.ageDays);
  let W=680,H=240,pad=40,plotW=W-pad*2,plotH=160,base=198;
  let maxV=Math.max(1,...actuals,...guides);
  let n=recs.length;
  let x=i=>n>1?pad+(plotW/(n-1))*i:pad+plotW/2;
  let y=v=>base-(v/maxV)*plotH;
  let bw=Math.min(22,plotW/Math.max(n,1)/2.5);
  let guideBars=guides.map((v,i)=>{let h=(v/maxV)*plotH;return `<rect x="${x(i)-bw-2}" y="${base-h}" width="${bw}" height="${h}" rx="3" fill="#fde68a"><title>الكايد: ${v} غم</title>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/></rect>`}).join('');
  let actualBars=actuals.map((v,i)=>{let h=(v/maxV)*plotH;return `<rect x="${x(i)+2}" y="${base-h}" width="${bw}" height="${h}" rx="3" fill="#16a34a"><title>الفعلي: ${v} غم</title>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/></rect>`}).join('');
  let labels=ages.map((a,i)=>`<text x="${x(i)}" y="${base+18}" text-anchor="middle" font-size="10" fill="#64748b">${a}ي</text>`).join('');
  return `<div class="card" style="margin-top:16px">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">scale</span> معدل الوزن الفعلي مقابل الكايد <span class="chartHint">حسب عمر الطير (يوم) - بالغرام</span></div>
    <div class="chartWrap"><svg class="fieldChartSvg" viewBox="0 0 ${W} ${H}" role="img">
      <line x1="${pad}" y1="${base}" x2="${W-pad}" y2="${base}" stroke="#cbd5e1"></line>
      <line x1="${pad}" y1="${base-plotH}" x2="${pad}" y2="${base}" stroke="#cbd5e1"></line>
      ${guideBars}
      ${actualBars}
      ${labels}
      <text x="${pad}" y="18" font-size="11" fill="#64748b">أعلى قيمة: ${maxV.toLocaleString()} غم</text>
    </svg></div>
    <div class="chartLegend">
      <span><i class="legendDot" style="background:#16a34a"></i>الوزن الفعلي (غم)</span>
      <span><i class="legendDot" style="background:#fde68a"></i>الوزن القياسي (الكايد) (غم)</span>
    </div>
  </div>`;
}

function onChartFieldChange(){
  if($('chartHall'))$('chartHall').value='';
  renderChartsPage();
}
function renderChartsPage(fieldName=''){
  if($('chartField')){
    let old=fieldName||$('chartField').value||selectedFieldName||'';
    $('chartField').innerHTML='<option value="">اختر الحقل</option>'+data.fields.filter(f=>canSeeField(f.name)).map(f=>`<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
    if(old&&[...$('chartField').options].some(o=>o.value===old))$('chartField').value=old;
    fieldName=$('chartField').value;
  }
  if($('chartHall')){
    let oldHall=$('chartHall').value||'';
    let halls=(data.halls||[]).filter(h=>{
      let f=data.fields.find(ff=>ff.id===h.fieldId);
      return f&&f.name===fieldName;
    });
    $('chartHall').innerHTML='<option value="">'+t('allHalls')+'</option>'+halls.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
    if(oldHall&&[...$('chartHall').options].some(o=>o.value===oldHall))$('chartHall').value=oldHall;
  }
  let hallId=$('chartHall')?$('chartHall').value:'';
  if(fieldName)renderFieldChart(fieldName,hallId);
  else if($('fieldChartPanel'))$('fieldChartPanel').innerHTML='<div class="warnBox free" style="display:block">اختر حقلاً لعرض المخطط البياني.</div>';
}
function buildWeightSuccessDash(){
  let activeBatches=visibleBatches().filter(b=>calc(b).transferred&&!calc(b).completed);
  if(!activeBatches.length)return '';
  let rows=activeBatches.map(b=>{
    let wsr=batchWeightSuccessRates(b);
    let gc=wsr.guide==null?'var(--ink3)':wsr.guide>=100?'#16a34a':'#dc2626';
    let mc=wsr.math==null?'var(--ink3)':wsr.math>=100?'#7c3aed':'#f59e0b';
    let lw=latestWeightForBatch(b.id);
    let lastAge=lw&&lw.ageDays!=null?lw.ageDays+' يوم':'—';
    let lastActual=lw?weightActualGrams(lw)+' غم':'—';
    let lastGuide=lw?weightGuideGrams(lw)+' غم':'—';
    return `<tr>
      <td><b>${esc(b.name)}</b></td>
      <td>${esc(b.field||'—')}</td>
      <td>${lastAge}</td>
      <td>${lastActual}</td>
      <td>${lastGuide}</td>
      <td style="font-weight:800;color:${gc}">${wsr.guide!=null?wsr.guide+'%':'—'}</td>
      <td style="font-weight:800;color:${mc}">${wsr.math!=null?wsr.math+'%':'—'}</td>
    </tr>`;
  }).join('');
  return `<div class="card" style="margin-top:16px;border-top:3px solid #2563eb">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">monitor_weight</span> نسبة نجاح الأوزان — كل الوجبات النشطة</div>
    <div class="tableWrap"><table>
      <thead><tr><th>الوجبة</th><th>الحقل</th><th>آخر عمر مسجل</th><th>آخر وزن فعلي</th><th>الكايد</th><th style="color:#16a34a">نجاح / كايد</th><th style="color:#7c3aed">نجاح / رياضي</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
function buildFieldsDashboard(){
  let fields=data.fields.filter(f=>canSeeField(f.name));
  if(!fields.length)return selectedDetails(null);
  let rows=fields.map(f=>{
    let ft=fieldTotals(f.name);
    return `<tr class="selectable" onclick="showFieldDetails('${String(f.name).replace(/'/g,"\\'")}')">
      <td><b>${esc(f.name)}</b></td>
      <td>${ft.halls.length}</td>
      <td>${ft.alive.toLocaleString()}</td>
      <td>${ft.mort.toLocaleString()}</td>
      <td>${ft.sold.toLocaleString()}</td>
      <td>${ft.feedToday.toLocaleString()} / ${ft.feedTotal.toLocaleString()} كغم</td>
      <td>${ft.medsToday} / ${ft.medsTotal}</td>
      <td>${ft.avgWeight?ft.avgWeight+' غم':'—'}</td>
      <td>${ft.guideWeight?ft.guideWeight+' غم':'—'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showFieldDetails('${String(f.name).replace(/'/g,"\\'")}')">تفاصيل</button></td>
    </tr>`;
  }).join('');
  return `<div class="card"><div class="cardTitle"><span class="material-symbols-outlined ct-icon">domain</span> نظرة الحقول <span style="font-size:11px;font-weight:500;color:var(--ink3)">اضغط على أي حقل لفتح ملخصه الذكي</span></div>
    <div class="tableWrap"><table><thead><tr><th>${t('thField')}</th><th>${t('thHalls')}</th><th>${t('thAlive')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thFeedTodayTotal')}</th><th>${t('thVaccTodayTotal')}</th><th>${t('thAvgWeight')}</th><th>${t('thGuide')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}
function showFieldDetails(fieldName){
  selectedFieldName=fieldName;
  selectedBatchId=null;
  let ft=fieldTotals(fieldName);
  if(!ft.field)return;
  let hallRows=ft.halls.map(h=>{
    let batches=visibleBatches().filter(x=>x.transferDate&&!calc(x).completed&&batchAllocatedToHall(x,h.id)>0);
    let allocated=batches.reduce((s,x)=>s+batchAllocatedToHall(x,h.id),0);
    let alive=batches.reduce((s,x)=>s+batchHallAlive(x,h.id),0);
    let mort=batches.reduce((s,x)=>s+batchHallMort(x,h.id),0);
    let sold=batches.reduce((s,x)=>s+batchHallSold(x,h.id),0);
    let lm=lastMedHall(h.id);
    return `<tr class="selectable" onclick="showHallDetailsInBatch(${h.id})">
      <td><b>${esc(h.name)}</b></td><td>${(+h.capacity||0)?(+h.capacity).toLocaleString():'—'}</td>
      <td>${allocated.toLocaleString()}</td><td>${alive.toLocaleString()}</td><td>${mort.toLocaleString()}</td><td>${sold.toLocaleString()}</td>
      <td>${feedTotalHall(h.id,today()).toLocaleString()} / ${feedTotalHall(h.id).toLocaleString()} كغم</td>
      <td>${medsCountHall(h.id,today())}</td><td>${lm?esc(lm.name):'—'}</td>
    </tr>`;
  }).join('');
  let detail=$('statsDetail');
  if(detail)detail.innerHTML=`<div class="detailPanel">
    <div class="dp-head"><span class="dp-title">🏡 تفاصيل الحقل: ${esc(fieldName)}</span><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="show('charts',null);renderChartsPage('${String(fieldName).replace(/'/g,"\\'")}')">فتح المخطط البياني</button><button class="btn btn-secondary btn-sm" onclick="selectedFieldName=null;renderStats()">رجوع للحقول</button></div></div>
    <div class="detailGrid">
      <div class="dCell"><div class="dc-label">عدد القاعات</div><div class="dc-val">${ft.halls.length}</div></div>
      <div class="dCell"><div class="dc-label">الحي الحالي</div><div class="dc-val">${ft.alive.toLocaleString()}</div></div>
      <div class="dCell" style="cursor:pointer;border-color:var(--p)" onclick="openSmartSection('mort','${String(fieldName).replace(/'/g,"\\'")}')"><div class="dc-label">الهلاك</div><div class="dc-val">${ft.mort.toLocaleString()}</div></div>
      <div class="dCell" style="cursor:pointer;border-color:var(--p)" onclick="openSmartSection('market','${String(fieldName).replace(/'/g,"\\'")}')"><div class="dc-label">التسويق</div><div class="dc-val">${ft.sold.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">علف اليوم</div><div class="dc-val">${ft.feedToday.toLocaleString()} كغم</div></div>
      <div class="dCell" style="cursor:pointer;border-color:var(--p)" onclick="openSmartSection('feed','${String(fieldName).replace(/'/g,"\\'")}')"><div class="dc-label">مجموع العلف</div><div class="dc-val">${ft.feedTotal.toLocaleString()} كغم</div></div>
      <div class="dCell"><div class="dc-label">لقاحات/أدوية اليوم</div><div class="dc-val">${ft.medsToday}</div></div>
      <div class="dCell" style="cursor:pointer;border-color:var(--p)" onclick="openSmartSection('meds','${String(fieldName).replace(/'/g,"\\'")}')"><div class="dc-label">مجموع اللقاحات/الأدوية</div><div class="dc-val">${ft.medsTotal}</div></div>
      <div class="dCell" style="cursor:pointer;border-color:var(--p)" onclick="openSmartSection('weights','${String(fieldName).replace(/'/g,"\\'")}')"><div class="dc-label">معدل الوزن</div><div class="dc-val">${ft.avgWeight?ft.avgWeight+' كغ':'—'}</div></div>
    </div>
  </div>
  <div class="card"><div class="cardTitle"><span class="material-symbols-outlined ct-icon">meeting_room</span> القاعات داخل ${fieldName}</div><div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thCapacity')}</th><th>${t('thCount')}</th><th>${t('thAlive')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thFeedTodayTotal')}</th><th>${t('thVaccToday')}</th><th>${t('thLastMaterial')}</th></tr></thead><tbody>${hallRows||'<tr><td colspan="9">لا توجد قاعات</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="cardTitle">انتقال سريع لتفاصيل الحقل <span style="font-size:11px;font-weight:500;color:var(--ink3)">يفتح الصفحة المعنية لهذا الحقل فقط</span></div><div class="statsGrid">${smartShortcutCards(fieldName)}</div></div>`;
}

/* ── تفاعليات ── */
(function(){
  // Ripple على كل الأزرار
  document.addEventListener('click', function(e){
    const btn = e.target.closest('.btn, .nav, .statCard.smartCard');
    if(!btn) return;
    const r = document.createElement('span');
    r.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
    btn.appendChild(r);
    r.addEventListener('animationend', ()=>r.remove());
  });

  // تحريك أيقونة ct-icon عند النقر على الكارد
  document.addEventListener('click', function(e){
    const icon = e.target.closest('.cardTitle')?.querySelector('.ct-icon');
    if(!icon) return;
    icon.style.animation = 'none';
    requestAnimationFrame(()=>{
      icon.style.animation = 'iconPop .35s cubic-bezier(.34,1.56,.64,1)';
    });
  });

  // حركة دخول للكاردز عند التحديث
  function animateCards(){
    document.querySelectorAll('.card, .statCard').forEach((el,i)=>{
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(()=>{
        el.style.transition = 'opacity .3s ease, transform .3s ease';
        el.style.opacity = '';
        el.style.transform = '';
        setTimeout(()=>{ el.style.transition = ''; }, 350);
      }, i * 40);
    });
  }

  // نفّذ عند كل تغيير صفحة
  const origShow = window.show;
  if(origShow) window.show = function(){
    origShow.apply(this, arguments);
    requestAnimationFrame(animateCards);
  };
})();
