// ── HALLS ──
function addHallForField(fieldId){
  show('fields',null);
  setTimeout(()=>{
    openHallsPanel(fieldId);
    if($('hName')){$('hName').focus();$('hName').scrollIntoView({behavior:'smooth',block:'center'});}
  },0);
}
function openHallsPanel(fieldId){
  let f=data.fields.find(x=>x.id===fieldId);if(!f)return;
  if($('hallsCard'))$('hallsCard').style.display='';
  if($('hallsFieldName'))$('hallsFieldName').textContent=f.name+' ('+f.type+')';
  if($('hFieldId'))$('hFieldId').value=fieldId;
  clearHallForm();
  renderHalls(fieldId);
}
function clearHallForm(){
  ['hName','hCapacity','hEditId'].forEach(id=>{if($(id))$(id).value=''});
}
function saveHall(){
  if(!isAdmin())return;
  let fieldId=+val('hFieldId');if(!fieldId)return msg('⚠ اختر الحقل أولاً');
  let nm=(val('hName')||'').trim();if(!nm)return msg('⚠ أدخل اسم القاعة');
  let eid=val('hEditId');
  let hallData={
    fieldId,name:nm,
    capacity:num('hCapacity')||0,
    
  };
  if(eid){
    let h=data.halls.find(x=>x.id===+eid);
    if(h)Object.assign(h,hallData);
  }else{
    if(data.halls.find(h=>h.fieldId===fieldId&&h.name===nm))return msg('⚠ يوجد قاعة بهذا الاسم في هذا الحقل');
    data.halls.push({id:Date.now(),...hallData});
  }
  clearHallForm();save();renderHalls(fieldId);renderFields();msg('تم حفظ القاعة');
}
function editHall(id){
  if(!isAdmin())return;
  let h=data.halls.find(x=>x.id===id);if(!h)return;
  $('hName').value=h.name;$('hCapacity').value=h.capacity||'';
  if($('hChickWeight'))$('hChickWeight').value=h.chickWeight||'';
  if($('hAvgWeight'))$('hAvgWeight').value=h.avgWeight||'';
  if($('hTotalWeight'))$('hTotalWeight').value=h.totalWeight||'';
  $('hEditId').value=h.id;
}
function deleteHall(id){
  if(!isAdmin())return;
  let h=data.halls.find(x=>x.id===id);
  if(!h)return;
  if(confirm('حذف القاعة؟')){
    data.halls=data.halls.filter(x=>x.id!==id);
    save();renderHalls(h.fieldId);renderFields();
  }
}
function renderHalls(fieldId){
  let el=$('hallsTable');if(!el)return;
  let halls=data.halls.filter(h=>h.fieldId===fieldId);
  if(!halls.length){el.innerHTML='<tbody><tr><td colspan="7" style="text-align:center;color:var(--ink3);padding:16px">لا توجد قاعات — أضف أول قاعة.</td></tr></tbody>';return}
  let rows=halls.map(h=>{
    // حساب الوجبات النشطة في هذه القاعة
    let activeBatches=data.batches.filter(b=>batchAllocatedToHall(b,h.id)>0&&!calc(b).completed&&b.transferDate);
    let usedBirds=activeBatches.reduce((s,b)=>s+batchHallAlive(b,h.id),0);
    let capTxt=h.capacity?`${usedBirds.toLocaleString()} / ${h.capacity.toLocaleString()}`:(usedBirds>0?usedBirds.toLocaleString():'—');
    let hallLws=activeBatches.map(b=>latestWeightForBatch(b.id)).filter(Boolean).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    let hallLw=hallLws[0];
    return `<tr>
      <td><b>${esc(h.name)}</b></td>
      <td>${capTxt}</td>
      <td>${h.chickWeight?h.chickWeight+' غ':'—'}</td>
      <td>${hallLw?weightActualGrams(hallLw)+' غم':'—'}</td>
      <td>${hallLw?weightGuideGrams(hallLw)+' غم':'—'}</td>
      <td>${activeBatches.length?activeBatches.map(b=>`<span class="badge b-green" style="margin-left:3px">${esc(b.name)}</span>`).join(''):'<span class="badge b-gray">فارغة</span>'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editHall(${h.id})">تعديل</button>
        <button class="btn btn-danger btn-sm" onclick="deleteHall(${h.id})">حذف</button>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thHall')}</th><th>${t('thLiveCap')}</th><th>${t('thChickWeight')}</th><th>${t('thActualWeight')}</th><th>${t('thGuideWeight')}</th><th>${t('thActiveBatches')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows}</tbody>`;
}
