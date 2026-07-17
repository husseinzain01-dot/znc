// ── EDIT RECORD MODAL ──
let _editType='',_editId=0;

function openEditRecord(type,id){
  _editType=type;_editId=id;
  let modal=$('editRecordModal');
  let titles={weight:'تعديل سجل الوزن',feed:'تعديل سجل العلف',med:'تعديل سجل الدواء/اللقاح',mort:'تعديل سجل الهلاك',market:'تعديل سجل التسويق'};
  $('editModalTitle').textContent=titles[type]||'تعديل السجل';
  let body='';
  if(type==='weight'){
    let r=(data.weights||[]).find(x=>x.id===id);if(!r)return;
    let b=(data.batches||[]).find(x=>x.id===r.batchId);
    let bName=b?b.name:'';
    body=`
      <div class="formGrid">
        <div class="formGroup" style="grid-column:1/-1"><label>الوجبة / القاعة</label><input type="text" value="${esc(bName+' — '+(r.hall||''))} " readonly style="background:#f1f5f9;color:#64748b"></div>
        <div class="formGroup"><label>التاريخ</label><input id="em_date" type="date" value="${r.date||''}"></div>
        <div class="formGroup"><label>عمر الطير (يوم)</label><input id="em_ageDays" type="number" value="${r.ageDays!=null?r.ageDays:''}"></div>
        <div class="formGroup"><label>الحي (طير)</label><input id="em_alive" type="number" value="${r.alive||''}"></div>
        <div class="formGroup"><label>الوزن الفعلي (غم)</label><input id="em_actual" type="number" value="${r.actual_weight_grams||''}"></div>
        <div class="formGroup"><label>الكايد (غم)</label><input id="em_guide" type="number" value="${r.guideWeightGrams||''}"></div>
        <div class="formGroup" style="grid-column:1/-1"><label>ملاحظة</label><input id="em_note" type="text" value="${esc(r.note||'')}"></div>
      </div>`;
  } else if(type==='feed'){
    let r=(data.feeds||[]).find(x=>x.id===id);if(!r)return;
    let b=(data.batches||[]).find(x=>x.id===r.batchId);
    let bName=b?b.name:'';
    let ftOpts=['بادئ','نامي','ناهي','بادئ+نامي','نامي+ناهي'].map(t=>`<option${r.feedType===t?' selected':''}>${t}</option>`).join('');
    body=`
      <div class="formGrid">
        <div class="formGroup" style="grid-column:1/-1"><label>الوجبة / القاعة</label><input type="text" value="${esc(bName+' — '+(r.hall||''))}" readonly style="background:#f1f5f9;color:#64748b"></div>
        <div class="formGroup"><label>التاريخ</label><input id="em_date" type="date" value="${r.date||''}"></div>
        <div class="formGroup"><label>عمر الطير (يوم)</label><input id="em_ageDays" type="number" value="${r.ageDays!=null?r.ageDays:''}"></div>
        <div class="formGroup"><label>نوع العلف</label><select id="em_feedType">${ftOpts}</select></div>
        <div class="formGroup"><label>الكمية (كغم)</label><input id="em_qty" type="number" step="0.01" value="${r.qty||''}"></div>
        <div class="formGroup" style="grid-column:1/-1"><label>ملاحظة</label><input id="em_note" type="text" value="${esc(r.note||'')}"></div>
      </div>`;
  } else if(type==='med'){
    let r=(data.meds||[]).find(x=>x.id===id);if(!r)return;
    let b=(data.batches||[]).find(x=>x.id===r.batchId);
    let bName=b?b.name:'';
    body=`
      <div class="formGrid">
        <div class="formGroup" style="grid-column:1/-1"><label>الوجبة / القاعة</label><input type="text" value="${esc(bName+' — '+(r.hall||''))}" readonly style="background:#f1f5f9;color:#64748b"></div>
        <div class="formGroup"><label>التاريخ</label><input id="em_date" type="date" value="${r.date||''}"></div>
        <div class="formGroup"><label>عمر الطير (يوم)</label><input id="em_ageDays" type="number" value="${r.ageDays!=null?r.ageDays:''}"></div>
        <div class="formGroup"><label>النوع</label><input id="em_type" type="text" value="${esc(r.type||'')}"></div>
        <div class="formGroup"><label>الاسم / المادة</label><input id="em_name" type="text" value="${esc(r.name||'')}"></div>
        <div class="formGroup"><label>الجرعة</label><input id="em_dose" type="text" value="${esc(r.dose||'')}"></div>
        <div class="formGroup"><label>الكمية</label><input id="em_qty" type="number" step="0.01" value="${r.qty||''}"></div>
        <div class="formGroup" style="grid-column:1/-1"><label>ملاحظة</label><input id="em_note" type="text" value="${esc(r.note||'')}"></div>
      </div>`;
  } else if(type==='mort'){
    let r=(data.morts||[]).find(x=>x.id===id);if(!r)return;
    let b=(data.batches||[]).find(x=>x.id===r.batchId);
    let bName=b?b.name:'';
    body=`
      <div class="formGrid">
        <div class="formGroup" style="grid-column:1/-1"><label>الوجبة / القاعة</label><input type="text" value="${esc(bName+' — '+(r.hall||''))}" readonly style="background:#f1f5f9;color:#64748b"></div>
        <div class="formGroup"><label>التاريخ</label><input id="em_date" type="date" value="${r.date||''}"></div>
        <div class="formGroup"><label>عمر الطير (يوم)</label><input id="em_ageDays" type="number" value="${r.ageDays!=null?r.ageDays:''}"></div>
        <div class="formGroup"><label>العدد</label><input id="em_count" type="number" value="${r.count||''}"></div>
        <div class="formGroup" style="grid-column:1/-1"><label>السبب</label><input id="em_reason" type="text" value="${esc(r.reason||'')}"></div>
      </div>`;
  } else if(type==='market'){
    let r=(data.markets||[]).find(x=>x.id===id);if(!r)return;
    let b=(data.batches||[]).find(x=>x.id===r.batchId);
    let bName=b?b.name:'';
    let stOpts=['تسويق إلى المجزرة','بيع مباشر','تحويل','أخرى'].map(s=>`<option${r.status===s?' selected':''}>${s}</option>`).join('');
    body=`
      <div class="formGrid">
        <div class="formGroup" style="grid-column:1/-1"><label>الوجبة / القاعة</label><input type="text" value="${esc(bName+' — '+(r.hall||''))}" readonly style="background:#f1f5f9;color:#64748b"></div>
        <div class="formGroup"><label>التاريخ</label><input id="em_date" type="date" value="${r.date||''}"></div>
        <div class="formGroup"><label>العدد</label><input id="em_count" type="number" value="${r.count||''}"></div>
        <div class="formGroup"><label>النوع</label><select id="em_status">${stOpts}</select></div>
        <div class="formGroup" style="grid-column:1/-1"><label>ملاحظة</label><input id="em_note" type="text" value="${esc(r.note||'')}"></div>
      </div>`;
  }
  $('editModalBody').innerHTML=body;
  modal.classList.add('show');
}

