// ── RENDER ALL ──
function renderAll(){
  if(typeof updateArchiveStatuses==='function')updateArchiveStatuses();
  renderSelectors();renderStats();renderBatches();
  renderMort();renderMarket();renderReports();
  renderArchive();renderCalendar();renderTransferredBatches();renderFields();renderSuppliers();
  renderUsers();renderUserFieldsList();renderLayerPurchase();renderWeights();renderFeed();renderMeds();
  renderAiAnalysis();renderMarketWeights();
  fillTransferPreview(false);
  // تحديث لوحة القاعات إذا كانت مفتوحة
  let openFieldId=+val('hFieldId');
  if(openFieldId)renderHalls(openFieldId);
  // hide backup/restore for non-admin
  if($('backupBtn'))$('backupBtn').style.display=isAdmin()?'':'none';
  if($('restoreBtn'))$('restoreBtn').style.display=isAdmin()?'':'none';
  if($('recalcGuideBtn'))$('recalcGuideBtn').style.display=isAdmin()?'':'none';
}

function renderSelectors(){
  let batches=visibleBatches().filter(b=>!calc(b).completed);
  let opts=batches.map(b=>`<option value="${b.id}">${esc(b.name)} — ${esc(b.type||'')}</option>`).join('');
  ['mortBatch','marketBatch'].forEach(id=>{if($(id))$(id).innerHTML=opts});
  if($('marketBatch'))fillMarketHalls();
  if($('transferBatch'))$('transferBatch').innerHTML=data.batches.filter(b=>!calc(b).completed&&hatchAvailableForTransfer(b)>0).map(b=>`<option value="${b.id}">${esc(b.name)} — ${esc(b.type||'')} — ${t('thRemainHatch')}: ${hatchAvailableForTransfer(b).toLocaleString()}</option>`).join('');
  if($('calFilter'))$('calFilter').innerHTML='<option value="all">'+t('allBatches')+'</option>'+batches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
  let fOpts=data.fields.length
    ?data.fields.map(f=>`<option value="${esc(f.name)}">${esc(f.name)} (${esc(f.type)})${f.capacity?' — سعة '+f.capacity:''}</option>`).join('')
    :t('noFields')+' — أضف من صفحة الحقول';
  if($('transferField')){$('transferField').innerHTML=fOpts;onTransferFieldChange();}
  if($('batchTargetField'))$('batchTargetField').innerHTML='<option value="">'+t('laterOnTransfer')+'</option>'+fOpts;
  if($('transferBatch'))fillTransferPreview(false);
  if($('lpField'))$('lpField').innerHTML=fOpts;
  if($('wField'))$('wField').innerHTML=fOpts;
  if($('wBulkField'))$('wBulkField').innerHTML=fOpts;
  if($('feedField'))$('feedField').innerHTML=fOpts;
  if($('feedBulkField'))$('feedBulkField').innerHTML=fOpts;
  if($('medField'))$('medField').innerHTML=fOpts;
  if($('medBulkField'))$('medBulkField').innerHTML=fOpts;
  if($('mortField')){$('mortField').innerHTML=fOpts;onMortFieldChange();}
  if($('mortBulkField'))$('mortBulkField').innerHTML=fOpts;

  renderBatchRecordFilters();
  renderArchiveFilters();


  let allActive=visibleBatches().filter(b=>!calc(b).completed);
  if($('mwBatch'))$('mwBatch').innerHTML=allActive.filter(b=>b.transferDate).map(b=>`<option value="${b.id}">${esc(b.name)} — ${esc(b.field||'')}</option>`).join('');
  if($('mwBatch'))onMwBatchChange();
  let activeTransferred=visibleBatches().filter(b=>b.transferDate&&!calc(b).completed);
  if($('wBatch'))$('wBatch').innerHTML=activeTransferred.map(b=>{
    let label=b.hall?`${esc(b.name)} — ${esc(b.field)} / ${esc(b.hall)}`:`${esc(b.name)} — ${esc(b.field||'بلا حقل')}`;
    return `<option value="${b.id}">${label}</option>`;
  }).join('');
  renderSupplierDatalists();

}

function uniqueClean(arr){
  return [...new Set(arr.map(x=>String(x||'').trim()).filter(Boolean))];
}
function renderSupplierDatalists(){
  let suppliers=uniqueClean(data.batches.map(b=>b.supplier));
  let companies=uniqueClean(data.batches.map(b=>b.company));
  if($('supplierList'))$('supplierList').innerHTML=suppliers.map(x=>`<option value="${x}"></option>`).join('');
  if($('companyList'))$('companyList').innerHTML=companies.map(x=>`<option value="${x}"></option>`).join('');
}
function renderSuppliers(){
  let table=$('suppliersTable');if(!table)return;
  let q=($('supplierSearch')&&$('supplierSearch').value||'').trim().toLowerCase();
  let map=new Map();
  data.batches.forEach(b=>{
    let supplier=(b.supplier||'—').trim()||'—';
    let company=(b.company||'—').trim()||'—';
    let key=supplier+'|'+company;
    if(!map.has(key))map.set(key,{supplier,company,count:0,birds:0,strains:new Set(),fields:new Set(),last:''});
    let rec=map.get(key),c=calc(b);
    rec.count++;
    rec.birds+=c.fieldBirds||0;
    if(b.birdStrain)rec.strains.add(b.birdStrain);
    if(b.field)rec.fields.add(b.field);
    let d=b.eggReceiveDate||b.hatchDate||'';
    if(String(d)>String(rec.last))rec.last=d;
  });
  let rows=[...map.values()].filter(r=>{
    return !q||[r.supplier,r.company,[...r.strains].join(' '),[...r.fields].join(' ')].some(x=>String(x).toLowerCase().includes(q));
  }).sort((a,b)=>String(a.supplier).localeCompare(String(b.supplier),'ar'));
  if($('supplierStats'))$('supplierStats').innerHTML=[
    {l:'عدد الموردين',v:uniqueClean(rows.map(r=>r.supplier).filter(x=>x!=='—')).length},
    {l:'عدد الشركات',v:uniqueClean(rows.map(r=>r.company).filter(x=>x!=='—')).length},
    {l:'الوجبات المرتبطة',v:rows.reduce((s,r)=>s+r.count,0)},
    {l:'الصافي المنقول',v:rows.reduce((s,r)=>s+r.birds,0).toLocaleString()}
  ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div></div>`).join('');
  table.innerHTML=`<thead><tr><th>${t('thSupplier')}</th><th>${t('thCompany')}</th><th>${t('thBatchCount')}</th><th>${t('thStrains')}</th><th>${t('thFields')}</th><th>${t('thNetTransfer')}</th><th>${t('thLastDate')}</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r.supplier}</b></td><td>${r.company}</td><td>${r.count}</td><td>${[...r.strains].join(' / ')||'—'}</td><td>${[...r.fields].join(' / ')||'—'}</td><td>${r.birds.toLocaleString()}</td><td>${fmt(r.last)}</td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--ink3);padding:18px">'+t('noData')+' موردين</td></tr>'}</tbody>`;
}

