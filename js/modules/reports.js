// ── REPORTS ──
// ── NEW BATCH-CENTRIC REPORT SYSTEM ──
let _rptSec='all';

function setRptSection(s){
  _rptSec=s;
  document.querySelectorAll('.rptTab').forEach(t=>t.classList.toggle('act',t.dataset.sec===s));
  renderBatchReport();
}

function onRptBatchChange(){
  // تحديث قائمة القاعات بعد اختيار الوجبة
  let batchId=$('rptBatch')&&$('rptBatch').value?+$('rptBatch').value:0;
  let hallSel=$('rptHall');
  if(hallSel){
    let b=batchId?data.batches.find(x=>x.id===batchId):null;
    let hallIds=b?batchHallIds(b):[];
    let halls=hallIds.map(id=>(data.halls||[]).find(h=>h.id===id)).filter(Boolean);
    hallSel.innerHTML='<option value="">كل القاعات</option>'+
      halls.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  }
  renderBatchReport();
}

function renderBatchReport(){
  // تحديث قائمة الوجبات
  let sel=$('rptBatch');
  if(sel){
    let prev=sel.value;
    let batches=isAdmin()?data.batches:visibleBatches();
    sel.innerHTML='<option value="">-- اختر وجبة --</option>'+
      batches.map(b=>{
        let c=calc(b);
        let st=c.completed?'منتهية':c.transferred?'في الحقل':'بالمفقس';
        return`<option value="${b.id}">${esc(b.name)} — ${esc(b.field||'—')} (${st})</option>`;
      }).join('');
    if(prev)sel.value=prev;
  }
  let area=$('batchReportArea');if(!area)return;
  let batchId=sel&&sel.value?+sel.value:0;
  let hallFilter=$('rptHall')&&$('rptHall').value?+$('rptHall').value:0;
  let from=$('rptFrom')?$('rptFrom').value:'';
  let to=$('rptTo')?$('rptTo').value:'';
  let inRange=d=>(!from||d>=from)&&(!to||d<=to);

  if(!batchId){
    area.innerHTML=`<div class="card" style="text-align:center;padding:60px 20px">
      <span class="material-symbols-outlined" style="font-size:60px;color:var(--ink3);display:block;margin-bottom:12px">description</span>
      <div style="font-size:18px;font-weight:700;margin-bottom:6px;color:var(--ink)">اختر وجبة من القائمة أعلاه</div>
      <div style="font-size:13px;color:var(--ink3)">ستظهر هنا جميع تفاصيلها — المفقس، الأوزان، العلف، الأدوية، الهلاك، التسويق</div>
    </div>`;
    return;
  }
  let b=data.batches.find(x=>x.id===batchId);
  if(!b){area.innerHTML='';return;}
  let c=calc(b);
  let html=_rptKPIs(b,c);
  if(_rptSec==='all'||_rptSec==='hatch')   html+=_rptHatchHtml(b,c);
  if(_rptSec==='all'||_rptSec==='weights') html+=_rptWeightsHtml(b,inRange,hallFilter)+_rptMarketWeightsHtml(b,inRange,hallFilter);
  if(_rptSec==='all'||_rptSec==='feed')    html+=_rptFeedHtml(b,inRange,hallFilter);
  if(_rptSec==='all'||_rptSec==='meds')    html+=_rptMedsHtml(b,inRange,hallFilter);
  if(_rptSec==='all'||_rptSec==='mort')    html+=_rptMortHtml(b,c,inRange,hallFilter);
  if(_rptSec==='all'||_rptSec==='market')  html+=_rptMarketHtml(b,inRange,hallFilter);
  area.innerHTML=html;
}

function _rptKPIs(b,c){
  let eggs=+b.eggs||0,setEggs=(+b.setEggs||0)>0?+b.setEggs:Math.max(0,eggs-(+b.badEggs||0));
  let hatched=c.hatched||0,netHatch=c.netHatch||0;
  let hRate=setEggs>0?((hatched/setEggs)*100).toFixed(1)+'%':'—';
  let nRate=setEggs>0?((netHatch/setEggs)*100).toFixed(1)+'%':'—';
  let sr=+successRate(b);
  let srCol=sr>=90?'#16a34a':sr>=80?'#d97706':'#dc2626';
  let st=c.completed?'منتهية':c.transferred?'في الحقل':'بالمفقس';
  let stCol=c.completed?'#64748b':c.transferred?'#16a34a':'#2563eb';
  let hallLabel=Array.isArray(b.hallAllocations)&&b.hallAllocations.length
    ?b.hallAllocations.map(a=>esc(a.hall)).join(' / ')
    :esc(b.hall||'—');
  return`<div class="card" style="margin-bottom:12px;border-top:3px solid var(--p)">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="font-size:20px;font-weight:800">${esc(b.name)}</div>
        <div style="font-size:12px;color:var(--ink3);margin-top:2px">${esc(b.type||'—')} · ${esc(b.field||'—')} · ${hallLabel}${b.supervisor?' · '+esc(b.supervisor):''}${b.vet?' · د.'+esc(b.vet):''}${b.supplier?' · مورد: '+esc(b.supplier):''}${b.company?' · شركة: '+esc(b.company):''}</div>
      </div>
      <span style="margin-right:auto;background:${stCol}18;color:${stCol};border-radius:8px;padding:4px 14px;font-weight:700;font-size:13px">${st}</span>
    </div>
    <div class="statsGrid">
      <div class="statCard" style="border-right:4px solid #7c3aed"><div class="statVal" style="color:#7c3aed">${hRate}</div><div class="statLbl">نسبة الفقس</div></div>
      <div class="statCard" style="border-right:4px solid #7c3aed"><div class="statVal" style="color:#7c3aed">${nRate}</div><div class="statLbl">نسبة الصافي</div></div>
      <div class="statCard" style="border-right:4px solid #7c3aed"><div class="statVal">${netHatch.toLocaleString()}</div><div class="statLbl">الصافي للنقل</div></div>
      <div class="statCard" style="border-right:4px solid #0891b2"><div class="statVal">${(c.fieldBirds||0).toLocaleString()}</div><div class="statLbl">في الحقل</div></div>
      <div class="statCard" style="border-right:4px solid #16a34a"><div class="statVal" style="color:#16a34a">${c.alive.toLocaleString()}</div><div class="statLbl">الحي الآن</div></div>
      <div class="statCard" style="border-right:4px solid #dc2626"><div class="statVal" style="color:#dc2626">${c.mort.toLocaleString()}</div><div class="statLbl">الهلاك</div></div>
      <div class="statCard" style="border-right:4px solid #d97706"><div class="statVal" style="color:#d97706">${c.sold.toLocaleString()}</div><div class="statLbl">المسوق</div></div>
      <div class="statCard" style="border-right:4px solid ${srCol}"><div class="statVal" style="color:${srCol}">${sr}%</div><div class="statLbl">نسبة النجاح</div></div>
    </div>
  </div>`;
}

function _rptHatchHtml(b,c){
  let eggs=+b.eggs||0,badEggs=+b.badEggs||0;
  let setEggs=(+b.setEggs||0)>0?+b.setEggs:Math.max(0,eggs-badEggs);
  let hatched=c.hatched||0,netHatch=c.netHatch||0,hatchLoss=c.hatchLoss||0;
  let vd=+b.vaccineDeaths||0,iso=+b.isolatedBirds||0,unfit=+b.unfitBirds||0;
  let hRate=setEggs>0?((hatched/setEggs)*100).toFixed(2)+'%':'—';
  let nRate=setEggs>0?((netHatch/setEggs)*100).toFixed(2)+'%':'—';
  let hallLabel=Array.isArray(b.hallAllocations)&&b.hallAllocations.length
    ?b.hallAllocations.map(a=>`<span class="badge b-teal">${esc(a.hall)}</span> <span style="font-size:11px;color:var(--ink3)">${(+a.birds||0).toLocaleString()} طير</span>`).join('  ')
    :(b.hall?`<span class="badge b-teal">${esc(b.hall)}</span>`:'—');
  let cell=(lbl,val,col='')=>`<div class="hatchCell"><div class="hc-lbl">${lbl}</div><div class="hc-val" style="color:${col||'var(--ink)'}">${val}</div></div>`;
  return`<div class="card" style="margin-bottom:12px">
    <div class="secHdr" style="color:#7c3aed"><span class="material-symbols-outlined">egg</span> بيانات المفقس</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;font-size:13px">
      <div><span style="color:var(--ink3)">تاريخ الفقس:</span> <b>${fmt(b.hatchDate)||'—'}</b></div>
      <div><span style="color:var(--ink3)">تاريخ النقل:</span> <b>${fmt(b.transferDate)||'—'}</b></div>
      <div><span style="color:var(--ink3)">الحقل:</span> <b>${esc(b.field||'—')}</b></div>
      <div><span style="color:var(--ink3)">القاعات:</span> ${hallLabel}</div>
      ${b.transferBirdWeight?`<div><span style="color:var(--ink3)">وزن الكتكوت:</span> <b>${b.transferBirdWeight} غم</b></div>`:''}
      ${b.supervisor?`<div><span style="color:var(--ink3)">المشرف:</span> <b>${esc(b.supervisor)}</b></div>`:''}
      ${b.vet?`<div><span style="color:var(--ink3)">الطبيب البيطري:</span> <b>${esc(b.vet)}</b></div>`:''}
      ${b.supplier?`<div><span style="color:var(--ink3)">المورد:</span> <b>${esc(b.supplier)}</b></div>`:''}
      ${b.company?`<div><span style="color:var(--ink3)">الشركة:</span> <b>${esc(b.company)}</b></div>`:''}
    </div>
    <div style="margin-bottom:6px;font-size:12px;font-weight:700;color:var(--ink3)">▸ البيض</div>
    <div class="hatchGrid" style="margin-bottom:14px">
      ${cell('إجمالي البيض',eggs.toLocaleString())}
      ${cell('البيض الفاسد',badEggs.toLocaleString(),'#dc2626')}
      ${cell('المخصص للفقس',setEggs.toLocaleString(),'#2563eb')}
      ${b.candleDate?cell('مكشوف بالشمع',(+b.candleBadEggs||0).toLocaleString(),'#d97706'):''}
    </div>
    <div style="margin-bottom:6px;font-size:12px;font-weight:700;color:var(--ink3)">▸ نتيجة الفقس</div>
    <div class="hatchGrid" style="margin-bottom:14px">
      ${cell('المفقوس',hatched.toLocaleString(),'#0891b2')}
      ${cell('نسبة الفقس',hRate,'#7c3aed')}
      ${cell('هلاك اللقاح',vd.toLocaleString(),'#dc2626')}
      ${cell('معزولة',iso.toLocaleString(),'#d97706')}
      ${cell('غير صالحة',unfit.toLocaleString(),'#d97706')}
      ${cell('إجمالي الخسائر',hatchLoss.toLocaleString(),'#dc2626')}
    </div>
    <div style="margin-bottom:6px;font-size:12px;font-weight:700;color:var(--ink3)">▸ الصافي للنقل</div>
    <div class="hatchGrid">
      ${cell('الصافي للنقل',netHatch.toLocaleString(),'#16a34a')}
      ${cell('نسبة الصافي',nRate,'#16a34a')}
      ${b.transferBirdWeight?cell('وزن الكتكوت',b.transferBirdWeight+' غم','#0891b2'):''}
    </div>
  </div>`;
}

