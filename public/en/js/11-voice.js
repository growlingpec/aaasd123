// Premier — клиент: voice (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- голос: ввод и озвучка ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = 'speechSynthesis' in window;
let rec = null, SPEAK = null;
if (SR) $('micBtn').hidden = false;
function toggleMic() {
  if (rec) { rec.stop(); return; }
  try { rec = new SR(); } catch { toast('Voice input is not available in this browser'); return; }
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
  const base = $('q').value.trim() ? $('q').value.replace(/\s*$/, ' ') : ''; let fin = '';
  rec.onresult = (e) => { let mid = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; e.results[i].isFinal ? (fin += t) : (mid += t); } $('q').value = base + fin + mid; grow(); renderSend(); };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow microphone access'); else if (!['aborted', 'no-speech'].includes(e.error)) toast('Voice input: ' + e.error); };
  rec.onend = () => { rec = null; $('micBtn').classList.remove('on'); $('micBtn').title = 'Voice input'; $('q').focus(); };
  try { rec.start(); } catch { rec = null; return; }
  $('micBtn').classList.add('on'); $('micBtn').title = 'Stop recording'; toast('Speak now… Tap the microphone again to finish');
}
/* ---------- озвучка: голос на сервере (RHVoice), запасной — голос браузера ---------- */
let SPEAK_LOAD = false, AUD = null, KEEP = null;
const VPREF = () => { try { return JSON.parse(localStorage.getItem('premier-voice') || '{}'); } catch { return {}; } };
const setVPref = (o) => localStorage.setItem('premier-voice', JSON.stringify({ ...VPREF(), ...o }));
fetch('/api/tts').then((r) => (r.ok ? r.json() : null)).then((d) => { VOICES = d?.voices || []; if (VOICES.length) renderChat(); }).catch(() => {});
// текст ответа → текст для чтения вслух: без разметки, кода и ссылок; числа, валюты и сокращения — словами
function speakText(t) {
  return String(t || '')
    .replace(/```[\s\S]*?(```|$)/g, '\nCode example — see the screen.\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/(?:www\.)?([^\/\s)]+)[^\s)]*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, r) => r.split('|').map((x) => x.trim()).filter(Boolean).join(', ') + '.')
    .replace(/^#{1,6}\s*(.+?)\s*$/gm, '$1.')
    .replace(/^\s*[-*•+]\s+/gm, '').replace(/^\s*>\s?/gm, '')
    .replace(/(\d)[ \u00a0\u202f](?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d)\s*₽/g, '$1 rubles').replace(/₽/g, 'rubles').replace(/(\d)\s*руб(?![а-яё])\.?/g, '$1 rubles')
    .replace(/\$\s*(\d[\d.,]*)/g, '$1 dollars').replace(/(\d)\s*\$/g, '$1 dollars').replace(/(\d)\s*€/g, '$1 euros').replace(/€\s*(\d[\d.,]*)/g, '$1 euros')
    .replace(/(\d)\s*%/g, '$1 percent').replace(/(\d)\s*°C?/g, '$1 degrees')
    .replace(/(?<!\p{L})т\.\s?е\./gu, 'that is').replace(/(?<!\p{L})т\.\s?д\./gu, 'so on').replace(/(?<!\p{L})т\.\s?п\./gu, 'the like').replace(/(?<!\p{L})т\.\s?к\./gu, 'because')
    .replace(/(?<!\p{L})напр\./gu, 'for example').replace(/(?<!\p{L})г\.\s(?=[А-ЯЁ])/gu, 'city ').replace(/(\d)\s?г\.(?!\p{L})/gu, '$1 year').replace(/(\d)\s?млн(?!\p{L})\.?/gu, '$1 million').replace(/(\d)\s?млрд(?!\p{L})\.?/gu, '$1 billion').replace(/(\d)\s?тыс(?!\p{L})\.?/gu, '$1 thousand')
    .replace(/\s(—|–|-)\s/g, ', ').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[*_~#|<>]/g, '').replace(/[ \t]+/g, ' ')
    .replace(/([^.!?:;,\n])\s*\n+/g, '$1.\n').replace(/\n{2,}/g, '\n').replace(/\.{2,}/g, '.').replace(/([!?])\./g, '$1')
    .trim().slice(0, 12000);
}
// режем на фразы: первая — короткая, чтобы звук пошёл быстрее
function speakChunks(text) {
  text = text.replace(/\s*\n\s*/g, ' '); const parts = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [text], out = []; let c = '';
  for (const p of parts) { const lim = out.length ? 260 : 140; if ((c + p).length > lim && c.trim()) { out.push(c.trim()); c = p; } else c += p; }
  if (c.trim()) out.push(c.trim());
  return out.flatMap((x) => (x.length > 500 ? x.match(/.{1,480}(\s|$)/g) : [x])).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
}
function silentWav() { const n = 400, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((ch, i) => b.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 22050, true); b.setUint32(28, 44100, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); }
function stopSpeak() {
  if (TTS) speechSynthesis.cancel(); clearInterval(KEEP); KEEP = null;
  if (AUD) { AUD.stop = true; try { AUD.audio.pause(); } catch {} AUD.wake?.(); AUD = null; }
  const was = SPEAK; SPEAK = null; SPEAK_LOAD = false; if (was) renderChat();
}
function speak(mid, txt) {
  if (SPEAK === mid) { stopSpeak(); return; }
  stopSpeak();
  const text = speakText(txt ?? findMsg(mid)?.t); if (!text) return;
  SPEAK = mid; SPEAK_LOAD = !!VOICES.length; renderChat();
  if (VOICES.length) speakNeural(mid, text); else speakBrowser(mid, text);
}
// скорость задаёт сервер (без искажений); если её сменили во время чтения — досдвигаем плеером
const VRATE = (ses) => (+VPREF().rate || 1) / (ses.rate || 1);
async function speakNeural(mid, text) {
  const pref = VPREF(), voice = (VOICES.find((v) => v.id === pref.voice) || VOICES[0]).id, rate = +pref.rate || 1;
  const chunks = speakChunks(text), ses = { mid, stop: false, rate, audio: new Audio() }; AUD = ses;
  ses.audio.preservesPitch = true; ses.audio.src = silentWav(); ses.audio.play().catch(() => {}); // разблокирует звук на iPhone, пока идёт запрос
  const jobs = [];
  const want = (i) => { if (i < chunks.length && !jobs[i]) { jobs[i] = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunks[i], voice, rate }) }).then((r) => { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); }); jobs[i].catch(() => {}); } return jobs[i]; };
  let i = 0;
  try {
    for (; i < chunks.length; i++) {
      want(i); want(i + 1); want(i + 2);
      const blob = await jobs[i]; if (ses.stop) return;
      if (SPEAK_LOAD) { SPEAK_LOAD = false; renderChat(); }
      const url = URL.createObjectURL(blob); ses.audio.src = url; ses.audio.playbackRate = VRATE(ses);
      await new Promise((ok, fail) => { ses.wake = ok; ses.audio.onended = ok; ses.audio.onerror = fail; ses.audio.play().catch(fail); });
      URL.revokeObjectURL(url); jobs[i] = null; if (ses.stop) return;
    }
  } catch {
    if (ses.stop) return;
    if (i === 0 && TTS) { AUD = null; SPEAK_LOAD = false; renderChat(); speakBrowser(mid, text); return; } // сервер не ответил — читаем голосом браузера
    toast('Could not read the response aloud');
  } finally { if (AUD === ses) { AUD = null; SPEAK = null; SPEAK_LOAD = false; renderChat(); } }
}
function speakBrowser(mid, text) {
  if (!TTS) { SPEAK = null; renderChat(); toast('Text-to-speech is not available in this browser'); return; }
  const ss = speechSynthesis, ru = /[а-яё]/i.test(text), lang = ru ? 'ru' : 'en', rate = +VPREF().rate || 1;
  const voices = ss.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  const voice = voices.find((v) => /natural|neural|online|google|milena|yuri|irina|svetlana|dmitry|pavel/i.test(v.name)) || voices[0];
  const chunks = speakChunks(text);
  chunks.forEach((ch, i) => {
    const u = new SpeechSynthesisUtterance(ch); u.lang = ru ? 'ru-RU' : 'en-US'; if (voice) u.voice = voice; u.rate = rate;
    if (i === chunks.length - 1) u.onend = u.onerror = () => { if (SPEAK === mid) { clearInterval(KEEP); KEEP = null; SPEAK = null; renderChat(); } };
    ss.speak(u);
  });
  // Chrome обрывает длинное чтение примерно через 15 секунд — периодически «будим» синтезатор
  clearInterval(KEEP); KEEP = setInterval(() => { if (!ss.speaking) return; ss.pause(); ss.resume(); }, 10000);
}
if (TTS) speechSynthesis.getVoices();
