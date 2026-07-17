// ── MARKET ──
function marketHallOptionsForBatch(b){
  if(!b)return [];
  if(Array.isArray(b.hallAllocations)&&b.hallAllocations.length)return b.hallAllocations;
  if(b.hallId)return [{hallId:b.hallId,hall:b.hall,birds:b.fieldBirds}];
  return [];
}
function fillMarketHalls(){
  let sel=$('marketHall');if(!sel)return;
  let id=$('marketBatch')?+$('marketBatch').value:0;
  let b=data.batches.find(x=>x.id===id);
  let arr=marketHallOptionsForBatch(b);
  sel.innerHTML=arr.length
    ?arr.map(a=>`<option value="${a.hallId}">${esc(a.hall||'قاعة')} — حي ${batchHallAlive(b,+a.hallId).toLocaleString()}</option>`).join('')
    :'<option value="">لا توجد قاعات لهذه الوجبة</option>';
  updateMarketAge();
}
function addMarket(){
  let id=+$('marketBatch').value;if(!id)return msg('⚠ اختر الوجبة أولاً');
  let b=data.batches.find(x=>x.id===id);
  if(!isAdmin()&&b&&!canSeeField(b.field))return msg('⛔ لا تملك صلاحية لهذه الوجبة');
  let hallId=$('marketHall')&&$('marketHall').value?+$('marketHall').value:null;
  let hallObj=hallId?data.halls.find(h=>h.id===hallId):null;
  if(b&&marketHallOptionsForBatch(b).length&&!hallId)return msg('⚠ اختر القاعة التي تم تسويقها');
  let count=num('marketCount');
  if(count<=0)return msg('⚠ أدخل عدد الطيور المسوقة');
  let aliveNow=hallId?batchHallAlive(b,hallId):calc(b).alive;
  let overDiff=hallId&&count>aliveNow?aliveNow-count:0;
  if(hallId&&count>aliveNow){if(!confirm('العدد ('+count.toLocaleString()+') أكبر من الحي داخل القاعة ('+aliveNow.toLocaleString()+'). الفرق ('+overDiff.toLocaleString()+') سيُسجَّل بالسالب. هل تريد المتابعة؟'))return;}
  data.markets.push({id:Date.now(),batchId:id,hallId:hallId,hall:hallObj?hallObj.name:'',date:val('marketDate')||today(),count:count,status:val('marketStatus'),note:val('marketNote'),diff:overDiff||undefined});
  if(b)updateBatchArchiveStatus(b);
  save();renderAll();clearMarketForm();
}
function renderMarket(){
  function mktBadge(s){
    if(s==='تسويق إلى المجزرة')return '<span class="badge b-red">🔪 مجزرة</span>';
    if(s==='بيعت جزئياً')return '<span class="badge b-violet">بيعت جزئياً</span>';
    if(s==='منتهية')return '<span class="badge b-gray">منتهية</span>';
    if(s==='منقولة')return '<span class="badge b-teal">منقولة</span>';
    return s;
  }
  let markets=data.markets.filter(m=>{let b=data.batches.find(x=>x.id===m.batchId);return isAdmin()||(b&&canSeeField(b.field))}).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let filterBatchId=$('marketBatchFilter')&&$('marketBatchFilter').value?+$('marketBatchFilter').value:0;
  if(filterBatchId)markets=markets.filter(m=>+m.batchId===filterBatchId);
  let fields=[...new Set(markets.map(m=>(data.batches.find(b=>b.id===m.batchId)||{}).field).filter(Boolean))];
  let rows=fields.map((field,i)=>{
    let fieldMarkets=markets.filter(m=>(data.batches.find(b=>b.id===m.batchId)||{}).field===field);
    let total=fieldMarkets.reduce((s,m)=>s+(+m.count||0),0);
    let todayCount=fieldMarkets.filter(m=>m.date===today()).reduce((s,m)=>s+(+m.count||0),0);
    let halls=[...new Set(fieldMarkets.map(m=>m.hall||'—'))];
    let detailRows=halls.map(hall=>{
      let hallMarkets=fieldMarkets.filter(m=>(m.hall||'—')===hall);
      let latest=hallMarkets[0]||{};
      let hTotal=hallMarkets.reduce((s,m)=>s+(+m.count||0),0);
      let hToday=hallMarkets.filter(m=>m.date===today()).reduce((s,m)=>s+(+m.count||0),0);
      let batches=[...new Set(hallMarkets.map(m=>(data.batches.find(b=>b.id===m.batchId)||{}).name).filter(Boolean))];
      let delBtns=hallMarkets.map(m=>`<button class="btn btn-danger btn-sm" title="${fmt(m.date)}" onclick="deleteMarket(${m.id})">حذف</button>`).join(' ');
      let mktDailyRows=hallMarkets.map(m=>`<tr>
        <td>${fmt(m.date)}</td>
        <td>${(+m.count||0).toLocaleString()}</td>
        <td>${m.diff&&m.diff<0?`<span style="color:#dc2626;font-weight:700">${m.diff.toLocaleString()}</span>`:'—'}</td>
        <td>${mktBadge(m.status||'—')}</td>
        <td>${esc(m.note||'—')}</td>
        <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openEditRecord('market',${m.id})">تعديل</button> ${isAdmin()?`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteMarket(${m.id})">حذف</button>`:''}</td>
      </tr>`).join('');
      return `<tr class="selectable" onclick="toggleInlineDetails('mktHallDetail_${i}_${hall.replace(/\s/g,'')}')">
        <td><b>${hall}</b></td>
        <td>${fmt(latest.date)}</td>
        <td>${hToday.toLocaleString()}</td>
        <td><b>${hTotal.toLocaleString()}</b></td>
        <td>${hallMarkets.length.toLocaleString()}</td>
        <td>${batches.join(' / ')||'—'}</td>
        <td>${mktBadge(latest.status||'—')}</td>
        <td>${esc(latest.note||'—')}</td>
        <td>${isDeveloperAdmin()?hallMarkets.map(m=>`<button class="btn btn-secondary btn-sm" onclick="editMarketCount(${m.id})">${(+m.count||0).toLocaleString()}</button>`).join(' '):'—'}</td>
        <td>${isAdmin()?delBtns:'—'}</td>
      </tr>
      <tr id="mktHallDetail_${i}_${hall.replace(/\s/g,'')}" class="hidden"><td colspan="10">
        <div class="tableWrap"><table><thead><tr><th>التاريخ</th><th>العدد</th><th>فرق</th><th>النوع</th><th>ملاحظة</th><th>إجراء</th></tr></thead><tbody>${mktDailyRows}</tbody></table></div>
      </td></tr>`;
    }).join('');
    return `<tr class="selectable" onclick="toggleInlineDetails('marketDetail${i}')" style="background:var(--bg)">
      <td><b>🏡 ${field}</b></td><td>${todayCount.toLocaleString()}</td><td><b>${total.toLocaleString()}</b></td><td>${fieldMarkets.length.toLocaleString()}</td><td colspan="3">اضغط لعرض التفاصيل</td>
    </tr>
    <tr id="marketDetail${i}" class="hidden"><td colspan="7">
      <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thLastDate')}</th><th>${t('thSaleToday')}</th><th>${t('thSaleTotal')}</th><th>${t('thRecords')}</th><th>${t('thBatches')}</th><th>النوع</th><th>ملاحظة</th><th>تعديل</th><th>حذف</th></tr></thead><tbody>${detailRows}</tbody></table></div>
    </td></tr>`;
  }).join('');
  $('marketTable').innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thSaleToday')}</th><th>${t('thSaleTotal')}</th><th>${t('thRecords')}</th><th colspan="3">${t('thDetails')}</th></tr></thead><tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:var(--ink3);padding:18px">'+t('noRecords')+' تسويق</td></tr>'}</tbody>`;
}
function deleteMarket(id){if(!isAdmin())return;if(confirm('حذف عملية التسويق؟')){let old=data.markets.find(m=>m.id===id);data.markets=data.markets.filter(m=>m.id!==id);if(old)updateBatchArchiveStatus(data.batches.find(b=>b.id===old.batchId));save();renderAll()}}

function editMarketCount(id){
  if(!isDeveloperAdmin())return msg('⛔ تعديل عدد الطير المسوق للمدير الرئيسي فقط');
  let m=data.markets.find(x=>x.id===id);if(!m)return;
  let b=data.batches.find(x=>x.id===m.batchId);if(!b)return;
  let old=+m.count||0;
  let hallId=+m.hallId||0;
  let available=(hallId?batchHallAlive(b,hallId):calc(b).alive)+old;
  let v=prompt('تعديل عدد الطير المسوق فقط',old);
  if(v===null)return;
  let next=+v;
  if(!Number.isFinite(next)||next<0)return msg('⚠ أدخل عدد صحيح موجب');
  if(next>available)return msg('⚠ العدد أكبر من المتاح: '+available.toLocaleString());
  m.count=next;
  updateBatchArchiveStatus(b);
  save();renderAll();msg('تم تعديل عدد الطير المسوق');
}

function forceArchiveBatch(id){
  if(!isAdmin())return;
  let b=(data.batches||[]).find(x=>x.id===id);if(!b)return;
  let c=calc(b);
  let msg2=`أرشفة الوجبة: ${b.name}\nالطير الحي المتبقي: ${c.alive.toLocaleString()}\n\nسيتم تحويل الوجبة إلى "منتهية" وأرشفتها مع كافة بياناتها.\nهل أنت متأكد؟`;
  if(!confirm(msg2))return;
  b.status='منتهية';
  b.archiveDate=b.archiveDate||today();
  b.archivedManually=true;
  save();renderAll();msg(`تمت أرشفة الوجبة: ${b.name} ✅`);
}
function updateBatchArchiveStatus(b){
  if(!b)return;
  let c=calc(b);
  if(c.completed){
    b.status='منتهية';
    b.archiveDate=b.archiveDate||today();
  }else if(b.status==='منتهية'){
    b.status='نشطة';
    b.archiveDate='';
  }
}
function updateArchiveStatuses(){
  (data.batches||[]).forEach(updateBatchArchiveStatus);
}
