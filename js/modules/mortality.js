// ── MORTALITY ──
function addMort(){
  let id=+$('mortBatch').value;
  if(!id)return msg('⚠ اختر الوجبة أولاً');
  let b=data.batches.find(x=>x.id===id);
  let hallId=$('mortHall')&&$('mortHall').value?+$('mortHall').value:null;
  let hallObj=hallId?data.halls.find(h=>h.id===hallId):null;
  if(b&&b.transferDate&&!hallId)return msg('⚠ اختر القاعة التي حدث بها الهلاك');
  data.morts.push({id:Date.now(),batchId:id,hallId:hallId,hall:hallObj?hallObj.name:'',date:val('mortDate')||today(),count:num('mortCount'),reason:val('mortReason')});
  updateBatchArchiveStatus(b);
  save();renderAll();clearMortForm();
}
function renderMort(){
  let morts=data.morts.filter(m=>{let b=data.batches.find(x=>x.id===m.batchId);return isAdmin()||(b&&canSeeField(b.field))}).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  let filterBatchId=$('mortBatchFilter')&&$('mortBatchFilter').value?+$('mortBatchFilter').value:0;
  if(filterBatchId)morts=morts.filter(m=>+m.batchId===filterBatchId);
  let mHall=$('mortHallFilter')&&$('mortHallFilter').value?+$('mortHallFilter').value:0;
  if(mHall)morts=morts.filter(m=>+m.hallId===mHall);
  let mFrom=$('mortFromDate')&&$('mortFromDate').value;
  let mTo=$('mortToDate')&&$('mortToDate').value;
  if(mFrom)morts=morts.filter(m=>m.date>=mFrom);
  if(mTo)morts=morts.filter(m=>m.date<=mTo);
  let fields=[...new Set(morts.map(m=>(data.batches.find(b=>b.id===m.batchId)||{}).field).filter(Boolean))];
  let rows=fields.map((field,i)=>{
    let fieldMorts=morts.filter(m=>(data.batches.find(b=>b.id===m.batchId)||{}).field===field);
    let total=fieldMorts.reduce((s,m)=>s+(+m.count||0),0);
    let todayCount=fieldMorts.filter(m=>m.date===today()).reduce((s,m)=>s+(+m.count||0),0);
    let halls=[...new Set(fieldMorts.map(m=>m.hall||'—'))];
    let detailRows=halls.map((hall,j)=>{
      let hallMorts=fieldMorts.filter(m=>(m.hall||'—')===hall);
      let latest=hallMorts[0]||{};
      let hTotal=hallMorts.reduce((s,m)=>s+(+m.count||0),0);
      let hToday=hallMorts.filter(m=>m.date===today()).reduce((s,m)=>s+(+m.count||0),0);
      let dailyRows=hallMorts.map(m=>{
        let mb=data.batches.find(b=>b.id===m.batchId);
        return `<tr class="rec-daily-row">
          <td>${fmt(m.date)}</td>
          <td>${mb?mb.name:'—'}</td>
          <td>${m.ageDays!=null?m.ageDays+' يوم':'—'}</td>
          <td>${(+m.count||0).toLocaleString()}</td>
          <td>${m.reason||'—'}</td>
          <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openEditRecord('mort',${m.id})">تعديل</button> ${isAdmin()?`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteMort(${m.id})">حذف</button>`:''}</td>
        </tr>`;
      }).join('');
      // نسبة النجاح من الهلاك لهذه القاعة
      let bForHall=hallMorts.length?data.batches.find(b=>b.id===hallMorts[0].batchId):null;
      let hallAlloc=bForHall?batchAllocatedToHall(bForHall,hallMorts[0]?+hallMorts[0].hallId:0):0;
      let survivalRate=hallAlloc>0?+(((hallAlloc-hTotal)/hallAlloc)*100).toFixed(1):null;
      let survColor=survivalRate==null?'var(--ink3)':survivalRate>=95?'#16a34a':survivalRate>=90?'#f59e0b':'#dc2626';
      let mchId=`mChev${i}_${j}`;
      return `<tr class="selectable rec-hall-row" onclick="toggleInlineDetails('mortHallDetail${i}_${j}','${mchId}')">
        <td><span id="${mchId}" class="hall-chevron" style="transition:transform .2s">◀</span> <b>${hall}</b></td>
        <td>${fmt(latest.date)}</td>
        <td>${hToday.toLocaleString()}</td>
        <td><b>${hTotal.toLocaleString()}</b></td>
        <td><span style="font-weight:700;color:${survColor}">${survivalRate!=null?survivalRate+'% نجاة':'—'}</span></td>
        <td>${hallMorts.length.toLocaleString()}</td>
      </tr>
      <tr id="mortHallDetail${i}_${j}" class="hidden"><td colspan="6">
        <div class="tableWrap"><table><thead><tr><th>${t('thDate')}</th><th>${t('thBatch')}</th><th>${t('thAge')}</th><th>${t('thCount')}</th><th>${t('thReason')}</th><th>إجراء</th></tr></thead><tbody>${dailyRows}</tbody></table></div>
      </td></tr>`;
    }).join('');
    let mfChId=`mFChev${i}`;
    return `<tr class="selectable rec-field-row" onclick="toggleInlineDetails('mortDetail${i}','${mfChId}')">
      <td><span id="${mfChId}" class="field-chevron">◀</span> 🏡 ${field}</td><td>${todayCount.toLocaleString()}</td><td><b>${total.toLocaleString()}</b></td><td>${fieldMorts.length.toLocaleString()} سجل</td><td colspan="2"></td>
    </tr>
    <tr id="mortDetail${i}" class="hidden"><td colspan="6">
      <div class="tableWrap"><table><thead><tr><th>${t('thHall')}</th><th>${t('thLastDate')}</th><th>${t('thMortToday')}</th><th>${t('thMortTotal')}</th><th>نسبة النجاة</th><th>${t('thRecords')}</th></tr></thead><tbody>${detailRows}</tbody></table></div>
    </td></tr>`;
  }).join('');
  $('mortTable').innerHTML=`<thead><tr><th>${t('thField')}</th><th>${t('thMortToday')}</th><th>${t('thMortTotal')}</th><th>${t('thRecords')}</th><th colspan="2">${t('thDetails')}</th></tr></thead><tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--ink3);padding:18px">'+t('noRecords')+' هلاك</td></tr>'}</tbody>`;
}
function deleteMort(id){if(!isAdmin())return;if(confirm('حذف سجل الهلاك؟')){let old=data.morts.find(m=>m.id===id);data.morts=data.morts.filter(m=>m.id!==id);if(old)updateBatchArchiveStatus(data.batches.find(b=>b.id===old.batchId));save();renderAll()}}
