// Sana: the screen, the ears and the voice put together.
import { createScene } from './scene.js';
import { createVoice } from './voice.js';
import { understand, timeText, dateText, weatherText, weatherWords, NAME } from './commands.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
// served by the helper on this computer (it can open programs), or opened as a file
const helper = location.protocol.startsWith('http');

const scene = createScene($('#stage'));
window.sana = { scene }; // for the tests

// ------------------------------------------------------------ the corner: clock, date, weather
const AR_DIGITS = (s) => String(s);
function tick() {
  const d = new Date();
  $('#clock').textContent = AR_DIGITS(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  $('#date').textContent = dateText(d).replace('اليوم ', '');
  const h = d.getHours();
  $('#greet').textContent = h < 5 ? 'تصبح على خير' : h < 12 ? 'صباح الخير' : h < 18 ? 'مساء الخير' : 'مساء النور';
}
tick();
setInterval(tick, 5000);

async function getWeather(city) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code&timezone=auto`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  return { temperature: j.current.temperature_2m, code: j.current.weather_code };
}
async function cornerWeather() {
  try {
    const w = await getWeather({ name: 'بغداد', lat: 33.31, lon: 44.36 });
    $('#temp').textContent = `${Math.round(w.temperature)}°C`;
    $('#sky').textContent = `بغداد · ${weatherWords(w.code)}`;
  } catch {
    $('#temp').textContent = '';
  }
}
cornerWeather();
setInterval(cornerWeather, 20 * 60 * 1000);

// ------------------------------------------------------------ the conversation on the side
const log = [];
function addLine(who, text) {
  if (!text) return;
  log.push({ who, text });
  while (log.length > 6) log.shift();
  $('#log').innerHTML = log.map((l) => `<p class="${l.who}"><b>${l.who === 'me' ? 'انت' : NAME}</b> ${esc(l.text)}</p>`).join('');
}
function setStatus(state, extra = '') {
  const el = $('#status');
  el.dataset.state = state;
  const words = {
    idle: 'اضغط للتشغيل',
    listening: 'مباشر · اضغط للإيقاف',
    speaking: 'تحچي…',
    nosr: 'هذا المتصفح ما يدعم السماع. افتحني من أيقونة سنا (يشتغل على Edge)',
    denied: 'الميكروفون مقفول. اسمحله من القفل جنب العنوان، أو من إعدادات الويندوز ← الخصوصية ← الميكروفون',
    network: 'السماع يحتاج إنترنت. تأكد من الاتصال',
  };
  $('#statusText').textContent = extra || words[state] || '';
}

// ------------------------------------------------------------ voice
const voice = createVoice({
  onHeard: (text) => { $('#interim').textContent = ''; handle(text); },
  onInterim: (text) => { $('#interim').textContent = text; },
  onState: (s) => setStatus(s),
  onSpeakLevel: (v) => { scene.setSpeak(v); level(v); },
  onMicLevel: (v) => { scene.setMic(v); if (!voice?.speaking) level(v); },
  onError: (e) => setStatus(e === 'mic-denied' ? 'denied' : e),
});

function level(v) { $('#level').style.width = `${Math.round(Math.min(1, v) * 100)}%`; }

async function reply(text) {
  addLine('sana', text);
  scene.nod();
  await voice.say(text);
}

async function openTarget(target) {
  if (target.url) {
    window.open(target.url, '_blank', 'noopener');
    return true;
  }
  if (!helper) return false;
  try {
    const r = await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sana': '1' }, body: JSON.stringify({ app: target.app }) });
    const j = await r.json();
    return j.ok;
  } catch {
    return false;
  }
}

async function handle(said) {
  const r = understand(said, { figure: scene.figure });
  // what she does not understand, and was not said to her, she lets pass
  if (r.intent === 'none') { addLine('me', said); return; }
  addLine('me', said);
  switch (r.intent) {
    case 'hush': voice.hush(); return;
    case 'figure': scene.showFigure(true); break;
    case 'orb': scene.showFigure(false); break;
    case 'turn': scene.turn(r.dir); break;
    case 'time': return reply(timeText());
    case 'date': return reply(dateText());
    case 'weather':
      try { return reply(weatherText(r.city.name, await getWeather(r.city))); } catch { return reply('ما گدرت أجيب الجو، يمكن الإنترنت مقطوع.'); }
    case 'open': {
      await reply(r.reply);
      const ok = await openTarget(r.target);
      if (!ok) await reply(`ما گدرت أفتح ${r.target.label}.${r.target.app === 'fr3oon' ? ' تأكد إن فرعون منصّب على هذا الجهاز.' : ''}`);
      return;
    }
    case 'close':
      await reply(r.reply);
      try { navigator.sendBeacon?.('/api/bye', '{}'); } catch { /* opened as a file */ }
      window.close();
      return;
  }
  if (r.reply) await reply(r.reply);
}

// ------------------------------------------------------------ starting
async function begin() {
  $('#start').hidden = true;
  // the whole screen, as on a dashboard (F11 goes back)
  if (helper && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  if (!voice.supported) {
    setStatus('nosr');
  } else {
    await voice.openMic();
    voice.start();
  }
  voice.voicesReady().then(() => {
    $('#voiceChip').textContent = voice.voiceName ? `الصوت: ${voice.voiceName.replace(/^Microsoft\s+/, '').replace(/\s+Online.*?-\s*/, ' · ')}` : 'لا يوجد صوت عربي';
  });
  $('#earChip').textContent = voice.supported ? `السماع: ${voice.lang}` : 'السماع غير مدعوم';
  const first = !store.get('sana-met');
  store.set('sana-met', '1');
  await reply(first ? `هلا بيك، اني ${NAME}. گول «افتحي شكلك» وتشوفني، أو «شتگدرين تسوين».` : 'هلا، أسمعك.');
}
$('#start').onclick = begin;
$('#orbBtn').onclick = () => (voice.listening ? voice.stop() : (voice.openMic(), voice.start()));
$('#typed').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#typedText').value.trim();
  $('#typedText').value = '';
  if (v) handle(v);
};
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input')) return;
  if (e.key === ' ') { e.preventDefault(); $('#orbBtn').click(); }
  if (e.key === 'Escape') voice.hush();
  if (e.key === 'f' || e.key === 'ب') scene.showFigure(!scene.figure);
  if (e.key === '/') { e.preventDefault(); $('#typed').hidden = false; $('#typedText').focus(); }
  if (e.key === 'F11') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); }
});

// the helper lives as long as this window: "still here" now and then, "bye" on closing
if (helper) {
  const alive = () => fetch('/api/alive', { method: 'POST', headers: { 'X-Sana': '1' } }).catch(() => {});
  alive();
  setInterval(alive, 5000);
  addEventListener('pagehide', () => navigator.sendBeacon?.('/api/bye', '{}'));
}
setStatus('idle');