function renderArchiveFilters(){
  let archived=(isAdmin()?data.batches:visibleBatches()).filter(b=>calc(b).completed);
  let oldBatch=$('archiveBatchFilter')?$('archiveBatchFilter').value:'';
  let oldField=$('archiveFieldFilter')?$('archiveFieldFilter').value:'';
  let oldHall=$('archiveHallFilter')?$('archiveHallFilter').value:'';
  if($('archiveBatchFilter')){
    $('archiveBatchFilter').innerHTML='<option value="">'+t('allBatches')+'</option>'+archived.map(b=>`<option value="${b.id}">${esc(b.name)}${b.field?' — '+esc(b.field):''}</option>`).join('');
    if(oldBatch&&[...$('archiveBatchFilter').options].some(o=>o.value===oldBatch))$('archiveBatchFilter').value=oldBatch;
  }
  if($('archiveFieldFilter')){
    let fields=[...new Set(archived.map(b=>b.field).filter(Boolean))];
    $('archiveFieldFilter').innerHTML='<option value="">'+t('allFields')+'</option>'+fields.map(f=>`<option value="${f}">${f}</option>`).join('');
    if(oldField&&[...$('archiveFieldFilter').options].some(o=>o.value===oldField))$('archiveFieldFilter').value=oldField;
  }
  fillArchiveHallFilter(oldHall);
}
function fillArchiveHallFilter(keep=''){
  let field=$('archiveFieldFilter')?$('archiveFieldFilter').value:'';
  let halls=[];
  if(field){
    let f=data.fields.find(x=>x.name===field);
    halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
  }else{
    halls=data.halls||[];
  }
  if($('archiveHallFilter')){
    $('archiveHallFilter').innerHTML='<option value="">'+t('allHalls')+'</option>'+halls.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
    if(keep&&[...$('archiveHallFilter').options].some(o=>o.value===keep))$('archiveHallFilter').value=keep;
  }
}
function onArchiveFieldFilterChange(){
  fillArchiveHallFilter('');
  renderArchive();
}

function allVisibleBatchesForFilters(){
  return (isAdmin()?data.batches:visibleBatches()).filter(b=>!b.field||canSeeField(b.field));
}
function renderBatchRecordFilters(){
  let all=allVisibleBatchesForFilters();
  let opts='<option value="">'+t('allBatches')+'</option>'+all.map(b=>`<option value="${b.id}">${esc(b.name)}${b.field?' — '+esc(b.field):''}</option>`).join('');
  ['feedBatchFilter','mortBatchFilter','marketBatchFilter','medBatchFilter','weightBatchFilter','mwBatchFilter'].forEach(id=>{
    let el=$(id);if(!el)return;
    let old=el.value;
    el.innerHTML=opts;
    if(old&&[...el.options].some(o=>o.value===old))el.value=old;
  });
}

function selectBatch(id){selectedBatchId=id;selectedFieldName=null;renderStats();renderBatches();msg('تم اختيار الوجبة')}


