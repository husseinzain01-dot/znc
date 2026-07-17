// ── CALENDAR ──
function batchHallIds(b){
  if(!b)return [];
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length)return b.hallAllocations.map(a=>+a.hallId).filter(Boolean);
  return b.hallId?[+b.hallId]:[];
}
function closeCalendarDayDetails(){
  if($('calDayOverlay'))$('calDayOverlay').classList.add('hidden');
}
function showCalendarDayDetails(batchId,date){
  let b=data.batches.find(x=>x.id===+batchId);if(!b)return;
  let c=calc(b,date);
  let hallIds=batchHallIds(b);
  let inBatchHall=x=>hallIds.length?(hallIds.includes(+x.hallId)):x.field===b.field;
  let feeds=(data.feeds||[]).filter(x=>x.date===date&&x.field===b.field&&inBatchHall(x));
  let meds=(data.meds||[]).filter(x=>x.date===date&&x.field===b.field&&inBatchHall(x));
  let morts=(data.morts||[]).filter(x=>x.date===date&&+x.batchId===b.id);
  let feedTotal=feeds.reduce((s,x)=>s+(+x.qty||0),0);
  let mortTotal=morts.reduce((s,x)=>s+(+x.count||0),0);
  let medCount=meds.length;
  let feedRows=feeds.map(x=>`<tr><td>${esc(x.hall||'—')}</td><td>${esc(x.feedType||'—')}</td><td>${(+x.qty||0).toLocaleString()} كغم</td><td>${esc(x.note||'—')}</td></tr>`).join('');
  let medRows=meds.map(x=>`<tr><td>${esc(x.hall||'—')}</td><td>${esc(x.type||'—')}</td><td>${esc(x.name||'—')}</td><td>${esc(x.dose||'—')}</td><td>${(+x.qty||0).toLocaleString()}</td></tr>`).join('');
  let mortRows=morts.map(x=>`<tr><td>${esc(x.hall||'—')}</td><td>${(+x.count||0).toLocaleString()}</td><td>${esc(x.reason||'—')}</td></tr>`).join('');
  let dayWeight=(data.weights||[]).find(x=>x.date===date&&+x.batchId===b.id);
  let actualG=dayWeight?weightActualGrams(dayWeight):0;
  let guideG=dayWeight?weightGuideGrams(dayWeight):getGuideWeightByAge(c.flockAge||0);
  if($('calDayTitle'))$('calDayTitle').textContent=`${b.name} — ${fmt(date)}`;
  if($('calDayBody'))$('calDayBody').innerHTML=`
    <div class="calMiniGrid">
      <div class="calMini"><div class="lbl">العمر</div><div class="val">${c.transferred?(c.isLayer?fmtLayerAge(c.flockAge):c.flockAge+' يوم'):(c.hatchAge+'/21 تفقيس')}</div></div>
      <div class="calMini"><div class="lbl">استهلاك العلف</div><div class="val">${feedTotal.toLocaleString()} كغم</div></div>
      <div class="calMini"><div class="lbl">الهلاك</div><div class="val">${mortTotal.toLocaleString()}</div></div>
      <div class="calMini"><div class="lbl">الأدوية واللقاحات</div><div class="val">${medCount.toLocaleString()}</div></div>
      <div class="calMini"><div class="lbl">الوزن الفعلي</div><div class="val">${actualG?actualG+' غم':'—'}</div></div>
      <div class="calMini"><div class="lbl">الكايد (المتوقع)</div><div class="val">${guideG?guideG+' غم':'—'}</div></div>
    </div>
    <div class="card" style="box-shadow:none;margin-bottom:10px"><div class="cardTitle"><span class="material-symbols-outlined ct-icon">grass</span> العلف في هذا اليوم</div><div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thFeedType')}</th><th>${t('thQty')}</th><th>${t('thNote')}</th></tr></thead><tbody>${feedRows||'<tr><td colspan="4">لا يوجد علف مسجل لهذا اليوم</td></tr>'}</tbody></table></div></div>
    <div class="card" style="box-shadow:none;margin-bottom:10px"><div class="cardTitle"><span class="material-symbols-outlined ct-icon">heart_minus</span> الهلاك في هذا اليوم</div><div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thCount')}</th><th>${t('thReason')}</th></tr></thead><tbody>${mortRows||'<tr><td colspan="3">'+t('noMort')+'مسجل لهذا اليوم</td></tr>'}</tbody></table></div></div>
    <div class="card" style="box-shadow:none;margin-bottom:0"><div class="cardTitle"><span class="material-symbols-outlined ct-icon">vaccines</span> الأدوية واللقاحات في هذا اليوم</div><div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thType')}</th><th>${t('thMaterial')}</th><th>${t('thDose')}</th><th>${t('thQty')}</th></tr></thead><tbody>${medRows||'<tr><td colspan="5">'+t('noMeds')+'لهذا اليوم</td></tr>'}</tbody></table></div></div>`;
  if($('calDayOverlay'))$('calDayOverlay').classList.remove('hidden');
}
function renderCalendar(){
  if(!$('calendar'))return;
  let y=calDate.getFullYear(),m=calDate.getMonth();
  $('monthTitle').textContent=calDate.toLocaleDateString('ar-IQ',{year:'numeric',month:'long'});
  let html=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map(x=>`<div class="calDayName">${x}</div>`).join('');
  let first=new Date(y,m,1),last=new Date(y,m+1,0);
  for(let i=0;i<first.getDay();i++)html+='<div></div>';
  let filter=$('calFilter').value||'all';
  let batches=visibleBatches();
  for(let d=1;d<=last.getDate();d++){
    let iso=new Date(y,m,d).toISOString().slice(0,10);
    let dayBatches=batches.filter(b=>filter==='all'||String(b.id)===String(filter));
    let ev=dayBatches.map(b=>{
      let c=calc(b,iso);let txt='';let cls='';
      if(!c.transferred&&c.rawHatchAge>=0&&c.rawHatchAge<21){txt='تفقيس '+c.hatchAge+'/21';cls='ev-teal'}
      if(!c.transferred&&c.rawHatchAge===21){txt='جاهزة للنقل';cls='ev-amber'}
      if(!c.transferred&&c.rawHatchAge>21){txt='متأخرة عن النقل';cls='ev-red'}
      if(c.entryDate&&iso===c.entryDate){txt='دخول الحقل';cls='ev-teal'}
      else if(c.transferred&&c.entryDate&&iso>=c.entryDate&&c.rawFlockAge<=(c.isLayer?LAYER_MAX_AGE_DAYS:40)){
        if(c.isLayer){txt='عمر '+fmtLayerAge(c.flockAge);cls='ev-green'}
        else{txt='عمر '+c.flockAge+' يوم';cls='ev-green'}
      }
      return txt?`<div class="ev ${cls}">${esc(b.name)}: ${txt}</div>`:'';
    }).join('');
    let clickable=filter!=='all';
    html+=`<div class="calDay ${clickable?'clickable':''}" ${clickable?`onclick="showCalendarDayDetails(${+filter},'${iso}')"`:''}><div class="calDayNum">${d}</div>${ev}</div>`;
  }
  $('calendar').innerHTML=html;
}
function moveMonth(n){calDate.setMonth(calDate.getMonth()+n);renderCalendar()}

