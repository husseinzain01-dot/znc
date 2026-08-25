// ── NAV ──
async function openLayerApp(event){
  if(event)event.preventDefault();
  try{
    const {data,error}=await sb.auth.getSession();
    const session=data&&data.session;
    if(!error&&session&&session.access_token&&session.refresh_token){
      sessionStorage.setItem('znc_layer_session_handoff',JSON.stringify({access_token:session.access_token,refresh_token:session.refresh_token}));
    }
  }catch(error){console.warn('تعذر تجهيز جلسة التحويل إلى البياض',error)}
  window.location.href='layer/';
  return false;
}
function buildNav(){
  let admin=isAdmin();
  const mi=ic=>`<span class="material-symbols-outlined">${ic}</span>`;
  let n=(icon,key,fn)=>`<button class="nav" onclick="show('${fn}',this)"><span class="navIcon">${mi(icon)}</span><span class="navText">${t(key)}</span></button>`;
  const layerHref='layer/';
  let html=`<div class="appModeSwitch" aria-label="التبديل بين اللحم والبياض">
    <button class="appModeBtn active" onclick="switchPublishedApp('meat')" title="إدارة اللحم"><span class="appModeIcon">🐔</span><span>اللحم</span></button>
    <a class="appModeBtn" href="${layerHref}" onclick="return openLayerApp(event)" title="إنتاج البياض"><span class="appModeIcon">🥚</span><span>البياض</span></a>
  </div>`;
  html+=`<div class="navLabel">${t('navHome')}</div>`;
  html+=`<button class="nav active" onclick="show('dash',this)"><span class="navIcon">${mi('dashboard')}</span><span class="navText">${t('navDash')}</span></button>`;
  if(admin){
    html+=`<div class="navLabel">${t('navOps')}</div>`;
    html+=n('egg','navBatch','batch');
    html+=n('swap_horiz','navTransfer','transfer');
    html+=n('storefront','navLayerBuy','layerPurchase');
  }else{
    html+=`<div class="navLabel">${t('navOps')}</div>`;
  }
  html+=n('heart_minus','navMort','mort');
  html+=n('sell','navMarket','market');
  html+=`<div class="navLabel">${t('navMgmt')}</div>`;
  if(admin){
    html+=n('home_work','navFields','fields');
    html+=n('business','navSuppliers','suppliers');
    html+=n('group','navUsers','users');
  }
  html+=n('grass','navFeed','feed');
  html+=n('vaccines','navMeds','meds');
  html+=n('scale','navWeights','weights');
  html+=n('menu_book','navGuide','guideRef');
  html+=n('autorenew','navCycle','fieldCycle');
  html+=n('bar_chart','navCharts','charts');
  html+=n('calendar_month','navCal','cal');
  html+=n('summarize','navReports','reports');
  html+=`<button class="nav" onclick="show('compare',this);renderCompare()"><span class="navIcon">${mi('compare_arrows')}</span><span class="navText">مقارنة الوجبات</span></button>`;
  html+=`<button class="nav" onclick="show('aiAnalysis',this)" style="background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(168,85,247,.12));border-right:3px solid #7c3aed"><span class="navIcon">${mi('psychology')}</span><span class="navText">🤖 تحليل ذكي</span></button>`;
  if(admin){
    html+=n('inventory_2','navArchive','archive');
    html+=n('settings','navSettings','settings');
  }
  $('sideNav').innerHTML=html;
}

function switchPublishedApp(mode){
  if(mode==='meat') show('dash',document.querySelector(`.nav[onclick*="'dash'"]`));
}

function show(id,btn,skipHistory){
  const adminOnly=['batch','transfer','layerPurchase','fields','suppliers','users','archive','settings'];
  if(adminOnly.includes(id)&&!isAdmin()){
    document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));
    $('dash').classList.remove('hidden');return;
  }
  document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));
  let pg=$(id);pg.classList.remove('hidden');
  // inner-page animation
  pg.classList.remove('innerPageWrap');void pg.offsetWidth;pg.classList.add('innerPageWrap');
  document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));
  let pageTitle='';
  // تفعيل زر السايدبار المناسب
  let matchBtn=btn||document.querySelector(`.nav[onclick*="'${id}'"]`);
  const titleKey='title'+id.charAt(0).toUpperCase()+id.slice(1);
  pageTitle = t(titleKey) || (matchBtn?matchBtn.textContent.trim():'');
  if(matchBtn) matchBtn.classList.add('active');
  $('title').textContent = pageTitle;
  // breadcrumb bar
  let bar=$('innerPageBar'),ipt=$('innerPageTitle');
  if(id==='dash'){bar.classList.add('hidden')}
  else{bar.classList.remove('hidden');if(ipt)ipt.textContent=pageTitle||$('title').textContent}
  // History API — زر الرجوع بالمتصفح
  if(!skipHistory){
    let state={page:id,title:pageTitle};
    if(history.state&&history.state.page===id){}
    else history.pushState(state,'',window.location.pathname+'#'+id);
  }
  // أغلق drawer الموبايل عند التنقل
  if(window.innerWidth<=768){
    $('app').classList.remove('sideOpen');
    let ov=$('sideOverlay');if(ov)ov.classList.remove('show');
  }
  renderAll();
  if(id==='transfer'){clearTransferForm();renderTransferredBatches();renderTransferAllocationsSummary();}
  if(id==='mort'){clearMortForm();}
  if(id==='market'){clearMarketForm();}
  if(id==='layerPurchase'){clearLayerPurchaseForm();renderLayerPurchase();}
  if(id==='suppliers'){renderSuppliers();}
  if(id==='feed'){clearFeedForm();renderFeed();}
  if(id==='meds'){clearMedForm();renderMeds();}
  if(id==='weights'){clearWeightForm();renderWeights();}
  if(id==='fieldCycle'){renderFieldCycle();}
  if(id==='guideRef'){
    if($('guideRefStrain')&&!$('guideRefStrain').options.length)onGuideRefTypeChange();
    else renderGuideRefTable();
  }
  if(id==='charts'){renderChartsPage();}
  if(id==='reports'){
    // تهيئة فلاتر التقرير
    if($('rptFrom')&&!$('rptFrom').value){
      let d=new Date();d.setMonth(d.getMonth()-1);
      $('rptFrom').value=d.toISOString().slice(0,10);
    }
    if($('rptTo')&&!$('rptTo').value)$('rptTo').value=today();
    renderReports();
  }
  if(id==='batch'){clearForm();}
  if(id==='fields'&&typeof clearFieldForm==='function'){clearFieldForm();}
  if(id==='users'&&typeof clearUserForm==='function'){clearUserForm();}
  if(id==='settings'){renderFixBatchSelect();}
}
