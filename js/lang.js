// ── LANGUAGE SYSTEM ──
const LANGS={
  ar:{
    dir:'rtl',
    appName:'زهور الوطن', appSub:'نظام إدارة الوجبات والحقول', appSub2:'للإنتاج الزراعي',
    username:'اسم المستخدم', password:'كلمة المرور', login:'تسجيل الدخول', logout:'تسجيل الخروج',
    roleAdmin:'مدير النظام', roleUser:'مستخدم',
    // nav labels
    navHome:'الرئيسية', navOps:'العمليات', navMgmt:'الإدارة',
    // nav items
    navDash:'لوحة المعلومات', navBatch:'وجبة تفقيس', navTransfer:'نقل الفقسة',
    navLayerBuy:'شراء البياض', navMort:'الهلاكات', navMarket:'التسويق',
    navFields:'الحقول', navSuppliers:'الموردين والشركات', navUsers:'المستخدمون',
    navFeed:'العلف', navMeds:'الأدوية واللقاحات', navWeights:'أوزان الطير',
    navGuide:'دليل الكايد', navCycle:'دورة الحقل', navCharts:'مخطط بياني',
    navCal:'الروزنامة', navReports:'التقارير', navArchive:'الأرشيف', navSettings:'الإعدادات',
    // page titles
    titleDash:'لوحة المعلومات', titleBatch:'وجبة تفقيس', titleTransfer:'نقل الفقسة',
    titleLayerBuy:'شراء البياض', titleMort:'الهلاكات', titleMarket:'التسويق',
    titleFields:'الحقول', titleSuppliers:'الموردين', titleUsers:'المستخدمون',
    titleFeed:'العلف', titleMeds:'الأدوية واللقاحات', titleWeights:'أوزان الطير',
    titleGuide:'دليل الكايد', titleCycle:'دورة الحقل', titleCharts:'مخطط بياني',
    titleCal:'الروزنامة', titleReports:'التقارير', titleArchive:'الأرشيف', titleSettings:'الإعدادات',
    backHome:'الرئيسية',
    // card titles
    ctActiveBatches:'الوجبات النشطة', ctFieldChart:'مخطط بياني لحالة الحقل',
    ctNewBatch:'تسجيل وجبة تفقيس', ctSuppliers:'الموردين والشركات',
    ctBuyLayer:'شراء طير البياض', ctLayerList:'وجبات البياض المشتراة',
    ctTransfer:'نقل الفقسة إلى الحقل', ctTransferList:'الوجبات المنقولة',
    ctLogMort:'تسجيل هلاك', ctMortLog:'سجل الهلاكات',
    ctLogSale:'تسجيل عملية تسويق', ctSaleLog:'سجل التسويق',
    ctAddField:'إضافة / تعديل حقل', ctHallsMgmt:'إدارة قاعات الحقل:',
    ctFieldsList:'قائمة الحقول', ctAddUser:'إضافة / تعديل مستخدم',
    ctUsersList:'قائمة المستخدمين', ctCal:'الروزنامة',
    ctFeedHalls:'استهلاك العلف لكل قاعة', ctFeedLog:'سجل العلف',
    ctMedsHalls:'الأدوية واللقاحات لكل قاعة', ctMedsLog:'سجل الأدوية واللقاحات',
    ctWeightHalls:'أوزان القاعات', ctWeightLog:'سجل أوزان القاعات',
    ctGuide:'دليل الكايد (الوزن القياسي حسب العمر)', ctCycle:'دورة الحقل',
    ctReports:'مركز التقارير', ctArchive:'أرشيف الوجبات المنتهية', ctSettings:'الإعدادات',
    // buttons
    btnSave:'حفظ', btnAdd:'إضافة', btnEdit:'تعديل', btnDelete:'حذف', btnClear:'مسح',
    btnSearch:'بحث', btnExport:'تصدير', btnClose:'إغلاق', btnConfirm:'تأكيد',
    btnDistribute:'وزّع على القاعات',
    // form labels
    lblBatchName:'اسم الوجبة', lblField:'الحقل', lblHall:'القاعة', lblDate:'التاريخ',
    lblBirdAge:'عمر الطير (يوم)', lblCount:'العدد', lblReason:'السبب', lblNote:'ملاحظة',
    lblBatch:'الوجبة', lblType:'النوع', lblStrain:'سلالة الطير', lblSupplier:'المورد',
    lblCompany:'الشركة', lblWeight:'الوزن', lblQty:'الكمية',
    // table headers
    thDate:'التاريخ', thBatch:'الوجبة', thField:'الحقل', thHall:'القاعة',
    thCount:'العدد', thReason:'السبب', thNote:'ملاحظة', thAction:'إجراء',
    thAge:'العمر', thType:'النوع', thWeight:'الوزن', thDelete:'حذف',
    thStatus:'الحالة', thName:'الاسم', thCapacity:'السعة', thAlive:'الحي',
    thQty:'الكمية', thKg:'الكيلو', thTotal:'الإجمالي', thAmount:'المبلغ',
    thPrice:'السعر', thSupplier:'المورد', thMed:'الدواء', thDose:'الجرعة',
    thAvg:'المتوسط', thSupplierName:'اسم المورد', thPhone:'رقم الهاتف',
    thEmail:'البريد', thAddress:'العنوان', thBatchNo:'رقم الدفعة',
    thEntryDate:'تاريخ الإدخال', thExitDate:'تاريخ الخروج', thBirdCount:'عدد الطيور',
    statActive:'نشط', statDone:'منتهي', statSold:'مباع', statTransferred:'محول', statArchived:'مؤرشف',
    noRecords:'لا توجد سجلات', noData:'لا توجد بيانات', noBatches:'لا توجد دفعات',
    noMort:'لا توجد وفيات', noTransfers:'لا توجد تحويلات', noSales:'لا توجد مبيعات',
    noFeed:'لا يوجد تغذية', noMeds:'لا يوجد أدوية', noWeights:'لا توجد أوزان',
    noFields:'لا توجد حقول', noSuppliers:'لا يوجد موردون', noArchive:'لا يوجد أرشيف',
    noActiveBatches:'لا توجد وجبات نشطة داخل القاعة', noTransferredBatches:'لا توجد وجبات منقولة لهذا الحقل',
    noArchivedBatches:'لا توجد وجبات مؤرشفة',
    thNet:'الصافي', thMort:'الهلاك', thSold:'المسوق', thLastWeight:'آخر وزن',
    thRemainHatch:'متبقي بالمفقس', thHatched:'الفاقس', thCandling:'الفحص الضوئي',
    thVaccMort:'هلاك اللقاح', thIsolation:'العزل', thNetTransfer:'الصافي المنقول',
    thHatchRate:'نسبة الفقس', thActual:'الفعلي (غم)', thGuide:'الكايد (غم)',
    thDiff:'فرق الوزن', thAchieve:'نسبة الكايد', thRecords:'السجلات',
    thFeedType:'نوع العلف', thMaterial:'المادة', thEggs:'البيض',
    thHalls:'القاعات', thSuccess:'النجاح', thLastDate:'آخر تاريخ',
    thAliveLeft:'الحي المتبقي',
    secWeights:'الأوزان', secFeed:'الأعلاف', secMeds:'الأدوية واللقاحات',
    secMort:'الهلاك', secMarket:'التسويق',
    thEggReceive:'استلام البيض', thTargetField:'الحقل المراد', thHatching:'التفقيس',
    thCompany:'الشركة', thBatchCount:'عدد الوجبات', thStrains:'السلالات', thFields:'الحقول',
    thCurBatch:'الوجبة الحالية', thBirdEntry:'دخول الطير', thCycleEnd:'نهاية الدورة',
    thCurBird:'الطير الحالي', thLastSale:'آخر تسويق', thMaintStart:'بداية الصيانة', thMaintEnd:'نهاية الصيانة',
    thAvgWeight:'معدل الوزن', thFeedToday:'علف اليوم', thFeedTotal:'مجموع العلف',
    thVaccToday:'لقاحات اليوم', thMortTotal:'مجموع الهلاك', thMortToday:'هلاك اليوم',
    thSaleTotal:'مجموع التسويق', thSaleToday:'تسويق اليوم', thTotalBirds:'إجمالي الطيور',
    thTotalFeed:'إجمالي العلف', thTotalVacc:'إجمالي اللقاحات', thOccupancy:'الإشغال',
    thLastMaterial:'آخر مادة', thBatches:'الوجبات', thLiveCap:'الحي / السعة',
    thChickWeight:'وزن الصوص', thActualWeight:'معدل الوزن الفعلي', thGuideWeight:'الكايد المتوقع',
    thActiveBatches:'الوجبات النشطة', thUsername:'اسم المستخدم', thRole:'الدور',
    thAssignedFields:'الحقول المخصصة', thQtyKg:'الكمية (كغم)',
    thAvailable:'المتاح', thLastType:'آخر نوع', thDetails:'تفاصيل', thAdjust:'تعديل العدد',
    thFeedTodayTotal:'العلف اليوم/الكلي', thVaccTodayTotal:'لقاحات اليوم/الكلي',
    noHalls:'لا توجد قاعات لهذا الحقل', lblFeed:'علف', lblMeds:'لقاحات',
    allBatches:'كل الوجبات', allFields:'كل الحقول', allHalls:'كل القاعات', allItems:'الكل',
    laterOnTransfer:'يحدد لاحقاً عند النقل',
    fieldBusy:'⚠️ الحقل مشغول بـ', fieldFree:'✅ الحقل متاح', canContinue:'يمكنك المتابعة',
    calcAuto:'يحسب تلقائياً', loading:'جاري التحميل...',
    adminRole:'مدير النظام', userRole:'مستخدم',
    dbConnected:'متصل بسوبابيس ✅', dbLocalOnly:'حفظ محلي فقط ⚠️',
    dbSaveFail:'تعذر الحفظ السحابي ⚠️', dbReady:'جاهز',
    dbSaved:'محفوظ', dbLastSave:'آخر حفظ',
    loginError:'اسم المستخدم أو كلمة المرور غير صحيحة',
    errSave:'خطأ في الحفظ', errLoad:'خطأ في تحميل البيانات',
    errBatchRequired:'يرجى إدخال اسم الوجبة وتاريخ الترقيد',
    errSelectBatch:'اختر وجبة أولاً', errSelectField:'اختر الحقل المستهدف أولاً',
    errEnterNet:'أدخل صافي الطير الجاهز للنقل أولاً',
    errAdminOnly:'هذه العملية بصلاحية المدير فقط',
    errPositiveNum:'أدخل عدد صحيح أكبر من صفر',
    errBatchNotFound:'الوجبة غير موجودة', errBatchNotTransferred:'هذه الوجبة غير منقولة',
    dashAdminDesc:'عرض كامل لجميع الوجبات والحقول.', dashUserDesc:'عرض مخصص لحقولك فقط.'
  },
  en:{
    dir:'ltr',
    appName:'Zuhour Al-Watan', appSub:'Batch & Field Management System', appSub2:'Agricultural Production',
    username:'Username', password:'Password', login:'Sign In', logout:'Logout',
    roleAdmin:'System Admin', roleUser:'User',
    navHome:'Home', navOps:'Operations', navMgmt:'Management',
    navDash:'Dashboard', navBatch:'New Batch', navTransfer:'Transfer',
    navLayerBuy:'Buy Layers', navMort:'Mortality', navMarket:'Sales',
    navFields:'Fields', navSuppliers:'Suppliers', navUsers:'Users',
    navFeed:'Feed', navMeds:'Medications', navWeights:'Bird Weights',
    navGuide:'Weight Guide', navCycle:'Field Cycle', navCharts:'Charts',
    navCal:'Calendar', navReports:'Reports', navArchive:'Archive', navSettings:'Settings',
    titleDash:'Dashboard', titleBatch:'New Batch', titleTransfer:'Transfer to Field',
    titleLayerBuy:'Buy Layers', titleMort:'Mortality', titleMarket:'Sales',
    titleFields:'Fields', titleSuppliers:'Suppliers', titleUsers:'Users',
    titleFeed:'Feed', titleMeds:'Medications', titleWeights:'Bird Weights',
    titleGuide:'Weight Guide', titleCycle:'Field Cycle', titleCharts:'Charts',
    titleCal:'Calendar', titleReports:'Reports', titleArchive:'Archive', titleSettings:'Settings',
    backHome:'Home',
    ctActiveBatches:'Active Batches', ctFieldChart:'Field Status Chart',
    ctNewBatch:'Register Hatch Batch', ctSuppliers:'Suppliers & Companies',
    ctBuyLayer:'Buy Layer Birds', ctLayerList:'Purchased Layer Batches',
    ctTransfer:'Transfer to Field', ctTransferList:'Transferred Batches',
    ctLogMort:'Log Mortality', ctMortLog:'Mortality Log',
    ctLogSale:'Log Sale', ctSaleLog:'Sales Log',
    ctAddField:'Add / Edit Field', ctHallsMgmt:'Manage Field Halls:',
    ctFieldsList:'Fields List', ctAddUser:'Add / Edit User',
    ctUsersList:'Users List', ctCal:'Calendar',
    ctFeedHalls:'Feed Consumption per Hall', ctFeedLog:'Feed Log',
    ctMedsHalls:'Medications per Hall', ctMedsLog:'Medications Log',
    ctWeightHalls:'Hall Weights', ctWeightLog:'Weight Records',
    ctGuide:'Weight Guide (Standard by Age)', ctCycle:'Field Cycle',
    ctReports:'Reports Center', ctArchive:'Archived Batches', ctSettings:'Settings',
    btnSave:'Save', btnAdd:'Add', btnEdit:'Edit', btnDelete:'Delete', btnClear:'Clear',
    btnSearch:'Search', btnExport:'Export', btnClose:'Close', btnConfirm:'Confirm',
    btnDistribute:'Distribute to Halls',
    lblBatchName:'Batch Name', lblField:'Field', lblHall:'Hall', lblDate:'Date',
    lblBirdAge:'Bird Age (day)', lblCount:'Count', lblReason:'Reason', lblNote:'Note',
    lblBatch:'Batch', lblType:'Type', lblStrain:'Strain', lblSupplier:'Supplier',
    lblCompany:'Company', lblWeight:'Weight', lblQty:'Quantity',
    thDate:'Date', thBatch:'Batch', thField:'Field', thHall:'Hall',
    thCount:'Count', thReason:'Reason', thNote:'Note', thAction:'Action',
    thAge:'Age', thType:'Type', thWeight:'Weight', thDelete:'Delete',
    thStatus:'Status', thName:'Name', thCapacity:'Capacity', thAlive:'Live',
    thQty:'Qty', thKg:'Kg', thTotal:'Total', thAmount:'Amount',
    thPrice:'Price', thSupplier:'Supplier', thMed:'Medicine', thDose:'Dose',
    thAvg:'Average', thSupplierName:'Supplier Name', thPhone:'Phone',
    thEmail:'Email', thAddress:'Address', thBatchNo:'Batch No.',
    thEntryDate:'Entry Date', thExitDate:'Exit Date', thBirdCount:'Bird Count',
    statActive:'Active', statDone:'Closed', statSold:'Sold', statTransferred:'Transferred', statArchived:'Archived',
    noRecords:'No records found', noData:'No data available', noBatches:'No batches',
    noMort:'No mortality records', noTransfers:'No transfers', noSales:'No sales',
    noFeed:'No feed records', noMeds:'No medications', noWeights:'No weight records',
    noFields:'No fields', noSuppliers:'No suppliers', noArchive:'No archived batches',
    noActiveBatches:'No active batches in this hall', noTransferredBatches:'No batches transferred to this field',
    noArchivedBatches:'No archived batches',
    thNet:'Net', thMort:'Mortality', thSold:'Sold', thLastWeight:'Last Weight',
    thRemainHatch:'Remain in Hatchery', thHatched:'Hatched', thCandling:'Candling',
    thVaccMort:'Vacc. Mortality', thIsolation:'Isolation', thNetTransfer:'Net Transferred',
    thHatchRate:'Hatch Rate', thActual:'Actual (g)', thGuide:'Guide (g)',
    thDiff:'Diff', thAchieve:'Achievement %', thRecords:'Records',
    thFeedType:'Feed Type', thMaterial:'Material', thEggs:'Eggs',
    thHalls:'Halls', thSuccess:'Success', thLastDate:'Last Date',
    thAliveLeft:'Live Remaining',
    secWeights:'Weights', secFeed:'Feed', secMeds:'Medications & Vaccines',
    secMort:'Mortality', secMarket:'Sales',
    thEggReceive:'Egg Receive', thTargetField:'Target Field', thHatching:'Hatching',
    thCompany:'Company', thBatchCount:'Batches', thStrains:'Strains', thFields:'Fields',
    thCurBatch:'Current Batch', thBirdEntry:'Bird Entry', thCycleEnd:'Cycle End',
    thCurBird:'Current Birds', thLastSale:'Last Sale', thMaintStart:'Maint. Start', thMaintEnd:'Maint. End',
    thAvgWeight:'Avg Weight', thFeedToday:"Today's Feed", thFeedTotal:'Total Feed',
    thVaccToday:"Today's Vacc", thMortTotal:'Total Mort.', thMortToday:"Today's Mort.",
    thSaleTotal:'Total Sales', thSaleToday:"Today's Sales", thTotalBirds:'Total Birds',
    thTotalFeed:'Total Feed', thTotalVacc:'Total Vacc', thOccupancy:'Occupancy',
    thLastMaterial:'Last Material', thBatches:'Batches', thLiveCap:'Live / Cap',
    thChickWeight:'Chick Weight', thActualWeight:'Actual Weight', thGuideWeight:'Guide Weight',
    thActiveBatches:'Active Batches', thUsername:'Username', thRole:'Role',
    thAssignedFields:'Assigned Fields', thQtyKg:'Qty (kg)',
    thAvailable:'Available', thLastType:'Last Type', thDetails:'Details', thAdjust:'Adjust Count',
    thFeedTodayTotal:'Feed Today/Total', thVaccTodayTotal:'Vacc Today/Total',
    noHalls:'No halls for this field', lblFeed:'feed', lblMeds:'vaccinations',
    calcAuto:'Auto calculated', loading:'Loading...',
    adminRole:'System Admin', userRole:'User',
    noHalls:'No halls for this field', lblFeed:'feed', lblMeds:'vaccinations',
    allBatches:'All Batches', allFields:'All Fields', allHalls:'All Halls', allItems:'All',
    laterOnTransfer:'Assigned later on transfer',
    fieldBusy:'⚠️ Field occupied by', fieldFree:'✅ Field available', canContinue:'you can continue',
    dbConnected:'Connected to Supabase ✅', dbLocalOnly:'Local save only ⚠️',
    dbSaveFail:'Cloud save failed ⚠️', dbReady:'Ready',
    dbSaved:'Saved', dbLastSave:'Last saved',
    loginError:'Incorrect username or password',
    errSave:'Save error', errLoad:'Error loading data',
    errBatchRequired:'Please enter batch name and hatch date',
    errSelectBatch:'Select a batch first', errSelectField:'Select a target field first',
    errEnterNet:'Enter the net bird count ready for transfer first',
    errAdminOnly:'This action requires admin privileges',
    errPositiveNum:'Enter a positive integer',
    errBatchNotFound:'Batch not found', errBatchNotTransferred:'This batch has not been transferred',
    dashAdminDesc:'Full view of all batches and fields.', dashUserDesc:'Filtered view for your fields only.'
  }
};

