// Озвучка ответов на сервере, офлайн, без ключей и оплаты.
// Основной движок — Vosk TTS (нейросеть, чистый «студийный» звук, Apache 2.0): tts/vosk/model + Python (tts/vosk/venv).
// Запасной — RHVoice (tts/rhvoice, ~30 МБ, уже в комплекте): работает сразу, но звучит более «синтетически».
// Установка Vosk — tts/setup.sh (скачивает модель ~750 МБ, ставит Python-пакеты).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { spawn, spawnSync } = require('child_process');

const T = path.join(__dirname, 'tts'), TMP = path.join(os.tmpdir(), 'premier-tts-' + process.pid);
const MAX_TEXT = 600, MAX_QUEUE = 48, JOB_TIMEOUT = 60000, CACHE_BYTES = 64 * 1024 * 1024;

// ---------- Vosk ----------
const VM = path.join(T, 'vosk', 'model'), VPY = [path.join(T, 'vosk', 'venv', 'bin', 'python3'), 'python3'].find((p) => p === 'python3' || fs.existsSync(p));
const VOSK_VOICES = [ // голоса из многоголосой модели: выбраны самые чистые по оценке DNSMOS
  { id: 'vera', spk: 'female_0', name: 'Вера', kind: 'женский' },
  { id: 'gleb', spk: 'male_0', name: 'Глеб', kind: 'мужской' },
];
let voskOk = null;
function voskReady() {
  if (voskOk !== null) return voskOk;
  voskOk = false;
  try {
    if (!['model.onnx', 'config.json', 'dict.idx', 'dict.txt', 'bert/vocab.txt'].every((f) => fs.existsSync(path.join(VM, f)))) return false;
    const map = JSON.parse(fs.readFileSync(path.join(VM, 'config.json'), 'utf8')).speaker_id_map || {};
    const r = spawnSync(VPY, ['-c', 'import vosk_tts, onnxruntime, tokenizers'], { timeout: 20000, stdio: 'ignore' });
    if (r.status !== 0) { console.warn('Озвучка: для Vosk не хватает Python-пакетов — запустите tts/setup.sh'); return false; }
    for (const v of VOSK_VOICES) v.sid = map[v.spk];
    voskOk = VOSK_VOICES.every((v) => Number.isInteger(v.sid));
  } catch {}
  return voskOk;
}

// ---------- RHVoice ----------
const RH = path.join(T, 'rhvoice'), RBIN = path.join(RH, 'bin', 'premier-rhvoice'), RDATA = path.join(RH, 'data'), RVDIR = path.join(RDATA, 'voices');
const RNAMES = { 'aleksandr-hq': ['Александр', 'мужской'], aleksandr: ['Александр', 'мужской'], elena: ['Елена', 'женский'] };
const RORDER = ['elena', 'aleksandr-hq', 'aleksandr'], REN = { female: 'Slt', male: 'Alan' }; // английские слова читает парный английский голос
const info = (f) => { const o = {}; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2]; } return o; };
function rhVoices() {
  if (!fs.existsSync(RBIN)) return [];
  return fs.readdirSync(RVDIR).map((d) => {
    const f = path.join(RVDIR, d, 'voice.info'); if (!fs.existsSync(f)) return null;
    const i = info(f); if (i.language !== 'Russian' || !i.name) return null;
    const key = d.toLowerCase(), n = RNAMES[key], en = REN[i.gender];
    return { id: i.name, key, profile: en && fs.existsSync(path.join(RVDIR, en.toLowerCase(), 'voice.info')) ? i.name + '+' + en : i.name,
      name: n ? n[0] : i.name, kind: n ? n[1] : (i.gender === 'female' ? 'женский' : i.gender === 'male' ? 'мужской' : '') };
  }).filter(Boolean).sort((a, b) => (RORDER.indexOf(a.key) + 1 || 99) - (RORDER.indexOf(b.key) + 1 || 99));
}
// скорость 0.85–1.5× → параметр RHVoice (-1…1, 0 — обычная)
const rhRate = (r) => (r >= 1 ? r - 1 : (r - 1) * 2);

// ---------- список голосов ----------
let vCache = null, vAt = 0;
function all() {
  if (vCache && Date.now() - vAt < 60000) return vCache;
  let list = [];
  try {
    if (voskReady()) list = VOSK_VOICES.map((v) => ({ ...v, engine: 'vosk' }));
    else list = rhVoices().map((v) => ({ ...v, engine: 'rhvoice' }));
  } catch {}
  vCache = list; vAt = Date.now(); return list;
}
const voices = () => all().map((v) => ({ id: v.id, name: v.name, kind: v.kind, lang: 'ru', engine: v.engine }));