function _rptWeightsHtml(b,inRange,hallFilter=0){
  let hallIds=batchHallIds(b);
  let inH=x=>(hallFilter?+x.hallId===hallFilter:(hallIds.length?hallIds.includes(+x.hallId):x.field===b.field));
  let recs=(data.weights||[]).filter(x=>(x.batchId===b.id||(x.field===b.field&&inH(x)))&&inRange(x.date))
    .sort((a,z)=>String(a.date).localeCompare(String(z.date)));
  let actuals=recs.map(x=>+(x.actual_weight_grams||x.avgWeight||0)).filter(v=>v>0);
  let guides=recs.map(x=>+(x.guideWeightGrams||0)).filter(v=>v>0);
  let avgA=actuals.length?Math.round(actuals.reduce((s,v)=>s+v,0)/actuals.length):0;
  let avgG=guides.length?Math.round(guides.reduce((s,v)=>s+v,0)/guides.length):0;
  let avgR=avgA&&avgG?((avgA/avgG)*100).toFixed(1):null;
  let avgRCol=avgR?(+avgR>=100?'#16a34a':+avgR>=90?'#d97706':'#dc2626'):'';
  let rows=recs.map(x=>{
    let actual=+(x.actual_weight_grams||x.avgWeight||0),guide=+(x.guideWeightGrams||0);
    let diff=actual&&guide?actual-guide:null,dCol=diff!=null?(diff>=0?'#16a34a':'#dc2626'):'';
    let pct=guide?((actual/guide)*100).toFixed(1):null;
    let pCol=pct?(+pct>=100?'#16a34a':+pct>=90?'#d97706':'#dc2626'):'';
    return`<tr>
      <td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td>
      <td style="text-align:center">${x.ageDays!=null?x.ageDays+' يوم':'—'}</td>
      <td style="font-weight:700;color:#2563eb;text-align:center">${actual?actual.toLocaleString()+' غم':'—'}</td>
      <td style="color:var(--ink3);text-align:center">${guide?guide.toLocaleString()+' غم':'—'}</td>
      <td style="color:${dCol};font-weight:700;text-align:center">${diff!=null?(diff>0?'+':'')+diff.toLocaleString()+' غم':'—'}</td>
      <td style="color:${pCol};font-weight:700;text-align:center">${pct!=null?pct+'%':'—'}</td>
      <td style="text-align:center">${(+x.alive||0).toLocaleString()||'—'}</td>
      <td>${esc(x.note||'—')}</td>
    </tr>`;
  }).join('');
  return`<div class="card" style="margin-bottom:12px">
    <div class="secHdr" style="color:#2563eb"><span class="material-symbols-outlined">scale</span> سجلات الأوزان</div>
    <div class="statsGrid" style="margin-bottom:12px">
      <div class="statCard"><div class="statVal">${recs.length}</div><div class="statLbl">عدد السجلات</div></div>
      <div class="statCard"><div class="statVal" style="color:#2563eb">${avgA?avgA.toLocaleString()+' غم':'—'}</div><div class="statLbl">متوسط الوزن الفعلي</div></div>
      <div class="statCard"><div class="statVal" style="color:var(--ink3)">${avgG?avgG.toLocaleString()+' غم':'—'}</div><div class="statLbl">متوسط الكايد</div></div>
      <div class="statCard"><div class="statVal" style="color:${avgRCol}">${avgR?avgR+'%':'—'}</div><div class="statLbl">متوسط التحقق</div></div>
    </div>
    <div class="tableWrap"><table class="tbl">
      <thead><tr><th>التاريخ</th><th>القاعة</th><th>العمر</th><th>الوزن الفعلي</th><th>الكايد</th><th>الفرق</th><th>نسبة التحقق</th><th>الحي</th><th>ملاحظة</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="9" style="text-align:center;color:var(--ink3);padding:14px">لا توجد سجلات أوزان</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function _rptMarketWeightsHtml(b,inRange,hallFilter=0){
  let recs=(data.marketWeights||[]).filter(x=>{
    if(+x.batchId!==b.id)return false;
    if(hallFilter&&+x.hallId!==hallFilter)return false;
    return true;
  }).sort((a,z)=>String(a.date).localeCompare(String(z.date)));
  if(!recs.length)return'';
  let totalBirds=recs.reduce((s,x)=>s+(+x.count||0),0);
  let totalKg=recs.reduce((s,x)=>s+(+x.totalKg||0),0);
  let avgKg=totalBirds?(totalKg/totalBirds).toFixed(3):0;
  let rows=recs.map(x=>`<tr>
    <td>${fmt(x.date)}</td>
    <td>${esc(x.hall||'—')}</td>
    <td style="text-align:center">${x.age!=null?x.age+' يوم':'—'}</td>
    <td style="font-weight:700;text-align:center">${(+x.count||0).toLocaleString()}</td>
    <td style="font-weight:700;color:#dc2626;text-align:center">${(+x.totalKg||0).toLocaleString()} كغ</td>
    <td style="font-weight:700;color:#7c3aed;text-align:center">${x.avgKg} كغ/طير</td>
    <td>${esc(x.note||'—')}</td>
  </tr>`).join('');
  return`<div class="card" style="margin-bottom:12px;border-top:3px solid #dc2626">
    <div class="secHdr" style="color:#dc2626"><span class="material-symbols-outlined">storefront</span> الأوزان المسوقة (وزن المجزرة)</div>
    <div class="statsGrid" style="margin-bottom:12px">
      <div class="statCard"><div class="statVal">${recs.length}</div><div class="statLbl">عدد السجلات</div></div>
      <div class="statCard"><div class="statVal" style="color:#1d4ed8">${totalBirds.toLocaleString()}</div><div class="statLbl">إجمالي الطيور المسوقة</div></div>
      <div class="statCard"><div class="statVal" style="color:#dc2626">${totalKg.toLocaleString()} كغ</div><div class="statLbl">الوزن الكلي</div></div>
      <div class="statCard"><div class="statVal" style="color:#7c3aed">${avgKg} كغ/طير</div><div class="statLbl">معدل الوزن</div></div>
    </div>
    <div class="tableWrap"><table class="tbl">
      <thead><tr><th>التاريخ</th><th>القاعة</th><th>العمر</th><th>العدد</th><th>الوزن الكلي</th><th>معدل الوزن</th><th>ملاحظة</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function _rptFeedHtml(b,inRange,hallFilter=0){
  let hallIds=batchHallIds(b);
  let inH=x=>(hallFilter?+x.hallId===hallFilter:(hallIds.length?hallIds.includes(+x.hallId):x.field===b.field));
  let recs=(data.feeds||[]).filter(x=>x.field===b.field&&inH(x)&&inRange(x.date))
    .sort((a,z)=>String(a.date).localeCompare(String(z.date)));
  let total=recs.reduce((s,x)=>s+(+x.qty||0),0);
  let byType={};recs.forEach(x=>{byType[x.feedType||'غير محدد']=(byType[x.feedType||'غير محدد']||0)+(+x.qty||0);});
  let rows=recs.map(x=>`<tr>
    <td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td>
    <td>${esc(x.feedType||'—')}</td>
    <td style="font-weight:700;color:#ca8a04;text-align:center">${(+x.qty||0).toLocaleString()} كغم</td>
    <td>${esc(x.note||'—')}</td>
  </tr>`).join('');
  let typeCards=Object.entries(byType).map(([t,q])=>
    `<div class="statCard"><div class="statVal" style="color:#ca8a04">${q.toLocaleString()}<span style="font-size:12px"> كغم</span></div><div class="statLbl">${t}</div></div>`
  ).join('');
  return`<div class="card" style="margin-bottom:12px">
    <div class="secHdr" style="color:#ca8a04"><span class="material-symbols-outlined">grass</span> سجلات العلف</div>
    <div class="statsGrid" style="margin-bottom:12px">
      <div class="statCard"><div class="statVal">${recs.length}</div><div class="statLbl">عدد السجلات</div></div>
      <div class="statCard"><div class="statVal" style="color:#ca8a04">${total.toLocaleString()} كغم</div><div class="statLbl">الإجمالي</div></div>
      ${typeCards}
    </div>
    <div class="tableWrap"><table class="tbl">
      <thead><tr><th>التاريخ</th><th>القاعة</th><th>النوع</th><th>الكمية</th><th>ملاحظة</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" style="text-align:center;color:var(--ink3);padding:14px">لا توجد سجلات علف</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function _rptMedsHtml(b,inRange,hallFilter=0){
  let hallIds=batchHallIds(b);
  let inH=x=>(hallFilter?+x.hallId===hallFilter:(hallIds.length?hallIds.includes(+x.hallId):x.field===b.field));
  let recs=(data.meds||[]).filter(x=>x.field===b.field&&inH(x)&&inRange(x.date))
    .sort((a,z)=>String(a.date).localeCompare(String(z.date)));
  let byType={};recs.forEach(x=>{byType[x.type||'—']=(byType[x.type||'—']||0)+1;});
  let rows=recs.map(x=>{
    let badgeCls=x.type==='لقاح'?'b-violet':x.type==='دواء'?'b-red':x.type==='فيتامين'?'b-green':'b-gray';
    return`<tr>
      <td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td>
      <td><span class="badge ${badgeCls}">${esc(x.type||'—')}</span></td>
      <td><b>${esc(x.name||'—')}</b></td>
      <td>${esc(x.dose||'—')}</td>
      <td style="text-align:center">${(+x.qty||0).toLocaleString()}</td>
      <td>${esc(x.note||'—')}</td>
    </tr>`;
  }).join('');
  let typeCards=Object.entries(byType).map(([t,n])=>
    `<div class="statCard"><div class="statVal" style="color:#7c3aed">${n}</div><div class="statLbl">${t}</div></div>`
  ).join('');
  return`<div class="card" style="margin-bottom:12px">
    <div class="secHdr" style="color:#7c3aed"><span class="material-symbols-outlined">vaccines</span> سجلات الأدوية واللقاحات</div>
    <div class="statsGrid" style="margin-bottom:12px">
      <div class="statCard"><div class="statVal">${recs.length}</div><div class="statLbl">إجمالي الجرعات</div></div>
      ${typeCards}
    </div>
    <div class="tableWrap"><table class="tbl">
      <thead><tr><th>التاريخ</th><th>القاعة</th><th>النوع</th><th>المادة</th><th>الجرعة</th><th>الكمية</th><th>ملاحظة</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:var(--ink3);padding:14px">لا توجد سجلات أدوية</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function _rptMortHtml(b,c,inRange,hallFilter=0){
  let allRecs=(data.morts||[]).filter(x=>+x.batchId===b.id&&inRange(x.date));
  let recs=hallFilter?allRecs.filter(x=>+x.hallId===hallFilter):allRecs;
  recs=recs.sort((a,z)=>String(a.date).localeCompare(String(z.date)));
  let total=recs.reduce((s,x)=>s+(+x.count||0),0);
  let initBirds=c.fieldBirds||1;
  let phases={early:0,mid:0,late:0};
  let byReason={};let byHall={};
  recs.forEach(x=>{
    let cnt=+x.count||0;
    let age=x.ageDays!=null?+x.ageDays:(x.date&&b.fieldEntryDate?Math.round((new Date(x.date)-new Date(b.fieldEntryDate))/864e5):null);
    if(age!=null){if(age<=7)phases.early+=cnt;else if(age<=21)phases.mid+=cnt;else phases.late+=cnt;}
    if(x.reason)byReason[x.reason]=(byReason[x.reason]||0)+cnt;
    let hk=x.hall||'غير محدد';byHall[hk]=(byHall[hk]||0)+cnt;
  });
  let mortPct=initBirds?(total/initBirds*100).toFixed(2):0;
  let pCol=+mortPct>5?'#dc2626':+mortPct>3?'#d97706':'#16a34a';
  let rows=recs.map(x=>`<tr>
    <td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td>
    <td style="color:#dc2626;font-weight:700;text-align:center">${(+x.count||0).toLocaleString()}</td>
    <td>${esc(x.reason||'—')}</td>
    <td>${esc(x.note||'—')}</td>
  </tr>`).join('');
  let reasonCards=Object.entries(byReason).sort((a,z)=>z[1]-a[1]).slice(0,6).map(([r,n])=>
    `<div class="statCard"><div class="statVal" style="color:#dc2626">${n.toLocaleString()}</div><div class="statLbl">${r}</div></div>`
  ).join('');
  // عدد الطيور لكل قاعة من hallAllocations
  let hallBirdsMap={};
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length){
    b.hallAllocations.forEach(a=>{hallBirdsMap[a.hall||'']=(+a.birds||0);});
  }
  let hallCards=Object.entries(byHall).map(([h,n])=>{
    let hallBirds=hallBirdsMap[h]||initBirds;
    let pct=hallBirds?(n/hallBirds*100).toFixed(2):0;
    let hCol=+pct>5?'#dc2626':+pct>3?'#d97706':'#16a34a';
    return`<div class="statCard" style="border-right:3px solid ${hCol}">
      <div class="statVal" style="color:#dc2626">${n.toLocaleString()}</div>
      <div style="font-size:11px;color:${hCol};font-weight:700;margin-top:2px">${pct}%</div>
      <div class="statLbl">${h}${hallBirdsMap[h]?' ('+hallBirdsMap[h].toLocaleString()+' طير)':''}</div>
    </div>`;
  }).join('');
  return`<div class="card" style="margin-bottom:12px">
    <div class="secHdr" style="color:#dc2626"><span class="material-symbols-outlined">heart_minus</span> سجلات الهلاك${hallFilter?' — '+((data.halls||[]).find(h=>h.id===hallFilter)||{}).name:''}</div>
    <div class="statsGrid" style="margin-bottom:10px">
      <div class="statCard"><div class="statVal">${recs.length}</div><div class="statLbl">عدد السجلات</div></div>
      <div class="statCard"><div class="statVal" style="color:#dc2626">${total.toLocaleString()}</div><div class="statLbl">إجمالي الهلاك</div></div>
      <div class="statCard"><div class="statVal" style="color:${pCol}">${mortPct}%</div><div class="statLbl">نسبة الهلاك</div></div>
      <div class="statCard" style="border-right:3px solid #ef4444"><div class="statVal">${phases.early.toLocaleString()}</div><div class="statLbl">مبكر (0-7 يوم)</div></div>
      <div class="statCard" style="border-right:3px solid #f97316"><div class="statVal">${phases.mid.toLocaleString()}</div><div class="statLbl">متوسط (8-21 يوم)</div></div>
      <div class="statCard" style="border-right:3px solid #7c3aed"><div class="statVal">${phases.late.toLocaleString()}</div><div class="statLbl">متأخر (21+ يوم)</div></div>
    </div>
    ${hallCards&&!hallFilter?`<div style="font-size:11px;font-weight:700;color:var(--ink3);margin-bottom:6px">▸ الهلاك لكل قاعة</div><div class="statsGrid" style="margin-bottom:10px">${hallCards}</div>`:''}
    ${reasonCards?`<div style="font-size:11px;font-weight:700;color:var(--ink3);margin-bottom:6px">▸ أسباب الهلاك</div><div class="statsGrid" style="margin-bottom:10px">${reasonCards}</div>`:''}
    <div class="tableWrap"><table class="tbl">
      <thead><tr><th>التاريخ</th><th>القاعة</th><th>العدد</th><th>السبب</th><th>ملاحظة</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" style="text-align:center;color:var(--ink3);padding:14px">لا توجد سجلات هلاك</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function _rptMarketHtml(b,inRange,hallFilter=0){
  // كل عمليات التسويق — بدون فلتر تاريخ إذا ما في نطاق محدد
  let allRecs=(data.markets||[]).filter(x=>+x.batchId===b.id);
  let recs=hallFilter?allRecs.filter(x=>+x.hallId===hallFilter):allRecs;
  // فلتر التاريخ يطبق فقط إذا محدد
  let from=$('rptFrom')?$('rptFrom').value:'';
  let to=$('rptTo')?$('rptTo').value:'';
  if(from||to)recs=recs.filter(x=>inRange(x.date));
  recs=recs.sort((a,z)=>String(a.date).localeCompare(String(z.date)));
  let totalSold=recs.reduce((s,x)=>s+(+x.count||0),0);
  let byType={};let byHall={};
  recs.forEach(x=>{
    byType[x.status||'غير محدد']=(byType[x.status||'غير محدد']||0)+(+x.count||0);
    let hk=x.hall||'غير محدد';byHall[hk]=(byHall[hk]||0)+(+x.count||0);
  });
  let rows=recs.map(x=>`<tr>
    <td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td>
    <td style="font-weight:700;color:#d97706;text-align:center">${(+x.count||0).toLocaleString()}</td>
    <td>${esc(x.status||'—')}</td>
    <td>${esc(x.note||'—')}</td>
    ${x.diff?`<td style="color:#dc2626;font-size:11px">${x.diff.toLocaleString()}</td>`:'<td>—</td>'}
  </tr>`).join('');
  let typeCards=Object.entries(byType).map(([t,n])=>
    `<div class="statCard"><div class="statVal" style="color:#d97706">${n.toLocaleString()}</div><div class="statLbl">${t}</div></div>`
  ).join('');
  let hallCards=!hallFilter?Object.entries(byHall).map(([h,n])=>
    `<div class="statCard" style="border-right:3px solid #d97706"><div class="statVal" style="color:#d97706">${n.toLocaleString()}</div><div class="statLbl">${h}</div></div>`
  ).join(''):'';
  return`<div class="card" style="margin-bottom:12px">
    <div class="secHdr" style="color:#d97706"><span class="material-symbols-outlined">storefront</span> سجلات التسويق${hallFilter?' — '+((data.halls||[]).find(h=>h.id===hallFilter)||{}).name:''}</div>
    <div class="statsGrid" style="margin-bottom:10px">
      <div class="statCard"><div class="statVal">${recs.length}</div><div class="statLbl">عدد العمليات</div></div>
      <div class="statCard"><div class="statVal" style="color:#d97706">${totalSold.toLocaleString()}</div><div class="statLbl">إجمالي المسوق</div></div>
      ${typeCards}
    </div>
    ${hallCards?`<div style="font-size:11px;font-weight:700;color:var(--ink3);margin-bottom:6px">▸ التسويق لكل قاعة</div><div class="statsGrid" style="margin-bottom:10px">${hallCards}</div>`:''}
    <div class="tableWrap"><table class="tbl">
      <thead><tr><th>التاريخ</th><th>القاعة</th><th>العدد</th><th>النوع</th><th>ملاحظة</th><th>فرق</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--ink3);padding:14px">لا توجد سجلات تسويق</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function exportBatchPDF(){
  let area=$('batchReportArea');if(!area||!area.innerHTML.trim())return msg('⚠ اختر وجبة أولاً');
  let batchId=$('rptBatch')&&$('rptBatch').value?+$('rptBatch').value:0;
  let b=batchId?data.batches.find(x=>x.id===batchId):null;
  let title=b?b.name:'تقرير الوجبة';
  let win=window.open('','_blank');
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>${title}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap');
      *{box-sizing:border-box}body{font-family:'IBM Plex Sans Arabic',Tahoma,Arial;padding:20px;color:#0f172a;font-size:12px;background:#fff}
      h2{font-size:18px;font-weight:800;margin-bottom:4px}.meta{font-size:11px;color:#64748b;margin-bottom:16px}
      .card{border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px}
      .secHdr{display:flex;align-items:center;gap:6px;font-weight:700;font-size:14px;padding:0 0 8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px}
      .statsGrid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
      .statCard{border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;min-width:100px;text-align:center}
      .statVal{font-size:17px;font-weight:800;color:#0d9488}.statLbl{font-size:10px;color:#64748b;margin-top:2px}
      .hatchGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px}
      .hatchCell{background:#f8fafc;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0}
      .hc-lbl{font-size:10px;color:#64748b;margin-bottom:4px}.hc-val{font-size:17px;font-weight:800}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{background:#f8fafc;border:1px solid #e2e8f0;padding:6px 8px;font-weight:700;text-align:right}
      td{border:1px solid #e2e8f0;padding:6px 8px;text-align:right}
      tr:nth-child(even) td{background:#f8fafc}
      .badge{padding:2px 7px;border-radius:99px;font-size:10px;font-weight:600;display:inline-block;background:#f1f5f9;color:#334155}
      @media print{button{display:none!important}}
    </style></head><body>
    <h2>📋 ${title}</h2>
    <p class="meta">زهور الوطن — ${new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'})}</p>
    ${area.innerHTML}
    <div style="margin-top:20px;text-align:center">
      <button onclick="window.print()" style="padding:10px 28px;background:#0d9488;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit">🖨️ طباعة / حفظ PDF</button>
    </div></body></html>`);
  win.document.close();
}

function exportBatchExcel(){
  let area=$('batchReportArea');if(!area||!area.innerHTML.trim())return msg('⚠ اختر وجبة أولاً');
  let batchId=$('rptBatch')&&$('rptBatch').value?+$('rptBatch').value:0;
  let b=batchId?data.batches.find(x=>x.id===batchId):null;
  let tables=[...area.querySelectorAll('table.tbl')];
  if(!tables.length)return msg('⚠ لا توجد جداول للتصدير');
  let csv='﻿';
  tables.forEach(tbl=>{
    let hdr=[...tbl.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    let rows=[...tbl.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.textContent.trim()));
    csv+=[hdr,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\n')+'\n\n';
  });
  let a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download=`تقرير_${b?b.name:'وجبة'}_${today()}.csv`;
  a.click();
  msg('تم تصدير Excel');
}

// ── REPORTS ENGINE ──
function rptFilteredData(){
  let type=$('rptType')?$('rptType').value:'batches';
  let field=$('rptField')?$('rptField').value:'';
  let hallId=$('rptHall')&&$('rptHall').value?+$('rptHall').value:0;
  let batchId=$('rptBatch')&&$('rptBatch').value?+$('rptBatch').value:0;
  let status=$('rptStatus')?$('rptStatus').value:'';
  let search=($('rptSearch')&&$('rptSearch').value||'').trim().toLowerCase();
  let from=$('rptFrom')?$('rptFrom').value:'';
  let to=$('rptTo')?$('rptTo').value:'';
  let inRange=(d)=>(!from||d>=from)&&(!to||d<=to);
  let inField=(f)=>!field||f===field;
  let inHall=(id)=>!hallId||(+id||0)===hallId;
  let textMatch=(parts)=>!search||parts.some(x=>String(x||'').toLowerCase().includes(search));
  return{type,field,hallId,batchId,status,search,from,to,inRange,inField,inHall,textMatch};
}

function reportStatusOptions(type){
  if(type==='batches')return [
    ['active','نشطة'],['completed','منتهية'],['transferred','منقولة للحقل'],['hatch','بالمفقس']
  ];
  if(type==='meds')return [['لقاح','لقاح'],['دواء','دواء'],['فيتامين','فيتامين'],['تعقيم','تعقيم']];
  if(type==='feed')return [...new Set((data.feeds||[]).map(x=>x.feedType).filter(Boolean))].map(x=>[x,x]);
  if(type==='mort')return [...new Set((data.morts||[]).map(x=>x.reason).filter(Boolean))].map(x=>[x,x]);
  if(type==='weights')return [];
  return [];
}
function renderReportFilters(){
  if($('rptField')){
    let cur=$('rptField').value;
    $('rptField').innerHTML='<option value="">'+t('allFields')+'</option>'+data.fields.map(f=>`<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
    if(cur&&[...$('rptField').options].some(o=>o.value===cur))$('rptField').value=cur;
  }
  if($('rptHall'))fillReportHallFilter($('rptHall').value);
  if($('rptBatch')){
    let cur=$('rptBatch').value;
    let field=$('rptField')?$('rptField').value:'';
    let batches=(isAdmin()?data.batches:visibleBatches()).filter(b=>(!field||b.field===field));
    $('rptBatch').innerHTML='<option value="">'+t('allBatches')+'</option>'+batches.map(b=>`<option value="${b.id}">${esc(b.name)}${b.field?' — '+esc(b.field):''}</option>`).join('');
    if(cur&&[...$('rptBatch').options].some(o=>o.value===cur))$('rptBatch').value=cur;
  }
  if($('rptStatus')){
    let cur=$('rptStatus').value,type=$('rptType')?$('rptType').value:'batches';
    let opts=reportStatusOptions(type);
    $('rptStatus').innerHTML='<option value="">'+t('allItems')+'</option>'+opts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    if(cur&&[...$('rptStatus').options].some(o=>o.value===cur))$('rptStatus').value=cur;
  }
}
function fillReportHallFilter(keep=''){
  let field=$('rptField')?$('rptField').value:'';
  let halls=field?(fieldHallsByName(field)):(data.halls||[]);
  $('rptHall').innerHTML='<option value="">'+t('allHalls')+'</option>'+halls.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  if(keep&&[...$('rptHall').options].some(o=>o.value===keep))$('rptHall').value=keep;
}
function onReportFieldChange(){
  fillReportHallFilter('');
  if($('rptBatch'))$('rptBatch').value='';
  renderReports();
}
function clearReportFilters(){
  ['rptField','rptHall','rptBatch','rptStatus'].forEach(id=>{if($(id))$(id).value=''});
  ['rptSearch','rptFrom','rptTo'].forEach(id=>{if($(id))$(id).value=''});
  renderReports();
}

function renderReports(){
  renderBatchReport();
  renderReportFilters();

  let{type,field,hallId,batchId,status,inRange,inField,inHall,textMatch}=rptFilteredData();
  let el=$('reportTable');if(!el)return;
  let title=$('rptTitle');
  let summary=$('rptSummaryCards');

  if(type==='batches'){
    if(title)title.textContent='📋 تقرير الوجبات';
    let batches=(isAdmin()?data.batches:visibleBatches()).filter(b=>inField(b.field));
    if(batchId)batches=batches.filter(b=>b.id===batchId);
    if(hallId)batches=batches.filter(b=>batchHallIds(b).includes(hallId));
    if(status){
      batches=batches.filter(b=>{
        let c=calc(b);
        if(status==='active')return !c.completed;
        if(status==='completed')return c.completed;
        if(status==='transferred')return c.transferred&&!c.completed;
        if(status==='hatch')return !c.transferred;
        return true;
      });
    }
    batches=batches.filter(b=>textMatch([b.name,b.field,b.hall,b.type,b.status,...(Array.isArray(b.hallAllocations)?b.hallAllocations.map(a=>a.hall):[])]));
    let totalAlive=batches.reduce((s,b)=>s+calc(b).alive,0);
    let totalField=batches.reduce((s,b)=>s+(calc(b).fieldBirds||0),0);
    let totalMort=batches.reduce((s,b)=>s+calc(b).mort,0);
    let totalSold=batches.reduce((s,b)=>s+calc(b).sold,0);
    if(summary)summary.innerHTML=[
      {l:'إجمالي الوجبات',v:batches.length},{l:'الحي الكلي',v:totalAlive.toLocaleString()},
      {l:'هلاك كلي',v:totalMort.toLocaleString()},{l:'مسوق كلي',v:totalSold.toLocaleString()},
      {l:'الصافي المنقول',v:totalField.toLocaleString()},
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div></div>`).join('');
    let rows=batches.map(b=>{
      let c=calc(b);let lw=latestWeightForBatch(b.id);
      let allocs=Array.isArray(b.hallAllocations)&&b.hallAllocations.length?b.hallAllocations.map(a=>`${esc(a.hall)}:${(+a.birds||0).toLocaleString()}`).join(' / '):(esc(b.hall||'—'));
      return `<tr>
        <td><b>${esc(b.name)}</b></td><td>${esc(b.type||'—')}</td><td>${fmt(b.hatchDate)}</td>
        <td>${esc(b.field||'—')}</td><td>${allocs}</td>
        <td>${(+b.eggs||0).toLocaleString()}</td><td>${hatchRate(b)}%</td>
        <td>${(c.fieldBirds||0).toLocaleString()}</td><td>${c.mort.toLocaleString()}</td>
        <td>${c.sold.toLocaleString()}</td><td><b>${c.alive.toLocaleString()}</b></td>
        <td>${successRate(b)}%</td><td>${lw?lw.avgWeight+' كغ':'—'}</td><td>${statusBadge(b)}</td>
      </tr>`;
    }).join('');
    el.innerHTML=`<thead><tr><th>${t('thBatch')}</th><th>${t('thType')}</th><th>${t('thEntryDate')}</th><th>${t('thField')}</th><th>${t('thHalls')}</th><th>${t('thEggs')}</th><th>${t('thHatchRate')}</th><th>${t('thNet')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thAlive')}</th><th>${t('thSuccess')}</th><th>${t('thLastWeight')}</th><th>${t('thStatus')}</th></tr></thead><tbody>${rows}</tbody>`;

  }else if(type==='mort'){
    if(title)title.textContent='💔 تقرير الهلاك';
    // مورت ليس فيه field — نجيبه من الوجبة
    let batchMap={};(data.batches||[]).forEach(b=>{batchMap[b.id]=b;});
    let hallMap={};(data.halls||[]).forEach(h=>{hallMap[h.id]=h;});
    let morts=(data.morts||[]).filter(x=>{
      let b=batchMap[x.batchId];
      let bField=b?b.field:'';
      if(!inField(bField))return false;
      if(!inRange(x.date))return false;
      if(hallId&&+x.hallId!==hallId)return false;
      if(batchId&&x.batchId!==batchId)return false;
      return true;
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    if(status)morts=morts.filter(x=>x.reason===status);
    morts=morts.filter(x=>{
      let b=batchMap[x.batchId];
      return textMatch([b?b.name:'',b?b.field:'',x.hall,x.reason]);
    });
    let totalMort=morts.reduce((s,x)=>s+(+x.count||0),0);
    let byField={};morts.forEach(x=>{let f=batchMap[x.batchId]?batchMap[x.batchId].field:'—';byField[f]=(byField[f]||0)+(+x.count||0);});
    let byHall={};morts.forEach(x=>{let k=x.hall||'—';byHall[k]=(byHall[k]||0)+(+x.count||0);});
    if(summary)summary.innerHTML=[
      {l:'إجمالي الهلاك',v:totalMort.toLocaleString(),c:'#dc2626'},
      {l:'عدد السجلات',v:morts.length,c:'#64748b'},
      ...Object.entries(byField).map(([f,c])=>({l:'هلاك '+f,v:c.toLocaleString(),c:'#dc2626'})),
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val" style="color:${x.c||'var(--p)'}">${x.v}</div></div>`).join('');
    let rows=morts.map(x=>{
      let b=batchMap[x.batchId];
      let h=hallMap[x.hallId]||{};
      let f=data.fields.find(fi=>b&&fi.id===(data.halls.find(hh=>hh.id===+x.hallId)||{}).fieldId);
      return `<tr>
        <td>${fmt(x.date)}</td>
        <td>${b?esc(b.name):'—'}</td>
        <td>${b?esc(b.field):'—'}</td>
        <td>${esc(x.hall||h.name||'—')}</td>
        <td style="color:#dc2626;font-weight:700">${(+x.count||0).toLocaleString()}</td>
        <td>${esc(x.reason||'—')}</td>
      </tr>`;
    }).join('');
    el.innerHTML=`<thead><tr><th>التاريخ</th><th>الوجبة</th><th>الحقل</th><th>القاعة</th><th>عدد الهلاك</th><th>السبب</th></tr></thead><tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--ink3);padding:16px">لا توجد سجلات</td></tr>'}</tbody>`;

  }else if(type==='weights'){
    if(title)title.textContent='⚖️ تقرير الأوزان';
    let batchMap={};(data.batches||[]).forEach(b=>{batchMap[b.id]=b;});
    let wRecs=(data.weights||[]).filter(x=>{
      if(!inField(x.field))return false;
      if(!inRange(x.date))return false;
      if(hallId&&+x.hallId!==hallId)return false;
      if(batchId&&x.batchId!==batchId)return false;
      return true;
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    wRecs=wRecs.filter(x=>{
      let b=batchMap[x.batchId];
      return textMatch([b?b.name:'',x.field,x.hall,x.note]);
    });
    let actuals=wRecs.map(x=>+(x.actual_weight_grams||x.avgWeight||0)).filter(v=>v>0);
    let avgActual=actuals.length?Math.round(actuals.reduce((s,v)=>s+v,0)/actuals.length):0;
    let guides=wRecs.map(x=>+(x.guideWeightGrams||0)).filter(v=>v>0);
    let avgGuide=guides.length?Math.round(guides.reduce((s,v)=>s+v,0)/guides.length):0;
    if(summary)summary.innerHTML=[
      {l:'عدد السجلات',v:wRecs.length,c:'#64748b'},
      {l:'متوسط الوزن الفعلي',v:avgActual?avgActual+'غم':'—',c:'#2563eb'},
      {l:'متوسط الكايد',v:avgGuide?avgGuide+'غم':'—',c:'#64748b'},
      {l:'نسبة التحقق',v:avgActual&&avgGuide?((avgActual/avgGuide)*100).toFixed(1)+'%':'—',c:avgActual>=avgGuide?'#16a34a':'#dc2626'},
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val" style="color:${x.c}">${x.v}</div></div>`).join('');
    let rows=wRecs.map(x=>{
      let b=batchMap[x.batchId];
      let actual=+(x.actual_weight_grams||x.avgWeight||0);
      let guide=+(x.guideWeightGrams||0);
      let diff=actual&&guide?actual-guide:null;
      let diffCol=diff!=null?(diff>=0?'#16a34a':'#dc2626'):'#64748b';
      let pct=guide?((actual/guide)*100).toFixed(1):null;
      return `<tr>
        <td>${fmt(x.date)}</td>
        <td>${b?esc(b.name):'—'}</td>
        <td>${esc(x.field||'—')}</td>
        <td>${esc(x.hall||'—')}</td>
        <td>${x.ageDays!=null?x.ageDays+' يوم':'—'}</td>
        <td style="font-weight:700;color:#2563eb">${actual?actual+'غم':'—'}</td>
        <td style="color:#64748b">${guide?guide+'غم':'—'}</td>
        <td style="color:${diffCol};font-weight:700">${diff!=null?(diff>0?'+':'')+diff+'غم':'—'}</td>
        <td style="color:${diffCol}">${pct!=null?pct+'%':'—'}</td>
        <td>${(+x.alive||0).toLocaleString()}</td>
        <td>${esc(x.note||'—')}</td>
      </tr>`;
    }).join('');
    el.innerHTML=`<thead><tr><th>التاريخ</th><th>الوجبة</th><th>الحقل</th><th>القاعة</th><th>العمر</th><th>الوزن الفعلي</th><th>الكايد</th><th>الفرق</th><th>نسبة التحقق</th><th>الحي</th><th>ملاحظة</th></tr></thead><tbody>${rows||'<tr><td colspan="11" style="text-align:center;color:var(--ink3);padding:16px">لا توجد سجلات</td></tr>'}</tbody>`;

  }else if(type==='feed'){
    if(title)title.textContent='🌾 تقرير استهلاك العلف';
    let feeds=(data.feeds||[]).filter(x=>inField(x.field)&&inRange(x.date)).sort((a,b)=>b.date.localeCompare(a.date));
    if(hallId)feeds=feeds.filter(x=>+x.hallId===hallId);
    if(batchId){
      let rb=data.batches.find(b=>b.id===batchId),hids=batchHallIds(rb);
      feeds=feeds.filter(x=>rb&&x.field===rb.field&&(!hids.length||hids.includes(+x.hallId)));
    }
    if(status)feeds=feeds.filter(x=>x.feedType===status);
    feeds=feeds.filter(x=>textMatch([x.field,x.hall,x.feedType,x.note]));
    let totalQty=feeds.reduce((s,x)=>s+(+x.qty||0),0);
    let byField={};feeds.forEach(x=>{byField[x.field]=(byField[x.field]||0)+(+x.qty||0);});
    if(summary)summary.innerHTML=[
      {l:'إجمالي العلف (كغم)',v:totalQty.toLocaleString()},
      {l:'عدد السجلات',v:feeds.length},
      ...Object.entries(byField).map(([f,q])=>({l:'علف '+f,v:q.toLocaleString()+' كغم'})),
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div></div>`).join('');
    let rows=feeds.map(x=>`<tr>
      <td>${fmt(x.date)}</td><td>${esc(x.field)}</td><td>${esc(x.hall||'—')}</td>
      <td>${esc(x.feedType||'—')}</td><td><b>${(+x.qty||0).toLocaleString()} كغم</b></td><td>${esc(x.note||'—')}</td>
    </tr>`).join('');
    el.innerHTML=`<thead><tr><th>${t('thDate')}</th><th>${t('thField')}</th><th>${t('thHall')}</th><th>${t('thFeedType')}</th><th>${t('thQtyKg')}</th><th>${t('thNote')}</th></tr></thead><tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--ink3);padding:16px">لا توجد سجلات</td></tr>'}</tbody>`;

  }else if(type==='meds'){
    if(title)title.textContent='💉 تقرير الأدوية واللقاحات';
    let meds=(data.meds||[]).filter(x=>inField(x.field)&&inRange(x.date)).sort((a,b)=>b.date.localeCompare(a.date));
    if(hallId)meds=meds.filter(x=>+x.hallId===hallId);
    if(batchId){
      let rb=data.batches.find(b=>b.id===batchId),hids=batchHallIds(rb);
      meds=meds.filter(x=>rb&&x.field===rb.field&&(!hids.length||hids.includes(+x.hallId)));
    }
    if(status)meds=meds.filter(x=>x.type===status);
    meds=meds.filter(x=>textMatch([x.field,x.hall,x.type,x.name,x.dose,x.note]));
    let byType={};meds.forEach(x=>{byType[x.type]=(byType[x.type]||0)+1;});
    if(summary)summary.innerHTML=[
      {l:'إجمالي الجرعات',v:meds.length},
      ...Object.entries(byType).map(([t,c])=>({l:t,v:c+' جرعة'})),
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div></div>`).join('');
    let rows=meds.map(x=>`<tr>
      <td>${fmt(x.date)}</td><td>${esc(x.field)}</td><td>${esc(x.hall||'—')}</td>
      <td><span class="badge ${x.type==='لقاح'?'b-violet':x.type==='دواء'?'b-red':x.type==='فيتامين'?'b-green':'b-gray'}">${esc(x.type)}</span></td>
      <td><b>${esc(x.name)}</b></td><td>${esc(x.dose||'—')}</td>
      <td>${(+x.qty||0).toLocaleString()}</td><td>${esc(x.note||'—')}</td>
    </tr>`).join('');
    el.innerHTML=`<thead><tr><th>${t('thDate')}</th><th>${t('thField')}</th><th>${t('thHall')}</th><th>${t('thType')}</th><th>${t('thMaterial')}</th><th>${t('thDose')}</th><th>${t('thQty')}</th><th>${t('thNote')}</th></tr></thead><tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:var(--ink3);padding:16px">لا توجد سجلات</td></tr>'}</tbody>`;

  }else if(type==='supervisor'||type==='vet'){
    let isSup=type==='supervisor';
    if(title)title.textContent=isSup?'👷 تقرير المشرفين':'🩺 تقرير الأطباء البيطريين';
    let keyField=isSup?'supervisor':'vet';
    let allBatches=(isAdmin()?data.batches:visibleBatches()).filter(b=>{
      if(!inField(b.field))return false;
      if(batchId&&b.id!==batchId)return false;
      return true;
    });
    // تجميع حسب المشرف/الدكتور
    let groups={};
    allBatches.forEach(b=>{
      let key=b[keyField]||'غير محدد';
      if(!groups[key])groups[key]=[];
      groups[key].push(b);
    });
    // فلتر نصي على الاسم
    if(search){
      Object.keys(groups).forEach(k=>{if(!k.toLowerCase().includes(search))delete groups[k];});
    }
    // ملخص
    let names=Object.keys(groups);
    let totalBatches=allBatches.length;
    let avgSuccessAll=totalBatches?Math.round(allBatches.reduce((s,b)=>s+(+successRate(b)),0)/totalBatches):0;
    if(summary)summary.innerHTML=[
      {l:isSup?'عدد المشرفين':'عدد الأطباء',v:names.length},
      {l:'إجمالي الوجبات',v:totalBatches},
      {l:'متوسط النجاح الكلي',v:avgSuccessAll+'%'},
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div></div>`).join('');
    // صفوف الجدول — صف لكل شخص
    let rows=names.sort().map(name=>{
      let bs=groups[name];
      let active=bs.filter(b=>!calc(b).completed);
      let done=bs.filter(b=>calc(b).completed);
      let totalAlive=bs.reduce((s,b)=>s+calc(b).alive,0);
      let totalMort=bs.reduce((s,b)=>s+calc(b).mort,0);
      let totalSold=bs.reduce((s,b)=>s+calc(b).sold,0);
      let totalField=bs.reduce((s,b)=>s+(calc(b).fieldBirds||0),0);
      let avgSR=bs.length?Math.round(bs.reduce((s,b)=>s+(+successRate(b)),0)/bs.length):0;
      let avgHatch=bs.length?Math.round(bs.reduce((s,b)=>s+(+hatchRate(b)),0)/bs.length):0;
      let srCol=avgSR>=90?'#16a34a':avgSR>=80?'#d97706':'#dc2626';
      let fields=[...new Set(bs.map(b=>b.field).filter(Boolean))].map(esc).join(' / ')||'—';
      // تفاصيل الوجبات (accordion style - row per batch inside)
      let batchDetails=bs.map(b=>{
        let c=calc(b);
        let sr=+successRate(b);
        return `<tr style="background:#f8fafc;font-size:11px">
          <td style="padding:4px 8px;padding-right:28px;color:var(--ink3)" colspan="2">↳ ${esc(b.name)} (${esc(b.field||'—')})</td>
          <td style="padding:4px 8px;color:var(--ink3)">${fmt(b.hatchDate)}</td>
          <td style="padding:4px 8px"></td>
          <td style="padding:4px 8px;color:var(--ink3)">${(c.fieldBirds||0).toLocaleString()}</td>
          <td style="padding:4px 8px;color:#dc2626">${c.mort.toLocaleString()}</td>
          <td style="padding:4px 8px;color:#16a34a">${c.alive.toLocaleString()}</td>
          <td style="padding:4px 8px;color:#7c3aed">${c.sold.toLocaleString()}</td>
          <td style="padding:4px 8px"></td>
          <td style="padding:4px 8px;color:${sr>=90?'#16a34a':sr>=80?'#d97706':'#dc2626'};font-weight:700">${sr}%</td>
          <td style="padding:4px 8px">${statusBadge(b)}</td>
        </tr>`;
      }).join('');
      return `<tr style="border-top:2px solid var(--border);cursor:pointer" onclick="this.nextElementSibling&&(this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none')">
        <td><b style="font-size:14px">${esc(name)}</b></td>
        <td>${bs.length} وجبة</td>
        <td>${fields}</td>
        <td>${active.length} نشطة / ${done.length} منتهية</td>
        <td>${totalField.toLocaleString()}</td>
        <td style="color:#dc2626">${totalMort.toLocaleString()}</td>
        <td style="color:#16a34a;font-weight:700">${totalAlive.toLocaleString()}</td>
        <td style="color:#7c3aed">${totalSold.toLocaleString()}</td>
        <td>${avgHatch}%</td>
        <td style="color:${srCol};font-weight:800">${avgSR}%</td>
        <td><span style="font-size:10px;color:var(--ink3)">▼ تفاصيل</span></td>
      </tr>
      <tbody style="display:none">${batchDetails}</tbody>`;
    }).join('');
    let personLabel=isSup?'المشرف':'الدكتور البيطري';
    el.innerHTML=`<thead><tr>
      <th>${personLabel}</th><th>عدد الوجبات</th><th>الحقول</th><th>الحالة</th>
      <th>المنقول</th><th>الهلاك</th><th>الحي</th><th>المسوق</th>
      <th>متوسط الفقس%</th><th>متوسط النجاح%</th><th></th>
    </tr></thead><tbody>${rows||`<tr><td colspan="11" style="text-align:center;color:var(--ink3);padding:16px">لا توجد بيانات</td></tr>`}</tbody>`;

  }else if(type==='fields'){
    if(title)title.textContent='🏡 تقرير الحقول';
    let fields=data.fields.filter(f=>inField(f.name));
    if(batchId){
      let rb=data.batches.find(b=>b.id===batchId);
      fields=fields.filter(f=>rb&&f.name===rb.field);
    }
    fields=fields.filter(f=>textMatch([f.name,f.type]));
    let rows=fields.map(f=>{
      let ft=fieldTotals(f.name);
      let fToday=feedTotalField(f.name,today());
      let mToday=medsCountField(f.name,today());
      return `<tr>
        <td><b>${esc(f.name)}</b></td>
        <td><span class="badge ${f.type==='بياض'?'b-violet':f.type==='تربية'?'b-amber':'b-teal'}">${esc(f.type)}</span></td>
        <td>${ft.halls.length}</td>
        <td>${ft.allocated.toLocaleString()}</td>
        <td><b>${ft.alive.toLocaleString()}</b></td>
        <td>${ft.mort.toLocaleString()}</td>
        <td>${ft.sold.toLocaleString()}</td>
        <td>${fToday.toLocaleString()} كغم</td>
        <td>${ft.feedTotal.toLocaleString()} كغم</td>
        <td>${mToday}</td>
        <td>${ft.medsTotal}</td>
        <td>${ft.avgWeight?ft.avgWeight+' كغ':'—'}</td>
      </tr>`;
    }).join('');
    let totalFeed=fields.reduce((s,f)=>s+feedTotalField(f.name),0);
    let totalAlive=fields.reduce((s,f)=>s+fieldTotals(f.name).alive,0);
    if(summary)summary.innerHTML=[
      {l:'عدد الحقول',v:fields.length},{l:'الطير الحي الكلي',v:totalAlive.toLocaleString()},
      {l:'إجمالي العلف (كغم)',v:totalFeed.toLocaleString()},
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div></div>`).join('');
    el.innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thType')}</th><th>${t('thHalls')}</th><th>${t('thTotalBirds')}</th><th>${t('thAlive')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thFeedToday')}</th><th>${t('thTotalFeed')}</th><th>${t('thVaccToday')}</th><th>${t('thTotalVacc')}</th><th>${t('thLastWeight')}</th></tr></thead><tbody>${rows}</tbody>`;

  }else if(type==='halls'){
    if(title)title.textContent='🚪 تقرير القاعات';
    let halls=data.halls.filter(h=>{
      let f=data.fields.find(x=>x.id===h.fieldId);
      return !field||(f&&f.name===field);
    });
    if(hallId)halls=halls.filter(h=>h.id===hallId);
    if(batchId){
      let rb=data.batches.find(b=>b.id===batchId),hids=batchHallIds(rb);
      halls=halls.filter(h=>rb&&hids.includes(h.id));
    }
    halls=halls.filter(h=>{let f=data.fields.find(x=>x.id===h.fieldId);return textMatch([h.name,f?f.name:'']);});
    let rows=halls.map(h=>{
      let f=data.fields.find(x=>x.id===h.fieldId);
      let batches=visibleBatches().filter(x=>x.transferDate&&!calc(x).completed&&batchAllocatedToHall(x,h.id)>0);
      let allocated=batches.reduce((s,x)=>s+batchAllocatedToHall(x,h.id),0);
      let alive=batches.reduce((s,x)=>s+batchHallAlive(x,h.id),0);
      let mort=batches.reduce((s,x)=>s+batchHallMort(x,h.id),0);
      let sold=batches.reduce((s,x)=>s+batchHallSold(x,h.id),0);
      let cap=+h.capacity||0;
      let occ=cap?((allocated/cap)*100).toFixed(1)+'%':'—';
      let lm=lastMedHall(h.id);
      let lw=batches.map(x=>latestWeightForBatch(x.id)).filter(Boolean);
      let avgW=lw.length?+(lw.reduce((s,w)=>s+(+w.avgWeight||0),0)/lw.length).toFixed(2):'—';
      let fToday=feedTotalHall(h.id,today());
      let fTotal=feedTotalHall(h.id);
      let mToday=medsCountHall(h.id,today());
      return `<tr>
        <td>${f?esc(f.name):'—'}</td><td><b>${esc(h.name)}</b></td>
        <td>${cap?cap.toLocaleString():'—'}</td><td>${allocated.toLocaleString()}</td>
        <td><b>${alive.toLocaleString()}</b></td><td>${mort.toLocaleString()}</td>
        <td>${sold.toLocaleString()}</td><td>${occ}</td>
        <td>${fToday.toLocaleString()} كغم</td><td>${fTotal.toLocaleString()} كغم</td>
        <td>${mToday}</td>
        <td>${lm?`<span class="badge b-violet" style="font-size:10px">${esc(lm.name)}</span>`:'—'}</td>
        <td>${avgW==='—'?'—':avgW+' كغ'}</td>
        <td>${batches.map(x=>esc(x.name)).join(' / ')||'—'}</td>
      </tr>`;
    }).join('');
    if(summary)summary.innerHTML=[
      {l:'عدد القاعات',v:halls.length},
      {l:'إجمالي علف اليوم',v:halls.reduce((s,h)=>s+feedTotalHall(h.id,today()),0).toLocaleString()+' كغم'},
      {l:'إجمالي اللقاحات اليوم',v:halls.reduce((s,h)=>s+medsCountHall(h.id,today()),0).toLocaleString()},
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val">${x.v}</div></div>`).join('');
    el.innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thHall')}</th><th>${t('thCapacity')}</th><th>${t('thTotalBirds')}</th><th>${t('thAlive')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thOccupancy')}</th><th>${t('thFeedToday')}</th><th>${t('thTotalFeed')}</th><th>${t('thVaccToday')}</th><th>${t('thLastMaterial')}</th><th>${t('thLastWeight')}</th><th>${t('thBatches')}</th></tr></thead><tbody>${rows}</tbody>`;

  }else if(type==='batch_detail'){
    if(title)title.textContent='📋 تقرير وجبة كاملة';
    if(!batchId){
      if(summary)summary.innerHTML='';
      el.innerHTML=`<tbody><tr><td style="text-align:center;color:var(--ink3);padding:40px;font-size:15px">اختر وجبة من قائمة "الوجبة" أعلاه لعرض تقريرها الكامل</td></tr></tbody>`;
      return;
    }
    let b=data.batches.find(x=>x.id===batchId);
    if(!b){if(summary)summary.innerHTML='';el.innerHTML=`<tbody><tr><td style="text-align:center;color:var(--ink3);padding:40px">لم يتم إيجاد الوجبة</td></tr></tbody>`;return;}
    let c=calc(b);
    let hallIds=batchHallIds(b);
    let eggs=+b.eggs||0,badEggs=+b.badEggs||0;
    let setEggs=(+b.setEggs||0)>0?+b.setEggs:Math.max(0,eggs-badEggs);
    let hatched=c.hatched||0,netHatch=c.netHatch||0,hatchLoss=c.hatchLoss||0;
    let vaccineDeaths=+b.vaccineDeaths||0,isolated=+b.isolatedBirds||0,unfitBirds=+b.unfitBirds||0;
    let hatchRatePct=setEggs>0?((hatched/setEggs)*100).toFixed(2):'—';
    let netRatePct=setEggs>0?((netHatch/setEggs)*100).toFixed(2):'—';
    let inHall=x=>hallIds.length?hallIds.includes(+x.hallId):x.field===b.field;
    let weights=(data.weights||[]).filter(x=>x.batchId===b.id||(x.field===b.field&&inHall(x))).sort((a,z)=>String(a.date).localeCompare(String(z.date)));
    let feeds=(data.feeds||[]).filter(x=>x.field===b.field&&inHall(x)).sort((a,z)=>String(a.date).localeCompare(String(z.date)));
    let meds=(data.meds||[]).filter(x=>x.field===b.field&&inHall(x)).sort((a,z)=>String(a.date).localeCompare(String(z.date)));
    let morts=(data.morts||[]).filter(x=>+x.batchId===b.id).sort((a,z)=>String(a.date).localeCompare(String(z.date)));
    let markets=(data.markets||[]).filter(x=>+x.batchId===b.id).sort((a,z)=>String(a.date).localeCompare(String(z.date)));
    let totalMort=morts.reduce((s,x)=>s+(+x.count||0),0);
    let totalSold=markets.reduce((s,x)=>s+(+x.count||0),0);
    let totalFeedKg=feeds.reduce((s,x)=>s+(+x.qty||0),0);
    let hallLabel=Array.isArray(b.hallAllocations)&&b.hallAllocations.length?b.hallAllocations.map(a=>esc(a.hall)).join(' / '):esc(b.hall||'—');
    let srVal=+successRate(b);
    let srCol=srVal>=90?'#16a34a':srVal>=80?'#d97706':'#dc2626';
    if(summary)summary.innerHTML=[
      {l:'الوجبة',v:esc(b.name),c:'#0f172a'},
      {l:'النوع',v:esc(b.type||'—'),c:'#0f172a'},
      {l:'الحالة',v:c.completed?'منتهية':c.transferred?'في الحقل':'في المفقس',c:c.completed?'#64748b':c.transferred?'#16a34a':'#2563eb'},
      {l:'نسبة الفقس',v:hatchRatePct+'%',c:'#7c3aed'},
      {l:'الصافي للنقل',v:netHatch.toLocaleString(),c:'#7c3aed'},
      {l:'في الحقل',v:(c.fieldBirds||0).toLocaleString(),c:'#0891b2'},
      {l:'الحي الآن',v:c.alive.toLocaleString(),c:'#16a34a'},
      {l:'الهلاك',v:totalMort.toLocaleString(),c:'#dc2626'},
      {l:'المسوق',v:totalSold.toLocaleString(),c:'#d97706'},
      {l:'نسبة النجاح',v:srVal+'%',c:srCol},
      {l:'إجمالي العلف',v:totalFeedKg.toLocaleString()+' كغم',c:'#ca8a04'},
    ].map(x=>`<div class="statCard"><div class="sc-label">${x.l}</div><div class="sc-val" style="color:${x.c}">${x.v}</div></div>`).join('');
    let nd=(n)=>`<tr><td colspan="${n}" style="text-align:center;color:var(--ink3);padding:8px">لا توجد سجلات</td></tr>`;
    let weightRows=weights.map(x=>{
      let actual=+(x.actual_weight_grams||x.avgWeight||0),guide=+(x.guideWeightGrams||0);
      let diff=actual&&guide?actual-guide:null,dCol=diff!=null?(diff>=0?'#16a34a':'#dc2626'):'';
      let pct=guide?((actual/guide)*100).toFixed(1):null;
      return `<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td>${x.ageDays!=null?x.ageDays+' يوم':'—'}</td><td style="font-weight:700;color:#2563eb">${actual?actual+'غم':'—'}</td><td style="color:#64748b">${guide?guide+'غم':'—'}</td><td style="color:${dCol};font-weight:700">${diff!=null?(diff>0?'+':'')+diff+'غم':''} ${pct!=null?'('+pct+'%)':''}</td><td>${(+x.alive||0).toLocaleString()||'—'}</td></tr>`;
    }).join('');
    let feedRows=feeds.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td>${esc(x.feedType||'—')}</td><td><b>${(+x.qty||0).toLocaleString()} كغم</b></td><td>${esc(x.note||'—')}</td></tr>`).join('');
    let medRows=meds.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td><span class="badge ${x.type==='لقاح'?'b-violet':x.type==='دواء'?'b-red':x.type==='فيتامين'?'b-green':'b-gray'}">${esc(x.type)}</span></td><td><b>${esc(x.name)}</b></td><td>${esc(x.dose||'—')}</td><td>${(+x.qty||0).toLocaleString()}</td><td>${esc(x.note||'—')}</td></tr>`).join('');
    let mortRows=morts.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td style="color:#dc2626;font-weight:700">${(+x.count||0).toLocaleString()}</td><td>${esc(x.reason||'—')}</td></tr>`).join('');
    let marketRows=markets.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td style="color:#d97706;font-weight:700">${(+x.count||0).toLocaleString()}</td><td>${esc(x.status||'—')}</td><td>${x.price!=null?esc(''+x.price):'—'}</td><td>${esc(x.note||'—')}</td></tr>`).join('');
    el.innerHTML=`<tbody><tr><td style="padding:0">
      <div style="padding:14px 0 6px;font-weight:700;font-size:15px;color:#7c3aed;display:flex;align-items:center;gap:6px"><span class="material-symbols-outlined" style="font-size:20px">egg</span> بيانات المفقس</div>
      <div class="detailGrid" style="margin-bottom:14px">
        <div class="dCell"><div class="dc-label">تاريخ الفقس</div><div class="dc-val">${fmt(b.hatchDate)||'—'}</div></div>
        <div class="dCell"><div class="dc-label">تاريخ النقل</div><div class="dc-val">${fmt(b.transferDate)||'—'}</div></div>
        <div class="dCell"><div class="dc-label">الحقل</div><div class="dc-val">${esc(b.field||'—')}</div></div>
        <div class="dCell"><div class="dc-label">القاعات</div><div class="dc-val">${hallLabel}</div></div>
        <div class="dCell"><div class="dc-label">إجمالي البيض</div><div class="dc-val">${eggs.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">البيض الفاسد</div><div class="dc-val">${badEggs.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">المخصص للفقس</div><div class="dc-val">${setEggs.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">المفقوس</div><div class="dc-val" style="font-weight:700">${hatched.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">نسبة الفقس</div><div class="dc-val" style="color:#7c3aed;font-weight:700">${hatchRatePct}%</div></div>
        <div class="dCell"><div class="dc-label">هلاك اللقاح</div><div class="dc-val">${vaccineDeaths.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">معزولة</div><div class="dc-val">${isolated.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">غير صالحة</div><div class="dc-val">${unfitBirds.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">إجمالي الخسائر</div><div class="dc-val">${hatchLoss.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">الصافي للنقل</div><div class="dc-val" style="color:#16a34a;font-weight:700">${netHatch.toLocaleString()}</div></div>
        <div class="dCell"><div class="dc-label">نسبة الصافي</div><div class="dc-val" style="color:#16a34a;font-weight:700">${netRatePct}%</div></div>
        ${b.transferBirdWeight?`<div class="dCell"><div class="dc-label">وزن الكتكوت</div><div class="dc-val">${b.transferBirdWeight} غم</div></div>`:''}
        ${b.supervisor?`<div class="dCell"><div class="dc-label">المشرف</div><div class="dc-val">${esc(b.supervisor)}</div></div>`:''}
        ${b.vet?`<div class="dCell"><div class="dc-label">الطبيب البيطري</div><div class="dc-val">${esc(b.vet)}</div></div>`:''}
      </div>
      <div class="tableWrap" style="margin-bottom:10px"><table class="tbl"><thead><tr><th colspan="7" style="background:#eff6ff;color:#2563eb;text-align:right">⚖️ سجلات الأوزان (${weights.length})</th></tr><tr><th>التاريخ</th><th>القاعة</th><th>العمر</th><th>الوزن الفعلي</th><th>الكايد</th><th>الفرق / نسبة التحقق</th><th>الحي</th></tr></thead><tbody>${weightRows||nd(7)}</tbody></table></div>
      <div class="tableWrap" style="margin-bottom:10px"><table class="tbl"><thead><tr><th colspan="5" style="background:#fefce8;color:#ca8a04;text-align:right">🌾 سجلات العلف (${feeds.length}) — إجمالي: ${totalFeedKg.toLocaleString()} كغم</th></tr><tr><th>التاريخ</th><th>القاعة</th><th>النوع</th><th>الكمية</th><th>ملاحظة</th></tr></thead><tbody>${feedRows||nd(5)}</tbody></table></div>
      <div class="tableWrap" style="margin-bottom:10px"><table class="tbl"><thead><tr><th colspan="7" style="background:#faf5ff;color:#7c3aed;text-align:right">💉 سجلات الأدوية واللقاحات (${meds.length})</th></tr><tr><th>التاريخ</th><th>القاعة</th><th>النوع</th><th>المادة</th><th>الجرعة</th><th>الكمية</th><th>ملاحظة</th></tr></thead><tbody>${medRows||nd(7)}</tbody></table></div>
      <div class="tableWrap" style="margin-bottom:10px"><table class="tbl"><thead><tr><th colspan="4" style="background:#fef2f2;color:#dc2626;text-align:right">💔 سجلات الهلاك (${morts.length}) — إجمالي: ${totalMort.toLocaleString()} طير</th></tr><tr><th>التاريخ</th><th>القاعة</th><th>العدد</th><th>السبب</th></tr></thead><tbody>${mortRows||nd(4)}</tbody></table></div>
      <div class="tableWrap"><table class="tbl"><thead><tr><th colspan="6" style="background:#fff7ed;color:#d97706;text-align:right">🛒 سجلات التسويق (${markets.length}) — إجمالي: ${totalSold.toLocaleString()} طير</th></tr><tr><th>التاريخ</th><th>القاعة</th><th>العدد</th><th>النوع</th><th>السعر</th><th>ملاحظة</th></tr></thead><tbody>${marketRows||nd(6)}</tbody></table></div>
    </td></tr></tbody>`;
  }
}

// ── EXPORT EXCEL (CSV مُحسَّن) ──
function exportRptExcel(){
  let{type}=rptFilteredData();
  let el=$('reportTable');if(!el)return;
  // استخرج رؤوس الأعمدة
  let headers=[...el.querySelectorAll('thead th')].map(th=>th.textContent.trim());
  // استخرج الصفوف — نظّف badges و HTML
  let rows=[...el.querySelectorAll('tbody tr')].map(tr=>
    [...tr.querySelectorAll('td')].map(td=>td.textContent.trim())
  );
  let csv='\ufeff'+[headers,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\n');
  let names={batches:'الوجبات',feed:'العلف',meds:'الأدوية',fields:'الحقول',halls:'القاعات'};
  let a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download=`zohor_${names[type]||type}_${today()}.csv`;
  a.click();
  msg('تم تصدير ملف Excel (CSV)');
}

// ── EXPORT PDF ──
function exportRptPDF(){
  let{type}=rptFilteredData();
  let names={batches:'الوجبات',feed:'استهلاك العلف',meds:'الأدوية واللقاحات',fields:'الحقول',halls:'القاعات'};
  let title=names[type]||type;
  let summaryEl=$('rptSummaryCards');
  let tableEl=$('reportTable');
  if(!tableEl)return;

  // بناء HTML مستقل للـ PDF
  let summaryHtml=summaryEl?`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">${
    [...summaryEl.querySelectorAll('.statCard')].map(c=>`<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;min-width:120px;text-align:center">
      <div style="font-size:10px;color:#64748b;margin-bottom:3px;text-transform:uppercase">${(c.querySelector('.sc-label')||{}).textContent||''}</div>
      <div style="font-size:18px;font-weight:700;color:#0d9488">${(c.querySelector('.sc-val')||{}).textContent||''}</div>
    </div>`).join('')
  }</div>`:'';

  let tableHtml=tableEl.outerHTML.replace(/class="[^"]*"/g,'style="border:1px solid #e2e8f0;padding:8px;font-size:12px"');

  let win=window.open('','_blank');
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head>
    <meta charset="utf-8">
    <title>تقرير ${title} — زهور الوطن</title>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap');
      body{font-family:'IBM Plex Sans Arabic',Tahoma,Arial;padding:20px;color:#0f172a;font-size:12px}
      h2{font-size:18px;font-weight:700;margin-bottom:4px;color:#0f172a}
      .meta{font-size:11px;color:#64748b;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{background:#f8fafc;border:1px solid #e2e8f0;padding:7px 9px;text-align:right;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase}
      td{border:1px solid #e2e8f0;padding:7px 9px;text-align:right}
      tr:nth-child(even) td{background:#f8fafc}
      .badge{padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;display:inline-block}
      .summary{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}
      .sc{border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;min-width:120px;text-align:center}
      .sc-label{font-size:9px;color:#64748b;margin-bottom:3px;text-transform:uppercase}
      .sc-val{font-size:16px;font-weight:700;color:#0d9488}
      @media print{button{display:none}}
    </style>
  </head><body>
    <h2>📋 تقرير ${title}</h2>
    <p class="meta">زهور الوطن — تاريخ التصدير: ${new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
    ${summaryHtml}
    ${tableEl.outerHTML}
    <div style="margin-top:24px;text-align:center">
      <button onclick="window.print()" style="padding:10px 24px;background:#0d9488;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit">🖨️ طباعة / حفظ PDF</button>
    </div>
  </body></html>`);
  win.document.close();
  msg('تم فتح نافذة PDF — اضغط طباعة ثم "حفظ كـ PDF"');
}

function exportCSV(){exportRptExcel();}

function backup(){if(!isAdmin())return;let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='zohor_backup_'+today()+'.json';a.click()}
function restore(e){if(!isAdmin())return;let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>{try{let obj=JSON.parse(r.result);if(confirm('استرجاع النسخة سيستبدل البيانات الحالية. متأكد؟')){data={...data,...obj};data.batches=(data.batches||[]).map(migrateBatch);data.fields=data.fields||[];data.halls=data.halls||[];data.weights=data.weights||[];data.subUsers=data.subUsers||[];save();renderAll()}}catch{msg('⚠ ملف النسخة الاحتياطية غير صالح')}e.target.value=''};r.readAsText(f)}

// ── ARCHIVE ──
function archiveBatchDetails(b){
  let hallIds=batchHallIds(b);
  let inHall=x=>hallIds.length?hallIds.includes(+x.hallId):x.field===b.field;
  let weights=(data.weights||[]).filter(x=>x.field===b.field&&inHall(x)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let feeds=(data.feeds||[]).filter(x=>x.field===b.field&&inHall(x)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let meds=(data.meds||[]).filter(x=>x.field===b.field&&inHall(x)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let morts=(data.morts||[]).filter(x=>+x.batchId===b.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let markets=(data.markets||[]).filter(x=>+x.batchId===b.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let tr=(rows,empty,cols)=>rows||`<tr><td colspan="${cols}" style="text-align:center;color:var(--ink3)"> ${empty}</td></tr>`;
  let weightRows=weights.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td>${x.avgWeight||'—'} كغ</td><td>${x.expectedWeight||'—'} كغ</td><td>${(+x.totalWeight||0).toLocaleString()} كغ</td></tr>`).join('');
  let feedRows=feeds.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td>${esc(x.feedType||'—')}</td><td>${(+x.qty||0).toLocaleString()} كغم</td></tr>`).join('');
  let medRows=meds.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td>${esc(x.type||'—')}</td><td>${esc(x.name||'—')}</td><td>${esc(x.dose||'—')}</td><td>${(+x.qty||0).toLocaleString()}</td></tr>`).join('');
  let mortRows=morts.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td>${(+x.count||0).toLocaleString()}</td><td>${esc(x.reason||'—')}</td></tr>`).join('');
  let marketRows=markets.map(x=>`<tr><td>${fmt(x.date)}</td><td>${esc(x.hall||'—')}</td><td>${(+x.count||0).toLocaleString()}</td><td>${esc(x.status||'—')}</td><td>${esc(x.note||'—')}</td></tr>`).join('');
  let c=calc(b);
  let eggs=+b.eggs||0,badEggs=+b.badEggs||0,setEggs=(+b.setEggs||0)>0?+b.setEggs:Math.max(0,eggs-badEggs);
  let hatched=c.hatched||0,netHatch=c.netHatch||0,hatchLoss=c.hatchLoss||0;
  let vaccineDeaths=+b.vaccineDeaths||0,isolated=+b.isolatedBirds||0,unfitBirds=+b.unfitBirds||0;
  let hatchRatePct=setEggs>0?((hatched/setEggs)*100).toFixed(2):'—';
  let netRatePct=setEggs>0?((netHatch/setEggs)*100).toFixed(2):'—';
  return `<div class="detailGrid" style="margin-bottom:12px">
    <div class="dCell"><div class="dc-label">الحقل</div><div class="dc-val">${esc(b.field||'—')}</div></div>
    <div class="dCell"><div class="dc-label">تاريخ الأرشفة</div><div class="dc-val">${fmt(b.archiveDate||today())}</div></div>
    <div class="dCell"><div class="dc-label">القاعات</div><div class="dc-val">${hallIds.length}</div></div>
    <div class="dCell"><div class="dc-label">الحالة</div><div class="dc-val">منتهية</div></div>
  </div>
  <div class="card" style="margin-bottom:12px;border-right:4px solid #7c3aed">
    <div class="cardTitle" style="color:#7c3aed"><span class="material-symbols-outlined ct-icon">egg</span> بيانات المفقس</div>
    <div class="detailGrid" style="margin-bottom:10px">
      <div class="dCell"><div class="dc-label">تاريخ الفقس</div><div class="dc-val">${fmt(b.hatchDate)||'—'}</div></div>
      <div class="dCell"><div class="dc-label">تاريخ النقل</div><div class="dc-val">${fmt(b.transferDate)||'—'}</div></div>
      <div class="dCell"><div class="dc-label">إجمالي البيض</div><div class="dc-val">${eggs.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">البيض الفاسد</div><div class="dc-val">${badEggs.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">البيض المخصص للفقس</div><div class="dc-val">${setEggs.toLocaleString()}</div></div>
      ${b.candleDate?`<div class="dCell"><div class="dc-label">تاريخ الشمع</div><div class="dc-val">${fmt(b.candleDate)}</div></div>`:''}
      ${b.candleBadEggs?`<div class="dCell"><div class="dc-label">مكشوف بالشمع</div><div class="dc-val">${(+b.candleBadEggs).toLocaleString()}</div></div>`:''}
      <div class="dCell"><div class="dc-label">المفقوس</div><div class="dc-val" style="font-weight:700">${hatched.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">نسبة الفقس</div><div class="dc-val" style="font-weight:700;color:#7c3aed">${hatchRatePct}%</div></div>
      <div class="dCell"><div class="dc-label">هلاك اللقاح</div><div class="dc-val">${vaccineDeaths.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">طيور معزولة</div><div class="dc-val">${isolated.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">طيور غير صالحة</div><div class="dc-val">${unfitBirds.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">إجمالي الخسائر</div><div class="dc-val">${hatchLoss.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">الصافي للنقل</div><div class="dc-val" style="font-weight:700;color:#16a34a">${netHatch.toLocaleString()}</div></div>
      <div class="dCell"><div class="dc-label">نسبة الصافي</div><div class="dc-val" style="font-weight:700;color:#16a34a">${netRatePct}%</div></div>
      ${b.transferBirdWeight?`<div class="dCell"><div class="dc-label">وزن الكتكوت</div><div class="dc-val">${b.transferBirdWeight} غم</div></div>`:''}
    </div>
  </div>
  <div class="tableWrap" style="margin-bottom:10px"><table><thead><tr><th colspan="5">${t('secWeights')}</th></tr><tr><th>${t('thDate')}</th><th>${t('thHall')}</th><th>${t('thActual')}</th><th>${t('thGuide')}</th><th>${t('thTotal')}</th></tr></thead><tbody>${tr(weightRows,t('noWeights'),5)}</tbody></table></div>
  <div class="tableWrap" style="margin-bottom:10px"><table><thead><tr><th colspan="4">${t('secFeed')}</th></tr><tr><th>${t('thDate')}</th><th>${t('thHall')}</th><th>${t('thType')}</th><th>${t('thQty')}</th></tr></thead><tbody>${tr(feedRows,t('noFeed'),4)}</tbody></table></div>
  <div class="tableWrap" style="margin-bottom:10px"><table><thead><tr><th colspan="6">${t('secMeds')}</th></tr><tr><th>${t('thDate')}</th><th>${t('thHall')}</th><th>${t('thType')}</th><th>${t('thMaterial')}</th><th>${t('thDose')}</th><th>${t('thQty')}</th></tr></thead><tbody>${tr(medRows,t('noMeds'),6)}</tbody></table></div>
  <div class="tableWrap" style="margin-bottom:10px"><table><thead><tr><th colspan="4">${t('secMort')}</th></tr><tr><th>${t('thDate')}</th><th>${t('thHall')}</th><th>${t('thCount')}</th><th>${t('thReason')}</th></tr></thead><tbody>${tr(mortRows,t('noMort'),4)}</tbody></table></div>
  <div class="tableWrap"><table><thead><tr><th colspan="5">${t('secMarket')}</th></tr><tr><th>${t('thDate')}</th><th>${t('thHall')}</th><th>${t('thCount')}</th><th>${t('thType')}</th><th>${t('thNote')}</th></tr></thead><tbody>${tr(marketRows,t('noSales'),5)}</tbody></table></div>`;
}
// ===== AI ANALYSIS =====
function buildDailyGrowthCurve(b,transferW,eggW,wRecs){
  let actualMap={};
  wRecs.forEach(w=>{actualMap[+w.ageDays]=+w.actual_weight_grams;});
  let day0W=transferW||(eggW?Math.round(eggW*0.68):0);
  if(day0W&&actualMap[0]==null)actualMap[0]=day0W;
  let sortedDays=Object.keys(actualMap).map(Number).sort((a,z)=>a-z);
  let maxDay=Math.max(56,...(sortedDays.length?sortedDays:[0]));
  let curve=[];
  let prevGuide=0;
  for(let d=0;d<=maxDay;d++){
    let guide=Math.round(expectedWeightForBatch(b,d)*1000);
    let actual=actualMap[d]!=null?actualMap[d]:null;
    let projected=null;
    if(sortedDays.length>0){
      let before=null,after=null;
      for(let i=0;i<sortedDays.length;i++){if(sortedDays[i]<=d)before=sortedDays[i];}
      for(let i=0;i<sortedDays.length;i++){if(sortedDays[i]>d){after=sortedDays[i];break;}}
      if(before!=null&&after!=null){
        let span=after-before;let prog=(d-before)/span;
        projected=Math.round(actualMap[before]+(actualMap[after]-actualMap[before])*prog);
      }else if(before!=null){
        let lastRatio=actualMap[before]/((Math.round(expectedWeightForBatch(b,before)*1000))||1);
        projected=Math.round(guide*lastRatio);
      }else if(after!=null){
        let firstRatio=actualMap[after]/((Math.round(expectedWeightForBatch(b,after)*1000))||1);
        projected=Math.round(guide*firstRatio);
      }
    }
    let dailyGainGuide=guide-prevGuide;
    let prevActual=d>0&&actualMap[d-1]!=null?actualMap[d-1]:null;
    let dailyGainActual=actual!=null&&prevActual!=null?actual-prevActual:null;
    prevGuide=guide;
    curve.push({d,guide,actual,projected,dailyGainGuide,dailyGainActual});
  }
  return curve;
}

function renderAiAnalysis(){
  let sel=$('aiaBatch');if(!sel)return;
  let batches=(data.batches||[]).filter(b=>b.type!=='بياض');
  let prevVal=sel.value;
  sel.innerHTML='<option value="">-- اختر وجبة --</option>'+batches.map(b=>{let c=calc(b);return`<option value="${b.id}">${esc(b.name)} — ${esc(b.hall||'')} (يوم ${c.flockAge}${c.completed?' — منتهية':''})</option>`}).join('');
  // استعادة الاختيار السابق
  if(prevVal)sel.value=prevVal;
  // استعادة مفتاح API
  // تشغيل التحليل إذا كانت وجبة محددة
  runAiAnalysis();
}
function onAiaBatchChange(){
  let bId=$('aiaBatch')&&$('aiaBatch').value?+$('aiaBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(b){
    if($('aiaEggWeight'))$('aiaEggWeight').value=b.eggWeight||'';
    if($('aiaTransferWeight'))$('aiaTransferWeight').value=b.transferBirdWeight||'';
  }
  runAiAnalysis();
}

function _aiaComputeCore(b){
  // ══ حسابات التحليل الرياضي ══
  let eggW=+($('aiaEggWeight').value||0);
  let transferW=+($('aiaTransferWeight').value||0)||+b.transferWeight||0;
  let targetW=+($('aiaTargetWeight').value||2500);
  let c=calc(b);
  let age=c.flockAge;
  let initBirds=c.fieldBirds||+b.initialBirds||+b.fieldBirds||1;
  let wRecs=(data.weights||[]).filter(w=>w.batchId===b.id).sort((a,z)=>+a.ageDays-+z.ageDays);
  let lastW=wRecs.length?wRecs[wRecs.length-1]:null;
  let actualNow=lastW?+lastW.actual_weight_grams:0;
  let ratios=wRecs.filter(w=>+w.guideWeightGrams>0).map(w=>+w.actual_weight_grams/+w.guideWeightGrams);
  let day0Guide=Math.round(expectedWeightForBatch(b,0)*1000);
  let avgRatio=1;
  if(b.transferBirdWeight&&b.transferBirdWeight>0&&day0Guide>0){
    avgRatio=b.transferBirdWeight/day0Guide;
  } else if(b.eggWeight&&b.eggWeight>0&&day0Guide>0){
    avgRatio=(b.eggWeight*0.67)/day0Guide;
  } else if(ratios.length){
    avgRatio=ratios.reduce((s,r)=>s+r,0)/ratios.length;
  }
  let trend=0;
  if(ratios.length>=2){let h=Math.ceil(ratios.length/2);let e=ratios.slice(0,h).reduce((s,r)=>s+r,0)/h;let l=ratios.slice(h).reduce((s,r)=>s+r,0)/(ratios.length-h||1);trend=l-e;}
  let adgActual=0,adgGuide=0;
  if(wRecs.length>=2){let first=wRecs[0],last=wRecs[wRecs.length-1];let dd=+last.ageDays-+first.ageDays||1;adgActual=Math.round((+last.actual_weight_grams-+first.actual_weight_grams)/dd);adgGuide=Math.round((+last.guideWeightGrams-+first.guideWeightGrams)/dd);}
  let mortRecs=(data.morts||[]).filter(m=>m.batchId===b.id).sort((a,z)=>String(a.date).localeCompare(String(z.date)));
  let totalDead=c.mort||mortRecs.reduce((s,m)=>s+(+m.count||0),0);
  let mortPct=initBirds?(totalDead/initBirds*100).toFixed(2):0;
  let mortPhases={early:0,mid:0,late:0};let mortByWeek={};let mortReasons={};
  mortRecs.forEach(m=>{
    let mAge=m.ageDays!=null?+m.ageDays:null;
    if(mAge==null&&m.date&&b.startDate)mAge=Math.round((new Date(m.date)-new Date(b.startDate))/(864e5));
    let cnt=+m.count||0;
    if(mAge!=null){if(mAge<=7)mortPhases.early+=cnt;else if(mAge<=21)mortPhases.mid+=cnt;else mortPhases.late+=cnt;let wk=Math.floor(mAge/7);mortByWeek[wk]=(mortByWeek[wk]||0)+cnt;}
    if(m.reason)mortReasons[m.reason]=(mortReasons[m.reason]||0)+(+m.count||0);
  });
  let worstMortWeek=Object.entries(mortByWeek).sort((a,z)=>z[1]-a[1])[0];
  let topReason=Object.entries(mortReasons).sort((a,z)=>z[1]-a[1])[0];
  let livability=((initBirds-totalDead)/initBirds*100).toFixed(1);
  let dailyMortRate=(totalDead/(age||1)/initBirds*100).toFixed(3);
  let feedRecs=(data.feeds||[]).filter(f=>f.batchId===b.id);
  let totalFeedKg=feedRecs.reduce((s,f)=>s+(+f.qty||+f.amount||0),0);
  let feedPerBirdDay=age&&c.alive?(totalFeedKg*1000/c.alive/age).toFixed(1):null;
  let totalBirdKg=actualNow&&c.alive?(actualNow/1000*c.alive):0;
  let fcrEst=totalFeedKg&&totalBirdKg?(totalFeedKg/totalBirdKg).toFixed(2):null;
  let fcrBench=age<=21?1.35:age<=35?1.55:age<=42?1.70:1.85;
  let epef=null;if(fcrEst&&actualNow&&age)epef=Math.round((+livability*(actualNow/1000)*100)/(age*+fcrEst));
  let expectedChickW=eggW?Math.round(eggW*0.68):0;
  let chickDiff=expectedChickW&&transferW?transferW-expectedChickW:0;
  // نافذة التسويق
  let marketWindows=[];
  for(let d=Math.max(age,28);d<=70;d++){let g=Math.round(expectedWeightForBatch(b,d)*1000);let proj=Math.round(g*avgRatio);if(proj>=targetW&&!marketWindows.find(x=>x.label==='هدفك'))marketWindows.push({d,proj,label:'هدفك'});if(proj>=2000&&proj<2200&&!marketWindows.find(x=>x.label==='2كغ'))marketWindows.push({d,proj,label:'2كغ'});if(proj>=2500&&proj<2700&&!marketWindows.find(x=>x.label==='2.5كغ'))marketWindows.push({d,proj,label:'2.5كغ'});if(proj>=3000&&proj<3200&&!marketWindows.find(x=>x.label==='3كغ'))marketWindows.push({d,proj,label:'3كغ'});}
  marketWindows=marketWindows.slice(0,4);
  // مجموعات القاعات — كل القاعات المخصصة للوجبة حتى بدون أوزان
  let hallGroups={};
  // أضف أولاً القاعات المخصصة من hallAllocations
  let allocs=b.hallAllocations&&b.hallAllocations.length?b.hallAllocations:[b.hallId?{hallId:b.hallId,hall:b.hall}:null].filter(Boolean);
  allocs.forEach(a=>{
    let h=data.halls&&data.halls.find(x=>x.id===+a.hallId);
    let key=a.hallId||a.hall||'عام';
    let label=(h?h.name:null)||a.hall||(a.hallId?'قاعة '+a.hallId:'عام');
    if(!hallGroups[key])hallGroups[key]={label,recs:[]};
  });
  // ثم أضف سجلات الوزن
  wRecs.forEach(w=>{let key=w.hallId||w.hall||'عام';let label=w.hall||(w.hallId?'قاعة '+w.hallId:'عام');if(!hallGroups[key])hallGroups[key]={label,recs:[]};hallGroups[key].recs.push(w);});
  return{eggW,transferW,targetW,c,age,initBirds,wRecs,lastW,actualNow,ratios,avgRatio,trend,adgActual,adgGuide,mortRecs,totalDead,mortPct,mortPhases,mortByWeek,mortReasons,worstMortWeek,topReason,livability,dailyMortRate,feedRecs,totalFeedKg,feedPerBirdDay,totalBirdKg,fcrEst,fcrBench,epef,expectedChickW,chickDiff,marketWindows,hallGroups};
}

function runAiAnalysis(){
  let el=$('aiaResults');if(!el)return;
  let bId=$('aiaBatch')&&$('aiaBatch').value?+$('aiaBatch').value:0;
  let b=bId?(data.batches||[]).find(x=>x.id===bId):null;
  if(!b){el.innerHTML='<div class="card" style="text-align:center;color:var(--ink3);padding:60px 20px"><span class="material-symbols-outlined" style="font-size:48px;color:var(--ink3);display:block;margin-bottom:12px">calculate</span><div style="font-size:15px">اختر وجبة لبدء التحليل الرياضي</div></div>';return;}
  try{
  let _d=_aiaComputeCore(b);
  let eggW=_d.eggW,transferW=_d.transferW,targetW=_d.targetW,c=_d.c,age=_d.age,initBirds=_d.initBirds;
  let wRecs=_d.wRecs,lastW=_d.lastW,actualNow=_d.actualNow,avgRatio=_d.avgRatio,trend=_d.trend;
  let adgActual=_d.adgActual,adgGuide=_d.adgGuide,totalDead=_d.totalDead,mortPct=_d.mortPct;
  let mortPhases=_d.mortPhases,mortByWeek=_d.mortByWeek,topReason=_d.topReason,livability=_d.livability;
  let feedPerBirdDay=_d.feedPerBirdDay,totalFeedKg=_d.totalFeedKg,fcrEst=_d.fcrEst,fcrBench=_d.fcrBench;
  let epef=_d.epef,expectedChickW=_d.expectedChickW,chickDiff=_d.chickDiff,marketWindows=_d.marketWindows,hallGroups=_d.hallGroups;
  // مؤشر الأداء
  let scoreGrowth=Math.min(40,Math.max(0,Math.round(avgRatio*40)));
  let scoreMort=Math.min(30,Math.max(0,Math.round((1-totalDead/initBirds)*30)));
  let scoreFCR=fcrEst?Math.min(30,Math.max(0,Math.round((1-(+fcrEst-fcrBench)/fcrBench)*30))):15;
  let totalScore=scoreGrowth+scoreMort+scoreFCR;
  let scoreColor=totalScore>=85?'#16a34a':totalScore>=70?'#2563eb':totalScore>=55?'#d97706':'#dc2626';
  let scoreLabel=totalScore>=85?'ممتاز':totalScore>=70?'جيد':totalScore>=55?'مقبول':'ضعيف';
  let epefColor=epef?epef>=400?'#16a34a':epef>=300?'#2563eb':epef>=200?'#d97706':'#dc2626':'#6b7280';
  let epefLabel=epef?epef>=400?'ممتاز':epef>=300?'جيد':epef>=200?'مقبول':'ضعيف':null;
  // توصيات
  let recs=[];
  if(!wRecs.length)recs.push({icon:'info',c:'#6b7280',p:'high',t:'لا توجد سجلات وزن — أدخل وزناً واحداً على الأقل.'});
  if(avgRatio<0.90)recs.push({icon:'crisis_alert',c:'#dc2626',p:'high',t:'الأوزان أقل من الكايد بأكثر من 10% — حالة حرجة. راجع التغذية فوراً وتحقق من الحرارة والتهوية.'});
  else if(avgRatio<0.95)recs.push({icon:'warning',c:'#d97706',p:'high',t:'الأوزان أقل من الكايد بـ 5-10% — راجع نوع العلف وكثافة الطيور.'});
  else if(avgRatio>1.08)recs.push({icon:'thumb_up',c:'#16a34a',p:'low',t:'أداء ممتاز — الأوزان تتجاوز الكايد. حافظ على نفس برنامج التغذية والإدارة.'});
  if(trend<-0.05)recs.push({icon:'trending_down',c:'#dc2626',p:'high',t:'معدل النمو يتراجع — قد يكون سبب مرضي أو تراجع في العلف.'});
  else if(trend>0.05)recs.push({icon:'trending_up',c:'#16a34a',p:'low',t:'معدل النمو في تصاعد مستمر — الوجبة تتحسن.'});
  if(+mortPct>5)recs.push({icon:'crisis_alert',c:'#dc2626',p:'high',t:`نسبة الهلاك ${mortPct}% عالية جداً — تدخل عاجل.`});
  else if(+mortPct>3)recs.push({icon:'warning',c:'#d97706',p:'high',t:`نسبة الهلاك ${mortPct}% أعلى من المعدل المقبول (3%).`});
  if(mortPhases.early>initBirds*0.02)recs.push({icon:'warning',c:'#d97706',p:'high',t:`هلاك مبكر (0-7 أيام) ${mortPhases.early} طير — يشير إلى جودة كتاكيت أو ظروف استقبال.`});
  if(topReason)recs.push({icon:'info',c:'#7c3aed',p:'mid',t:`أكثر أسباب الهلاك: "${topReason[0]}" (${topReason[1]} طير).`});
  if(fcrEst&&+fcrEst>fcrBench+0.2)recs.push({icon:'warning',c:'#d97706',p:'mid',t:`FCR تقديري ${fcrEst} أعلى من المعيار (${fcrBench}).`});
  if(chickDiff<-5)recs.push({icon:'info',c:'#7c3aed',p:'mid',t:`وزن الكتكوت عند النقل (${transferW}غم) أقل من المتوقع من البيضة (${expectedChickW}غم).`});
  if(chickDiff>5)recs.push({icon:'thumb_up',c:'#16a34a',p:'low',t:`بداية قوية — وزن الكتكوت (${transferW}غم) أعلى من المتوقع من البيضة (${expectedChickW}غم).`});
  if(epef&&epef<200)recs.push({icon:'crisis_alert',c:'#dc2626',p:'high',t:`EPEF ${epef} منخفض جداً — المعيار الجيد فوق 300.`});
  recs.sort((a,z)=>({high:0,mid:1,low:2}[a.p]-{high:0,mid:1,low:2}[z.p]));
  // هلاك أسبوعي
  let mortWeekRows=Object.entries(mortByWeek).sort((a,z)=>+a[0]-+z[0]).map(([wk,cnt])=>{
    let pct=(cnt/initBirds*100).toFixed(2);let bad=+pct>1;
    return`<tr><td>الأسبوع ${+wk+1} (يوم ${+wk*7}–${+wk*7+6})</td><td style="color:${bad?'#dc2626':'inherit'};font-weight:${bad?700:400}">${cnt.toLocaleString()}</td><td style="color:${bad?'#dc2626':'inherit'}">${pct}%</td></tr>`;
  }).join('');
  // بناء القاعات
  let hallKeys=Object.keys(hallGroups);
  let hallCardsHtml='';
  if(hallKeys.length){
    let hallStats=hallKeys.map(k=>{
      let hrs=hallGroups[k].recs.sort((a,z)=>+a.ageDays-+z.ageDays);
      let rs=hrs.filter(w=>+w.guideWeightGrams>0).map(w=>+w.actual_weight_grams/+w.guideWeightGrams);
      let avgR=rs.length?rs.reduce((s,r)=>s+r,0)/rs.length:1;
      let tr=0;if(rs.length>=2){let h=Math.ceil(rs.length/2);let e=rs.slice(0,h).reduce((s,r)=>s+r,0)/h;let l=rs.slice(h).reduce((s,r)=>s+r,0)/(rs.length-h||1);tr=l-e;}
      let curve=buildDailyGrowthCurve(b,transferW,eggW,hrs);
      return{key:k,label:hallGroups[k].label,hrs,avgR,trend:tr,curve};
    }).sort((a,z)=>a.avgR-z.avgR);
    hallCardsHtml=hallStats.map(hs=>{
      let pct=(hs.avgR*100).toFixed(1);
      let pCol=hs.avgR>=1.05?'#16a34a':hs.avgR>=0.95?'#2563eb':hs.avgR>=0.88?'#d97706':'#dc2626';
      let pLbl=hs.avgR>=1.05?'ممتاز':hs.avgR>=0.95?'جيد':hs.avgR>=0.88?'مقبول':'ضعيف';
      let tTxt=hs.trend>0.03?'↑ تحسن':hs.trend<-0.03?'↓ انحدار':'← ثابت';
      let tCol=hs.trend>0.03?'#16a34a':hs.trend<-0.03?'#dc2626':'#6b7280';
      // نسبة التوقع من وزن النقل يوم 0 (أو متوسط القاعة إن لم يتوفر)
      let day0Guide=Math.round(expectedWeightForBatch(b,0)*1000)||1;
      let day0W=transferW||(eggW?Math.round(eggW*0.68):0);
      let initRatio=day0W>0?(day0W/day0Guide):hs.avgR;
      let tableRows=hs.hrs.map(w=>{
        let guideAtDay=Math.round(expectedWeightForBatch(b,+w.ageDays)*1000);
        let projW=guideAtDay?Math.round(guideAtDay*initRatio):null;
        let actual=+w.actual_weight_grams;
        let diff=projW&&projW>0?((actual/projW-1)*100).toFixed(1):null;
        let dCol=diff!=null?(+diff>=0?'#16a34a':'#dc2626'):'';
        let guideW=w.guideWeightGrams?(+w.guideWeightGrams):guideAtDay;
        let vsGuide=guideW>0?((actual/guideW-1)*100).toFixed(1):null;
        let vgCol=vsGuide!=null?(+vsGuide>=0?'#16a34a':'#dc2626'):'';
        return`<tr>
          <td style="font-weight:600">يوم ${w.ageDays}</td>
          <td>${guideW?guideW.toLocaleString()+'غم':'—'}</td>
          <td style="font-weight:700">${actual.toLocaleString()}غم <span style="font-size:11px;color:${vgCol}">(${vsGuide!=null?(+vsGuide>0?'+':'')+vsGuide+'%':'—'})</span></td>
          <td style="color:#7c3aed;font-weight:700">${projW?projW.toLocaleString()+'غم':'—'}</td>
          <td style="color:${dCol};font-weight:700">${diff!=null?(+diff>0?'+':'')+diff+'%':'—'}</td>
        </tr>`}).join('');
      let initBasis=day0W>0?`وزن النقل ${day0W}غم ÷ كايد يوم0 ${day0Guide}غم = ${(initRatio*100).toFixed(1)}%`:`متوسط أداء القاعة ${(initRatio*100).toFixed(1)}%`;
      return`<div style="border:1px solid var(--border);border-right:4px solid ${pCol};border-radius:10px;padding:14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div style="font-weight:700;font-size:15px">${hs.label}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span style="background:${pCol}18;color:${pCol};border-radius:6px;padding:3px 10px;font-size:13px;font-weight:700">${pct}% — ${pLbl}</span>
            <span style="background:${tCol}15;color:${tCol};border-radius:6px;padding:3px 10px;font-size:13px;font-weight:700">${tTxt}</span>
          </div>
        </div>
        <div style="font-size:11px;color:#7c3aed;margin-bottom:8px">📐 أساس التوقع: ${initBasis} · المتوقع = الكايد × النسبة</div>
        <div class="tableWrap"><table class="tbl" style="font-size:13px">
          <thead><tr><th>اليوم</th><th>الكايد</th><th>الفعلي (vs كايد)</th><th>المتوقع 📐</th><th>فعلي vs متوقع</th></tr></thead>
          <tbody>${tableRows||'<tr><td colspan="5" style="text-align:center;color:var(--ink3)">لا يوجد بيانات</td></tr>'}</tbody>
        </table></div>
      </div>`;
    }).join('');
  }
  el.innerHTML=`
  <div class="statsGrid" style="margin-bottom:14px">
    <div class="statCard" style="border-right:4px solid ${scoreColor}"><div class="statVal" style="color:${scoreColor}">${totalScore}/100</div><div class="statLbl">مؤشر الأداء — ${scoreLabel}</div></div>
    ${epef!=null?`<div class="statCard" style="border-right:4px solid ${epefColor}"><div class="statVal" style="color:${epefColor}">${epef}</div><div class="statLbl">EPEF — ${epefLabel}</div></div>`:''}
    <div class="statCard" style="border-right:4px solid #2563eb"><div class="statVal">${(avgRatio*100).toFixed(1)}%</div><div class="statLbl">تحقيق الكايد (${trend>0.03?'↑ تحسن':trend<-0.03?'↓ تراجع':'← ثابت'})</div></div>
    <div class="statCard" style="border-right:4px solid ${+mortPct>3?'#dc2626':+mortPct>1.5?'#d97706':'#16a34a'}"><div class="statVal" style="color:${+mortPct>3?'#dc2626':+mortPct>1.5?'#d97706':'#16a34a'}">${mortPct}%</div><div class="statLbl">الهلاك — ${totalDead.toLocaleString()} طير</div></div>
    <div class="statCard" style="border-right:4px solid #16a34a"><div class="statVal">${livability}%</div><div class="statLbl">الحيوية</div></div>
    <div class="statCard" style="border-right:4px solid #0891b2"><div class="statVal">${fcrEst||'—'}</div><div class="statLbl">FCR (معيار: ${fcrBench})</div></div>
    ${adgActual?`<div class="statCard" style="border-right:4px solid #7c3aed"><div class="statVal" style="color:${adgActual>=adgGuide*0.95?'#16a34a':'#d97706'}">${adgActual}غم/يوم</div><div class="statLbl">نمو يومي (كايد: ${adgGuide}غم)</div></div>`:''}
    ${feedPerBirdDay?`<div class="statCard" style="border-right:4px solid #d97706"><div class="statVal">${feedPerBirdDay}غم</div><div class="statLbl">علف/طير/يوم</div></div>`:''}
    ${eggW?`<div class="statCard" style="border-right:4px solid #7c3aed"><div class="statVal">${expectedChickW}غم</div><div class="statLbl">وزن كتكوت متوقع (بيضة ${eggW}غم) ${chickDiff>5?'✅':chickDiff<-5?'⚠️':''}</div></div>`:''}
    <div class="statCard" style="border-right:4px solid #d97706"><div class="statVal">يوم ${age}</div><div class="statLbl">العمر — ${c.alive.toLocaleString()} حي</div></div>
  </div>
  ${marketWindows.length?`<div class="card" style="margin-bottom:14px">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">store</span> نوافذ التسويق المتوقعة</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;padding:6px 0">
      ${marketWindows.map(mw=>`<div style="background:var(--card2,#f3f4f6);border-radius:10px;padding:12px 20px;text-align:center;min-width:110px;border-top:3px solid #7c3aed"><div style="font-size:20px;font-weight:700;color:#7c3aed">يوم ${mw.d}</div><div style="font-size:14px;font-weight:700">${mw.proj.toLocaleString()}غم</div><div style="font-size:11px;color:var(--ink3)">${mw.label}</div></div>`).join('')}
    </div>
  </div>`:''}
  ${hallCardsHtml?`<div class="card" style="margin-bottom:14px">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">home_work</span> تحليل الأداء لكل قاعة</div>
    <div style="font-size:12px;color:var(--ink3);margin-bottom:10px">مرتبة من الأضعف للأقوى · المتوقع 📐 = نسبة الأداء الفعلية × كايد Ross 308</div>
    ${hallCardsHtml}
  </div>`:''}
  <div class="card" style="margin-bottom:14px">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">heart_minus</span> تحليل الهلاك</div>
    ${_d.mortRecs.length?`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <div style="flex:1;min-width:100px;background:var(--card2,#f3f4f6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:17px;font-weight:700;color:${mortPhases.early>initBirds*0.02?'#dc2626':'#d97706'}">${mortPhases.early}</div><div style="font-size:11px;color:var(--ink3)">مبكر (0-7)</div></div>
      <div style="flex:1;min-width:100px;background:var(--card2,#f3f4f6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:17px;font-weight:700;color:#d97706">${mortPhases.mid}</div><div style="font-size:11px;color:var(--ink3)">متوسط (8-21)</div></div>
      <div style="flex:1;min-width:100px;background:var(--card2,#f3f4f6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:17px;font-weight:700;color:${mortPhases.late>mortPhases.early?'#dc2626':'#d97706'}">${mortPhases.late}</div><div style="font-size:11px;color:var(--ink3)">متأخر (>21)</div></div>
      <div style="flex:1;min-width:100px;background:var(--card2,#f3f4f6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:17px;font-weight:700;color:#6b7280">${_d.dailyMortRate}%</div><div style="font-size:11px;color:var(--ink3)">يومي متوسط</div></div>
    </div>${_d.worstMortWeek?`<div style="font-size:13px;margin-bottom:6px">⚠️ أعلى أسبوع: <strong>الأسبوع ${+_d.worstMortWeek[0]+1}</strong> (${_d.worstMortWeek[1].toLocaleString()} طير)</div>`:''}${topReason?`<div style="font-size:13px;margin-bottom:8px">السبب الأكثر: <strong>${topReason[0]}</strong> (${topReason[1]} طير)</div>`:''}${mortWeekRows?`<div class="tableWrap"><table class="tbl"><thead><tr><th>الفترة</th><th>الهلاك</th><th>النسبة</th></tr></thead><tbody>${mortWeekRows}</tbody></table></div>`:''}`:`<p style="color:var(--ink3);font-size:13px">لا توجد سجلات هلاك.</p>`}
  </div>
  ${recs.length?`<div class="card">
    <div class="cardTitle"><span class="material-symbols-outlined ct-icon">lightbulb</span> التوصيات والمؤشرات (تحليل رياضي)</div>
    ${recs.map((r,i)=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;${i<recs.length-1?'border-bottom:1px solid var(--border)':''}"><span class="material-symbols-outlined" style="color:${r.c};font-size:22px;flex-shrink:0;margin-top:1px">${r.icon}</span><div><span style="display:inline-block;background:${r.p==='high'?'#fee2e2':r.p==='mid'?'#fef3c7':'#dcfce7'};color:${r.p==='high'?'#dc2626':r.p==='mid'?'#d97706':'#16a34a'};border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700;margin-bottom:4px">${r.p==='high'?'عاجل':r.p==='mid'?'مهم':'معلومة'}</span><div style="font-size:13px;line-height:1.7">${r.t}</div></div></div>`).join('')}
  </div>`:''}`;
  }catch(err){el.innerHTML=`<div class="card" style="border-right:4px solid #dc2626;color:#dc2626;padding:14px;font-family:monospace;font-size:13px">خطأ في التحليل: ${err.message}<br><small>${err.stack||''}</small></div>`;}
}

// ===== END AI ANALYSIS =====


function renderArchive(){
  let el=$('archiveTable');if(!el)return;
  let q=($('archiveSearch')&&$('archiveSearch').value||'').trim().toLowerCase();
  let batchFilter=$('archiveBatchFilter')&&$('archiveBatchFilter').value?+$('archiveBatchFilter').value:0;
  let fieldFilter=$('archiveFieldFilter')?$('archiveFieldFilter').value:'';
  let hallFilter=$('archiveHallFilter')&&$('archiveHallFilter').value?+$('archiveHallFilter').value:0;
  let batches=isAdmin()?data.batches.filter(b=>calc(b).completed):visibleBatches().filter(b=>calc(b).completed);
  if(batchFilter)batches=batches.filter(b=>b.id===batchFilter);
  if(fieldFilter)batches=batches.filter(b=>b.field===fieldFilter);
  if(hallFilter)batches=batches.filter(b=>batchHallIds(b).includes(hallFilter));
  if(q){
    batches=batches.filter(b=>[
      b.name,b.field,b.hall,b.type,b.status,
      ...(Array.isArray(b.hallAllocations)?b.hallAllocations.map(a=>a.hall):[])
    ].some(x=>String(x||'').toLowerCase().includes(q)));
  }
  let rows=batches.map((b,i)=>{let c=calc(b);return `<tr class="selectable" onclick="toggleInlineDetails('archiveDetail${i}')"><td><b>${esc(b.name)}</b></td><td>${fmt(b.hatchDate)}</td><td>${fmt(c.entryDate)}</td><td>${esc(b.field||'—')}</td><td>${(c.fieldBirds||0).toLocaleString()}</td><td>${c.mort.toLocaleString()}</td><td>${c.sold.toLocaleString()}</td><td>0</td><td><span class="badge b-gray">منتهية</span></td><td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();toggleInlineDetails('archiveDetail${i}')">تفاصيل الأرشيف</button></td></tr>
  <tr id="archiveDetail${i}" class="hidden"><td colspan="10">${archiveBatchDetails(b)}</td></tr>`}).join('');
  el.innerHTML=`<thead><tr><th>${t('thBatch')}</th><th>${t('thEntryDate')}</th><th>${t('thEntryDate')}</th><th>${t('thField')}</th><th>${t('thNetTransfer')}</th><th>${t('thMort')}</th><th>${t('thSold')}</th><th>${t('thAliveLeft')}</th><th>${t('thStatus')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows||'<tr><td colspan="10" style="text-align:center;color:var(--ink3);padding:18px">'+t('noArchivedBatches')+'</td></tr>'}</tbody>`;
}
