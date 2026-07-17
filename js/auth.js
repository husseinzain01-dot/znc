// ── LOGIN / LOGOUT ──
async function loginNow(){
  const u=($('loginUser').value||'').trim();
  const p=($('loginPass').value||'').trim();
  if(!u||!p)return showLoginError('أدخل البريد الإلكتروني وكلمة المرور');

  // Try Supabase Auth first (admin)
  const {data:authData,error}=await sb.auth.signInWithPassword({email:u,password:p});
  if(!error&&authData.user){
    const role=authData.user.user_metadata?.role||'admin';
    const fields=authData.user.user_metadata?.fields||null;
    currentUser={name:authData.user.user_metadata?.name||u,role,fields,email:u};
    startSession();
    await pullCloud();
    startRealtimeSync();
    renderAll();
    return;
  }

  showLoginError('بيانات الدخول غير صحيحة');
}
function showLoginError(msg){$('loginMsg').textContent=msg;}
function startSession(){
  sessionStorage.setItem('cf_logged','1');
  sessionStorage.setItem('cf_user',JSON.stringify(currentUser));
  $('loginBox').classList.add('hidden');
  $('app').classList.remove('hidden');
  load();
  buildNav();
  updateUserChip();
  applyLang();
  applyRoleVisibility();
}
function toggleSide(){
  let app=$('app');
  let isMobile=window.innerWidth<=768;
  if(isMobile){
    // على الموبايل: drawer يفتح/يغلق
    app.classList.toggle('sideOpen');
    let ov=$('sideOverlay');
    if(ov)ov.classList.toggle('show',app.classList.contains('sideOpen'));
  }else{
    // على الكمبيوتر: sidebar يضيق/يتسع
    app.classList.toggle('collapsed');
    sessionStorage.setItem('sideCollapsed',app.classList.contains('collapsed')?'1':'0');
  }
}
// إغلاق drawer على الموبايل عند تغيير الحجم
window.addEventListener('resize',()=>{
  if(window.innerWidth>768){
    $('app').classList.remove('sideOpen');
    let ov=$('sideOverlay');if(ov)ov.classList.remove('show');
    // استرجاع حالة collapsed
    if(sessionStorage.getItem('sideCollapsed')==='1')$('app').classList.add('collapsed');
  }
});
function logout(){sb.auth.signOut();sessionStorage.removeItem('cf_logged');sessionStorage.removeItem('cf_user');sessionStorage.removeItem('currentUser');location.reload()}