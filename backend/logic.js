// منطق مشترك (نفس المنطق الموجود في الواجهة) - مصدر واحد للحقيقة على الـ Backend
// كايد الوزن حسب عمر الطير بالأيام (غرام) - أول يوم دخول لا يُحتسب من العمر (يُحسب في الواجهة عبر calc())
const GUIDE_WEIGHT_BY_AGE_GRAMS = [[0,42],[7,180],[14,450],[21,850],[28,1350],[35,1950],[42,2600],[49,3200]];

function getGuideWeightByAge(ageDays) {
  const table = GUIDE_WEIGHT_BY_AGE_GRAMS;
  const age = Number(ageDays) || 0;
  if (age <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1], b = table[i];
    if (age <= b[0]) {
      const ratio = (age - a[0]) / (b[0] - a[0]);
      return Math.round(a[1] + (b[1] - a[1]) * ratio);
    }
  }
  return table[table.length - 1][1];
}

function achievementPct(actualGrams, guideGrams) {
  const g = Number(guideGrams) || 0;
  if (!g) return 0;
  return +((Number(actualGrams) || 0) / g * 100).toFixed(1);
}

module.exports = { GUIDE_WEIGHT_BY_AGE_GRAMS, getGuideWeightByAge, achievementPct };