// إرجاع الوزن الفعلي بالغرام لسجل وزن، مع التحويل من الكيلوغرام للسجلات القديمة
function weightActualGrams(w){
  if(!w)return 0;
  if(w.actual_weight_grams!=null)return +w.actual_weight_grams||0;
  let v=+w.avgWeight||0;
  return Math.round(v<20?v*1000:v);
}
function weightGuideGrams(w){
  if(!w)return 0;
  if(w.guideWeightGrams!=null)return +w.guideWeightGrams||0;
  return getGuideWeightByAge(w.ageDays!=null?+w.ageDays:0);
}
// تحويل سجلات الأوزان القديمة (المخزّنة بالكيلوغرام) إلى غرام دون حذف أي بيانات
function migrateWeightsToGrams(){
  (data.weights||[]).forEach(w=>{
    if(w.actual_weight_grams==null)w.actual_weight_grams=weightActualGrams(w);
    if(w.guideWeightGrams==null)w.guideWeightGrams=weightGuideGrams(w);
    if(w.achievementPct==null)w.achievementPct=w.guideWeightGrams?+(w.actual_weight_grams/w.guideWeightGrams*100).toFixed(1):0;
  });
}
function _applyGuideWeights(){
  (data.weights||[]).forEach(w=>{
    let b=(data.batches||[]).find(x=>x.id===w.batchId);
    let guide=Math.round(expectedWeightForBatch(b,w.ageDays!=null?+w.ageDays:0)*1000);
    if(!guide)return;
    w.guideWeightGrams=guide;
    w.expectedWeight=+(guide/1000).toFixed(3);
    w.achievementPct=w.actual_weight_grams?+(w.actual_weight_grams/guide*100).toFixed(1):0;
    w.diff=+(w.achievementPct-100).toFixed(1);
  });
}
function recalcAllGuideWeights(){
  _applyGuideWeights();
  save();renderAll();msg('تم إعادة حساب الكايد لجميع السجلات');
}
function latestWeightForBatch(batchId){
  let list=(data.weights||[]).filter(w=>w.batchId===batchId).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return list[0]||null;
}
function hallUsedBirds(hallId,ignoreBatchId=null){return data.batches.filter(b=>b.id!==ignoreBatchId&&!calc(b).completed&&b.transferDate).reduce((s,b)=>s+batchAllocatedToHall(b,hallId),0);}
function hallCapacityStatus(hallId,addBirds=0,ignoreBatchId=null){
  let h=data.halls.find(x=>x.id===+hallId);
  if(!h)return {ok:true,used:0,cap:0,remaining:999999};
  let used=hallUsedBirds(h.id,ignoreBatchId);
  let cap=+h.capacity||0;
  let remaining=cap?cap-used:999999;
  return {ok:!cap||addBirds<=remaining,used,cap,remaining,hall:h};
}
const BROILER_WEIGHT_GUIDES={
  'Ross 308':[[0,0.044],[1,0.062],[2,0.081],[3,0.102],[4,0.125],[5,0.151],[6,0.181],[7,0.213],[8,0.249],[9,0.288],[10,0.330],[11,0.376],[12,0.425],[13,0.477],[14,0.533],[15,0.592],[16,0.655],[17,0.720],[18,0.789],[19,0.860],[20,0.935],[21,1.012],[22,1.092],[23,1.174],[24,1.258],[25,1.345],[26,1.434],[27,1.524],[28,1.616],[29,1.710],[30,1.805],[31,1.901],[32,1.999],[33,2.097],[34,2.196],[35,2.296],[36,2.396],[37,2.496],[38,2.597],[39,2.697],[40,2.798],[41,2.898],[42,2.998],[43,3.097],[44,3.197],[45,3.295],[46,3.393],[47,3.490],[48,3.586],[49,3.681],[50,3.776],[51,3.869],[52,3.961],[53,4.052],[54,4.142],[55,4.230],[56,4.318]],
  'Ross 708':[[0,0.04],[7,0.19],[14,0.49],[21,0.96],[28,1.60],[35,2.36],[42,3.16],[49,3.90]],
  'Cobb 500':[[0,0.04],[7,0.18],[14,0.46],[21,0.89],[28,1.48],[35,2.18],[42,2.92],[49,3.58]],
  'Cobb 700':[[0,0.04],[7,0.18],[14,0.47],[21,0.91],[28,1.51],[35,2.23],[42,2.99],[49,3.66]],
  'Arbor Acres':[[0,0.04],[7,0.18],[14,0.45],[21,0.87],[28,1.43],[35,2.10],[42,2.82],[49,3.45]],
  'Hubbard':[[0,0.04],[7,0.17],[14,0.43],[21,0.82],[28,1.36],[35,2.02],[42,2.70],[49,3.32]],
  'Indian River':[[0,0.04],[7,0.17],[14,0.44],[21,0.85],[28,1.40],[35,2.06],[42,2.76],[49,3.40]],
  'Sasso (بلدي مطور)':[[0,0.04],[7,0.10],[14,0.25],[21,0.45],[28,0.70],[35,1.00],[42,1.35],[49,1.75],[56,2.10],[63,2.45]]
};
// كايد استهلاك العلف Ross 308 — غرام/طير/يوم (As-Hatched, من جدول Performance Objectives 2022)
const FEED_GUIDE_ROSS308=[0,12,16,20,24,27,31,35,39,44,48,52,57,62,67,72,77,83,88,94,100,106,111,117,122,128,134,139,145,150,156,161,166,171,176,180,185,189,193,197,201,204,207,211,213,216,219,221,223,225,227,229,230,231,233,233,234];
function feedGuideGrams(ageDays){
  if(ageDays==null||ageDays<0)return null;
  if(ageDays<FEED_GUIDE_ROSS308.length)return FEED_GUIDE_ROSS308[ageDays];
  return FEED_GUIDE_ROSS308[FEED_GUIDE_ROSS308.length-1];
}
function feedAvgRatio(b){
  if(!b)return 1;
  let day0Guide=Math.round(expectedWeightForBatch(b,0)*1000);
  if(b.transferBirdWeight&&+b.transferBirdWeight>0&&day0Guide>0)return +b.transferBirdWeight/day0Guide;
  if(b.eggWeight&&+b.eggWeight>0&&day0Guide>0)return (+b.eggWeight*0.67)/day0Guide;
  return 1;
}
const LAYER_WEIGHT_GUIDES={
  'Lohmann Brown':[[0,0.04],[28,0.28],[56,0.68],[84,1.08],[112,1.40],[126,1.55],[140,1.68]],
  'Lohmann LSL':[[0,0.04],[28,0.26],[56,0.62],[84,0.98],[112,1.28],[126,1.42],[140,1.55]],
  'Hy-Line Brown':[[0,0.04],[28,0.29],[56,0.70],[84,1.10],[112,1.42],[126,1.58],[140,1.70]],
  'Hy-Line W-36':[[0,0.04],[28,0.25],[56,0.60],[84,0.95],[112,1.23],[126,1.36],[140,1.48]],
  'ISA Brown':[[0,0.04],[28,0.28],[56,0.67],[84,1.06],[112,1.38],[126,1.53],[140,1.66]],
  'Bovans Brown':[[0,0.04],[28,0.28],[56,0.66],[84,1.05],[112,1.36],[126,1.51],[140,1.64]],
  'Bovans White':[[0,0.04],[28,0.25],[56,0.60],[84,0.94],[112,1.22],[126,1.35],[140,1.47]],
  'Dekalb White':[[0,0.04],[28,0.25],[56,0.61],[84,0.96],[112,1.25],[126,1.39],[140,1.52]],
  'Novogen Brown':[[0,0.04],[28,0.28],[56,0.69],[84,1.09],[112,1.41],[126,1.56],[140,1.69]],
  'H&N Brown':[[0,0.04],[28,0.28],[56,0.68],[84,1.07],[112,1.39],[126,1.54],[140,1.67]],
  'بياض تجاري':[[0,0.04],[28,0.27],[56,0.65],[84,1.02],[112,1.32],[126,1.46],[140,1.58]]
};
function guideWeightFromTable(ageDays,table){
  if(!table||!table.length)return 0;
  if(ageDays<=table[0][0])return table[0][1];
  for(let i=1;i<table.length;i++){
    let a=table[i-1],b=table[i];
    if(ageDays<=b[0]){
      let ratio=(ageDays-a[0])/(b[0]-a[0]);
      return +(a[1]+(b[1]-a[1])*ratio).toFixed(2);
    }
  }
  return table[table.length-1][1];
}
// كايد وزن ثابت حسب عمر الطير بالأيام (بالغرام) - لا يعتمد على الوزن الفعلي
const GUIDE_WEIGHT_BY_AGE_GRAMS=[[0,44],[1,62],[2,81],[3,102],[4,125],[5,151],[6,181],[7,213],[8,249],[9,288],[10,330],[11,376],[12,425],[13,477],[14,533],[15,592],[16,655],[17,720],[18,789],[19,860],[20,935],[21,1012],[22,1092],[23,1174],[24,1258],[25,1345],[26,1434],[27,1524],[28,1616],[29,1710],[30,1805],[31,1901],[32,1999],[33,2097],[34,2196],[35,2296],[36,2396],[37,2496],[38,2597],[39,2697],[40,2798],[41,2898],[42,2998],[43,3097],[44,3197],[45,3295],[46,3393],[47,3490],[48,3586],[49,3681],[50,3776],[51,3869],[52,3961],[53,4052],[54,4142],[55,4230],[56,4318]];
function getGuideWeightByAge(ageDays){
  let table=GUIDE_WEIGHT_BY_AGE_GRAMS;
  if(ageDays<=table[0][0])return table[0][1];
  for(let i=1;i<table.length;i++){
    let a=table[i-1],b=table[i];
    if(ageDays<=b[0]){
      let ratio=(ageDays-a[0])/(b[0]-a[0]);
      return Math.round(a[1]+(b[1]-a[1])*ratio);
    }
  }
  return table[table.length-1][1];
}
function expectedWeightForBatch(b,ageDays){
  if(!b)return defaultExpectedWeight(ageDays,false);
  if(b.type==='بياض'){
    let strain=b.birdStrain||'بياض تجاري';
    return guideWeightFromTable(ageDays,LAYER_WEIGHT_GUIDES[strain]||LAYER_WEIGHT_GUIDES['بياض تجاري']);
  }
  let strain=b.birdStrain||'Ross 308';
  return guideWeightFromTable(ageDays,BROILER_WEIGHT_GUIDES[strain]||BROILER_WEIGHT_GUIDES['Ross 308']);
}
function defaultExpectedWeight(ageDays,isLayer=false){
  if(isLayer){
    // تقدير بسيط للبياض حتى لا يبقى النظام غبياً مثل بعض النماذج الإدارية.
    if(ageDays<70)return 0.6;
    if(ageDays<112)return 1.1;
    if(ageDays<140)return 1.35;
    return 1.55;
  }
  const table=[
    [0,0.04],[7,0.18],[14,0.45],[21,0.85],[28,1.35],[35,1.95],[40,2.35],[45,2.75]
  ];
  let last=table[0];
  for(const row of table){if(ageDays>=row[0])last=row;else break}
  return last[1];
}

