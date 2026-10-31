// What Sana understands, in Iraqi Arabic, without any online brain: each
// thing said is matched against a list of intents. Pure functions (no DOM),
// so they are tested in Node (test/commands.test.mjs).

export const NAME = 'سنا';

// One way of writing: no diacritics or tatweel, one alef, ة→ه, ى→ي, and the
// Iraqi letters گ چ ڤ as ك ج ف (speech recognition writes either).
export function normalize(text) {
  return String(text || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/ڤ/g, 'ف')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const has = (t, words) => words.some((w) => t.includes(normalize(w)));
const pick = (list, r = Math.random) => list[Math.floor(r() * list.length) % list.length];

// The cities she knows the weather of (Baghdad unless another is named).
export const CITIES = [
  ['بغداد', 33.31, 44.36], ['البصره', 30.51, 47.81], ['الموصل', 36.34, 43.13], ['اربيل', 36.19, 44.01], ['النجف', 32.0, 44.34],
  ['كربلاء', 32.62, 44.02], ['كركوك', 35.47, 44.39], ['السليمانيه', 35.56, 45.44], ['الحله', 32.48, 44.42], ['الناصريه', 31.05, 46.26],
  ['الرمادي', 33.42, 43.3], ['الكوت', 32.5, 45.82], ['الديوانيه', 31.99, 44.93], ['العماره', 31.84, 47.14], ['السماوه', 31.31, 45.28],
  ['بعقوبه', 33.75, 44.64], ['دهوك', 36.87, 42.99], ['تكريت', 34.6, 43.68], ['الفلوجه', 33.35, 43.78], ['سامراء', 34.2, 43.87],
];
export function findCity(t) {
  for (const [name, lat, lon] of CITIES) {
    const bare = name.replace(/^ال/, '');
    if (t.includes(normalize(name)) || t.includes(normalize(bare))) return { name, lat, lon };
  }
  return null;
}

// Things she can open: sites in the browser, programs through the helper.
export const OPENABLE = [
  { words: ['يوتيوب', 'اليوتيوب', 'youtube'], label: 'يوتيوب', url: 'https://www.youtube.com' },
  { words: ['كوكل', 'جوجل', 'غوغل', 'google'], label: 'كوكل', url: 'https://www.google.com' },
  { words: ['واتساب', 'الواتساب', 'whatsapp'], label: 'واتساب', url: 'https://web.whatsapp.com' },
  { words: ['فيسبوك', 'الفيسبوك', 'فيس'], label: 'فيسبوك', url: 'https://www.facebook.com' },
  { words: ['انستغرام', 'انستا', 'الانستا'], label: 'انستغرام', url: 'https://www.instagram.com' },
  { words: ['تيك توك', 'التيك توك', 'تكتوك'], label: 'تيك توك', url: 'https://www.tiktok.com' },
  { words: ['الخرائط', 'خرائط', 'الخريطه'], label: 'الخرائط', url: 'https://maps.google.com' },
  { words: ['كلود', 'claude'], label: 'كلود', url: 'https://claude.ai' },
  { words: ['فرعون', 'برنامج المحل', 'fr3oon'], label: 'فرعون', app: 'fr3oon' },
  { words: ['الحاسبه', 'حاسبه', 'الكالكوليتر'], label: 'الحاسبة', app: 'calc' },
  { words: ['المفكره', 'النوت', 'نوت باد'], label: 'المفكرة', app: 'notepad' },
  { words: ['الملفات', 'المستكشف', 'ملفاتي'], label: 'الملفات', app: 'explorer' },
  { words: ['الاعدادات', 'اعدادات الويندوز'], label: 'الإعدادات', app: 'settings' },
  { words: ['الرسام', 'الرسم', 'بينت'], label: 'الرسّام', app: 'paint' },
];

const JOKES = [
  'واحد سأل صاحبه: شنو أسرع شي بالدنيا؟ گاله: الراتب، يوصل ويطير بنفس اليوم.',
  'واحد اشترى ساعة ذكية، صارت تگله كل ساعة: گوم تمشّى. هسه هي تمشي ويا مرته وهو گاعد.',
  'سألوا الكسلان: شنو هوايتك؟ گال: أرتاح من الراحة.',
  'واحد دخل امتحان الرياضيات، كتب بالورقة: الله يرحم والديك يا أستاذ، والجواب عندك.',
  'الموبايل گال للشاحن: من غيرك أموت. گاله الشاحن: وأني من غيرك محد يتذكرني.',
];

const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function timeText(d = new Date()) {
  const h = d.getHours(), m = d.getMinutes();
  const part = h < 5 ? 'بالليل' : h < 12 ? 'الصبح' : h < 14 ? 'الظهر' : h < 17 ? 'العصر' : h < 19 ? 'المغرب' : 'بالليل';
  const h12 = h % 12 || 12;
  const mins = m === 0 ? 'بالضبط' : m === 15 ? 'وربع' : m === 30 ? 'ونص' : m === 45 ? 'إلا ربع' : `و${m} دقيقة`;
  const hour = m === 45 ? (h12 % 12) + 1 : h12;
  return `الساعة ${hour} ${mins} ${part}`;
}
export function dateText(d = new Date()) {
  return `اليوم ${DAYS[d.getDay()]}، ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Open-Meteo's weather codes, in a few words.
export function weatherWords(code) {
  if (code === 0) return 'صافي';
  if (code <= 2) return 'غائم جزئياً';
  if (code === 3) return 'غائم';
  if (code <= 48) return 'بيه ضباب';
  if (code <= 57) return 'بيه رذاذ';
  if (code <= 67) return 'ممطر';
  if (code <= 77) return 'بيه ثلج';
  if (code <= 82) return 'بيه زخات مطر';
  if (code <= 86) return 'بيه زخات ثلج';
  return 'بيه عواصف رعدية';
}
export function weatherText(city, w) {
  const t = Math.round(w.temperature);
  const feel = t >= 40 ? 'حر كلش، دير بالك من الشمس' : t >= 32 ? 'حار' : t >= 22 ? 'حلو ومعتدل' : t >= 12 ? 'بارد شوية' : 'بارد، البس زين';
  return `الجو ب${city} هسه ${weatherWords(w.code)}، والحرارة ${t} درجة. ${feel}.`;
}

// What was said → what to do. `addressed`: her name was in it.
export function understand(said, { figure = false, rand = Math.random } = {}) {
  const t = normalize(said);
  const addressed = t.includes(normalize(NAME));
  const out = (intent, reply, extra = {}) => ({ intent, reply, addressed, ...extra });
  if (!t) return out('none', '');

  // stop talking / close
  if (has(t, ['اسكتي', 'اسكت', 'بس خلاص', 'كافي', 'توقفي', 'وقفي'])) return out('hush', '');
  if (has(t, ['سدي البرنامج', 'سكري البرنامج', 'اطفي البرنامج', 'سدي نفسك', 'سكري نفسك', 'اطلعي من البرنامج'])) return out('close', 'تمام، أشوفك بعدين.');

  // shape
  if (has(t, ['افتحي شكلك', 'افتح شكلك', 'افتحي وجهك', 'اظهري', 'اطلعي', 'بيني نفسك', 'بيني شكلك', 'وريني شكلك', 'شوفيني شكلك', 'ورينا شكلك', 'تحولي', 'شكلك']) && !has(t, ['ارجعي', 'اخفي', 'سدي', 'سكري'])) {
    return out('figure', figure ? 'اني هنا كدامك.' : pick(['هاي اني.', 'تفضل، هذا شكلي.', 'ها، شلون شكلي؟'], rand), { figure: true });
  }
  if (has(t, ['ارجعي كره', 'رجعي كره', 'صيري كره', 'اخفي شكلك', 'سدي شكلك', 'سكري شكلك', 'اختفي', 'ارجعي ضوه', 'ارجعي ضوء'])) {
    return out('orb', figure ? 'تمام.' : 'اني أصلاً كرة.', { figure: false });
  }

  // turning
  if (has(t, ['يمين', 'اليمين', 'يمنه'])) return out('turn', pick(['هيج؟', 'تمام.', 'زين.'], rand), { dir: 'right' });
  if (has(t, ['يسار', 'اليسار', 'يسره', 'شمال'])) return out('turn', pick(['هيج؟', 'تمام.', 'زين.'], rand), { dir: 'left' });
  if (has(t, ['باوعيني', 'باوعي علي', 'قدام', 'كدام', 'عدلي', 'التفتي علي', 'لفي علي'])) return out('turn', 'ها، أسمعك.', { dir: 'front' });

  // time, date, weather
  if (has(t, ['الساعه', 'شكد الوقت', 'كم الوقت', 'الوقت هسه', 'شكد صارت'])) return out('time', '');
  if (has(t, ['التاريخ', 'اليوم شنو', 'شنو اليوم', 'شكد بالشهر', 'اي يوم'])) return out('date', '');
  if (has(t, ['الجو', 'الطقس', 'الحراره', 'درجه الحراره', 'تمطر', 'مطر', 'حار', 'برد'])) return out('weather', '', { city: findCity(t) || { name: 'بغداد', lat: 33.31, lon: 44.36 } });

  // opening things
  if (has(t, ['افتحي', 'افتح', 'شغلي', 'شغل', 'طلعيلي', 'روحي على', 'وديني'])) {
    const what = OPENABLE.find((o) => has(t, o.words));
    if (what) return out('open', `دا أفتحلك ${what.label}.`, { target: what });
    return out('open-unknown', 'شنو أفتحلك؟ أگدر أفتح يوتيوب، كوكل، واتساب، فرعون، الحاسبة، المفكرة، أو الملفات.');
  }

  // talk
  if (has(t, ['السلام عليكم', 'سلام عليكم'])) return out('hello', 'وعليكم السلام ورحمة الله، هلا بيك.');
  if (has(t, ['مرحبا', 'هلو', 'هلا', 'صباح الخير', 'مساء الخير', 'صباحو', 'مساءو'])) {
    if (has(t, ['صباح'])) return out('hello', 'صباح النور، شلونك اليوم؟');
    if (has(t, ['مساء'])) return out('hello', 'مساء النور، شلونك؟');
    return out('hello', pick(['هلا بيك، شلونك؟', 'هلا والله، آمرني.', 'هلو، شأگدر أسويلك؟'], rand));
  }
  if (has(t, ['شلونك', 'شخبارك', 'شلون حالك', 'شونك', 'اشلونك'])) return out('howareyou', pick(['زينة الحمد لله، وانت شلونك؟', 'تمام، بخير مادام انت بخير.'], rand));
  if (has(t, ['منو انتي', 'شنو اسمك', 'شسمك', 'منو انت', 'عرفيني بنفسك'])) return out('who', `اني ${NAME}، مساعدتك. أسمعك، أفتحلك برامج ومواقع، أگلك الوقت والجو، وأتحول من كرة لشكل.`);
  if (has(t, ['شتكدرين', 'شنو تكدرين', 'شتعرفين', 'ساعديني', 'شنو تسوين', 'الاوامر'])) {
    return out('help', 'گول: افتحي شكلك، ارجعي كرة، التفتي يمين أو يسار، شكد الساعة، شلون الجو، افتحي يوتيوب أو فرعون، احچيلي نكتة.');
  }
  if (has(t, ['نكته', 'ضحكيني', 'احجيلي شي يضحك'])) return out('joke', pick(JOKES, rand));
  if (has(t, ['شكرا', 'شكرن', 'مشكوره', 'تسلمين', 'عاشت ايدج', 'ممنون', 'thank'])) return out('thanks', pick(['العفو، بالخدمة.', 'تدلل.', 'ولو، هذا واجبي.'], rand));
  if (has(t, ['احبج', 'احبك', 'حلوه', 'جميله'])) return out('nice', 'ذوقك حلو، شكراً.');
  if (has(t, ['تصبحين على خير', 'باي', 'مع السلامه', 'اشوفج'])) return out('bye', 'مع السلامة، بأمان الله.');

  // her name alone: she answers; anything else said to her: honest
  const rest = t.split(' ').filter((w) => w !== normalize(NAME) && w !== 'يا');
  if (addressed && !rest.length) return out('name', pick(['نعم؟', 'ها، آمرني.', 'أسمعك.'], rand));
  if (addressed) return out('unknown', 'بعدني أتعلّم، هاي ما أعرفها. گول «شتگدرين تسوين» وأگلك.');
  return out('none', '');
}
