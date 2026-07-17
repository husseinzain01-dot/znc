// ── SUPABASE CLOUD SYNC ──
const SUPABASE_URL='https://tvuymajwnrzlibxzfdhy.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2dXltYWp3bnJ6bGlieHpmZGh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODcxMDMsImV4cCI6MjA5NjE2MzEwM30.pr9dxBM9Ob75T0lg063_y-O3Q6BgL7o6FAM-9eLODj4';
const SUPABASE_STATE_ID='main';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let cloudReady=true;
let cloudBusy=false;

async function pullCloud(){
  if(!cloudReady) return false;
  // RLS: تأكد من وجود جلسة مسجّلة قبل الطلب
  const {data:session}=await sb.auth.getSession();
  if(!session?.session) return false;
  try{
    const {data:rows,error}=await sb.from('app_state').select('data').eq('id',SUPABASE_STATE_ID);
    if(error){
      // RLS rejection — المستخدم غير مصرّح
      if(error.code==='PGRST301'||error.message?.includes('row-level security')){
        console.warn('RLS: غير مصرّح بقراءة البيانات');
        if($('dbState'))$('dbState').textContent='⛔ غير مصرّح';
        return false;
      }
      throw error;
    }
    if(rows&&rows[0]&&rows[0].data){
      data={...data,...rows[0].data};
      data.batches=(data.batches||[]).map(migrateBatch);
      data.fields=data.fields||[];data.halls=data.halls||[];
      data.weights=data.weights||[];data.feeds=data.feeds||[];
      data.meds=data.meds||[];data.subUsers=data.subUsers||[];
      migrateWeightsToGrams();_applyGuideWeights();
      localStorage.setItem(STORE,JSON.stringify(data));
      if($('dbState'))$('dbState').textContent=t('dbConnected');
      if(currentUser)renderAll();
      return true;
    }
    return false;
  }catch(e){
    console.warn('Supabase pull failed:',e);
    if($('dbState'))$('dbState').textContent=t('dbLocalOnly');
    return false;
  }
}

async function pushCloud(){
  if(!cloudReady||cloudBusy) return false;
  // RLS: تأكد من وجود جلسة مسجّلة قبل الحفظ
  const {data:session}=await sb.auth.getSession();
  if(!session?.session) return false;
  cloudBusy=true;
  try{
    const {error}=await sb.from('app_state').upsert({id:SUPABASE_STATE_ID,data:data,updated_at:new Date().toISOString()});
    if(error){
      if(error.code==='PGRST301'||error.message?.includes('row-level security')){
        console.warn('RLS: غير مصرّح بالكتابة');
        if($('dbState'))$('dbState').textContent='⛔ غير مصرّح بالحفظ';
        return false;
      }
      throw error;
    }
    if($('dbState'))$('dbState').textContent=t('dbSaved')+' '+new Date().toLocaleTimeString('ar-IQ',{hour:'2-digit',minute:'2-digit'});
    return true;
  }catch(e){
    console.warn('Supabase push failed:',e);
    if($('dbState'))$('dbState').textContent=t('dbSaveFail');
    return false;
  }finally{cloudBusy=false;}
}

function startRealtimeSync(){
  sb.channel('app_state_changes')
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'app_state',filter:`id=eq.${SUPABASE_STATE_ID}`},()=>{
      pullCloud();
    })
    .subscribe();
}

const STORE='chicken_field_system_v22_data';
const OLD_STORES=['chicken_field_system_v21_data','chicken_field_system_v11_data'];
