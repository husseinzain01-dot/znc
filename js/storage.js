// ── SAVE / LOAD ──
function save(){
  try{
    localStorage.setItem(STORE,JSON.stringify(data));
    localStorage.setItem(STORE+'_lastSave',new Date().toISOString());
    pushCloud();
    let ts=new Date().toLocaleTimeString('ar-IQ',{hour:'2-digit',minute:'2-digit'});
    $('dbState').textContent=t('dbSaved')+' '+ts;
    msg('تم الحفظ');return true;
  }catch(e){msg('⚠ '+t('errSave')+': '+e.message);return false;}
}
function load(){
  try{
    let raw=localStorage.getItem(STORE);
    if(!raw){for(const s of OLD_STORES){let old=localStorage.getItem(s);if(old){raw=old;break}}}
    if(raw){
      let parsed=JSON.parse(raw);
      data={...data,...parsed};
      data.batches=(data.batches||[]).map(migrateBatch);
      data.fields=data.fields||[];
      data.halls=data.halls||[];
      data.weights=data.weights||[];
      migrateWeightsToGrams();
      _applyGuideWeights();
      data.subUsers=data.subUsers||[];
      data.markets=(data.markets||[]).map(m=>({...m,status:'تسويق إلى المجزرة'}));
    }
    let ls=localStorage.getItem(STORE+'_lastSave');
    $('dbState').textContent=ls?t('dbLastSave')+': '+new Date(ls).toLocaleString('ar-IQ',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):t('dbReady');
  }catch(e){msg('⚠ '+t('errLoad')+': '+e.message)}
  $('mortDate').value=today();$('marketDate').value=today();$('transferDate').value=today();
  renderAll();
  pullCloud();
}
function migrateBatch(b){
  let vb=+b.vaccineDeaths||0,iso=+b.isolatedBirds||0,hat=+b.hatched||0;
  let fixedNet=+b.netHatch||Math.max(0,hat-vb-iso);
  let eggs=+b.eggs||0;let fb=+b.fieldBirds||0;
  let setEggs=(+b.setEggs||0)>0?+b.setEggs:Math.max(0,eggs-(+b.badEggs||0));
  let fixedRate=(+b.fixedHatchRate||0)>0?+b.fixedHatchRate:(eggs?+((fixedNet/eggs)*100).toFixed(2):0);
  return{...b,eggReceiveDate:b.eggReceiveDate||'',targetField:b.targetField||b.field||'',birdStrain:b.birdStrain||(b.type==='بياض'?'بياض تجاري':'Ross 308'),supplier:b.supplier||'',company:b.company||'',setEggs,transferDate:b.transferDate||'',fieldEntryDate:b.fieldEntryDate||b.transferDate||'',field:b.field||'',hall:b.hall||'',hallId:b.hallId||null,hatched:b.hatched||'',vaccineDeaths:vb,isolatedBirds:iso,netHatch:fixedNet,fieldBirds:fb,fixedHatchRate:fixedRate,transferBirdWeight:+b.transferBirdWeight||0};
}


function loadUsersBeforeLogin(){
  try{
    let raw=localStorage.getItem(STORE);
    if(!raw){
      for(const s of OLD_STORES){
        let old=localStorage.getItem(s);
        if(old){raw=old;break}
      }
    }
    if(raw){
      let parsed=JSON.parse(raw);
      data={...data,...parsed};
      data.batches=(data.batches||[]).map(migrateBatch);
      data.fields=data.fields||[];
      data.halls=data.halls||[];
      data.subUsers=data.subUsers||[];
    }
  }catch(e){
    console.warn('تعذر تحميل المستخدمين قبل الدخول:',e);
  }
}
