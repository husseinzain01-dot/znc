// ── مساعد: بناء شريط معلومات الوجبة ──
function _bulkInfoBar(b, date, extra=''){
  let c=calc(b,date);
  let strain=b.type==='بياض'?(b.birdStrain||'بياض تجاري'):(b.birdStrain||'Ross 308');
  return`<div style="display:flex;gap:16px;flex-wrap:wrap;background:var(--card2,#f3f4f6);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px">
    <span>📅 عمر الطير: <strong>يوم ${c.flockAge}</strong></span>
    <span>🐔 السلالة: <strong>${strain}</strong></span>${extra}
  </div>`;
}

// ══ هلاك جماعي ══

function onMortBulkFieldChange(){
  let fn=val('mortBulkField')||'';
  let batches=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&(!fn||b.field===fn));
  if($('mortBulkBatch'))$('mortBulkBatch').innerHTML='<option value="">-- اختر الوجبة --</option>'+batches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
  buildMortHallsGrid();
}
function updateBulkAge(batchSelId, dateInputId, ageInputId){
  let bEl=$(batchSelId), dEl=$(dateInputId), aEl=$(ageInputId);
  if(!bEl||!dEl||!aEl)return;
  let bId=bEl.value?+bEl.value:0;
  let date=dEl.value;
  let b=(data.batches||[]).find(x=>x.id===bId);
  if(b&&date){
    let entryDate=b.fieldEntryDate||b.transferDate||'';
    let age=calcBirdAge(entryDate,date);
    aEl.value=age>=0?age:'';
  } else {
    aEl.value='';
  }
}
function buildMortHallsGrid(){
  let el=$('mortHallsGrid');if(!el)return;
  let bId=$('mortBulkBatch')&&$('mortBulkBatch').value?+$('mortBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b){el.innerHTML='';return;}
  let date=val('mortBulkDate')||today();
  let halls=_bulkHalls(bId, val('mortBulkField'));
  if(!halls.length){el.innerHTML=`<div style="color:var(--ink3);font-size:13px;padding:10px 0">لا توجد قاعات مرتبطة بهذه الوجبة.</div>`;return;}
  let infoBar=_bulkInfoBar(b,date,`<span>🏠 عدد القاعات: <strong>${halls.length}</strong></span>`);
  let rows=halls.map(h=>{
    let alive=batchHallAlive(b,h.id);
    let todayMort=(data.morts||[]).filter(m=>m.batchId===b.id&&+m.hallId===h.id&&m.date===date).reduce((s,m)=>s+(+m.count||0),0);
    return`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:7px;background:var(--bg)">
      <div style="min-width:100px;font-weight:700;font-size:14px">${esc(h.name)}</div>
      <div style="font-size:12px;color:var(--ink3);min-width:80px">🐔 حي: <strong>${alive.toLocaleString()}</strong></div>
      ${todayMort?`<div style="font-size:12px;color:#dc2626;min-width:100px">اليوم: <strong>${todayMort} طير</strong></div>`:'<div style="min-width:100px"></div>'}
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:200px">
        <label style="font-size:13px;white-space:nowrap;color:var(--ink2)">عدد الهلاك:</label>
        <input type="number" min="0" step="1" id="mortHall_${h.id}"
          style="width:100px;padding:7px 10px;border:2px solid #fca5a5;border-radius:8px;font-size:15px;font-weight:700;text-align:center;font-family:inherit;background:var(--bg)"
          placeholder="0">
        <label style="font-size:12px;color:var(--ink3);white-space:nowrap">السبب:</label>
        <input type="text" id="mortHallReason_${h.id}"
          style="flex:1;min-width:100px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:var(--bg)"
          placeholder="اختياري">
      </div>
    </div>`;
  }).join('');
  el.innerHTML=infoBar+rows;
}
function saveAllMorts(){
  let bId=$('mortBulkBatch')&&$('mortBulkBatch').value?+$('mortBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b)return msg('⚠ اختر الوجبة أولاً');
  let date=val('mortBulkDate')||today();
  let commonReason=val('mortBulkReason')||'';
  let halls=_bulkHalls(bId, val('mortBulkField'));
  let saved=0,ts=Date.now();
  halls.forEach(h=>{
    let inp=$(`mortHall_${h.id}`);
    let cnt=inp?+inp.value:0;
    if(!cnt)return;
    let reason=val(`mortHallReason_${h.id}`)||commonReason;
    let hallObj=data.halls.find(x=>x.id===h.id);
    let mortBulkAge=calcBirdAge(b.fieldEntryDate||b.transferDate||'',date);
    data.morts.push({id:ts+saved,batchId:b.id,hallId:h.id,hall:hallObj?hallObj.name:h.name,date,count:cnt,reason,ageDays:mortBulkAge!=null?mortBulkAge:undefined});
    saved++;
  });
  if(!saved)return msg('⚠ أدخل عدد هلاك قاعة واحدة على الأقل');
  updateBatchArchiveStatus(b);
  save();renderAll();clearMortBulkForm();msg(`تم حفظ هلاك ${saved} قاعة ✅`);
}
function clearMortBulkForm(){
  if($('mortBulkField'))$('mortBulkField').selectedIndex=0;
  if($('mortBulkDate'))$('mortBulkDate').value=today();
  if($('mortBulkReason'))$('mortBulkReason').value='';
  if($('mortHallsGrid'))$('mortHallsGrid').innerHTML='';
  onMortBulkFieldChange();
}

// ══ علف جماعي ══

function onFeedBulkFieldChange(){
  let fn=val('feedBulkField')||'';
  let batches=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&(!fn||b.field===fn));
  if($('feedBulkBatch'))$('feedBulkBatch').innerHTML='<option value="">-- اختر الوجبة --</option>'+batches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
  buildFeedHallsGrid();
}
function buildFeedHallsGrid(){
  let el=$('feedHallsGrid');if(!el)return;
  let bId=$('feedBulkBatch')&&$('feedBulkBatch').value?+$('feedBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b){el.innerHTML='';return;}
  let date=val('feedBulkDate')||today();
  let halls=_bulkHalls(bId, val('feedBulkField'));
  if(!halls.length){el.innerHTML=`<div style="color:var(--ink3);font-size:13px;padding:10px 0">لا توجد قاعات مرتبطة بهذه الوجبة.</div>`;return;}
  let infoBar=_bulkInfoBar(b,date,`<span>🏠 عدد القاعات: <strong>${halls.length}</strong></span>`);
  let rows=halls.map(h=>{
    let alive=batchHallAliveBeforeDate(b,h.id,date);
    let todayFeed=(data.feeds||[]).filter(f=>+f.hallId===h.id&&f.date===date).reduce((s,f)=>s+(+f.qty||0),0);
    return`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:7px;background:var(--bg)">
      <div style="min-width:100px;font-weight:700;font-size:14px">${esc(h.name)}</div>
      <div style="font-size:12px;color:var(--ink3);min-width:80px">🐔 حي: <strong>${alive.toLocaleString()}</strong></div>
      ${todayFeed?`<div style="font-size:12px;color:#16a34a;min-width:110px">اليوم: <strong>${todayFeed} كغم</strong></div>`:'<div style="min-width:110px"></div>'}
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px">
        <label style="font-size:13px;white-space:nowrap;color:var(--ink2)">الكمية (كغم):</label>
        <input type="number" min="0" step="0.01" id="feedHall_${h.id}" data-alive="${alive}"
          style="width:110px;padding:7px 10px;border:2px solid #86efac;border-radius:8px;font-size:15px;font-weight:700;text-align:center;font-family:inherit;background:var(--bg)"
          placeholder="0"
          oninput="let v=+this.value,a=+this.dataset.alive,g=v&&a?(v*1000/a).toFixed(2):0;document.getElementById('feedGram_${h.id}').textContent=g>0?g+' غم/طير':''">
        <span id="feedGram_${h.id}" style="font-size:13px;font-weight:700;color:#7c3aed;min-width:80px"></span>
      </div>
    </div>`;
  }).join('');
  el.innerHTML=infoBar+rows;
}
function saveAllFeeds(){
  let bId=$('feedBulkBatch')&&$('feedBulkBatch').value?+$('feedBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b)return msg('⚠ اختر الوجبة أولاً');
  let date=val('feedBulkDate')||today();
  let feedType=val('feedBulkType')||'';
  let note=val('feedBulkNote')||'';
  let fn=val('feedBulkField')||'';
  let halls=_bulkHalls(bId, fn);
  data.feeds=data.feeds||[];
  let saved=0,ts=Date.now();
  halls.forEach(h=>{
    let inp=$(`feedHall_${h.id}`);
    let qty=inp?+inp.value:0;
    if(!qty)return;
    let hallObj=data.halls.find(x=>x.id===h.id);
    let feedBulkAge=calcBirdAge(b.fieldEntryDate||b.transferDate||'',date);
    let alive=batchHallAliveBeforeDate(b,h.id,date);
    let gramsPerBird=qty&&alive?parseFloat((qty*1000/alive).toFixed(2)):0;
    data.feeds.push({id:ts+saved,batchId:b.id,date,field:fn||b.field||'',hallId:h.id,hall:hallObj?hallObj.name:h.name,feedType,qty,note,ageDays:feedBulkAge!=null?feedBulkAge:undefined,gramsPerBird:gramsPerBird||undefined});
    saved++;
  });
  if(!saved)return msg('⚠ أدخل كمية قاعة واحدة على الأقل');
  save();renderAll();clearFeedBulkForm();msg(`تم حفظ علف ${saved} قاعة ✅`);
}
function clearFeedBulkForm(){
  if($('feedBulkField'))$('feedBulkField').selectedIndex=0;
  if($('feedBulkDate'))$('feedBulkDate').value=today();
  ['feedBulkType','feedBulkNote'].forEach(id=>{if($(id))$(id).value='';});
  if($('feedHallsGrid'))$('feedHallsGrid').innerHTML='';
  onFeedBulkFieldChange();
}

// ══ أدوية/لقاحات جماعية ══

function onMedBulkFieldChange(){
  let fn=val('medBulkField')||'';
  let batches=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&(!fn||b.field===fn));
  if($('medBulkBatch'))$('medBulkBatch').innerHTML='<option value="">-- اختر الوجبة --</option>'+batches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
  buildMedHallsGrid();
}
function buildMedHallsGrid(){
  let el=$('medHallsGrid');if(!el)return;
  let bId=$('medBulkBatch')&&$('medBulkBatch').value?+$('medBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b){el.innerHTML='';return;}
  let date=val('medBulkDate')||today();
  let halls=_bulkHalls(bId, val('medBulkField'));
  if(!halls.length){el.innerHTML=`<div style="color:var(--ink3);font-size:13px;padding:10px 0">لا توجد قاعات مرتبطة بهذه الوجبة.</div>`;return;}
  let infoBar=_bulkInfoBar(b,date,`<span>🏠 عدد القاعات: <strong>${halls.length}</strong></span>`);
  let rows=halls.map(h=>{
    let alive=batchHallAlive(b,h.id);
    let lastMed=(data.meds||[]).filter(m=>m.batchId===b.id&&+m.hallId===h.id).sort((a,z)=>String(z.date).localeCompare(String(a.date)))[0];
    return`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:7px;background:var(--bg)">
      <div style="min-width:100px;font-weight:700;font-size:14px">${esc(h.name)}</div>
      <div style="font-size:12px;color:var(--ink3);min-width:80px">🐔 حي: <strong>${alive.toLocaleString()}</strong></div>
      ${lastMed?`<div style="font-size:12px;color:#7c3aed;min-width:140px">آخر: <strong>${lastMed.name}</strong> (${lastMed.date})</div>`:'<div style="font-size:12px;color:var(--ink3);min-width:140px">لا يوجد سابق</div>'}
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:200px">
        <label style="font-size:13px;white-space:nowrap;color:var(--ink2)">الكمية:</label>
        <input type="number" min="0" step="0.01" id="medHall_${h.id}"
          style="width:100px;padding:7px 10px;border:2px solid #c4b5fd;border-radius:8px;font-size:15px;font-weight:700;text-align:center;font-family:inherit;background:var(--bg)"
          placeholder="0">
        <label style="font-size:12px;color:var(--ink3)">✔ تطبيق:</label>
        <input type="checkbox" id="medHallChk_${h.id}" checked
          style="width:18px;height:18px;accent-color:#7c3aed;cursor:pointer">
      </div>
    </div>`;
  }).join('');
  el.innerHTML=infoBar+rows;
}
function saveAllMeds(){
  let bId=$('medBulkBatch')&&$('medBulkBatch').value?+$('medBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b)return msg('⚠ اختر الوجبة أولاً');
  let name=val('medBulkName')||'';
  if(!name)return msg('⚠ أدخل اسم المادة');
  let date=val('medBulkDate')||today();
  let type=val('medBulkType')||'لقاح';
  let dose=val('medBulkDose')||'';
  let note=val('medBulkNote')||'';
  let fn=val('medBulkField')||'';
  let halls=_bulkHalls(bId, fn);
  data.meds=data.meds||[];
  let saved=0,ts=Date.now();
  halls.forEach(h=>{
    let chk=$(`medHallChk_${h.id}`);
    if(chk&&!chk.checked)return;
    let qtyInp=$(`medHall_${h.id}`);
    let qty=qtyInp?+qtyInp.value:0;
    let hallObj=data.halls.find(x=>x.id===h.id);
    let medBulkAge=calcBirdAge(b.fieldEntryDate||b.transferDate||'',date);
    data.meds.push({id:ts+saved,batchId:b.id,date,field:fn||b.field||'',hallId:h.id,hall:hallObj?hallObj.name:h.name,type,name,dose,qty,note,ageDays:medBulkAge!=null?medBulkAge:undefined});
    saved++;
  });
  if(!saved)return msg('⚠ لم يتم تحديد أي قاعة');
  save();renderAll();clearMedBulkForm();msg(`تم حفظ المادة لـ ${saved} قاعة ✅`);
}
function clearMedBulkForm(){
  if($('medBulkField'))$('medBulkField').selectedIndex=0;
  if($('medBulkDate'))$('medBulkDate').value=today();
  if($('medBulkType'))$('medBulkType').selectedIndex=0;
  ['medBulkName','medBulkDose','medBulkNote'].forEach(id=>{if($(id))$(id).value='';});
  if($('medHallsGrid'))$('medHallsGrid').innerHTML='';
  onMedBulkFieldChange();
}

function toggleInlineDetails(id,chevronId){
  let el=$(id);if(!el)return;
  el.classList.toggle('hidden');
  if(chevronId){let ch=$(chevronId);if(ch)ch.style.transform=el.classList.contains('hidden')?'':'rotate(90deg)';}
}

function fillRecHallFilter(prefix){
  let batchSel=$(prefix+'BatchFilter');
  let hallSel=$(prefix+'HallFilter');
  if(!hallSel)return;
  let batchId=batchSel?+batchSel.value:0;
  let b=batchId?(data.batches||[]).find(x=>x.id===batchId):null;
  let halls=[];
  if(b){
    let allocs=Array.isArray(b.hallAllocations)&&b.hallAllocations.length?b.hallAllocations:(b.hallId?[{hallId:b.hallId,hall:b.hall}]:[]);
    halls=allocs.map(a=>({id:a.hallId,name:a.hall||'قاعة'}));
  } else {
    let dataset={weight:data.weights,feed:data.feeds,med:data.meds,mort:data.morts}[prefix]||[];
    let seen={};
    dataset.forEach(r=>{if(r.hallId&&!seen[r.hallId]){seen[r.hallId]=1;halls.push({id:r.hallId,name:r.hall||'قاعة '+r.hallId});}});
  }
  let cur=hallSel.value;
  hallSel.innerHTML='<option value="">كل القاعات</option>'+halls.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  if(cur&&[...hallSel.options].some(o=>o.value===cur))hallSel.value=cur;
}

function clearRecFilters(prefix){
  let ids={weight:['weightBatchFilter','weightHallFilter','weightFromDate','weightToDate'],feed:['feedBatchFilter','feedHallFilter','feedFromDate','feedToDate'],med:['medBatchFilter','medHallFilter','medFromDate','medToDate'],mort:['mortBatchFilter','mortHallFilter','mortFromDate','mortToDate']};
  (ids[prefix]||[]).forEach(id=>{let el=$(id);if(el){if(el.tagName==='SELECT')el.value='';else el.value='';}});
  ({weight:renderWeights,feed:renderFeed,med:renderMeds,mort:renderMort}[prefix]||renderAll)();
}
function renderFeed(){
  let el=$('feedTable');if(!el)return;
  let feeds=(data.feeds||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let filterBatchId=$('feedBatchFilter')&&$('feedBatchFilter').value?+$('feedBatchFilter').value:0;
  if(filterBatchId){
    let fb=data.batches.find(b=>b.id===filterBatchId);
    let halls=batchHallIds(fb);
    feeds=feeds.filter(x=>fb&&x.field===fb.field&&(!halls.length||halls.includes(+x.hallId)));
  }
  let fHall=$('feedHallFilter')&&$('feedHallFilter').value?+$('feedHallFilter').value:0;
  if(fHall)feeds=feeds.filter(x=>+x.hallId===fHall);
  let fFrom=$('feedFromDate')&&$('feedFromDate').value;
  let fTo=$('feedToDate')&&$('feedToDate').value;
  if(fFrom)feeds=feeds.filter(x=>x.date>=fFrom);
  if(fTo)feeds=feeds.filter(x=>x.date<=fTo);
  let fields=[...new Set(feeds.map(x=>x.field).filter(Boolean))];
  let rows=fields.map((field,i)=>{
    let fieldFeeds=feeds.filter(x=>x.field===field);
    let total=fieldFeeds.reduce((s,x)=>s+(+x.qty||0),0);
    let todayQty=fieldFeeds.filter(x=>x.date===today()).reduce((s,x)=>s+(+x.qty||0),0);
    let halls=[...new Set(fieldFeeds.map(x=>x.hall||'—'))];
    let hallRows=halls.map((hall,j)=>{
      let hallFeeds=fieldFeeds.filter(x=>(x.hall||'—')===hall);
      let hTotal=hallFeeds.reduce((s,x)=>s+(+x.qty||0),0);
      let latest=hallFeeds[0]||{};
      let hBatch=data.batches.find(bb=>hallFeeds[0]&&bb.id===hallFeeds[0].batchId);
      let hRatio=feedAvgRatio(hBatch);
      let isRoss=hBatch&&(hBatch.birdStrain||'Ross 308')==='Ross 308';
      let dailyRows=hallFeeds.map(x=>{
        let guide=isRoss&&x.ageDays!=null?feedGuideGrams(x.ageDays):null;
        let mathPred=guide!=null?+(guide*hRatio).toFixed(2):null;
        let actual=x.gramsPerBird||null;
        let diffGuide=guide!=null&&actual!=null?+(actual-guide).toFixed(2):null;
        let diffMath=mathPred!=null&&actual!=null?+(actual-mathPred).toFixed(2):null;
        let colG=diffGuide==null?'var(--ink3)':diffGuide>=0?'#16a34a':'#dc2626';
        let colM=diffMath==null?'var(--ink3)':diffMath>=0?'#16a34a':'#dc2626';
        return`<tr class="rec-daily-row">
          <td>${fmt(x.date)}</td>
          <td>${x.ageDays!=null?x.ageDays+' يوم':'—'}</td>
          <td>${esc(x.feedType||'—')}</td>
          <td>${(+x.qty||0).toLocaleString()} كغم</td>
          <td>${actual?`<span style="color:#7c3aed;font-weight:700">${actual} غم</span>`:'—'}</td>
          <td>${guide!=null?`<span style="color:#0369a1;font-weight:700">${guide} غم</span>`:'—'}</td>
          <td>${mathPred!=null?`<div style="font-size:12px;color:#7c3aed;font-weight:700">${mathPred} غم</div><div style="font-size:11px;color:${colM};font-weight:600">${diffMath!=null?(diffMath>=0?'+':'')+diffMath+' غم':'—'}</div>`:'—'}</td>
          <td>${diffGuide!=null?`<span style="color:${colG};font-weight:700">${diffGuide>=0?'+':''}${diffGuide} غم</span>`:'—'}</td>
          <td>${esc(x.note||'—')}</td>
          <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openEditRecord('feed',${x.id})">تعديل</button> ${isAdmin()?`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteFeed(${x.id})">حذف</button>`:''}</td>
        </tr>`;
      }).join('');
      let fhChId=`fhChev${i}_${j}`;
      return `<tr class="selectable rec-hall-row" onclick="toggleInlineDetails('feedHallDetail${i}_${j}','${fhChId}')">
        <td><span id="${fhChId}" class="hall-chevron" style="transition:transform .2s">◀</span> <b>${esc(hall)}</b></td><td>${fmt(latest.date)}</td><td>${esc(latest.feedType||'—')}</td><td>${hTotal.toLocaleString()} كغم</td><td>${hallFeeds.length.toLocaleString()}</td><td>${esc(latest.note||'—')}</td>
      </tr>
      <tr id="feedHallDetail${i}_${j}" class="hidden"><td colspan="6">
        <div class="tableWrap"><table><thead><tr><th>التاريخ</th><th>العمر</th><th>نوع العلف</th><th>الكمية</th><th>فعلي غم/طير</th><th>كايد Ross غم/طير</th><th>📐 توقع رياضي / فرق</th><th>فرق عن الكايد</th><th>ملاحظة</th><th>إجراء</th></tr></thead><tbody>${dailyRows}</tbody></table></div>
      </td></tr>`;
    }).join('');
    let ffChId=`ffChev${i}`;
    return `<tr class="selectable rec-field-row" onclick="toggleInlineDetails('feedDetail${i}','${ffChId}')">
      <td><span id="${ffChId}" class="field-chevron">◀</span> 🏡 ${field}</td>
      <td>اليوم: ${todayQty.toLocaleString()} كغم</td>
      <td>${halls.length.toLocaleString()} قاعة</td>
      <td><b>${total.toLocaleString()} كغم</b></td>
      <td>${fieldFeeds.length.toLocaleString()} سجل</td>
      <td></td>
    </tr>
    <tr id="feedDetail${i}" class="hidden"><td colspan="6">
      <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thLastDate')}</th><th>${t('thLastType')}</th><th>${t('thFeedTotal')}</th><th>${t('thRecords')}</th><th>${t('thNote')}</th></tr></thead><tbody>${hallRows}</tbody></table></div>
    </td></tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thFeedToday')}</th><th>${t('thHalls')}</th><th>${t('thFeedTotal')}</th><th>${t('thRecords')}</th><th>${t('thDetails')}</th></tr></thead><tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--ink3);padding:18px">'+t('noRecords')+' '+t('lblFeed')+'</td></tr>'}</tbody>`;
}
function renderMeds(){
  let el=$('medTable');if(!el)return;
  let meds=(data.meds||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let filterBatchId=$('medBatchFilter')&&$('medBatchFilter').value?+$('medBatchFilter').value:0;
  if(filterBatchId){
    let fb=data.batches.find(b=>b.id===filterBatchId);
    let halls=batchHallIds(fb);
    meds=meds.filter(x=>fb&&x.field===fb.field&&(!halls.length||halls.includes(+x.hallId)));
  }
  let mdHall=$('medHallFilter')&&$('medHallFilter').value?+$('medHallFilter').value:0;
  if(mdHall)meds=meds.filter(x=>+x.hallId===mdHall);
  let mdFrom=$('medFromDate')&&$('medFromDate').value;
  let mdTo=$('medToDate')&&$('medToDate').value;
  if(mdFrom)meds=meds.filter(x=>x.date>=mdFrom);
  if(mdTo)meds=meds.filter(x=>x.date<=mdTo);
  let fields=[...new Set(meds.map(x=>x.field).filter(Boolean))];
  let rows=fields.map((field,i)=>{
    let fieldMeds=meds.filter(x=>x.field===field);
    let todayCount=fieldMeds.filter(x=>x.date===today()).length;
    let halls=[...new Set(fieldMeds.map(x=>x.hall||'—'))];
    let hallRows=halls.map((hall,j)=>{
      let hallMeds=fieldMeds.filter(x=>(x.hall||'—')===hall);
      let latest=hallMeds[0]||{};
      let dailyRows=hallMeds.map(x=>`<tr class="rec-daily-row">
        <td>${fmt(x.date)}</td>
        <td>${esc(x.type||'—')}</td>
        <td><b>${esc(x.name||'—')}</b></td>
        <td>${esc(x.note||'—')}</td>
        <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openEditRecord('med',${x.id})">تعديل</button> ${isAdmin()?`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteMed(${x.id})">حذف</button>`:''}</td>
      </tr>`).join('');
      let mdChId=`mdChev${i}_${j}`;
      return `<tr class="selectable rec-hall-row" onclick="toggleInlineDetails('medHallDetail${i}_${j}','${mdChId}')">
        <td><span id="${mdChId}" class="hall-chevron" style="transition:transform .2s">◀</span> <b>${esc(hall)}</b></td>
        <td>${fmt(latest.date)}</td>
        <td>${esc(latest.type||'—')}</td>
        <td><b>${esc(latest.name||'—')}</b></td>
        <td>${hallMeds.length.toLocaleString()}</td>
        <td>${esc(latest.note||'—')}</td>
      </tr>
      <tr id="medHallDetail${i}_${j}" class="hidden"><td colspan="6">
        <div class="tableWrap"><table><thead><tr><th>${t('thDate')}</th><th>${t('thType')}</th><th>${t('thMaterial')}</th><th>${t('thNote')}</th><th>إجراء</th></tr></thead><tbody>${dailyRows}</tbody></table></div>
      </td></tr>`;
    }).join('');
    let mdfChId=`mdfChev${i}`;
    return `<tr class="selectable rec-field-row" onclick="toggleInlineDetails('medDetail${i}','${mdfChId}')">
      <td><span id="${mdfChId}" class="field-chevron">◀</span> 🏡 ${field}</td>
      <td>اليوم: ${todayCount.toLocaleString()}</td>
      <td>${halls.length.toLocaleString()} قاعة</td>
      <td><b>${fieldMeds.length.toLocaleString()} سجل</b></td>
      <td colspan="2"></td>
    </tr>
    <tr id="medDetail${i}" class="hidden"><td colspan="6">
      <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thLastDate')}</th><th>${t('thLastType')}</th><th>${t('thLastMaterial')}</th><th>${t('thRecords')}</th><th>${t('thNote')}</th></tr></thead><tbody>${hallRows}</tbody></table></div>
    </td></tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thVaccToday')}</th><th>${t('thHalls')}</th><th>${t('thTotal')}</th><th>${t('thRecords')}</th><th>${t('thDetails')}</th></tr></thead><tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--ink3);padding:18px">'+t('noRecords')+' '+t('lblMeds')+'</td></tr>'}</tbody>`;
}
