'use strict';
// Журнал действий в панели: кто, что и когда изменил — с телом запроса (без секретов) и разницей «было → стало».
const SECRET = /pass|secret|token|apikey|api_key|^key$|\.key$|totp|hash|salt|hook/i;
const KEEP_DAYS = 365;

// [метод, путь, название, цель] — цель: 'user' | 'model' | 'promo' | 'payment' | 'admin' | 'referral' | 'apikey' (из пути) или 'user:uid' / 'review:id' (из тела)
const ACTIONS = [
  ['POST', /^\/api\/admin\/models$/, 'Модель добавлена'],
  ['POST', /^\/api\/admin\/models\/bulk$/, 'Модели импортированы'],
  ['POST', /^\/api\/admin\/models\/order$/, 'Изменён порядок моделей'],
  ['POST', /^\/api\/admin\/models\/check$/, 'Запущена проверка моделей'],
  ['PATCH', /^\/api\/admin\/models\/([\w-]+)$/, 'Модель изменена', 'model'],
  ['DELETE', /^\/api\/admin\/models\/([\w-]+)$/, 'Модель удалена', 'model'],
  ['POST', /^\/api\/admin\/search$/, 'Настройки: интернет-поиск'],
  ['POST', /^\/api\/admin\/watermark$/, 'Настройки: водяной знак'],
  ['POST', /^\/api\/admin\/browser$/, 'Настройки: браузер'],
  ['POST', /^\/api\/admin\/image$/, 'Настройки: картинки'],
  ['POST', /^\/api\/admin\/video$/, 'Настройки: видео'],
  ['POST', /^\/api\/admin\/code$/, 'Настройки: Python'],
  ['POST', /^\/api\/admin\/usage$/, 'Изменён расход сообщений', 'user:uid'],
  ['POST', /^\/api\/admin\/msg-ext$/, 'Изменён лимит сообщений', 'user:uid'],
  ['POST', /^\/api\/admin\/users\/([a-f0-9]+)\/plan$/, 'Изменён тариф', 'user'],
  ['POST', /^\/api\/admin\/users\/([a-f0-9]+)\/ban$/, 'Блокировка аккаунта', 'user'],
  ['POST', /^\/api\/admin\/users\/([a-f0-9]+)\/logout$/, 'Выход на всех устройствах', 'user'],
  ['POST', /^\/api\/admin\/users\/([a-f0-9]+)\/note$/, 'Заметка и метки', 'user'],
  ['POST', /^\/api\/admin\/users\/([a-f0-9]+)\/keys\/revoke$/, 'Отозваны API-ключи', 'user'],
  ['POST', /^\/api\/admin\/users\/bulk$/, 'Массовое действие с пользователями'],
  ['POST', /^\/api\/admin\/users$/, 'Создан аккаунт'],
  ['DELETE', /^\/api\/admin\/users\/([a-f0-9]+)$/, 'Удалён аккаунт', 'user'],
  ['POST', /^\/api\/admin\/plans$/, 'Изменены тарифы'],
  ['POST', /^\/api\/admin\/pay$/, 'Настройки оплаты: Platega'],
  ['POST', /^\/api\/admin\/cispay$/, 'Настройки оплаты: cISPay'],
  ['POST', /^\/api\/admin\/crypto$/, 'Настройки оплаты: Crypto Bot'],
  ['POST', /^\/api\/admin\/referrals$/, 'Реферальная программа'],
  ['POST', /^\/api\/admin\/referrals\/([\w-]+)$/, 'Реферал изменён', 'referral'],
  ['POST', /^\/api\/admin\/payments\/([\w-]+)\/check$/, 'Проверен статус платежа', 'payment'],
  ['POST', /^\/api\/admin\/payments\/([\w-]+)\/refund$/, 'Оформлен возврат', 'payment'],
  ['POST', /^\/api\/admin\/promos$/, 'Создан промокод'],
  ['POST', /^\/api\/admin\/promos\/bulk$/, 'Созданы промокоды пачкой'],
  ['POST', /^\/api\/admin\/promos\/delete$/, 'Удалены промокоды'],
  ['PATCH', /^\/api\/admin\/promos\/([^/]+)$/, 'Промокод изменён', 'promo'],
  ['DELETE', /^\/api\/admin\/promos\/([^/]+)$/, 'Удалён промокод', 'promo'],
  ['POST', /^\/api\/admin\/api$/, 'Доступ к API'],
  ['POST', /^\/api\/admin\/apikeys\/([\w-]+)\/revoke$/, 'Отозван API-ключ', 'apikey'],
  ['POST', /^\/api\/admin\/register$/, 'Открытая регистрация'],
  ['POST', /^\/api\/admin\/reviews$/, 'Модерация отзыва', 'review:id'],
  ['POST', /^\/api\/admin\/reviews\/bulk$/, 'Массовая модерация отзывов'],
  ['POST', /^\/api\/admin\/announce$/, 'Объявление'],
  ['POST', /^\/api\/admin\/maintenance$/, 'Режим техработ'],
  ['POST', /^\/api\/admin\/notify$/, 'Настройки оповещений'],
  ['POST', /^\/api\/admin\/errors\/resolve$/, 'Ошибки отмечены исправленными'],
  ['POST', /^\/api\/admin\/backup$/, 'Создана резервная копия'],
  ['POST', /^\/api\/admin\/admins$/, 'Добавлен администратор'],
  ['PATCH', /^\/api\/admin\/admins\/([\w-]+)$/, 'Администратор изменён', 'admin'],
  ['DELETE', /^\/api\/admin\/admins\/([\w-]+)$/, 'Администратор удалён', 'admin'],
  ['POST', /^\/api\/admin\/me\/password$/, 'Сменён свой пароль'],
  ['POST', /^\/api\/admin\/me\/totp\/enable$/, 'Включена 2FA'],
  ['POST', /^\/api\/admin\/me\/totp\/disable$/, 'Выключена 2FA'],
  ['POST', /^\/api\/admin\/me\/sessions\/revoke$/, 'Завершены сессии'],
];
// проверки и служебные запросы ничего не меняют — в журнал не пишем
const QUIET = [/\/test$/, /\/models\/fetch$/, /\/api\/admin\/test$/, /\/me\/totp\/setup$/, /\/backup\/ticket$/, /\/notify\/test$/, /\/api\/admin\/logout$/];