function saveField(){
  if(!isAdmin())return;
  let nm=(val('fName')||'').trim();if(!nm)return msg('⚠ أدخل اسم الحقل');
  let eid=val('fEditId');
  if(eid){let f=data.fields.find(x=>x.id===+eid);if(f){f.name=nm;f.type=$('fType').value;f.capacity=num('fCapacity')||0}}
  else{if(data.fields.find(f=>f.name===nm))return msg('⚠ يوجد حقل بهذا الاسم مسبقاً');data.fields.push({id:Date.now(),name:nm,type:$('fType').value,capacity:num('fCapacity')||0})}
  save();renderAll();
  let saved=data.fields.find(f=>f.name===nm);
  if(saved)openHallsPanel(saved.id);
  msg('تم حفظ الحقل — يمكنك إضافة أكثر من قاعة لهذا الحقل من اللوحة المفتوحة');
  ['fName','fCapacity','fEditId'].forEach(id=>{if($(id))$(id).value=''});
}
function clearFieldForm(){
  if($('fName'))$('fName').value='';
  if($('fType'))$('fType').value='لحم';
  if($('fCapacity'))$('fCapacity').value='';
  if($('fEditId'))$('fEditId').value='';
  // إخفاء لوحة القاعات
  if($('hallsCard'))$('hallsCard').style.display='none';
}
function editField(id){
  if(!isAdmin())return;
  let f=data.fields.find(x=>x.id===id);if(!f)return;
  $('fName').value=f.name;$('fType').value=f.type;$('fCapacity').value=f.capacity||'';$('fEditId').value=f.id;
  show('fields',null);
  // فتح لوحة القاعات لهذا الحقل
  openHallsPanel(id);
}
function deleteField(id){
  if(!isAdmin())return;
  if(confirm('حذف الحقل وكل قاعاته؟')){
    data.fields=data.fields.filter(f=>f.id!==id);
    data.halls=data.halls.filter(h=>h.fieldId!==id);
    save();renderAll();
  }
}
function fieldStatus(fn){let active=data.batches.filter(b=>!calc(b).completed&&b.field===fn&&b.transferDate);return{busy:active.length>0,batches:active}}
function checkFieldOccupancy(){
  if(!$('transferField'))return;
  let fn=$('transferField').value;let warn=$('fieldWarn');
  if(!fn){warn.className='warnBox';return}
  let st=fieldStatus(fn);let f=data.fields.find(x=>x.name===fn);
  // حساب السعة من القاعات إذا لم تكن محددة على الحقل
  let cap=f&&f.capacity?f.capacity:data.halls.filter(h=>h.fieldId===(f?f.id:null)).reduce((s,h)=>s+(+h.capacity||0),0);
  let info='';
  if(cap){let used=data.batches.filter(b=>!calc(b).completed&&b.field===fn&&b.transferDate).reduce((s,b)=>s+calc(b).alive,0);if(used>0)info=` — الحي الحالي: ${used.toLocaleString()} من ${cap.toLocaleString()}`}
  if(st.busy){warn.className='warnBox busy';warn.innerHTML=t('fieldBusy')+': '+st.batches.map(b=>`<b>${esc(b.name)}</b>`).join('، ')+info+' — '+t('canContinue')}
  else{warn.className='warnBox free';warn.innerHTML=t('fieldFree')+info}
}
function renderFields(){
  let el=$('fieldsTable');if(!el)return;
  if(!data.fields.length){el.innerHTML='<tbody><tr><td colspan="6" style="text-align:center;color:var(--ink3);padding:24px">'+t('noFields')+' مسجلة.</td></tr></tbody>';return}
  let rows=data.fields.map(f=>{
    let st=fieldStatus(f.name);
    let halls=data.halls.filter(h=>h.fieldId===f.id);
    let used=data.batches.filter(b=>!calc(b).completed&&b.field===f.name&&b.transferDate).reduce((s,b)=>s+calc(b).alive,0);
    let cap=f.capacity||halls.reduce((s,h)=>s+(+h.capacity||0),0);
    let capTxt=cap?`${used.toLocaleString()} / ${cap.toLocaleString()}`:'—';
    let hallsTxt=halls.length?`<span class="badge b-blue">${halls.length} قاعة</span>`:'<span class="badge b-gray">بلا قاعات</span>';
    let typeBdg=f.type==='بياض'?'<span class="badge b-violet">🥚 بياض</span>':f.type==='تربية'?'<span class="badge b-amber">تربية</span>':'<span class="badge b-teal">لحم</span>';
    let statusBdg=st.busy?`<span class="badge b-amber">مشغول</span>`:`<span class="badge b-green">متاح</span>`;
    return `<tr>
      <td><b>${esc(f.name)}</b></td>
      <td>${typeBdg}</td>
      <td>${capTxt}</td>
      <td>${hallsTxt}</td>
      <td>${statusBdg}${st.busy?' <span style="font-size:11px;color:var(--ink3)">('+st.batches.map(b=>b.name).join('، ')+')</span>':''}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editField(${f.id})">تعديل</button>
        <button class="btn btn-primary btn-sm" onclick="addHallForField(${f.id})">➕ إضافة قاعة</button>
        <button class="btn btn-danger btn-sm" onclick="deleteField(${f.id})">حذف</button>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thName')}</th><th>${t('thType')}</th><th>${t('thLiveCap')}</th><th>${t('thHalls')}</th><th>${t('thStatus')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows}</tbody>`;
}