function selectedDetails(b){
  if(!b)return `<div class="detailPanel"><p style="color:var(--ink3);font-size:13px">اضغط على أي وجبة من الجدول لعرض تفاصيلها.</p></div>`;
  let c=calc(b);
  // قسمان: معلومات الفقس + معلومات الحقل
  let hatchCells=[
    ['استلام البيض',fmt(b.eggReceiveDate)],
    ['تاريخ الترقيد',fmt(b.hatchDate)],
    ['سلالة الطير',esc(b.birdStrain||'—')],
    ['معدل وزن البيضة',(+b.eggWeight||0)?b.eggWeight+' غم':'—'],
    ['عمر الأم',(+b.motherAge||0)?b.motherAge+' أسبوع':'—'],
    ['المورد',b.supplier||'—'],
    ['الشركة',b.company||'—'],
    ['مسؤول الوجبة / المشرف',esc(b.supervisor||'—')],
    ['الدكتور البيطري',esc(b.vet||'—')],
    ['عمر التفقيس',c.hatchAge+'/21'],
    ['موعد النقل',fmt(c.expectedTransfer)],
    ['الحقل المراد نقله إليه',esc(b.targetField||'—')],
    ['البيض الداخل',(b.eggs||0).toLocaleString()],
    ['البيض التالف',(b.badEggs||0).toLocaleString()],
    ['عدد البيض المرقد',(c.est||0).toLocaleString()],
    ['الفحص الضوئي',b.candle?(+b.candle).toFixed(2)+'%':'0.00%'],
    ['عدد التالف بعد الفحص الضوئي',(b.damagedAfterCandle||0).toLocaleString()],
    ['نسبة العزل الضوئي',b.isolationRate?(+b.isolationRate).toFixed(2)+'%':'0.00%'],
    ['هلاك اللقاح',c.vaccineDeaths.toLocaleString()],
    ['الطير العزل داخل المفقس',c.isolated.toLocaleString()],
    ['غير صالح للتربية',(+b.unfitBirds||0).toLocaleString()],
    ['نسبة الفقس',hatchRate(b)+'%','dc-accent'],
  ];
  let lw=latestWeightForBatch(b.id);
  let fieldCells=[
    ['الحقل',esc(b.field||'—')],
    ['القاعة',b.hall?`<span style="cursor:pointer;text-decoration:underline" onclick="showFieldHallsList('${String(b.field).replace(/'/g,"\\'")}')">${esc(b.hall)}</span>`:'—'],
    ['دخول الحقل',fmt(c.entryDate)],
    ['عمر الطير',c.transferred?(c.isLayer?fmtLayerAge(c.flockAge):(c.flockAge+'/40 يوم')):'—'],
    ['الصافي المنقول',(c.fieldBirds||0).toLocaleString(),'dc-accent'],
    ['وزن الطير عند النقل',b.transferBirdWeight?b.transferBirdWeight+' غم':'—'],
    ['هلاك الحقل',c.mort.toLocaleString()],
    ['المسوق',c.sold.toLocaleString()],
    ['الحي المتبقي',c.alive.toLocaleString(),'dc-accent'],
    ['نسبة النجاح',successRate(b)+'%','dc-accent'],
    ['آخر وزن (الفعلي)',lw?(weightActualGrams(lw)+' غم'):'—','dc-accent'],
    ['الوزن المتوقع (الكايد)',lw?(weightGuideGrams(lw)+' غم'):'—'],
    ['فرق الوزن',lw?((weightActualGrams(lw)-weightGuideGrams(lw))+' غم'):'—'],
    ['الحالة',c.completed?'منتهية':(b.status||'نشطة')],
  ];
  let mkCells=c=>c.map(x=>`<div class="dCell${x[2]?' '+x[2]:''}"><div class="dc-label">${x[0]}</div><div class="dc-val">${x[1]}</div></div>`).join('');
  return `<div class="detailPanel">
    <div class="dp-head"><span class="dp-title">📌 ${esc(b.name)}</span><span class="badge b-${c.completed?'gray':c.alert?'amber':'green'}">${c.completed?'منتهية':c.alert?'تنبيه':'نشطة'}</span></div>
    <div class="dp-sub">المفقس</div>
    <div class="detailGrid" style="margin-bottom:6px">${mkCells(hatchCells)}</div>
    <div class="dp-sub">الحقل</div>
    <div class="detailGrid">${mkCells(fieldCells)}</div>
  </div>`;
}