// ---------- постоянные процессы синтеза ----------
const W = {};
function worker(engine) {
  let w = W[engine]; if (w && !w.dead) return w;
  fs.mkdirSync(TMP, { recursive: true });
  let proc;
  if (engine === 'vosk') proc = spawn(VPY, [path.join(T, 'vosk', 'worker.py'), VM], { cwd: path.join(T, 'vosk'), env: { ...process.env, OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || String(Math.max(1, os.cpus().length)) }, stdio: ['pipe', 'pipe', 'pipe'] });
  else proc = spawn(RBIN, [RDATA, path.join(RH, 'etc', 'RHVoice.conf')], { cwd: RH, env: { ...process.env, LD_LIBRARY_PATH: path.join(RH, 'lib') + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const me = W[engine] = { engine, proc, queue: [], cur: null, out: '', dead: false, ready: engine !== 'vosk' };
  if (!me.ready) setTimeout(() => { if (!me.ready) { console.warn('Озвучка: Vosk не загрузился за 15 минут'); try { proc.kill('SIGKILL'); } catch {} } }, 900000).unref();
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  // Vosk грузит модель ~20–80 с (зависит от процессора) — задания ждут в очереди
  proc.stderr.on('data', (d) => { if (!me.ready && /(^|\n)ready/.test(d)) { me.ready = true; console.log('Озвучка: голоса Vosk загружены'); pump(me); } });
  proc.stdout.on('data', (d) => { me.out += d; let i; while ((i = me.out.indexOf('\n')) >= 0) { const line = me.out.slice(0, i).trim(); me.out = me.out.slice(i + 1); if (line) finish(me, line); } });
  const die = () => { if (me.dead) return; me.dead = true; const js = [me.cur, ...me.queue].filter(Boolean); me.cur = null; me.queue = []; for (const j of js) { clearTimeout(j.timer); j.reject(new Error('Синтез речи прервался — попробуйте ещё раз')); } };
  proc.on('exit', die); proc.on('error', die); proc.stdin.on('error', () => {});
  return me;
}
function pump(me) {
  if (me.cur || me.dead || !me.ready || !me.queue.length) return;
  const j = me.cur = me.queue.shift();
  j.timer = setTimeout(() => { try { me.proc.kill('SIGKILL'); } catch {} }, JOB_TIMEOUT);
  if (me.engine === 'vosk') me.proc.stdin.write(JSON.stringify({ speaker: j.v.sid, rate: j.rate, file: j.file, text: j.text }) + '\n');
  else me.proc.stdin.write([j.v.profile, rhRate(j.rate).toFixed(2), j.file, j.text].join('\t') + '\n');
}
function finish(me, line) {
  const j = me.cur; if (!j) return; clearTimeout(j.timer); me.cur = null;
  if (line.startsWith('!')) { fs.rm(j.file, { force: true }, () => {}); j.reject(new Error('Не удалось озвучить')); }
  else fs.readFile(j.file, (e, b) => { fs.rm(j.file, { force: true }, () => {}); e || !b.length ? j.reject(new Error('Не удалось озвучить')) : j.resolve(b); });
  pump(me);
}
process.on('exit', () => { for (const w of Object.values(W)) try { w.proc.kill(); } catch {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });
// модель Vosk грузится долго, поэтому поднимаем её сразу при старте сервера и держим в памяти (~650 МБ)
setTimeout(() => { try { if (voskReady()) worker('vosk'); } catch {} }, 1000).unref();

// ---------- кэш готового звука: один и тот же ответ не синтезируем дважды ----------
const cache = new Map(); let cacheSize = 0;
function cacheGet(k) { const b = cache.get(k); if (b) { cache.delete(k); cache.set(k, b); } return b; }
function cachePut(k, b) { cache.set(k, b); cacheSize += b.length; for (const [kk, bb] of cache) { if (cacheSize <= CACHE_BYTES) break; cache.delete(kk); cacheSize -= bb.length; } }

const clean = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
function synth(text, voice, rate) {
  const list = all(); if (!list.length) return Promise.reject(Object.assign(new Error('Голос не установлен на сервере'), { status: 503 }));
  let v = list.find((x) => x.id === voice) || list[0], t = clean(text); if (v.engine === 'vosk' && !worker('vosk').ready) { const rh = rhVoices().find((x) => x.kind === v.kind); if (rh) v = { ...rh, engine: 'rhvoice' }; } // fallback: пока нейросеть грузится — сразу RHVoice того же пола, r = Math.round(Math.min(1.6, Math.max(0.75, +rate || 1)) * 100) / 100;
  if (!t) return Promise.reject(Object.assign(new Error('Пустой текст'), { status: 400 }));
  const key = crypto.createHash('sha1').update(v.engine + '\n' + v.id + '\n' + r + '\n' + t).digest('hex'), hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  const me = worker(v.engine);
  if (me.queue.length >= MAX_QUEUE) return Promise.reject(Object.assign(new Error('Сервер озвучки занят — попробуйте через минуту'), { status: 503 }));
  return new Promise((resolve, reject) => {
    me.queue.push({ v, rate: r, text: t, file: path.join(TMP, key + '-' + crypto.randomBytes(3).toString('hex') + '.wav'), resolve: (b) => { cachePut(key, b); resolve(b); }, reject });
    pump(me);
  });
}
module.exports = { voices, synth };