let currentLang = localStorage.getItem('cf_lang') || 'ar';

function t(key){ return (LANGS[currentLang]||LANGS.ar)[key] || LANGS.ar[key] || key; }

function applyLang(){
  const L = LANGS[currentLang];
  // dir و html
  document.documentElement.lang = currentLang;
  document.documentElement.dir = L.dir;
  document.body.dir = L.dir;
  // كل العناصر data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const k = el.getAttribute('data-i18n');
    if(t(k) !== k) el.textContent = t(k);
  });
  // زر اللغة
  const btn = document.getElementById('langBtnTxt');
  if(btn) btn.textContent = currentLang==='ar' ? 'EN' : 'عر';
  const btn2 = document.getElementById('langBtnTxt2');
  if(btn2) btn2.textContent = currentLang==='ar' ? 'EN' : 'عر';
  // user role
  if(currentUser) updateUserChip();
  // أعد بناء القائمة
  buildNav();
  // أعد رسم المحتوى الديناميكي
  if(typeof renderAll==='function') renderAll();
}

function toggleLang(){
  currentLang = currentLang==='ar' ? 'en' : 'ar';
  localStorage.setItem('cf_lang', currentLang);
  applyLang();
}

function updateUserChip(){
  if(!currentUser)return;
  $('userAvatar').textContent=currentUser.name.charAt(0).toUpperCase();
  $('userNameDisplay').textContent=currentUser.name;
  $('userRoleDisplay').textContent=currentUser.role==='admin'? t('roleAdmin') : t('roleUser');
}