function closeEditRecord(){
  $('editRecordModal').classList.remove('show');
  _editType='';_editId=0;
}

function saveEditRecord(){
  if(!_editType||!_editId)return;
  let v=id=>$(id)?$(id).value:'';
  let n=id=>$(id)?+$(id).value||0:0;

  if(_editType==='weight'){
    let r=(data.weights||[]).find(x=>x.id===_editId);if(!r)return;
    r.date=v('em_date')||r.date;
    let agV=v('em_ageDays');r.ageDays=agV!==''?+agV:r.ageDays;
    r.alive=n('em_alive')||r.alive;
    let actual=n('em_actual');let guide=n('em_guide');
    if(actual)r.actual_weight_grams=actual;
    if(guide)r.guideWeightGrams=guide;
    if(actual&&guide){r.achievementPct=+(actual/guide*100).toFixed(1);r.diff=+(r.achievementPct-100).toFixed(1);}
    if(actual){r.avgWeight=+(actual/1000).toFixed(3);}
    r.note=v('em_note');

  } else if(_editType==='feed'){
    let r=(data.feeds||[]).find(x=>x.id===_editId);if(!r)return;
    r.date=v('em_date')||r.date;
    let agV=v('em_ageDays');r.ageDays=agV!==''?+agV:r.ageDays;
    r.feedType=v('em_feedType')||r.feedType;
    let qty=n('em_qty');if(qty)r.qty=qty;
    r.note=v('em_note');
    if(r.qty&&r.hallId){let b=(data.batches||[]).find(x=>x.id===r.batchId);if(b){let alive=batchHallAlive(b,+r.hallId);r.gramsPerBird=alive?parseFloat((r.qty*1000/alive).toFixed(2)):0;}}

  } else if(_editType==='med'){
    let r=(data.meds||[]).find(x=>x.id===_editId);if(!r)return;
    r.date=v('em_date')||r.date;
    let agV=v('em_ageDays');r.ageDays=agV!==''?+agV:r.ageDays;
    r.type=v('em_type')||r.type;
    r.name=v('em_name')||r.name;
    r.dose=v('em_dose');
    let qty=n('em_qty');if(qty)r.qty=qty;
    r.note=v('em_note');

  } else if(_editType==='mort'){
    let r=(data.morts||[]).find(x=>x.id===_editId);if(!r)return;
    r.date=v('em_date')||r.date;
    let agV=v('em_ageDays');r.ageDays=agV!==''?+agV:r.ageDays;
    let cnt=n('em_count');if(cnt)r.count=cnt;
    r.reason=v('em_reason');

  } else if(_editType==='market'){
    let r=(data.markets||[]).find(x=>x.id===_editId);if(!r)return;
    r.date=v('em_date')||r.date;
    let cnt=n('em_count');if(cnt)r.count=cnt;
    r.status=v('em_status')||r.status;
    r.note=v('em_note');
  }

  save();renderAll();closeEditRecord();msg('تم حفظ التعديل');