// Sana's ears and voice, both from the browser (Microsoft Edge): its speech
// recognition (online, Iraqi Arabic when offered) and its natural voices
// (an Iraqi one if there is one). No key, no cost.

const LANGS = ['ar-IQ', 'ar-SA', 'ar-EG', 'ar'];

export function createVoice({ onHeard, onInterim, onState, onSpeakLevel, onMicLevel, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, wanted = false, busy = false, langIdx = 0, speaking = false, restartTimer = 0, failures = 0;

  // ------------------------------------------------------------ ears
  function makeRec() {
    const r = new SR();
    r.lang = LANGS[langIdx];
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => { busy = true; failures = 0; onState?.('listening'); };
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) onHeard?.(text);
        else onInterim?.(text);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'language-not-supported' && langIdx < LANGS.length - 1) { langIdx++; rec = null; return; }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wanted = false; onError?.('mic-denied'); return; }
      if (e.error === 'network') { failures++; onError?.('network'); return; }
      if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
    };
    r.onend = () => {
      busy = false;
      if (!rec) rec = null;
      // keep listening, unless she is speaking or it was switched off
      clearTimeout(restartTimer);
      if (wanted && !speaking) restartTimer = setTimeout(start, failures > 3 ? 4000 : 250);
      else onState?.(speaking ? 'speaking' : 'idle');
    };
    return r;
  }
  function start() {
    if (!SR || busy || speaking) return;
    wanted = true;
    if (!rec || rec.lang !== LANGS[langIdx]) rec = makeRec();
    try { rec.start(); } catch { /* already started */ }
  }
  function stop() {
    wanted = false;
    clearTimeout(restartTimer);
    try { rec?.stop(); } catch { /* not running */ }
    onState?.('idle');
  }
  function pause() {
    clearTimeout(restartTimer);
    try { rec?.abort(); } catch { /* not running */ }
  }

  // ------------------------------------------------------------ the mic's level (the orb follows it)
  let analyser = null, buf = null;
  async function openMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      buf = new Uint8Array(analyser.fftSize);
      src.connect(analyser);
      return true;
    } catch {
      onError?.('mic-denied');
      return false;
    }
  }
  (function level() {
    if (analyser) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      onMicLevel?.(speaking ? 0 : Math.min(1, Math.max(0, (rms - 0.015) * 9)));
    }
    requestAnimationFrame(level);
  })();

  // ------------------------------------------------------------ voice
  const synth = window.speechSynthesis;
  let voice = null;
  function chooseVoice() {
    const all = synth ? synth.getVoices() : [];
    const ar = all.filter((v) => /^ar/i.test(v.lang));
    const female = (v) => /rana|zariyah|salma|fatima|hoda|amina|noura|laila|female|امرأة/i.test(v.name);
    voice =
      ar.find((v) => /ar-IQ/i.test(v.lang) && female(v)) ||
      ar.find((v) => /ar-IQ/i.test(v.lang)) ||
      ar.find((v) => /natural|online/i.test(v.name) && female(v)) ||
      ar.find(female) ||
      ar.find((v) => /natural|online/i.test(v.name)) ||
      ar[0] || null;
    return voice;
  }
  if (synth) {
    chooseVoice();
    synth.onvoiceschanged = chooseVoice;
  }

  // the face glows with the words: each word boundary is a pulse, and the
  // level falls between them (no audio stream to measure from speech here)
  let pulse = 0, pulseTimer = 0;
  function animateSpeech() {
    clearInterval(pulseTimer);
    pulseTimer = setInterval(() => {
      if (!speaking) { onSpeakLevel?.(0); clearInterval(pulseTimer); return; }
      pulse = Math.max(0.35, pulse * 0.82);
      onSpeakLevel?.(Math.min(1, pulse + Math.random() * 0.25));
    }, 50);
  }

  function say(text) {
    return new Promise((resolve) => {
      if (!text) return resolve();
      speaking = true;
      pause();
      onState?.('speaking');
      animateSpeech();
      const done = () => {
        if (!speaking) return;
        speaking = false;
        onSpeakLevel?.(0);
        onState?.(wanted ? 'listening' : 'idle');
        if (wanted) setTimeout(start, 200);
        resolve();
      };
      if (!synth || !voice) {
        // no Arabic voice on this computer: the words on screen, the glow for as long as reading takes
        setTimeout(done, Math.min(9000, 700 + text.length * 70));
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1.0;
      u.pitch = 1.05;
      u.onboundary = () => { pulse = 1; };
      u.onend = done;
      u.onerror = done;
      // Chrome/Edge sometimes never fire onend: a generous safety net
      setTimeout(done, 4000 + text.length * 120);
      synth.speak(u);
    });
  }
  function hush() {
    if (synth) synth.cancel();
    if (speaking) {
      speaking = false;
      onSpeakLevel?.(0);
      if (wanted) setTimeout(start, 200);
    }
  }

  return {
    supported: !!SR,
    start, stop, openMic, say, hush,
    get listening() { return wanted; },
    get speaking() { return speaking; },
    get voiceName() { return voice ? `${voice.name} (${voice.lang})` : ''; },
    get lang() { return LANGS[langIdx]; },
  };
}
