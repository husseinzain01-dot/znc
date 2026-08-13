// ── WEIGHTS ──

// ── فورم القاعة الواحدة (الأصلي) ──
function clearWeightForm(){
  if($('wField'))$('wField').selectedIndex=0;
  if($('wDate'))$('wDate').value=today();
  ['wAvg','wExpected','wNote','wAlive','wDiff','wStrain','wAgeDays'].forEach(id=>{if($(id))$(id).value=''});
  if($('wGuideTable'))$('wGuideTable').innerHTML='';
  onWeightFieldChange();
}
function onWeightFieldChange(){
  let fn=$('wField')?$('wField').value:'';
  let f=data.fields.find(x=>x.name===fn);
  let halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
  if($('wHall'))$('wHall').innerHTML=halls.map(h=>`<option value="${h.id}">${esc(h.name)}${h.capacity?' — سعة '+h.capacity:''}</option>`).join('');
  onWeightHallChange();
}
function onWeightHallChange(){
  let hallId=$('wHall')&&$('wHall').value?+$('wHall').value:null;
  let batches=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&batchAllocatedToHall(b,hallId)>0);
  if($('wBatch'))$('wBatch').innerHTML=batches.map(b=>`<option value="${b.id}">${esc(b.name)} — حي ${batchHallAlive(b,hallId).toLocaleString()}</option>`).join('');
  fillWeightDefaults();
}
function calcWeightTotal(){
  let id=$('wBatch')?+$('wBatch').value:0;
  let b=data.batches.find(x=>x.id===id);
  if(!b)return;
  let c=calc(b,val('wDate')||today());
  let hallId=$('wHall')&&$('wHall').value?+$('wHall').value:null;
  let actual=+($('wAvg').value||0);
  let guide=Math.round(expectedWeightForBatch(b,c.flockAge)*1000);
  if($('wAlive'))$('wAlive').value=(hallId?batchHallAlive(b,hallId):c.alive)||0;
  if($('wAgeDays'))$('wAgeDays').value=c.flockAge;
  if($('wExpected'))$('wExpected').value=guide;
  if($('wDiff'))$('wDiff').value=actual?((actual/guide*100).toFixed(1)+'%'):'';
}
function fillWeightDefaults(){
  let id=$('wBatch')?+$('wBatch').value:0;
  let b=data.batches.find(x=>x.id===id);
  if(!b){if($('wGuideTable'))$('wGuideTable').innerHTML='';return;}
  let c=calc(b,val('wDate')||today());
  let _hallId=$('wHall')&&$('wHall').value?+$('wHall').value:null;
  if($('wAlive'))$('wAlive').value=(_hallId?batchHallAlive(b,_hallId):c.alive)||0;
  if($('wStrain'))$('wStrain').value=b.type==='بياض'?(b.birdStrain||'بياض تجاري'):(b.birdStrain||'Ross 308');
  if($('wAgeDays'))$('wAgeDays').value=c.flockAge;
  if($('wExpected'))$('wExpected').value=getGuideWeightByAge(c.flockAge);
  renderGuideTable(b,c.flockAge);
  calcWeightTotal();
}
function saveWeightRecord(){
  let field=$('wField')?$('wField').value:'';
  let hallId=$('wHall')&&$('wHall').value?+$('wHall').value:null;
  let hall=data.halls.find(h=>h.id===hallId);
  let id=+$('wBatch').value,b=data.batches.find(x=>x.id===id);
  if(!field||!hallId)return msg('⚠ اختر الحقل والقاعة أولاً');
  if(!b)return msg('⚠ اختر الوجبة داخل القاعة');
  if(!isAdmin()&&!canSeeField(b.field))return msg('⛔ لا تملك صلاحية لهذه القاعة');
  let actual=+($('wAvg').value||0);if(actual<=0)return msg('⚠ أدخل الوزن الفعلي بالغرام');
  let c=calc(b,val('wDate')||today());
  let guide=Math.round(expectedWeightForBatch(b,c.flockAge)*1000);
  let hallAlive=hallId?batchHallAlive(b,hallId):c.alive;
  let total=Math.round(actual*(hallAlive||c.fieldBirds||0));
  let achievementPct=guide?+(actual/guide*100).toFixed(1):0;
  let rec={id:Date.now(),batchId:b.id,field:field,hallId:hallId,hall:hall?hall.name:(b.hall||''),date:val('wDate')||today(),
    alive:hallAlive,ageDays:c.flockAge,actual_weight_grams:actual,guideWeightGrams:guide,achievementPct:achievementPct,
    avgWeight:+(actual/1000).toFixed(3),expectedWeight:+(guide/1000).toFixed(3),totalWeight:total,diff:+(achievementPct-100).toFixed(1),note:val('wNote')};
  data.weights=data.weights||[];data.weights.push(rec);
  if(hall){hall.avgWeight=rec.avgWeight;hall.totalWeight=total;}
  save();renderAll();clearWeightForm();msg('تم حفظ وزن القاعة');
}