const short = (v) => {
  if (v === undefined) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
};
function redact(v, key = '') {
  if (SECRET.test(key)) return v === undefined || v === null || v === '' ? v : '•••';
  if (Array.isArray(v)) return v.length > 30 ? [`(${v.length} шт.)`] : v.map((x) => redact(x));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = redact(x, k); return o; }
  if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + '…';
  return v;
}
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const keyOf = (x) => (isObj(x) ? x.id ?? x.code ?? null : null);
// разница двух значений: [{ p: путь, from, to }]
function diff(a, b, p = '', out = []) {
  if (out.length >= 40) return out;
  const last = p.split(/[.[]/).pop();
  if (SECRET.test(last)) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ p, from: a ? '•••' : null, to: b ? '•••' : null }); return out; }
  if (isObj(a) && isObj(b)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p ? p + '.' + k : k, out); return out; }
  if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].length && [...a, ...b].every((x) => keyOf(x) != null)) {
    const ma = new Map(a.map((x) => [String(keyOf(x)), x])), mb = new Map(b.map((x) => [String(keyOf(x)), x]));
    for (const k of new Set([...ma.keys(), ...mb.keys()])) {
      const x = ma.get(k), y = mb.get(k), q = `${p}[${k}]`;
      if (!x) out.push({ p: q, from: null, to: 'добавлено' }); else if (!y) out.push({ p: q, from: 'было', to: 'удалено' }); else diff(x, y, q, out);
      if (out.length >= 40) break;
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ p, from: short(redact(a, last)), to: short(redact(b, last)) });
  return out;
}

function createAudit({ store }) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, aid TEXT, alogin TEXT, action TEXT NOT NULL,
      method TEXT, path TEXT, target TEXT, status INTEGER, ip TEXT, data TEXT);
    CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at);
    CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit (target, at);
    CREATE INDEX IF NOT EXISTS admin_audit_aid ON admin_audit (aid, at);`);
  const q = (sql) => db.prepare(sql);
  const prune = () => { try { q('DELETE FROM admin_audit WHERE at < ?').run(Date.now() - KEEP_DAYS * 864e5); } catch {} };
  prune(); setInterval(prune, 12 * 3600e3).unref();

  function describe(method, path, body) {
    for (const [m, re, label, tgt] of ACTIONS) {
      if (m !== method) continue;
      const x = re.exec(path); if (!x) continue;
      let target = null;
      if (tgt && tgt.includes(':')) { const [kind, field] = tgt.split(':'); const v = body && body[field]; if (v) target = kind + ':' + String(v).slice(0, 80); }
      else if (tgt && x[1]) target = tgt + ':' + decodeURIComponent(x[1]).slice(0, 80);
      return { label, target };
    }
    return { label: method + ' ' + path.replace('/api/admin/', ''), target: null };
  }
  const quiet = (method, path) => method === 'GET' || QUIET.some((re) => re.test(path));

  function log({ admin, action, method = '', path = '', target = null, status = 200, ip = '', data = null }) {
    try {
      q('INSERT INTO admin_audit (at, aid, alogin, action, method, path, target, status, ip, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Date.now(), admin ? admin.id : null, admin ? admin.login : null, String(action).slice(0, 160), method, path.slice(0, 200), target, status | 0, String(ip || '').slice(0, 64), data ? JSON.stringify(data).slice(0, 20000) : null);
    } catch (e) { console.log('audit:', e.message); }
  }
  const row = (r) => ({ id: r.id, at: r.at, aid: r.aid, login: r.alogin, action: r.action, method: r.method, path: r.path, target: r.target, status: r.status, ip: r.ip, data: r.data ? JSON.parse(r.data) : null });
  function list({ aid, q: text, target, from, to, failed, page = 1, size = 50 } = {}) {
    const w = [], a = [];
    if (aid) { w.push('aid = ?'); a.push(aid); }
    if (target) { w.push('target = ?'); a.push(target); }
    if (from) { w.push('at >= ?'); a.push(from); }
    if (to) { w.push('at < ?'); a.push(to); }
    if (failed) w.push('status >= 400');
    if (text) { w.push('(action LIKE ? OR target LIKE ? OR alogin LIKE ? OR ip LIKE ? OR data LIKE ?)'); const s = '%' + String(text).replace(/[%_]/g, '') + '%'; a.push(s, s, s, s, s); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = q(`SELECT count(*) n FROM admin_audit ${where}`).get(...a).n;
    const items = q(`SELECT * FROM admin_audit ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...a, size, (page - 1) * size).map(row);
    return { items, total, page, size };
  }
  const forTarget = (target, n = 20) => q('SELECT * FROM admin_audit WHERE target = ? ORDER BY id DESC LIMIT ?').all(target, n).map(row);
  return { describe, quiet, log, list, forTarget, redact, diff };
}

module.exports = { createAudit, diff, redact };
