// Premier — мониторинг: журнал ошибок (последние 200, видны в /panelp → Обзор), оповещения в Telegram или на свой адрес,
// проверка «жив ли сервер» (GET /healthz). Внешних сервисов не нужно.
//   ALERT_TELEGRAM_TOKEN + ALERT_TELEGRAM_CHAT — бот и чат для оповещений; ALERT_WEBHOOK_URL — POST JSON {text} на свой адрес
const os = require('os');
const started = Date.now(), errors = [], counts = { req: 0, e5xx: 0 };
const TG = process.env.ALERT_TELEGRAM_TOKEN, TG_CHAT = process.env.ALERT_TELEGRAM_CHAT, HOOK = process.env.ALERT_WEBHOOK_URL;
const NAME = process.env.ALERT_NAME || os.hostname();
const sent = new Map(); let sentHour = 0, hourAt = 0;
const chats = [];
function chat(record) {
  // Без сообщений, reasoning, ключей и URL провайдера.
  const safe = {};
  for (const key of ['id', 'model', 'intent', 'artifactMode', 'baseHash', 'editCount', 'ms', 'firstTextMs', 'requests', 'repairs', 'tools', 'outcome'])
    if (record[key] !== undefined) safe[key] = record[key];
  chats.push({ at: Date.now(), ...safe }); if (chats.length > 100) chats.shift();
  console.log('[чат] ' + JSON.stringify(safe));
}

// ошибка в коде (а не «неверный пароль» и т. п.): такие стоит чинить
const isBug = (e) => !!e && !e.status && (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError && !/JSON/.test(e.message) || /^ERR_SQLITE/.test(e.code || '') || /database is locked|disk I\/O|SQLITE_/i.test(e.message || ''));

// настройки оповещений из панели (Настройки → Оповещения); если там пусто — переменные окружения
let CFG = () => ({});
const configure = (fn) => { CFG = fn; };
const ICON = { error: '⚠️', pay: '💳', signup: '👤', model: '🔌', review: '⭐', test: '✅' };
function conf() {
  let c = {}; try { c = CFG() || {}; } catch {}
  return { tg: c.tgToken || TG, chat: c.tgChat || TG_CHAT, hook: c.hook || HOOK, name: c.name || NAME, events: c.events || {} };
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
function deliver(c, msg) {
  const jobs = [];
  if (c.tg && c.chat) jobs.push(post(`https://api.telegram.org/bot${c.tg}/sendMessage`, { chat_id: c.chat, text: msg, disable_web_page_preview: true })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error('Telegram: ' + (j.description || 'HTTP ' + r.status)); }));
  if (c.hook) jobs.push(post(c.hook, { text: msg }).then((r) => { if (!r.ok) throw new Error('Вебхук: HTTP ' + r.status); }));
  return jobs;
}
// kind: error | pay | signup | model | review — каждое можно выключить в панели
function alert(text, kind = 'error') {
  const c = conf();
  if (!(c.tg && c.chat) && !c.hook) return;
  if (c.events[kind] === false) return;
  const key = kind + ':' + text.slice(0, 160), now = Date.now();
  if (kind === 'error' && sent.get(key) > now - 10 * 60e3) return; // одна и та же ошибка — не чаще раза в 10 минут
  if (now - hourAt > 3600e3) { hourAt = now; sentHour = 0; } if (++sentHour > 60) return; // и не больше 60 сообщений в час
  sent.set(key, now); if (sent.size > 500) sent.clear();
  for (const j of deliver(c, `${ICON[kind] || '⚠️'} Premier (${c.name})\n${text}`.slice(0, 3500))) j.catch(() => {});
}
// проверка из панели: дождаться ответа и вернуть ошибку, если что-то не так
async function test(text) {
  const c = conf();
  if (!(c.tg && c.chat) && !c.hook) return { ok: false, error: 'Укажите бота Telegram и чат или адрес вебхука' };
  const r = await Promise.allSettled(deliver(c, `${ICON.test} Premier (${c.name})\n${text}`));
  const bad = r.filter((x) => x.status === 'rejected').map((x) => x.reason && x.reason.message || 'ошибка');
  return bad.length ? { ok: false, error: bad.join('; ') } : { ok: true, sent: r.length };
}
function error(where, e, extra) {
  const msg = String(e && e.message || e).slice(0, 500), stack = String(e && e.stack || '').split('\n').slice(1, 4).map((s) => s.trim()).join(' ← ').slice(0, 600);
  const last = errors[errors.length - 1];
  if (last && last.where === where && last.msg === msg && Date.now() - last.at < 60e3) last.n++;
  else { errors.push({ at: Date.now(), where: String(where).slice(0, 120), msg, stack, n: 1, ...(extra ? { extra: String(extra).slice(0, 200) } : {}) }); if (errors.length > 200) errors.shift(); }
  console.error(`[ошибка] ${where}: ${msg}${stack ? '\n  ' + stack : ''}`);
  alert(`${where}: ${msg}`);
}
const request = (status) => { counts.req++; if (status >= 500) counts.e5xx++; };
const list = () => errors.slice().reverse();
const day = () => errors.filter((x) => x.at > Date.now() - 864e5).reduce((n, x) => n + x.n, 0);
function health(checks = {}) {
  const res = { ok: true, uptime: Math.round((Date.now() - started) / 1000) }, det = {};
  for (const [k, fn] of Object.entries(checks)) { try { det[k] = fn(); if (det[k] === false) res.ok = false; } catch (e) { det[k] = false; res.ok = false; } }
  return { ...res, checks: det };
}
function stats() {
  const m = process.memoryUsage();
  return { uptime: Math.round((Date.now() - started) / 1000), rssMb: Math.round(m.rss / 1048576), heapMb: Math.round(m.heapUsed / 1048576), load: os.loadavg()[0], freeMb: Math.round(os.freemem() / 1048576), requests: counts.req, e5xx: counts.e5xx, errors24h: day(), alerts: (() => { const c = conf(); return !!(c.tg && c.chat) || !!c.hook; })() };
}
// падение процесса: записать, оповестить и дать systemd перезапустить сервис
let installed = false;
function install() {
  if (installed) return; installed = true;
  process.on('unhandledRejection', (e) => error('необработанная ошибка (promise)', e));
  process.on('uncaughtException', (e) => { error('сервер упал', e); setTimeout(() => process.exit(1), 1500).unref(); });
}
module.exports = { error, isBug, alert, test, configure, request, list, health, stats, install, chat, chats: () => chats.slice().reverse() };