function buildFieldTopDashboard(fieldName,selectedBatch=null){
  let f=data.fields.find(x=>x.name===fieldName);
  let batches=visibleBatches().filter(b=>!calc(b).completed&&b.transferDate&&b.field===fieldName);
  let halls=f?data.halls.filter(h=>h.fieldId===f.id):[];
  let alive=batches.reduce((s,b)=>s+batchHallAlive(b,h.id),0);
  let birds=batches.reduce((s,b)=>s+batchAllocatedToHall(b,h.id),0);
  let mort=batches.reduce((s,b)=>s+batchHallMort(b,h.id),0);
  let sold=batches.reduce((s,b)=>s+batchHallSold(b,h.id),0);
  let weights=batches.map(b=>latestWeightForBatch(b.id)).filter(Boolean);
  let avgWeight=weights.length?Math.round(weights.reduce((s,w)=>s+weightActualGrams(w),0)/weights.length):0;
  let avgGuide=weights.length?Math.round(weights.reduce((s,w)=>s+weightGuideGrams(w),0)/weights.length):0;
  let totalWeight=weights.reduce((s,w)=>s+(+w.totalWeight||0),0);
  let cap=halls.reduce((s,h)=>s+(+h.capacity||0),0);
  let occ=cap?((alive/cap)*100).toFixed(1)+'%':'—';
  let title=selectedBatch?`${selectedBatch.name} — ملخص الحقل ${fieldName}`:`ملخص الحقل ${fieldName}`;
  let cards=[
    {l:'عدد القاعات',v:halls.length,s:'داخل الحقل'},
    {l:'الوجبات النشطة',v:batches.length,s:'داخل الحقل'},
    {l:'السعة الكلية',v:cap?cap.toLocaleString():'—',s:'طير'},
    {l:'الصافي المنقول',v:birds.toLocaleString(),s:'ثابت'},
    {l:'الحي الحالي',v:alive.toLocaleString(),s:'كل القاعات'},
    {l:'هلاك الحقل',v:mort.toLocaleString(),s:'متراكم'},
    {l:'المسوق',v:sold.toLocaleString(),s:'متراكم'},
    {l:'الإشغال',v:occ,s:'من السعة'},
    {l:'معدل الوزن (الفعلي)',v:avgWeight?avgWeight+' غم':'—',s:'آخر قراءات'},
    {l:'الكايد (المتوقع)',v:avgGuide?avgGuide+' غم':'—',s:'حسب العمر'},
    {l:'مجموع الوزن',v:totalWeight?totalWeight.toLocaleString()+' غم':'—',s:'كل القاعات'}
  ];
  return `<div class="heroBanner"><div><h2>${title}</h2><p>الواجهة العليا تعرض مجموع الحقل. اضغط على قاعة بالأسفل حتى تتحول الواجهة العليا إلى تفاصيل القاعة.</p></div><div class="hb-right">${f?f.type:'حقل'}</div></div>`+
    cards.map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div><div class="sc-sub">${x.s}</div></div>`).join('');
}
function buildHallTopDashboard(hallId){
  let h=data.halls.find(x=>x.id===+hallId);if(!h)return '';
  let f=data.fields.find(x=>x.id===h.fieldId);
  let batches=visibleBatches().filter(b=>!calc(b).completed&&b.transferDate&&batchAllocatedToHall(b,h.id)>0);
  let alive=batches.reduce((s,b)=>s+batchHallAlive(b,h.id),0);
  let birds=batches.reduce((s,b)=>s+batchAllocatedToHall(b,h.id),0);
  let mort=batches.reduce((s,b)=>s+batchHallMort(b,h.id),0);
  let sold=batches.reduce((s,b)=>s+batchHallSold(b,h.id),0);
  let weights=batches.map(b=>(data.weights||[]).filter(w=>w.batchId===b.id&&+w.hallId===h.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]).filter(Boolean);
  let avgWeight=weights.length?Math.round(weights.reduce((s,w)=>s+weightActualGrams(w),0)/weights.length):0;
  let expected=weights.length?Math.round(weights.reduce((s,w)=>s+weightGuideGrams(w),0)/weights.length):0;
  let totalWeight=weights.reduce((s,w)=>s+(+w.totalWeight||0),0)||(+h.totalWeight||0);
  let cap=+h.capacity||0;
  let remain=cap?Math.max(0,cap-alive):'—';
  let occ=cap?((alive/cap)*100).toFixed(1)+'%':'—';
  let cards=[
    {l:'الحقل',v:f?f.name:'—',s:'تابعة له'},
    {l:'القاعة',v:h.name,s:'تفاصيل مباشرة'},
    {l:'السعة',v:cap?cap.toLocaleString():'—',s:'طير'},
    {l:'المتاح',v:remain.toLocaleString?remain.toLocaleString():remain,s:'طير'},
    {l:'الإشغال',v:occ,s:'نسبة'},
    {l:'الصافي المنقول',v:birds.toLocaleString(),s:'ثابت'},
    {l:'الحي الحالي',v:alive.toLocaleString(),s:'داخل القاعة'},
    {l:'الهلاك',v:mort.toLocaleString(),s:'داخل القاعة'},
    {l:'المسوق',v:sold.toLocaleString(),s:'داخل القاعة'},
    {l:'معدل الوزن (الفعلي)',v:avgWeight?avgWeight+' غم':'—',s:'فعلي'},
    {l:'الكايد (المتوقع)',v:expected?expected+' غم':'—',s:'حسب العمر'}
  ];
  return `<div class="heroBanner"><div><h2><span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;font-variation-settings:'FILL' 1,'wght' 400">meeting_room</span> ${esc(h.name)}</h2><p>تفاصيل القاعة بدل ملخص الحقل. الحقل: ${f?esc(f.name):'—'}</p></div><div class="hb-right">إشغال ${occ}</div></div>`+
    cards.map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div><div class="sc-sub">${x.s}</div></div>`).join('');
}
function setTopToHall(hallId){
  let cards=$('statsCards');
  if(cards)cards.innerHTML=buildHallTopDashboard(hallId);
}


function renderBatchHallsPanel(b){
  let el=$('batchHallsPanel');if(!el)return;
  if(!b||!b.field){el.innerHTML='';return;}
  let f=data.fields.find(x=>x.name===b.field);
  if(!f){el.innerHTML='';return;}
  let halls=data.halls.filter(h=>h.fieldId===f.id);
  let rows=halls.map(h=>{
    let batches=visibleBatches().filter(x=>x.transferDate&&!calc(x).completed&&(+x.hallId||0)===h.id);
    let alive=batches.reduce((s,x)=>s+calc(x).alive,0);
    let birds=batches.reduce((s,x)=>s+(calc(x).fieldBirds||0),0);
    let mort=batches.reduce((s,x)=>s+calc(x).mort,0);
    let sold=batches.reduce((s,x)=>s+calc(x).sold,0);
    let lwList=batches.map(x=>latestWeightForBatch(x.id)).filter(Boolean);
    let avg=lwList.length?+(lwList.reduce((s,w)=>s+(+w.avgWeight||0),0)/lwList.length).toFixed(2):'—';
    let cap=+h.capacity||0;
    let remain=cap?Math.max(0,cap-alive):'—';
    return `<tr class="selectable" onclick="showHallDetailsInBatch(${h.id})">
      <td><b>${esc(h.name)}</b></td>
      <td>${cap?cap.toLocaleString():'—'}</td>
      <td>${birds.toLocaleString()}</td>
      <td><b>${alive.toLocaleString()}</b></td>
      <td>${remain.toLocaleString?remain.toLocaleString():remain}</td>
      <td>${mort.toLocaleString()}</td>
      <td>${sold.toLocaleString()}</td>
      <td>${avg==='—'?'—':avg+' كغ'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showHallDetailsInBatch(${h.id})">تفاصيل القاعة</button></td>
    </tr>`;
  }).join('');
  el.innerHTML=`<div class="card">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">meeting_room</span> قاعات ${esc(f.name)}</div>
    <p style="font-size:12px;color:var(--ink3);margin-bottom:10px">اضغط على القاعة لعرض تفاصيلها مكان تفاصيل الوجبة أعلاه.</p>
    <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thCapacity')}</th><th>${t('thNet')}</th><th>${t('thAlive')}</th><th>${t('thAvailable')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thLastWeight')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows||'<tr><td colspan="9">'+t('noHalls')+'</td></tr>'}</tbody></table></div>
  </div>`;
}
function showHallDetailsInBatch(hallId){
  let h=data.halls.find(x=>x.id===+hallId);if(!h)return;
  let f=data.fields.find(x=>x.id===h.fieldId);
  let batches=visibleBatches().filter(x=>x.transferDate&&!calc(x).completed&&batchAllocatedToHall(x,h.id)>0);
  let alive=batches.reduce((s,x)=>s+batchHallAlive(x,h.id),0);
  let birds=batches.reduce((s,x)=>s+batchAllocatedToHall(x,h.id),0);
  let mort=batches.reduce((s,x)=>s+batchHallMort(x,h.id),0);
  let sold=batches.reduce((s,x)=>s+batchHallSold(x,h.id),0);
  let cap=+h.capacity||0;
  let remain=cap?Math.max(0,cap-alive):'—';
  let occ=cap?((alive/cap)*100).toFixed(1)+'%':'—';
  // أوزان خاصة بهذه القاعة فقط
  let hallWeightRecs=batches.map(x=>(data.weights||[]).filter(w=>w.batchId===x.id&&+w.hallId===h.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]).filter(Boolean);
  let avgActualG=hallWeightRecs.length?Math.round(hallWeightRecs.reduce((s,w)=>s+weightActualGrams(w),0)/hallWeightRecs.length):0;
  let avgGuideG=hallWeightRecs.length?Math.round(hallWeightRecs.reduce((s,w)=>s+weightGuideGrams(w),0)/hallWeightRecs.length):0;
  let cells=[
    ['الحقل',f?esc(f.name):'—'],['القاعة',esc(h.name)],['السعة',cap?cap.toLocaleString():'—'],['الإشغال',occ],
    ['الصافي المنقول',birds.toLocaleString()],['الحي داخل القاعة',alive.toLocaleString()],['المتاح',remain.toLocaleString?remain.toLocaleString():remain],
    ['هلاك القاعة',mort.toLocaleString()],['المسوق',sold.toLocaleString()],
    ['الوزن الفعلي',avgActualG?avgActualG+' غم':'—'],['الكايد (المتوقع)',avgGuideG?avgGuideG+' غم':'—'],
    ['فرق الوزن',(avgActualG&&avgGuideG)?(avgActualG-avgGuideG)+' غم':'—']
  ];
  let rows=batches.map(x=>{
    let lw=(data.weights||[]).filter(w=>w.batchId===x.id&&+w.hallId===h.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
    let c=calc(x);
    return `<tr><td>${esc(x.name)}</td><td>${fmt(c.entryDate)}</td><td>${c.isLayer?fmtLayerAge(c.flockAge):c.flockAge+'/40'}</td><td>${batchAllocatedToHall(x,h.id).toLocaleString()}</td><td>${batchHallAlive(x,h.id).toLocaleString()}</td><td>${batchHallMort(x,h.id).toLocaleString()}</td><td>${batchHallSold(x,h.id).toLocaleString()}</td><td>${lw?weightActualGrams(lw)+' غم':'—'}</td></tr>`;
  }).join('');
  let detail=$('statsDetail');
  if(detail)detail.innerHTML=`<div class="detailPanel">
    <div class="dp-head"><span class="dp-title">🚪 تفاصيل القاعة: ${esc(h.name)}</span><button class="btn btn-secondary btn-sm" onclick="restoreSelectedBatchDetails()">رجوع لتفاصيل الوجبة</button></div>
    <div class="detailGrid">${cells.map(x=>`<div class="dCell"><div class="dc-label">${x[0]}</div><div class="dc-val">${x[1]}</div></div>`).join('')}</div>
    <div class="dp-sub">الوجبات داخل القاعة</div>
    <div class="tableWrap"><table><thead><tr><th>${t('thBatch')}</th><th>${t('thEntryDate')}</th><th>${t('thAge')}</th><th>${t('thNet')}</th><th>${t('thAlive')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thLastWeight')}</th></tr></thead><tbody>${rows||'<tr><td colspan="8">'+t('noActiveBatches')+'</td></tr>'}</tbody></table></div>
  </div>`;
}
function restoreSelectedBatchDetails(){
  let b=data.batches.find(x=>x.id===selectedBatchId);
  if(b&&$('statsDetail'))$('statsDetail').innerHTML=selectedDetails(b);
  else if(selectedFieldName)showFieldDetails(selectedFieldName);
}

function smartShortcutCards(fieldName=''){
  let arg=String(fieldName||'').replace(/'/g,"\\'");
  return [
    ['scale','الأوزان','weights','weights'],
    ['grass','الأعلاف','feed','feed'],
    ['sell','التسويق','market','market'],
    ['vaccines','الأدوية واللقاحات','meds','meds'],
    ['heart_minus','الهلاك','mort','mort'],
    ['bar_chart','مخطط بياني','charts','weights']
  ].map(x=>`<div class="statCard smartCard ${x[3]}" onclick="openSmartSection('${x[2]}','${arg}')">
    <div class="sc-label"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle">${x[0]}</span> انتقال سريع</div><div class="sc-val" style="font-size:15px">${x[1]}</div><div class="sc-sub">${fieldName?'لهذا الحقل':'فتح الصفحة'}</div>
  </div>`).join('');
}

function smartSectionHasData(section,fieldName){
  if(!fieldName)return true;
  if(section==='feed')return (data.feeds||[]).some(x=>x.field===fieldName);
  if(section==='meds')return (data.meds||[]).some(x=>x.field===fieldName);
  if(section==='weights')return (data.weights||[]).some(x=>x.field===fieldName);
  if(section==='mort')return (data.morts||[]).some(x=>(data.batches.find(b=>b.id===x.batchId)||{}).field===fieldName);
  if(section==='market')return (data.markets||[]).some(x=>(data.batches.find(b=>b.id===x.batchId)||{}).field===fieldName);
  if(section==='charts')return true;
  return true;
}

function openSmartSection(section,fieldName=''){
  if(fieldName&&!smartSectionHasData(section,fieldName)){
    let names={feed:'العلف',meds:'الأدوية واللقاحات',weights:'الأوزان',market:'التسويق',mort:'الهلاك',charts:'المخطط البياني'};
    msg(t('noData')+' '+(names[section]||'')+' لهذا الحقل');
    return;
  }
  if(section==='charts'){
    show('charts',null);
    setTimeout(()=>renderChartsPage(fieldName),0);
    return;
  }
  show(section,null);
  setTimeout(()=>{
    if(fieldName){
      let fieldSelect={feed:'feedField',meds:'medField',weights:'wField'}[section];
      if(fieldSelect&&$(fieldSelect)&&[...$(fieldSelect).options].some(o=>o.value===fieldName)){
        $(fieldSelect).value=fieldName;
        if(section==='feed')onFeedFieldChange();
        if(section==='meds')onMedFieldChange();
        if(section==='weights')onWeightFieldChange();
      }
    }
    if(section==='feed')renderFeed();
    if(section==='meds')renderMeds();
    if(section==='weights')renderWeights();
    if(section==='market')renderMarket();
    if(section==='mort')renderMort();
    let tableId={feed:'feedTable',meds:'medTable',weights:'weightsTable',market:'marketTable',mort:'mortTable'}[section];
    if(fieldName&&$(tableId)){
      let row=[...$(tableId).querySelectorAll('tbody tr.selectable')].find(r=>r.textContent.includes(fieldName));
      if(row){row.click();row.scrollIntoView({behavior:'smooth',block:'center'});}
    }
  },0);
}

function renderCompare(){
  // populate field filter
  let fSel=$('cmpField');
  if(fSel){
    let fields=data.fields.filter(f=>canSeeField(f.name));
    fSel.innerHTML='<option value="all">كل الحقول</option>'+fields.map(f=>`<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
  }
  let typeF=$('cmpType')&&$('cmpType').value||'all';
  let fieldF=$('cmpField')&&$('cmpField').value||'all';
  let statusF=$('cmpStatus')&&$('cmpStatus').value||'all';
  let sortF=$('cmpSort')&&$('cmpSort').value||'success';

  let batches=visibleBatches().filter(b=>{
    if(typeF!=='all'&&b.type!==typeF)return false;
    if(fieldF!=='all'&&b.field!==fieldF)return false;
    let c=calc(b);
    if(statusF==='active'&&c.completed)return false;
    if(statusF==='done'&&!c.completed)return false;
    return true;
  });

  // sort
  batches.sort((a,b)=>{
    let ca=calc(a),cb=calc(b);
    let lwa=latestWeightForBatch(a.id),lwb=latestWeightForBatch(b.id);
    if(sortF==='success')return +successRate(b)- +successRate(a);
    if(sortF==='alive')return cb.alive-ca.alive;
    if(sortF==='mort')return ca.mort-cb.mort;
    if(sortF==='weight')return (weightActualGrams(lwb)||0)-(weightActualGrams(lwa)||0);
    if(sortF==='hatch')return +hatchRate(b)- +hatchRate(a);
    if(sortF==='date')return String(b.hatchDate).localeCompare(String(a.hatchDate));
    return 0;
  });

  // summary chips
  let sumEl=$('cmpSummary');
  if(sumEl&&batches.length){
    let avgSuccess=Math.round(batches.reduce((s,b)=>s+(+successRate(b)),0)/batches.length);
    let avgHatch=Math.round(batches.reduce((s,b)=>s+(+hatchRate(b)),0)/batches.length);
    let totalAlive=batches.reduce((s,b)=>s+calc(b).alive,0);
    let totalMort=batches.reduce((s,b)=>s+calc(b).mort,0);
    let bestB=batches.reduce((best,b)=>+successRate(b)>+successRate(best)?b:best,batches[0]);
    let chips=[
      {l:'عدد الوجبات',v:batches.length,c:'#2563eb',bg:'#eff6ff'},
      {l:'متوسط النجاح',v:avgSuccess+'%',c:avgSuccess>=90?'#16a34a':'#d97706',bg:'#f0fdf4'},
      {l:'متوسط الفقس',v:avgHatch+'%',c:'#0891b2',bg:'#ecfeff'},
      {l:'إجمالي الحي',v:totalAlive.toLocaleString(),c:'#16a34a',bg:'#f0fdf4'},
      {l:'إجمالي الهلاك',v:totalMort.toLocaleString(),c:'#dc2626',bg:'#fef2f2'},
      {l:'أفضل وجبة',v:bestB.name,c:'#7c3aed',bg:'#f5f3ff'},
    ];
    sumEl.innerHTML=chips.map(x=>`<div class="statCard" style="background:${x.bg};border:none;padding:12px 14px"><div style="font-size:10px;color:var(--ink3);margin-bottom:3px">${x.l}</div><div style="font-size:16px;font-weight:800;color:${x.c}">${x.v}</div></div>`).join('');
  }else if(sumEl){sumEl.innerHTML='';}

  // table
  let tEl=$('cmpTable');
  if(!tEl)return;
  if(!batches.length){
    tEl.innerHTML='<tbody><tr><td colspan="14" style="text-align:center;padding:20px;color:var(--ink3)">لا توجد وجبات تطابق الفلاتر</td></tr></tbody>';
    return;
  }
  let rows=batches.map((b,i)=>{
    let c=calc(b);
    let lw=latestWeightForBatch(b.id);
    let actualG=lw?weightActualGrams(lw):0;
    let guideG=lw?weightGuideGrams(lw):0;
    let wDiff=actualG&&guideG?((actualG/guideG-1)*100).toFixed(1):null;
    let wCol=wDiff!=null?(+wDiff>=0?'#16a34a':'#dc2626'):'#64748b';
    let sr=+successRate(b);
    let srCol=sr>=90?'#16a34a':sr>=80?'#d97706':'#dc2626';
    let rank=i+1;
    let rankStyle=rank===1?'background:#fbbf24;color:#fff':rank===2?'background:#94a3b8;color:#fff':rank===3?'background:#b45309;color:#fff':'background:var(--bg);color:var(--ink3)';
    return `<tr class="selectable" onclick="selectBatch(${b.id});show('dash',document.querySelectorAll('.nav')[0])">
      <td style="text-align:center"><span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:11px;font-weight:800;${rankStyle}">${rank}</span></td>
      <td><b>${esc(b.name)}</b><div style="font-size:10px;color:var(--ink3)">${fmt(b.hatchDate)}</div></td>
      <td>${esc(b.type||'—')}</td>
      <td>${esc(b.field||'—')}</td>
      <td>${esc(b.supervisor||'—')}</td>
      <td>${esc(b.vet||'—')}</td>
      <td>${c.transferred?(c.isLayer?fmtLayerAge(c.flockAge):'يوم '+c.flockAge):'مفقس'}</td>
      <td>${hatchRate(b)}%</td>
      <td>${c.fieldBirds?(+c.fieldBirds).toLocaleString():'—'}</td>
      <td style="color:#dc2626">${c.mort.toLocaleString()}</td>
      <td style="color:#16a34a;font-weight:700">${c.alive.toLocaleString()}</td>
      <td style="color:${wCol};font-weight:700">${actualG?actualG+'غم':'—'}${wDiff!=null?` <span style="font-size:10px">(${+wDiff>0?'+':''}${wDiff}%)</span>`:''}</td>
      <td style="color:${srCol};font-weight:800">${sr}%</td>
      <td>${c.completed?'<span style="color:#64748b">منتهية</span>':'<span style="color:#16a34a">نشطة</span>'}</td>
    </tr>`;
  }).join('');
  tEl.innerHTML=`<thead><tr>
    <th>#</th><th>الوجبة</th><th>النوع</th><th>الحقل</th><th>المشرف</th><th>الدكتور البيطري</th>
    <th>العمر</th><th>نسبة الفقس</th><th>المنقول</th><th>الهلاك</th><th>الحي</th>
    <th>الوزن/الكايد</th><th>النجاح%</th><th>الحالة</th>
  </tr></thead><tbody>${rows}</tbody>`;
}