// ── فورم إدخال جميع القاعات دفعة واحدة (الجديد) ──
function onBulkFieldChange(){
  let fn=$('wBulkField')?$('wBulkField').value:'';
  let batches=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed&&(!fn||b.field===fn));
  if($('wBulkBatch'))$('wBulkBatch').innerHTML='<option value="">-- اختر الوجبة --</option>'+batches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
  buildWeightHallsGrid();
}
function buildWeightHallsGrid(){
  let el=$('wHallsGrid');if(!el)return;
  let bId=$('wBulkBatch')&&$('wBulkBatch').value?+$('wBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b){el.innerHTML='';return;}
  let date=val('wBulkDate')||today();
  let c=calc(b,date);
  let age=c.flockAge;
  let guide=Math.round(expectedWeightForBatch(b,age)*1000);
  let strain=b.type==='بياض'?(b.birdStrain||'بياض تجاري'):(b.birdStrain||'Ross 308');
  let fn=$('wBulkField')?$('wBulkField').value:'';
  let f=data.fields.find(x=>x.name===(fn||b.field));
  let halls=f?data.halls.filter(h=>h.fieldId===f.id&&batchAllocatedToHall(b,h.id)>0):[];
  if(!halls.length){el.innerHTML=`<div style="color:var(--ink3);font-size:13px;padding:10px 0">لا توجد قاعات مرتبطة بهذه الوجبة. أضف القاعات أولاً من صفحة الإعدادات.</div>`;return;}
  let infoBar=`<div style="display:flex;gap:16px;flex-wrap:wrap;background:var(--card2,#f3f4f6);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px">
    <span>📅 عمر الطير: <strong>يوم ${age}</strong></span>
    <span>🐔 السلالة: <strong>${strain}</strong></span>
    <span>📐 كايد اليوم: <strong>${guide} غم</strong></span>
    <span>🏠 عدد القاعات: <strong>${halls.length}</strong></span>
  </div>`;
  let rows=halls.map(h=>{
    let alive=batchHallAlive(b,h.id);
    let lastW=(data.weights||[]).filter(w=>w.batchId===b.id&&+w.hallId===h.id).sort((a,z)=>String(z.date).localeCompare(String(a.date)))[0];
    let lastActual=lastW?lastW.actual_weight_grams:null;
    let vsGuide=lastActual&&guide?((lastActual/guide-1)*100).toFixed(1):null;
    let vsCol=vsGuide!=null?(+vsGuide>=0?'#16a34a':'#dc2626'):'#6b7280';
    return`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:7px;background:var(--bg)">
      <div style="min-width:100px;font-weight:700;font-size:14px">${esc(h.name)}</div>
      <div style="font-size:12px;color:var(--ink3);min-width:70px">🐔 حي: <strong>${alive.toLocaleString()}</strong></div>
      <div style="font-size:12px;color:var(--ink3);min-width:95px">📐 كايد: <strong>${guide} غم</strong></div>
      ${lastActual!=null?`<div style="font-size:12px;color:${vsCol};min-width:110px">آخر: <strong>${lastActual}غم</strong> (${vsGuide!=null?(+vsGuide>0?'+':'')+vsGuide+'%':'—'})</div>`:`<div style="font-size:12px;color:var(--ink3);min-width:110px">لا يوجد وزن سابق</div>`}
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:190px">
        <label style="font-size:13px;white-space:nowrap;color:var(--ink2)">الوزن الفعلي (غم):</label>
        <input type="number" min="0" step="1" id="wHall_${h.id}"
          style="width:110px;padding:7px 10px;border:2px solid var(--border);border-radius:8px;font-size:15px;font-weight:700;text-align:center;font-family:inherit;background:var(--bg)"
          placeholder="0" oninput="updateHallWeightDiff(${h.id},${guide})">
        <span id="wHallDiff_${h.id}" style="font-size:13px;min-width:55px;font-weight:700"></span>
      </div>
    </div>`;
  }).join('');
  el.innerHTML=infoBar+rows;
}
function updateHallWeightDiff(hallId,guide){
  let inp=$(`wHall_${hallId}`);let sp=$(`wHallDiff_${hallId}`);
  if(!inp||!sp)return;
  let actual=+inp.value;
  if(!actual||!guide){sp.textContent='';return;}
  let pct=((actual/guide-1)*100).toFixed(1);
  sp.textContent=(+pct>=0?'+':'')+pct+'%';
  sp.style.color=+pct>=0?'#16a34a':'#dc2626';
}
function saveAllWeights(){
  let bId=$('wBulkBatch')&&$('wBulkBatch').value?+$('wBulkBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b)return msg('⚠ اختر الوجبة أولاً');
  let date=val('wBulkDate')||today();
  let c=calc(b,date);
  let age=c.flockAge;
  let guide=Math.round(expectedWeightForBatch(b,age)*1000);
  let note=val('wBulkNote')||'';
  let fn=$('wBulkField')?$('wBulkField').value:'';
  let f=data.fields.find(x=>x.name===(fn||b.field));
  let halls=f?data.halls.filter(h=>h.fieldId===f.id&&batchAllocatedToHall(b,h.id)>0):[];
  data.weights=data.weights||[];
  let saved=0,ts=Date.now();
  halls.forEach(h=>{
    let inp=$(`wHall_${h.id}`);
    let actual=inp?+inp.value:0;
    if(!actual)return;
    let alive=batchHallAlive(b,h.id);
    let total=Math.round(actual*alive);
    let achievementPct=guide?+(actual/guide*100).toFixed(1):0;
    let rec={id:ts+saved,batchId:b.id,field:fn||b.field||'',hallId:h.id,hall:h.name,
      date,alive,ageDays:age,actual_weight_grams:actual,guideWeightGrams:guide,
      achievementPct,avgWeight:+(actual/1000).toFixed(3),expectedWeight:+(guide/1000).toFixed(3),
      totalWeight:total,diff:+(achievementPct-100).toFixed(1),note};
    data.weights.push(rec);
    h.avgWeight=rec.avgWeight;h.totalWeight=total;
    saved++;
  });
  if(!saved)return msg('⚠ أدخل وزن قاعة واحدة على الأقل');
  save();renderAll();clearBulkWeightForm();msg(`تم حفظ أوزان ${saved} قاعة ✅`);
}
function clearBulkWeightForm(){
  if($('wBulkField'))$('wBulkField').selectedIndex=0;
  if($('wBulkDate'))$('wBulkDate').value=today();
  if($('wBulkNote'))$('wBulkNote').value='';
  if($('wHallsGrid'))$('wHallsGrid').innerHTML='';
  onBulkFieldChange();
}
// ── دليل الكايد المستقل (بدون ربط بوجبة) ──
function lastMarketDateForBatch(batchId){
  let ms=(data.markets||[]).filter(m=>+m.batchId===+batchId&&m.date);
  if(!ms.length)return null;
  return ms.reduce((a,m)=>String(m.date)>String(a)?m.date:a,ms[0].date);
}
function renderFieldCycle(){
  let el=$('fieldCycleTable');if(!el)return;
  let fields=data.fields.filter(f=>canSeeField(f.name));
  let rows=fields.map(f=>{
    let batches=visibleBatches().filter(b=>b.field===f.name&&b.transferDate);
    let activeBatch=batches.filter(b=>calc(b).alive>0).sort((a,b)=>String(b.fieldEntryDate||b.transferDate).localeCompare(String(a.fieldEntryDate||a.transferDate)))[0]||null;
    let badge,entryDate='—',cycleEnd='—',cycleInfo='—',currentBirds=0,lastMarket='—',mStart='—',mEnd='—',note='';
    if(activeBatch){
      entryDate=activeBatch.fieldEntryDate||activeBatch.transferDate;
      cycleEnd=addDays(entryDate,40);
      currentBirds=calc(activeBatch).alive;
      let remain=diffDays(today(),cycleEnd);
      let elapsed=diffDays(entryDate,today());
      cycleInfo=today()<=cycleEnd?`متبقي ${remain} يوم`:`منقضي ${elapsed-40} يوم زيادة`;
      badge='<span class="badge b-amber">🟡 مشغول</span>';
    }else{
      // ابحث عن آخر وجبة منتهية لهذا الحقل
      let doneBatches=batches.filter(b=>calc(b).completed||calc(b).alive===0).sort((a,b)=>String(b.fieldEntryDate||b.transferDate).localeCompare(String(a.fieldEntryDate||a.transferDate)));
      let lastBatch=doneBatches[0]||null;
      let lm=lastBatch?lastMarketDateForBatch(lastBatch.id):null;
      if(lastBatch)entryDate=lastBatch.fieldEntryDate||lastBatch.transferDate,cycleEnd=addDays(entryDate,40);
      if(lm){
        lastMarket=fmt(lm);
        mStart=fmt(lm);
        let mEndIso=addDays(lm,20);
        mEnd=fmt(mEndIso);
        let remain=diffDays(today(),mEndIso);
        if(today()<=mEndIso){
          badge='<span class="badge b-blue">🔧 صيانة</span>';
          cycleInfo=`متبقي ${remain} يوم للصيانة`;
        }else{
          badge='<span class="badge b-green">✅ جاهز</span>';
          note='جاهز لاستقبال فقسة جديدة';
        }
      }else{
        badge='<span class="badge b-green">✅ جاهز</span>';
        note='لا توجد وجبة حالية';
      }
    }
    return `<tr>
      <td><b>${esc(f.name)}</b></td>
      <td>${activeBatch?esc(activeBatch.name):'—'}</td>
      <td>${entryDate&&entryDate!=='—'?fmt(entryDate):'—'}</td>
      <td>${cycleEnd&&cycleEnd!=='—'?fmt(cycleEnd):'—'}</td>
      <td>${currentBirds.toLocaleString()}</td>
      <td>${lastMarket}</td>
      <td>${mStart}</td>
      <td>${mEnd}</td>
      <td>${badge}${note?`<div style="font-size:11px;color:var(--ink3);margin-top:4px">${note}</div>`:''}${cycleInfo&&cycleInfo!=='—'?`<div style="font-size:11px;color:var(--ink3);margin-top:4px">${cycleInfo}</div>`:''}</td>
    </tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thCurBatch')}</th><th>${t('thBirdEntry')}</th><th>${t('thCycleEnd')}</th><th>${t('thCurBird')}</th><th>${t('thLastSale')}</th><th>${t('thMaintStart')}</th><th>${t('thMaintEnd')}</th><th>${t('thStatus')}</th></tr></thead><tbody>${rows||'<tr><td colspan="9" style="text-align:center;color:var(--ink3);padding:18px">'+t('noFields')+'</td></tr>'}</tbody>`;
}
function onGuideRefTypeChange(){
  let isLayer=$('guideRefType')&&$('guideRefType').value==='بياض';
  let strains=isLayer?Object.keys(LAYER_WEIGHT_GUIDES):Object.keys(BROILER_WEIGHT_GUIDES);
  if($('guideRefStrain'))$('guideRefStrain').innerHTML=strains.map(s=>`<option value="${s}">${s}</option>`).join('');
  renderGuideRefTable();
}
function renderGuideRefTable(){
  let el=$('guideRefTable');if(!el)return;
  let isLayer=$('guideRefType')&&$('guideRefType').value==='بياض';
  let strain=$('guideRefStrain')?$('guideRefStrain').value:'';
  let table=isLayer?(LAYER_WEIGHT_GUIDES[strain]||LAYER_WEIGHT_GUIDES['بياض تجاري']):(BROILER_WEIGHT_GUIDES[strain]||BROILER_WEIGHT_GUIDES['Ross 308']);
  let maxAge=table[table.length-1][0];
  let maxG=Math.round(table[table.length-1][1]*1000);
  // بناء قائمة يومية كاملة (روزنامة) من اليوم 0 حتى آخر عمر بالجدول
  let days=[];
  for(let age=0;age<=maxAge;age++){
    let grams=Math.round(guideWeightFromTable(age,table)*1000);
    let prevGrams=age>0?Math.round(guideWeightFromTable(age-1,table)*1000):grams;
    days.push({age,grams,gain:grams-prevGrams});
  }
  // تقسيم إلى أسابيع (7 أيام بالصف) مثل الروزنامة
  let weeksHtml='';
  for(let w=0;w*7<=maxAge;w++){
    let weekDays=days.slice(w*7,w*7+7);
    if(!weekDays.length)break;
    let cells=weekDays.map(d=>{
      let pct=Math.min(100,Math.round(d.grams/maxG*100));
      return `<div class="statCard" style="overflow:visible;padding:8px">
        <div class="sc-label" style="font-size:11px">📅 يوم ${d.age}</div>
        <div class="sc-val" style="font-size:16px">${d.grams.toLocaleString()} <span style="font-size:10px;font-weight:600;color:var(--ink3)">غم</span></div>
        <div style="background:var(--bg2,#eef2f7);border-radius:6px;height:5px;margin:6px 0 4px;overflow:hidden">
          <div style="background:linear-gradient(90deg,var(--p2),var(--p));height:100%;width:${pct}%"></div>
        </div>
        <div class="sc-sub" style="font-size:10px">${d.age>0?`<span class="badge b-green">+${d.gain.toLocaleString()} غم</span>`:'<span class="badge b-gray">البداية</span>'}</div>
      </div>`;
    }).join('');
    weeksHtml+=`<div style="margin-bottom:12px">
      <div class="dp-sub" style="margin-bottom:6px">🗓️ الأسبوع ${w+1} (الأيام ${weekDays[0].age}–${weekDays[weekDays.length-1].age})</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px">${cells}</div>
    </div>`;
  }
  el.innerHTML=`${weeksHtml}
  <p style="font-size:11px;color:var(--ink3);margin-top:10px">📊 الشريط يعبّر عن نسبة الوزن من أقصى وزن مستهدف (${maxG.toLocaleString()} غم) — والشارة الخضراء توضح مقدار الزيادة اليومية عن اليوم السابق بالغرام، والقيم محسوبة يومياً بالتدرج بين نقاط الجدول.</p>`;
}
// عرض دليل الكايد (الوزن القياسي حسب العمر) لسلالة الوجبة المختارة، مع تمييز العمر الحالي
function renderGuideTable(b,currentAge){
  let el=$('wGuideTable');if(!el)return;
  let isLayer=b&&b.type==='بياض';
  let strain=b?(b.birdStrain||(isLayer?'بياض تجاري':'Ross 308')):'Ross 308';
  let table=isLayer?(LAYER_WEIGHT_GUIDES[strain]||LAYER_WEIGHT_GUIDES['بياض تجاري']):(BROILER_WEIGHT_GUIDES[strain]||BROILER_WEIGHT_GUIDES['Ross 308']);
  let cells=table.map(([age,kg])=>{
    let grams=Math.round(kg*1000);
    let active=currentAge!=null&&Math.abs(+currentAge-age)<=(table[1]?Math.abs(table[1][0]-table[0][0])/2:3.5);
    return `<div class="dCell${active?' dc-accent':''}"><div class="dc-label">${age} يوم</div><div class="dc-val">${grams.toLocaleString()} غم</div></div>`;
  }).join('');
  el.innerHTML=`<div class="detailPanel" style="margin-top:6px">
    <div class="dp-sub">📖 دليل الكايد (الوزن القياسي) — ${strain}</div>
    <div class="detailGrid">${cells}</div>
  </div>`;
}
function saveWeightRecord(){
  let field=$('wField')?$('wField').value:'';
  let hallId=$('wHall')&&$('wHall').value?+$('wHall').value:null;
  let hall=data.halls.find(h=>h.id===hallId);
  let id=+$('wBatch').value,b=data.batches.find(x=>x.id===id);
  if(!field||!hallId)return msg('⚠ اختر الحقل والقاعة أولاً');
  if(!b)return msg('⚠ اختر الوجبة داخل القاعة');
  if(!isAdmin()&&!canSeeField(b.field))return msg('⛔ لا تملك صلاحية لهذه القاعة');
  let actual=+($('wAvg').value||0);if(actual<=0)return msg('⚠ أدخل الوزن الفعلي بالغرام');
  let c=calc(b,val('wDate')||today());
  let guide=Math.round(expectedWeightForBatch(b,c.flockAge)*1000);
  let hallAlive=hallId?batchHallAlive(b,hallId):c.alive;
  let total=Math.round(actual*(hallAlive||c.fieldBirds||0));
  let achievementPct=guide?+(actual/guide*100).toFixed(1):0;
  let rec={id:Date.now(),batchId:b.id,field:field,hallId:hallId,hall:hall?hall.name:(b.hall||''),date:val('wDate')||today(),
    alive:hallAlive,ageDays:c.flockAge,actual_weight_grams:actual,guideWeightGrams:guide,achievementPct:achievementPct,
    avgWeight:+(actual/1000).toFixed(3),expectedWeight:+(guide/1000).toFixed(3),totalWeight:total,diff:+(achievementPct-100).toFixed(1),note:val('wNote')};
  data.weights=data.weights||[];data.weights.push(rec);
  if(hall){hall.avgWeight=rec.avgWeight;hall.totalWeight=total;}
  save();renderAll();clearWeightForm();msg('تم حفظ وزن القاعة');
}
function renderWeights(){
  let el=$('weightsTable');if(!el)return;
  let weights=(data.weights||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let filterBatchId=$('weightBatchFilter')&&$('weightBatchFilter').value?+$('weightBatchFilter').value:0;
  if(filterBatchId)weights=weights.filter(w=>+w.batchId===filterBatchId);
  let wHall=$('weightHallFilter')&&$('weightHallFilter').value?+$('weightHallFilter').value:0;
  if(wHall)weights=weights.filter(w=>+w.hallId===wHall);
  let wFrom=$('weightFromDate')&&$('weightFromDate').value;
  let wTo=$('weightToDate')&&$('weightToDate').value;
  if(wFrom)weights=weights.filter(w=>w.date>=wFrom);
  if(wTo)weights=weights.filter(w=>w.date<=wTo);
  // نسبة أداء كل وجبة — مصدرها بالأولوية:
  // 1) وزن الطير عند النقل ÷ كايد يوم 0
  // 2) وزن البيضة × 67% ÷ كايد يوم 0
  // 3) متوسط (فعلي ÷ كايد) من السجلات المسجلة
  let batchAvgRatio={};
  (data.batches||[]).forEach(b=>{
    let day0Guide=Math.round(expectedWeightForBatch(b,0)*1000);
    if(b.transferBirdWeight&&b.transferBirdWeight>0&&day0Guide>0){
      batchAvgRatio[b.id]=b.transferBirdWeight/day0Guide;
      return;
    }
    if(b.eggWeight&&b.eggWeight>0&&day0Guide>0){
      batchAvgRatio[b.id]=(b.eggWeight*0.67)/day0Guide;
      return;
    }
    let bw=(data.weights||[]).filter(w=>w.batchId===b.id&&weightActualGrams(w)>0&&weightGuideGrams(w)>0);
    if(!bw.length){batchAvgRatio[b.id]=1;return;}
    let sum=bw.reduce((s,w)=>s+weightActualGrams(w)/weightGuideGrams(w),0);
    batchAvgRatio[b.id]=sum/bw.length;
  });
  let fields=[...new Set(weights.map(w=>w.field).filter(Boolean))];
  let rows=fields.map((field,i)=>{
    let fieldWeights=weights.filter(w=>w.field===field);
    let latest=fieldWeights[0]||{};
    let avgCount=fieldWeights.filter(w=>weightActualGrams(w)>0).length;
    let avgWeight=avgCount?Math.round(fieldWeights.reduce((s,w)=>s+weightActualGrams(w),0)/avgCount):0;
    let halls=[...new Set(fieldWeights.map(w=>w.hall||'—'))];
    let hallRows=halls.map((hall,j)=>{
      let hallWeights=fieldWeights.filter(w=>(w.hall||'—')===hall);
      let last=hallWeights[0]||{};
      let b=data.batches.find(x=>x.id===last.batchId);
      let actualG=weightActualGrams(last),guideG=weightGuideGrams(last);
      let pct=guideG?+(actualG/guideG*100).toFixed(1):0;
      let badge=pct>=100?'<span class="badge b-green">جيد</span>':'<span class="badge b-amber">أقل من الكايد</span>';
      let dailyRows=hallWeights.map(w=>{
        let wb=data.batches.find(x=>x.id===w.batchId);
        let aG=weightActualGrams(w),gG=weightGuideGrams(w);
        let p=gG?+(aG/gG*100).toFixed(1):0;
        let bd=p>=100?'<span class="badge b-green">جيد</span>':'<span class="badge b-amber">أقل من الكايد</span>';
        let hallAliveW=wb&&w.hallId?batchHallAlive(wb,+w.hallId):(+w.alive||0);
        // التحليل الرياضي
        let ratio=batchAvgRatio[w.batchId]||1;
        let mathPred=gG?Math.round(gG*ratio):0;
        let mathDiff=aG&&mathPred?aG-mathPred:null;
        let mathCol=mathDiff==null?'var(--ink3)':mathDiff>=0?'#16a34a':'#dc2626';
        let mathCell=mathPred?`<div style="font-size:12px;color:#7c3aed;font-weight:700">${mathPred}غم</div><div style="font-size:11px;color:${mathCol};font-weight:600">${mathDiff!=null?(mathDiff>=0?'+':'')+mathDiff+'غم':'—'}</div>`:'—';
        return `<tr class="rec-daily-row">
          <td>${fmt(w.date)}</td>
          <td>${wb?wb.name:'—'}</td>
          <td>${w.ageDays!=null?w.ageDays:'—'}</td>
          <td>${hallAliveW.toLocaleString()}</td>
          <td>${aG||'—'} غم</td>
          <td>${gG||'—'} غم</td>
          <td>${(aG&&gG)?(aG-gG)+' غم':'—'}</td>
          <td>${aG?p+'% '+bd:'—'}</td>
          <td>${mathCell}</td>
          <td>${esc(w.note||'—')}</td>
          <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openEditRecord('weight',${w.id})">تعديل</button> ${isAdmin()?`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteWeight(${w.id})">حذف</button>`:''}</td>
        </tr>`;
      }).join('');
      // نسبة نجاح الوزن: آخر سجل مقارنةً بكايد عمره
      let lastW=hallWeights.find(w=>weightActualGrams(w)>0&&weightGuideGrams(w)>0)||null;
      let avgAchieveGuide=lastW?+(weightActualGrams(lastW)/weightGuideGrams(lastW)*100).toFixed(1):null;
      let lastR=lastW?(batchAvgRatio[lastW.batchId]||1):1;
      let lastMathPred=lastW&&weightGuideGrams(lastW)?Math.round(weightGuideGrams(lastW)*lastR):0;
      let avgAchieveMath=lastW&&lastMathPred?+(weightActualGrams(lastW)/lastMathPred*100).toFixed(1):null;
      let guideColor=avgAchieveGuide==null?'var(--ink3)':avgAchieveGuide>=100?'#16a34a':'#dc2626';
      let mathColor=avgAchieveMath==null?'var(--ink3)':avgAchieveMath>=100?'#7c3aed':'#f59e0b';
      let chId=`wChev${i}_${j}`;
      return `<tr class="selectable rec-hall-row" onclick="toggleInlineDetails('weightHallDetail${i}_${j}','${chId}')">
        <td><span id="${chId}" class="hall-chevron" style="transition:transform .2s">◀</span> <b>${hall}</b></td>
        <td>${fmt(last.date)}</td>
        <td>${b?b.name:'—'}</td>
        <td>${last.ageDays!=null?last.ageDays:'—'}</td>
        <td>${(b&&last.hallId?batchHallAlive(b,+last.hallId):(+last.alive||0)).toLocaleString()}</td>
        <td>${actualG||'—'} غم</td>
        <td>${guideG||'—'} غم</td>
        <td>${(actualG&&guideG)?(actualG-guideG)+' غم':'—'}</td>
        <td>${actualG?pct+'% '+badge:'—'}</td>
        <td><span style="font-weight:700;color:${guideColor}">${avgAchieveGuide!=null?avgAchieveGuide+'%':'—'}</span></td>
        <td><span style="font-weight:700;color:${mathColor}">${avgAchieveMath!=null?avgAchieveMath+'%':'—'}</span></td>
        <td>${hallWeights.length.toLocaleString()}</td>
      </tr>
      <tr id="weightHallDetail${i}_${j}" class="hidden"><td colspan="13">
        <div class="tableWrap"><table><thead><tr><th>${t('thDate')}</th><th>${t('thBatch')}</th><th>${t('thAge')}</th><th>${t('thAlive')}</th><th>${t('thActual')}</th><th>${t('thGuide')}</th><th>${t('thDiff')}</th><th>${t('thAchieve')}</th><th>📐 توقع رياضي / فرق</th><th>${t('thNote')}</th><th>إجراء</th></tr></thead><tbody>${dailyRows}</tbody></table></div>
      </td></tr>`;
    }).join('');
    let fChId=`wFChev${i}`;
    return `<tr class="selectable rec-field-row" onclick="toggleInlineDetails('weightDetail${i}','${fChId}')">
      <td><span id="${fChId}" class="field-chevron">◀</span> 🏡 ${field}</td>
      <td>${fmt(latest.date)}</td>
      <td>${halls.length.toLocaleString()} قاعة</td>
      <td>${avgWeight?avgWeight+' غم':'—'}</td>
      <td>${fieldWeights.length.toLocaleString()} سجل</td>
      <td colspan="4"></td>
    </tr>
    <tr id="weightDetail${i}" class="hidden"><td colspan="9">
      <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thLastDate')}</th><th>${t('thBatch')}</th><th>${t('thAge')}</th><th>${t('thAlive')}</th><th>${t('thActual')}</th><th>${t('thGuide')}</th><th>${t('thDiff')}</th><th>${t('thAchieve')}</th><th>% كايد</th><th>% رياضي</th><th>${t('thRecords')}</th></tr></thead><tbody>${hallRows}</tbody></table></div>
    </td></tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thLastDate')}</th><th>${t('thHalls')}</th><th>${t('thAvgWeight')}</th><th>${t('thRecords')}</th><th colspan="4">${t('thDetails')}</th></tr></thead><tbody>${rows||'<tr><td colspan="9" style="text-align:center;color:var(--ink3);padding:18px">'+t('noRecords')+' أوزان</td></tr>'}</tbody>`;
}

function deleteWeight(id){
  if(!isAdmin())return;
  if(confirm('حذف سجل الوزن؟')){
    data.weights=(data.weights||[]).filter(w=>w.id!==id);
    save();renderAll();msg('تم حذف سجل الوزن');
  }
}

// ── الأوزان المسوقة ──
function onMwBatchChange(){
  calcMwAge();
}
function calcMwAge(){
  let id=$('mwBatch')?+$('mwBatch').value:0;
  let b=data.batches.find(x=>x.id===id);
  let d=$('mwDate')?$('mwDate').value:today();
  if(b&&b.fieldEntryDate&&d){
    let age=Math.round((new Date(d)-new Date(b.fieldEntryDate))/(1000*60*60*24));
    if($('mwAge'))$('mwAge').value=age>=0?age:'';
  } else {
    if($('mwAge'))$('mwAge').value='';
  }
}
function calcMwAvg(){
  let cnt=+($('mwCount')?$('mwCount').value:0)||0;
  let kg=+($('mwTotalKg')?$('mwTotalKg').value:0)||0;
  let avg=$('mwAvgKg');if(!avg)return;
  avg.value=(cnt&&kg)?(kg/cnt).toFixed(3)+' كغ/طير':'';
}
function addMarketWeight(){
  let batchId=$('mwBatch')?+$('mwBatch').value:0;if(!batchId)return msg('⚠ اختر الوجبة أولاً');
  let b=data.batches.find(x=>x.id===batchId);
  if(!isAdmin()&&b&&!canSeeField(b.field))return msg('⛔ لا تملك صلاحية');
  let count=+($('mwCount')?$('mwCount').value:0)||0;
  let totalKg=+($('mwTotalKg')?$('mwTotalKg').value:0)||0;
  if(!count)return msg('⚠ أدخل عدد الطيور');
  if(!totalKg)return msg('⚠ أدخل مجموع الوزن الكلي');
  let date=$('mwDate')?$('mwDate').value:today();
  let age=$('mwAge')?+$('mwAge').value||null:null;
  let note=$('mwNote')?$('mwNote').value:'';
  let avgKg=+(totalKg/count).toFixed(3);
  data.marketWeights=data.marketWeights||[];
  data.marketWeights.push({id:Date.now(),batchId,date,age,count,totalKg,avgKg,note});
  save();renderAll();clearMwForm();msg('تم حفظ وزن التسويق ✅');
}
function clearMwForm(){
  if($('mwCount'))$('mwCount').value='';
  if($('mwTotalKg'))$('mwTotalKg').value='';
  if($('mwAvgKg'))$('mwAvgKg').value='';
  if($('mwAge'))$('mwAge').value='';
  if($('mwNote'))$('mwNote').value='';
  if($('mwDate'))$('mwDate').value=today();
}
function renderMarketWeights(){
  let el=$('marketWeightsTable');if(!el)return;
  let filterBatchId=$('mwBatchFilter')&&$('mwBatchFilter').value?+$('mwBatchFilter').value:0;
  let recs=(data.marketWeights||[]).filter(r=>{
    let b=data.batches.find(x=>x.id===r.batchId);
    if(!isAdmin()&&b&&!canSeeField(b.field))return false;
    if(filterBatchId&&+r.batchId!==filterBatchId)return false;
    return true;
  }).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let rows=recs.map(r=>{
    let b=data.batches.find(x=>x.id===r.batchId);
    return `<tr>
      <td>${fmt(r.date)}</td>
      <td>${esc(b?b.name:'—')}</td>
      <td>${r.age!=null?r.age+' يوم':'—'}</td>
      <td>${(+r.count||0).toLocaleString()}</td>
      <td><b>${(+r.totalKg||0).toLocaleString()} كغ</b></td>
      <td><b style="color:#dc2626">${r.avgKg} كغ/طير</b></td>
      <td>${esc(r.note||'—')}</td>
      <td>${isAdmin()?`<button class="btn btn-danger btn-sm" onclick="deleteMarketWeight(${r.id})">حذف</button>`:'—'}</td>
    </tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>التاريخ</th><th>الوجبة</th><th>العمر</th><th>العدد</th><th>الوزن الكلي</th><th>معدل الوزن</th><th>ملاحظة</th><th>حذف</th></tr></thead><tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:var(--ink3);padding:18px">لا توجد سجلات أوزان مسوقة</td></tr>'}</tbody>`;
}
function deleteMarketWeight(id){
  if(!isAdmin())return;
  if(confirm('حذف سجل وزن التسويق؟')){
    data.marketWeights=(data.marketWeights||[]).filter(r=>r.id!==id);
    save();renderAll();msg('تم الحذف');
  }
}

