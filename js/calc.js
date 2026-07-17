// ── LAYER AGE HELPERS ──
// تحويل الأيام الكلية إلى {weeks, days}
function daysToWeeksAndDays(totalDays){
  let w=Math.floor(totalDays/7);
  let d=totalDays%7;
  return{weeks:w,days:d};
}
function fmtLayerAge(totalDays){
  if(totalDays<0)return '—';
  let{weeks,days}=daysToWeeksAndDays(totalDays);
  if(days===0)return `${weeks} أسبوع`;
  return `${weeks} أسبوع و${days} يوم`;
}
// الحد الأقصى للبياض = 140 أسبوع = 980 يوم
const LAYER_MAX_AGE_DAYS=980;
const BROILER_MAX_AGE_DAYS=40;

// ── CALC ──
function addDays(ds,n){
  let d=dateOnly(ds);
  if(!d)return '';
  d.setDate(d.getDate()+n);
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateOnly(ds){
  if(!ds)return null;
  const [y,m,d]=String(ds).slice(0,10).split('-').map(Number);
  return new Date(y,(m||1)-1,d||1,12,0,0,0);
}
function diffDays(a,b=today()){
  let A=dateOnly(a),B=dateOnly(b);
  if(!A||!B)return 0;
  return Math.max(0,Math.floor((B-A)/86400000));
}
function fmt(d){if(!d)return '—';return new Date(d+'T00:00:00').toLocaleDateString('ar-IQ')}

function calc(b,on=today()){
  let isLayer=(b.type==='بياض');
  let rawHatchAge=diffDays(b.hatchDate,on);
  let hatchAge=Math.min(21,rawHatchAge);
  let hatchComplete=!b.transferDate&&rawHatchAge===21;
  let hatchLate=!b.transferDate&&rawHatchAge>21;
  let expectedTransfer=addDays(b.hatchDate,21);
  let transferred=!!b.transferDate;
  let entryDate=b.fieldEntryDate||b.transferDate||'';

  // ── حساب عمر الطير ──
  // للبياض: إذا شراء → عمر مبدئي (بالأيام) + أيام منذ الدخول
  //          إذا مفقس → أيام منذ الدخول فقط (= 0 يوم دخول)
  // للحم: أيام منذ دخول الحقل، حد 40 يوم
  let rawFlockAge=0;
  let layerInitDays=0;
  if(isLayer){
    layerInitDays=(+b.layerInitWeeks||0)*7+(+b.layerInitDays||0);
    if(transferred&&entryDate){
      rawFlockAge=layerInitDays+diffDays(entryDate,on);
    }
  }else{
    rawFlockAge=transferred&&entryDate?diffDays(entryDate,on):0;
  }
  let maxAge=isLayer?LAYER_MAX_AGE_DAYS:BROILER_MAX_AGE_DAYS;
  let flockAge=Math.min(maxAge,rawFlockAge);

  let eggs=+b.eggs||0,badEggs=+b.badEggs||0;
  let validEggs=(+b.setEggs||0)>0?+b.setEggs:Math.max(0,eggs-badEggs);
  let est=validEggs;
  let hatched=(+b.hatched||0)>0?+b.hatched:est;
  let vaccineDeaths=+b.vaccineDeaths||0,isolated=+b.isolatedBirds||0,unfitBirds=+b.unfitBirds||0;
  let hatchLoss=vaccineDeaths+isolated+unfitBirds;
  let netHatch=(+b.netHatch||0)>0?+b.netHatch:Math.max(0,hatched-hatchLoss);
  let fieldBirds=Array.isArray(b.hallAllocations)&&b.hallAllocations.length?b.hallAllocations.reduce((s,a)=>s+(+a.birds||0),0):((+b.fieldBirds||0)>0?+b.fieldBirds:(transferred?netHatch:0));
  let mort=data.morts.filter(m=>m.batchId===b.id).reduce((s,m)=>s+(+m.count||0),0);
  let sold=data.markets.filter(m=>m.batchId===b.id).reduce((s,m)=>s+(+m.count||0),0);
  let alive=transferred?Math.max(0,fieldBirds-mort-sold):0;
  let completed=transferred&&fieldBirds>0&&alive<=0;
  let alertFlag=transferred&&(isLayer?flockAge>=(+b.alertAge||980):flockAge>=(+b.alertAge||35))&&!completed;
  return{rawHatchAge,hatchAge,hatchComplete,hatchLate,expectedTransfer,transferred,entryDate,rawFlockAge,flockAge,hatched,vaccineDeaths,isolated,hatchLoss,netHatch,fieldBirds,mort,sold,alive,completed,alert:alertFlag,est,isLayer,layerInitDays,marketDate:transferred?addDays(entryDate,(+b.marketAge||35)):''};
}
function hatchRate(b){let eggs=+b.eggs||0;if(!eggs)return '0.00';let c=calc(b);return ((c.netHatch/eggs)*100).toFixed(2);}
function successRate(b){let c=calc(b),base=c.fieldBirds||0;return base?((Math.max(0,base-c.mort)/base)*100).toFixed(2):'0.00'}
function statusBadge(b){
  let c=calc(b);
  if(c.completed)return '<span class="badge b-gray">منتهية</span>';
  if(c.transferred&&hatchAvailableForTransfer(b)>0)return '<span class="badge b-amber">نقل جزئي</span>';
  if(!c.transferred&&c.rawHatchAge>21)return '<span class="badge b-red">متأخرة عن النقل</span>';
  if(!c.transferred&&c.hatchComplete)return '<span class="badge b-amber">جاهزة للنقل</span>';
  if(!c.transferred)return '<span class="badge b-blue">بالمفقس</span>';
  if(b.status==='بيعت جزئياً')return '<span class="badge b-violet">بيعت جزئياً</span>';
  if(b.status==='تسويق إلى المجزرة')return '<span class="badge b-red">مجزرة</span>';
  if(b.status==='منقولة')return '<span class="badge b-teal">منقولة</span>';
  if(c.alert)return '<span class="badge b-amber">تنبيه</span>';
  return '<span class="badge b-green">نشطة</span>';
}

// ── VISIBLE BATCHES (filtered by user's fields) ──
function visibleBatches(){
  if(isAdmin())return data.batches;
  let mf=myFields();
  return data.batches.filter(b=>!b.field||mf.includes(b.field)||!b.transferDate);
}