function batchWeightSuccessRates(b){
  if(!b)return{guide:null,math:null};
  // avgRatio بنفس أولوية renderWeights
  let day0Guide=Math.round(expectedWeightForBatch(b,0)*1000);
  let ratio=1;
  if(b.transferBirdWeight&&b.transferBirdWeight>0&&day0Guide>0)ratio=b.transferBirdWeight/day0Guide;
  else if(b.eggWeight&&b.eggWeight>0&&day0Guide>0)ratio=(b.eggWeight*0.67)/day0Guide;
  else{
    let bw=(data.weights||[]).filter(w=>w.batchId===b.id&&weightActualGrams(w)>0&&weightGuideGrams(w)>0);
    if(bw.length)ratio=bw.reduce((s,w)=>s+weightActualGrams(w)/weightGuideGrams(w),0)/bw.length;
  }
  // آخر وزن لكل قاعة
  let hallIds=[...new Set((data.weights||[]).filter(w=>w.batchId===b.id).map(w=>w.hallId).filter(x=>x!=null))];
  if(!hallIds.length){
    // بدون تخصيص قاعات — آخر سجل عام
    let sorted=(data.weights||[]).filter(w=>w.batchId===b.id&&weightActualGrams(w)>0&&weightGuideGrams(w)>0).sort((a,z)=>String(z.date).localeCompare(String(a.date)));
    if(!sorted.length)return{guide:null,math:null};
    let lw=sorted[0];
    let aG=weightActualGrams(lw),gG=weightGuideGrams(lw),mp=Math.round(gG*ratio);
    return{guide:+(aG/gG*100).toFixed(1),math:mp?+(aG/mp*100).toFixed(1):null};
  }
  let guideVals=[],mathVals=[];
  hallIds.forEach(hId=>{
    let hw=(data.weights||[]).filter(w=>w.batchId===b.id&&+w.hallId===+hId&&weightActualGrams(w)>0&&weightGuideGrams(w)>0).sort((a,z)=>String(z.date).localeCompare(String(a.date)));
    if(!hw.length)return;
    let lw=hw[0],aG=weightActualGrams(lw),gG=weightGuideGrams(lw),mp=Math.round(gG*ratio);
    guideVals.push(aG/gG*100);
    if(mp)mathVals.push(aG/mp*100);
  });
  return{
    guide:guideVals.length?+(guideVals.reduce((s,v)=>s+v,0)/guideVals.length).toFixed(1):null,
    math:mathVals.length?+(mathVals.reduce((s,v)=>s+v,0)/mathVals.length).toFixed(1):null
  };
}
function renderStats(){
  let b=data.batches.find(x=>x.id===selectedBatchId);
  if(b&&!canSeeField(b.field))b=null;
  let cardsEl=$('statsCards');let detailEl=$('statsDetail');
  if(!cardsEl)return;

  if(b){
    let c=calc(b);
    let lw=latestWeightForBatch(b.id);
    let wsr=batchWeightSuccessRates(b);
    let guideColor=wsr.guide==null?'inherit':wsr.guide>=100?'#16a34a':'#dc2626';
    let mathColor=wsr.math==null?'inherit':wsr.math>=100?'#7c3aed':'#f59e0b';
    let stats=[
      {l:'عمر التفقيس',v:c.hatchAge+'/21',s:c.hatchLate?'⚠️ متأخرة':c.hatchComplete?'🔔 جاهزة':''},
      {l:'عمر الطير',v:c.transferred?(c.isLayer?fmtLayerAge(c.flockAge):c.flockAge+'/40'):'—',s:c.isLayer?'بياض':'بالحقل'},
      {l:'الصافي المنقول',v:(c.fieldBirds||0).toLocaleString(),s:'ثابت'},
      {l:'هلاك الحقل',v:c.mort.toLocaleString(),s:'متراكم'},
      {l:'المسوق',v:c.sold.toLocaleString(),s:'إجمالي'},
      {l:'الحي المتبقي',v:c.alive.toLocaleString(),s:'صافي'},
      {l:'نسبة النجاح (هلاك)',v:successRate(b)+'%',s:''},
      {l:'آخر وزن (الفعلي)',v:lw?(weightActualGrams(lw)+' غم'):'—',s:lw?('الكايد '+weightGuideGrams(lw)+' غم'):''},
      {l:'نجاح الوزن / كايد',v:wsr.guide!=null?`<span style="color:${guideColor};font-weight:800">${wsr.guide}%</span>`:'—',s:'متوسط القاعات'},
      {l:'نجاح الوزن / رياضي',v:wsr.math!=null?`<span style="color:${mathColor};font-weight:800">${wsr.math}%</span>`:'—',s:'بوزن الاستلام'},
    ];
    cardsEl.innerHTML=
      `<div class="heroBanner"><div><h2>${esc(b.name)}</h2><p>${esc(b.type||'وجبة')} — ${fmt(b.hatchDate)} — ${esc(b.field||'لم تُنقل')}</p></div></div>`+
      stats.map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div><div class="sc-sub">${x.s}</div></div>`).join('')+
      smartShortcutCards(b.field||'');
    if(detailEl)detailEl.innerHTML=selectedDetails(b);
    renderBatchHallsPanel(b);
    return;
  }

  let vis=visibleBatches();
  let activeB=vis.filter(b=>!calc(b).completed);
  let arch=vis.filter(b=>calc(b).completed);
  let active=activeB.length,inc=activeB.filter(b=>!calc(b).transferred).length,done=arch.length;
  let eggs=activeB.reduce((s,b)=>s+(+b.eggs||0),0);
  let alive=activeB.reduce((s,b)=>s+calc(b).alive,0);
  let mort=activeB.reduce((s,b)=>s+calc(b).mort,0);
  let field=activeB.reduce((s,b)=>s+(calc(b).fieldBirds||0),0);
  let isoBatches=vis.filter(b=>b.transferDate&&b.isolationRate!=null);
  let isoAvg=isoBatches.length?(isoBatches.reduce((s,b)=>s+(+b.isolationRate||0),0)/isoBatches.length):0;
  let stats=[{l:'الوجبات النشطة',v:active,s:'غير منتهية'},{l:'بالمفقس',v:inc,s:'لم تُنقل'},{l:'الأرشيف',v:done,s:'منتهية'},{l:'إجمالي البيض',v:eggs.toLocaleString(),s:''},{l:'الصافي المنقول',v:field.toLocaleString(),s:'للحقول'},{l:'هلاك الحقول',v:mort.toLocaleString(),s:'إجمالي'},{l:'الطير الحي',v:alive.toLocaleString(),s:'متبقي'},{l:'نسبة العزل الضوئي',v:isoAvg.toFixed(2)+'%',s:'متوسط الوجبات'}];
  let greeting=isAdmin()?'زهور الوطن — لوحة المعلومات':`مرحباً، ${currentUser.name}`;
  cardsEl.innerHTML=`<div class="heroBanner"><div><h2>${greeting}</h2><p>${isAdmin()?t('dashAdminDesc'):t('dashUserDesc')}</p></div></div>`+stats.map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div><div class="sc-sub">${x.s}</div></div>`).join('')+smartShortcutCards('');
  if(detailEl){
    detailEl.innerHTML='';
    if(selectedFieldName&&data.fields.some(f=>f.name===selectedFieldName)&&canSeeField(selectedFieldName)){
      showFieldDetails(selectedFieldName);
    }
  }
  if($('batchHallsPanel'))$('batchHallsPanel').innerHTML='';
}

function renderBatches(){
  let q=($('batchSearch')&&$('batchSearch').value||'').trim().toLowerCase();
  let batches=visibleBatches().filter(b=>!calc(b).completed);
  if(q){
    batches=batches.filter(b=>[
      b.name,b.field,b.hall,b.type,b.status,
      ...(Array.isArray(b.hallAllocations)?b.hallAllocations.map(a=>a.hall):[])
    ].some(x=>String(x||'').toLowerCase().includes(q)));
  }
  let rows=batches.map(b=>{
    let c=calc(b),sel=b.id===selectedBatchId?' selectedRow':'';
    let ageDisp=c.transferred?(c.isLayer?fmtLayerAge(c.flockAge):c.flockAge+'/40'):'—';
    let archiveBtn=isAdmin()&&c.transferred?`<button class="btn btn-sm" style="background:#6b7280;color:#fff" onclick="event.stopPropagation();forceArchiveBatch(${b.id})" title="تحويل الوجبة إلى منتهية وأرشفتها">📦 أرشفة</button>`:'';
    let editDel=isAdmin()?`<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();editBatch(${b.id})">تعديل</button> <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteBatch(${b.id})">حذف</button> ${archiveBtn}`:'—';
    return `<tr class="selectable${sel}" onclick="selectBatch(${b.id})"><td><b>${esc(b.name)}</b></td><td>${fmt(b.eggReceiveDate)||'—'}</td><td>${fmt(b.hatchDate)}</td><td>${esc(b.targetField||'—')}</td><td>${esc(b.type||'—')}</td><td>${statusBadge(b)}</td><td>${c.hatchAge}/21</td><td>${c.transferred?fmt(c.entryDate):'—'}</td><td>${esc(b.field||'—')}</td><td>${esc(b.hall||'—')}</td><td>${ageDisp}</td><td>${hatchRate(b)}%</td><td>${c.fieldBirds?(+c.fieldBirds).toLocaleString():'—'}</td><td>${c.mort.toLocaleString()}</td><td>${c.sold.toLocaleString()}</td><td><b>${c.alive.toLocaleString()}</b></td><td>${((latestWeightForBatch(b.id)||{}).avgWeight)||'—'}</td><td>${successRate(b)}%</td><td>${editDel}</td></tr>`;
  }).join('');
  $('batchTable').innerHTML=`<thead><tr><th>${t('thBatch')}</th><th>${t('thEggReceive')}</th><th>${t('thEntryDate')}</th><th>${t('thTargetField')}</th><th>${t('thType')}</th><th>${t('thStatus')}</th><th>${t('thHatching')}</th><th>${t('thEntryDate')}</th><th>${t('thField')}</th><th>${t('thHall')}</th><th>${t('thAge')}</th><th>${t('thHatchRate')}</th><th>${t('thNet')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thAlive')}</th><th>${t('thLastWeight')}</th><th>${t('thSuccess')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows||'<tr><td colspan="19" style="text-align:center;color:var(--ink3);padding:18px">لا توجد وجبات نشطة</td></tr>'}</tbody>`;
}
