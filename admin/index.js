'use strict';
// Панель управления: вход, права, журнал действий и новые разделы /api/admin/*.
// Старые маршруты панели остаются в server.js и проходят через gate(): вход, проверку прав и журнал.
const crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os');
const { createAuth, ROLES, PERMS, GRANTS } = require('./auth');
const { createAudit } = require('./audit');
const { createStats } = require('./stats');

const DAY = 864e5;
const E = (status, error) => Object.assign(new Error(error), { status });
const mask = (s, a = 4, b = 4) => (s ? (s.length > a + b + 2 ? s.slice(0, a) + '••••' + s.slice(-b) : '••••') : '');

// права по маршрутам: первое совпадение; 'W' — любой метод, кроме GET; null — любой вошедший администратор
const RULES = [
  ['W', /^\/api\/admin\/plans$/, 'plans.edit'],
  ['*', /^\/api\/admin\/(me|logout|badges|find)(\/|$)/, null],
  ['GET', /^\/api\/admin\/plans$/, null],
  ['GET', /^\/api\/admin\/(dashboard|stats)$/, 'dashboard'],
  ['GET', /^\/api\/admin\/users(\/|$)/, 'users.view'],
  ['POST', /^\/api\/admin\/users$/, 'users.create'],
  ['DELETE', /^\/api\/admin\/users\//, 'users.delete'],
  ['POST', /^\/api\/admin\/users\/[a-f0-9]+\/ban$/, 'users.ban'],
  ['W', /^\/api\/admin\/(users|usage|msg-ext)(\/|$)/, 'users.edit'],
  ['GET', /^\/api\/admin\/payments(\/|$)/, 'payments.view'],
  ['W', /^\/api\/admin\/payments\//, 'payments.manage'],
  ['GET', /^\/api\/admin\/promos(\/|$)/, 'promos.view'],
  ['W', /^\/api\/admin\/promos(\/|$)/, 'promos.edit'],
  ['GET', /^\/api\/admin\/referrals(\/|$)/, 'referrals.view'],
  ['W', /^\/api\/admin\/referrals(\/|$)/, 'referrals.edit'],
  ['GET', /^\/api\/admin\/reviews(\/|$)/, 'reviews.view'],
  ['W', /^\/api\/admin\/reviews(\/|$)/, 'reviews.edit'],
  ['GET', /^\/api\/admin\/(models|modelhealth)(\/|$)/, 'models.view'],
  ['W', /^\/api\/admin\/(models|test)(\/|$)/, 'models.edit'],
  ['GET', /^\/api\/admin\/(api|apistats|apikeys)(\/|$)/, 'api.view'],
  ['W', /^\/api\/admin\/(api|apikeys)(\/|$)/, 'api.edit'],
  ['GET', /^\/api\/admin\/(pay|cispay|robokassa|crypto)$/, 'plans.view'],
  ['W', /^\/api\/admin\/(pay|cispay|robokassa|crypto)(\/|$)/, 'plans.edit'],
  ['GET', /^\/api\/admin\/(search|watermark|browser|image|video|code)$/, 'tools.view'],
  ['W', /^\/api\/admin\/(search|watermark|browser|image|video|code)(\/|$)/, 'tools.edit'],
  ['GET', /^\/api\/admin\/(announce|maintenance)$/, 'content.view'],
  ['W', /^\/api\/admin\/(announce|maintenance)$/, 'content.edit'],
  ['GET', /^\/api\/admin\/(monitor|errors|system|notify|backups)$/, 'system.view'],
  ['W', /^\/api\/admin\/(errors|notify|register)(\/|$)/, 'system.edit'],
  ['*', /^\/api\/admin\/backup(\/|$)/, 'backup'],
  ['GET', /^\/api\/admin\/audit$/, 'audit.view'],
  ['*', /^\/api\/admin\/admins(\/|$)/, 'admins.manage'],
];
function permFor(m, p) {
  for (const [rm, re, perm] of RULES) if ((rm === '*' || rm === m || (rm === 'W' && m !== 'GET')) && re.test(p)) return perm;
  return 'system.edit'; // неизвестный маршрут — только владельцу и администраторам
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (head, rows) => '\uFEFF' + [head.map((h) => csvCell(h[1])).join(';'), ...rows.map((r) => head.map((h) => csvCell(typeof h[0] === 'function' ? h[0](r) : r[h[0]])).join(';'))].join('\r\n');
const iso = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : '');

function createAdmin(d) {
  const { store, bill, monitor, json, readBody, loadSettings, saveSettings, loadModels, publicUser, deleteUser, limited, hit, clientIp } = d;
  const auth = createAuth({ store, owner: d.owner });
  const audit = createAudit({ store });
  const stats = createStats({ store, bill, loadModels });
  const q = (sql) => store.db.prepare(sql);
  const all = (sql, ...a) => { try { return q(sql).all(...a); } catch { return []; } };
  const one = (sql, ...a) => { try { return q(sql).get(...a) || {}; } catch { return {}; } };
  const loginOf = (uid) => { const u = store.users.get(uid); return u ? u.login : null; };
  const DATA = path.dirname(store.FILE), BK_DIR = path.join(DATA, 'backups'), CRON_DIR = process.env.BACKUP_DIR || '/var/backups/premier';
  const VERSION = (() => { try { return require(path.join(__dirname, '..', 'package.json')).version || ''; } catch { return ''; } })();

  /* ---------- тело запроса: читаем один раз (для журнала), старые маршруты берут его через readBody ---------- */
  const preRead = (req, limit = 4e6) => new Promise((ok, fail) => {
    let s = ''; req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > limit) { fail(E(413, 'Слишком большой запрос')); req.destroy(); } });
    req.on('end', () => ok(s)); req.on('error', fail);
  });
  const parse = (raw) => { if (!raw) return {}; try { const b = JSON.parse(raw); return b && typeof b === 'object' ? b : {}; } catch { throw E(400, 'bad json'); } };
  const cleanUser = (u) => { if (!u) return null; const { refTiers, ...rest } = u; return rest; };
  const snapshot = (uid) => ({ settings: store.kv.get('settings', {}), plans: store.kv.get('plans', null), promos: store.kv.get('promos', []), models: store.kv.get('models', []), ...(uid ? { user: cleanUser(store.users.get(uid)) } : {}) });

  async function gate(req, res, url) {
    const p = url.pathname, m = req.method, ip = clientIp(req);
    const s = auth.session(req);
    if (!s) { json(res, 401, { error: 'Нужен вход в панель' }); return null; }
    const perm = permFor(m, p);
    if (perm && !auth.can(s.admin, perm)) { json(res, 403, { error: 'Недостаточно прав для этого действия' }); return null; }
    const ctx = { admin: s.admin, h: s.h, sid: s.sid, ip, can: (x) => auth.can(s.admin, x) };
    if (m !== 'GET' && m !== 'HEAD') {
      req._adminRaw = await preRead(req);
      if (audit.quiet(m, p)) res.on('finish', () => stats.invalidate());
      else {
        let b = {}; try { b = parse(req._adminRaw); } catch {}
        const { label, target } = audit.describe(m, p, b);
        const uid = target && target.startsWith('user:') ? target.slice(5) : null;
        const before = snapshot(uid);
        res.on('finish', () => {
          stats.invalidate();
          const changes = audit.diff(before, snapshot(uid));
          audit.log({ admin: s.admin, action: ctx.note || label, method: m, path: p, target: ctx.target || target, status: res.statusCode, ip,
            data: { body: audit.redact(b), ...(changes.length ? { diff: changes } : {}), ...(ctx.extra ? { extra: ctx.extra } : {}) } });
        });
      }
    }
    return ctx;
  }

  /* ---------- маленький роутер новых маршрутов ---------- */
  const routes = [];
  const on = (m, re, fn) => routes.push([m, re, fn]);
  async function route(req, res, url, ctx) {
    for (const [m, re, fn] of routes) {
      if (m !== req.method) continue;
      const x = re.exec(url.pathname); if (!x) continue;
      Object.assign(ctx, { req, res, url, qs: url.searchParams, body: () => parse(req._adminRaw) });
      const out = await fn(ctx, x);
      if (!res.headersSent) json(res, 200, out === undefined ? { ok: true } : out);
      return true;
    }
    return false;
  }
  const num = (qs, k, d) => { const v = parseInt(qs.get(k), 10); return Number.isFinite(v) ? v : d; };
  const sendCsv = (res, name, body) => { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }); res.end(body); };

  /* ---------- вход ---------- */
  async function login(req, res) {
    const ip = clientIp(req);
    // 5 ошибок за 10 минут с одного IP — пауза; общий потолок 50 ошибок за час — от перебора с разных адресов
    if (limited('admin:' + ip, 5, 10 * 60000) || limited('admin:*', 50, 3600000)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
    const b = await readBody(req, 4000);
    try {
      const r = auth.login(b, ip, req.headers['user-agent']);
      audit.log({ admin: r.admin, action: 'Вход в панель', method: 'POST', path: '/api/admin/login', status: 200, ip, data: { ua: String(req.headers['user-agent'] || '').slice(0, 160), remember: !!b.remember } });
      return json(res, 200, { token: r.token, admin: r.admin });
    } catch (e) {
      if (!e.status) throw e;
      if (e.fail) {
        hit('admin:' + ip); hit('admin:*'); console.log(`Панель: ${e.totp ? 'неверный код 2FA' : 'неверный пароль'} с ${ip}`);
        audit.log({ admin: null, action: e.totp ? 'Неверный код 2FA' : 'Неудачный вход', method: 'POST', path: '/api/admin/login', target: 'admin:' + String(b.login || 'owner').slice(0, 40), status: 401, ip });
      }
      return json(res, e.status, { error: e.message, ...(e.totp ? { totp: true } : {}) });
    }
  }
  on('POST', /^\/api\/admin\/logout$/, (c) => { auth.logout(c.h); audit.log({ admin: c.admin, action: 'Выход из панели', method: 'POST', path: '/api/admin/logout', ip: c.ip }); });
  on('GET', /^\/api\/admin\/me$/, (c) => ({ admin: auth.pub(c.admin), sid: c.sid, roles: ROLES }));
  on('POST', /^\/api\/admin\/me\/password$/, (c) => { const b = c.body(); auth.changePassword(c.admin, b.old, b.password, c.h); });
  on('POST', /^\/api\/admin\/me\/totp\/setup$/, (c) => auth.totpSetup(c.admin));
  on('POST', /^\/api\/admin\/me\/totp\/enable$/, (c) => { auth.totpEnable(c.admin, c.body().code); });
  on('POST', /^\/api\/admin\/me\/totp\/disable$/, (c) => { auth.totpDisable(c.admin, c.body().code); });
  on('GET', /^\/api\/admin\/me\/sessions$/, (c) => ({ current: c.sid, items: auth.sessions(c.admin.id) }));
  on('POST', /^\/api\/admin\/me\/sessions\/revoke$/, (c) => ({ ok: true, n: auth.revoke(c.admin.id, String(c.body().id || 'others'), c.h) }));

  /* ---------- команда ---------- */
  on('GET', /^\/api\/admin\/admins$/, () => ({ items: auth.list(), roles: Object.entries(ROLES).map(([id, r]) => ({ id, ...r, perms: GRANTS[id] })), perms: PERMS }));
  on('POST', /^\/api\/admin\/admins$/, (c) => { const r = auth.create(c.body()); c.target = 'admin:' + r.admin.id; return r; });
  on('PATCH', /^\/api\/admin\/admins\/([\w-]+)$/, (c, x) => auth.update(x[1], c.body()));
  on('DELETE', /^\/api\/admin\/admins\/([\w-]+)$/, (c, x) => { if (x[1] === c.admin.id) throw E(400, 'Нельзя удалить себя'); auth.remove(x[1]); });

  /* ---------- дашборд, счётчики, поиск ---------- */
  const reviewsPending = () => one("SELECT count(*) n FROM reviews WHERE status = 'pending'").n || 0;
  on('GET', /^\/api\/admin\/dashboard$/, (c) => {
    const dash = stats.dashboard(num(c.qs, 'days', 30));
    const stale = all("SELECT data FROM payments WHERE status = 'PENDING' AND at BETWEEN ? AND ?", Date.now() - 2 * DAY, Date.now() - 30 * 60e3).length;
    return { ...dash, attention: { reviews: c.can('reviews.view') ? reviewsPending() : 0, errors: c.can('system.view') ? errorGroups().filter((g) => !g.resolved && g.last > Date.now() - DAY).length : 0, stalePays: stale, modelsDown: stats.modelsDown(), maintenance: !!activeMaintenance() } };
  });
  on('GET', /^\/api\/admin\/badges$/, (c) => ({
    reviews: c.can('reviews.view') ? reviewsPending() : 0,
    errors: c.can('system.view') ? errorGroups().filter((g) => !g.resolved && g.last > Date.now() - DAY).length : 0,
    maintenance: !!activeMaintenance(), announce: !!(loadSettings().announce || {}).on,
  }));
  on('GET', /^\/api\/admin\/find$/, (c) => {
    const s = String(c.qs.get('q') || '').trim().toLowerCase();
    const out = { users: [], payments: [], promos: [], models: [] };
    if (s.length < 2) return out;
    if (c.can('users.view')) out.users = stats.userRows().filter((r) => r.id === s || r.login.toLowerCase().includes(s) || r.email.includes(s) || r.name.toLowerCase().includes(s)).slice(0, 6).map((r) => ({ id: r.id, login: r.login, email: r.email, plan: r.plan, banned: r.banned }));
    if (c.can('payments.view')) out.payments = store.payments.all().reverse().filter((p) => String(p.id).toLowerCase().startsWith(s) || String(p.tx || '').toLowerCase().startsWith(s) || String(p.login || '').toLowerCase().includes(s)).slice(0, 5).map((p) => ({ id: p.id, login: p.login, amount: p.amount, status: p.status, at: stats.payAt(p) }));
    if (c.can('promos.view')) out.promos = bill.loadPromos().filter((x) => x.code.toLowerCase().includes(s)).slice(0, 5).map((x) => ({ code: x.code, kind: x.kind, used: x.used || 0 }));
    if (c.can('models.view')) out.models = loadModels().filter((m) => m.name.toLowerCase().includes(s) || String(m.modelId).toLowerCase().includes(s)).slice(0, 5).map((m) => ({ id: m.id, name: m.name, modelId: m.modelId }));
    return out;
  });

  /* ---------- пользователи ---------- */
  const userParams = (qs) => ({ q: qs.get('q'), plan: qs.get('plan'), status: qs.get('status'), via: qs.get('via'), tag: qs.get('tag'), sort: qs.get('sort'), dir: qs.get('dir'), page: qs.get('page'), size: qs.get('size') });
  on('GET', /^\/api\/admin\/users\/list$/, (c) => stats.queryUsers(userParams(c.qs)));
  on('GET', /^\/api\/admin\/users\/export$/, (c) => {
    const rows = stats.queryUsers({ ...userParams(c.qs), all: true }).items;
    sendCsv(c.res, `premier-users-${stats.dayOf(Date.now())}.csv`, csv([['id', 'ID'], ['login', 'Логин'], ['name', 'Имя'], ['email', 'Почта'], [(r) => (r.google ? 'Google' : r.github ? 'GitHub' : 'почта'), 'Вход'],
      ['planName', 'Тариф'], [(r) => iso(r.until), 'Действует до'], [(r) => (r.trial ? 'да' : ''), 'Пробный'], [(r) => (r.banned ? 'да' : ''), 'Заблокирован'],
      ['used', 'Сообщений сегодня'], ['spent', 'Оплачено, ₽'], ['pays', 'Платежей'], ['keys', 'API-ключей'], [(r) => iso(r.seen), 'Был в сети'], [(r) => iso(r.createdAt), 'Регистрация'], [(r) => r.tags.join(', '), 'Метки']], rows));
  });
  on('GET', /^\/api\/admin\/users\/([a-f0-9]{4,32})$/, (c, x) => {
    const u = store.users.get(x[1]); if (!u) throw E(404, 'Пользователь не найден');
    const row = stats.userRows().find((r) => r.id === u.id) || {};
    const ref = one('SELECT * FROM referrals WHERE id = ?', u.id);
    const chats = one('SELECT count(*) n, max(at) last FROM chats WHERE uid = ? AND data IS NOT NULL', u.id);
    const mem = store.kv.get('mem:' + u.id, {}) || {};
    return {
      user: { ...publicUser(u), ...row, banned: u.banned || null, note: u.adminNote || '', tags: Array.isArray(u.tags) ? u.tags : [], ghLogin: u.ghLogin || '',
        refBonus: u.refBonus && u.refBonus.n > 0 && u.refBonus.until > Date.now() ? u.refBonus : null, sessions: store.sessions.count(u.id) },
      payments: all('SELECT data FROM payments WHERE uid = ? ORDER BY at DESC', u.id).map((r) => JSON.parse(r.data)),
      usage: stats.userUsage(u.id, 30),
      keys: all('SELECT id, name, hint, created, expires, last_used, last_ip, last_client FROM api_tokens WHERE uid = ? ORDER BY created DESC', u.id),
      api30: (() => { const r = one('SELECT count(*) n, sum(cost) cost FROM api_log WHERE uid = ? AND at >= ?', u.id, Date.now() - 30 * DAY); return { n: r.n || 0, cost: Math.round((r.cost || 0) * 10) / 10 }; })(),
      referral: { by: ref.id ? { id: ref.ref, login: loginOf(ref.ref), status: ref.status, at: ref.at, paid: !!ref.paid } : null,
        invited: all('SELECT id, status, msg, paid, at FROM referrals WHERE ref = ? ORDER BY at DESC LIMIT 100', u.id).map((r) => ({ ...r, login: loginOf(r.id) })), info: bill.refInfo(u) },
      reviews: all('SELECT id, nick, rating, text, status, at FROM reviews WHERE uid = ? ORDER BY at DESC', u.id),
      chats: { n: chats.n || 0, last: chats.last || null }, memory: Array.isArray(mem.items) ? mem.items.length : 0,
      audit: c.can('audit.view') ? audit.forTarget('user:' + u.id, 30) : [],
    };
  });
  on('POST', /^\/api\/admin\/users\/([a-f0-9]{4,32})\/ban$/, (c, x) => {
    const b = c.body(), ban = b.on !== false, reason = String(b.reason || '').trim().slice(0, 300);
    const u = bill.updateUser(x[1], (y) => { if (ban) y.banned = { at: Date.now(), by: c.admin.login, reason }; else delete y.banned; });
    if (!u) throw E(404, 'Пользователь не найден');
    if (ban) q('DELETE FROM sessions WHERE uid = ?').run(u.id);
    c.note = ban ? 'Аккаунт заблокирован' : 'Аккаунт разблокирован';
    return { ok: true, banned: u.banned || null };
  });
  on('POST', /^\/api\/admin\/users\/([a-f0-9]{4,32})\/logout$/, (c, x) => { if (!store.users.get(x[1])) throw E(404, 'Пользователь не найден'); return { ok: true, n: q('DELETE FROM sessions WHERE uid = ?').run(x[1]).changes }; });
  on('POST', /^\/api\/admin\/users\/([a-f0-9]{4,32})\/note$/, (c, x) => {
    const b = c.body();
    const u = bill.updateUser(x[1], (y) => {
      if (typeof b.note === 'string') { const n = b.note.trim().slice(0, 2000); if (n) y.adminNote = n; else delete y.adminNote; }
      if (Array.isArray(b.tags)) { const t = [...new Set(b.tags.map((s) => String(s).trim().slice(0, 24)).filter(Boolean))].slice(0, 12); if (t.length) y.tags = t; else delete y.tags; }
    });
    if (!u) throw E(404, 'Пользователь не найден');
    return { ok: true, note: u.adminNote || '', tags: u.tags || [] };
  });
  on('POST', /^\/api\/admin\/users\/([a-f0-9]{4,32})\/keys\/revoke$/, (c, x) => {
    const id = c.body().id;
    const n = id ? q('DELETE FROM api_tokens WHERE uid = ? AND id = ?').run(x[1], String(id)).changes : q('DELETE FROM api_tokens WHERE uid = ?').run(x[1]).changes;
    return { ok: true, n };
  });
  const setPlan = (uid, plan, days, extend) => bill.updateUser(uid, (y) => { delete y.trial; if (plan === 'free') { delete y.plan; delete y.until; } else if (extend) bill.extend(y, plan, days); else { y.plan = plan; y.until = Date.now() + days * DAY; } });
  on('POST', /^\/api\/admin\/users\/bulk$/, (c) => {
    const b = c.body(), ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))].filter((id) => /^[a-f0-9]{4,32}$/.test(id)).slice(0, 2000);
    if (!ids.length) throw E(400, 'Не выбраны пользователи');
    const ACT = { plan: ['users.edit', 'тариф'], logout: ['users.edit', 'выход на всех устройствах'], tag: ['users.edit', 'метка'], untag: ['users.edit', 'снять метку'], ban: ['users.ban', 'блокировка'], unban: ['users.ban', 'разблокировка'], delete: ['users.delete', 'удаление'] }[b.action];
    if (!ACT) throw E(400, 'Неизвестное действие');
    if (!c.can(ACT[0])) throw E(403, 'Недостаточно прав для этого действия');
    const plan = String(b.plan || 'free'), days = Math.round(+b.days || 0), tag = String(b.tag || '').trim().slice(0, 24);
    if (b.action === 'plan') { if (plan !== 'free' && !bill.cfg().plans.some((p) => p.id === plan)) throw E(400, 'Нет такого тарифа'); if (plan !== 'free' && !(days > 0 && days <= 3650)) throw E(400, 'Укажите число дней (1–3650)'); }
    if ((b.action === 'tag' || b.action === 'untag') && !tag) throw E(400, 'Укажите метку');
    let done = 0;
    for (const id of ids) {
      if (!store.users.get(id)) continue;
      if (b.action === 'plan') setPlan(id, plan, days, !!b.extend);
      else if (b.action === 'ban') { bill.updateUser(id, (y) => { y.banned = { at: Date.now(), by: c.admin.login, reason: String(b.reason || '').slice(0, 300) }; }); q('DELETE FROM sessions WHERE uid = ?').run(id); }
      else if (b.action === 'unban') bill.updateUser(id, (y) => { delete y.banned; });
      else if (b.action === 'logout') q('DELETE FROM sessions WHERE uid = ?').run(id);
      else if (b.action === 'tag') bill.updateUser(id, (y) => { y.tags = [...new Set([...(y.tags || []), tag])].slice(0, 12); });
      else if (b.action === 'untag') bill.updateUser(id, (y) => { y.tags = (y.tags || []).filter((t) => t !== tag); if (!y.tags.length) delete y.tags; });
      else if (b.action === 'delete') deleteUser(id);
      done++;
    }
    c.note = `Массово: ${ACT[1]} — ${done} польз.`; c.extra = { ids: ids.slice(0, 200) };
    return { ok: true, done };
  });

  /* ---------- платежи ---------- */
  const PROVIDERS = ['platega', 'crypto', 'robokassa', 'cispay'];
  function payQuery(qs) {
    const st = qs.get('status'), pr = qs.get('provider'), plan = qs.get('plan'), uid = qs.get('uid'), text = String(qs.get('q') || '').trim().toLowerCase();
    const from = qs.get('from') ? Date.parse(qs.get('from') + 'T00:00:00+03:00') : 0, to = qs.get('to') ? Date.parse(qs.get('to') + 'T23:59:59.999+03:00') : 0;
    const min = +qs.get('min') || 0, max = +qs.get('max') || 0;
    let rows = store.payments.all().reverse().map((p) => ({ ...p, provider: p.provider || 'platega', at: stats.payAt(p) }));
    if (pr) rows = rows.filter((p) => p.provider === pr);
    if (plan) rows = rows.filter((p) => p.plan === plan);
    if (uid) rows = rows.filter((p) => p.uid === uid);
    if (from) rows = rows.filter((p) => p.at >= from);
    if (to) rows = rows.filter((p) => p.at <= to);
    if (min) rows = rows.filter((p) => p.amount >= min);
    if (max) rows = rows.filter((p) => p.amount <= max);
    if (text) rows = rows.filter((p) => [p.id, p.tx, p.login, p.uid, p.promo].some((v) => String(v || '').toLowerCase().includes(text)));
    const counts = { all: rows.length }; for (const p of rows) counts[p.status] = (counts[p.status] || 0) + 1;
    if (st) rows = rows.filter((p) => p.status === st);
    const confirmed = rows.filter((p) => p.status === 'CONFIRMED');
    if (qs.get('sort') === 'amount') rows.sort((a, b) => (a.amount - b.amount) * (qs.get('dir') === 'asc' ? 1 : -1));
    else if (qs.get('dir') === 'asc') rows.reverse();
    return { rows, counts, sum: confirmed.reduce((a, p) => a + (p.amount || 0), 0), paid: confirmed.length };
  }
  on('GET', /^\/api\/admin\/payments\/list$/, (c) => {
    const r = payQuery(c.qs), size = Math.min(500, Math.max(10, num(c.qs, 'size', 50))), pages = Math.max(1, Math.ceil(r.rows.length / size)), page = Math.min(pages, Math.max(1, num(c.qs, 'page', 1)));
    return { items: r.rows.slice((page - 1) * size, page * size), total: r.rows.length, page, size, pages, counts: r.counts, sum: r.sum, paid: r.paid, providers: PROVIDERS, plans: bill.cfg().plans.map((p) => ({ id: p.id, name: p.name })) };
  });
  on('GET', /^\/api\/admin\/payments\/export$/, (c) => {
    const ST = { CONFIRMED: 'оплачен', PENDING: 'ожидает', CANCELED: 'отменён', CHARGEBACKED: 'возврат' };
    sendCsv(c.res, `premier-payments-${stats.dayOf(Date.now())}.csv`, csv([[(p) => iso(p.at), 'Дата'], ['id', 'Заказ'], ['tx', 'Транзакция'], ['provider', 'Способ'], ['login', 'Пользователь'], ['uid', 'ID пользователя'], ['plan', 'Тариф'], ['days', 'Дней'], ['amount', 'Сумма, ₽'], ['promo', 'Промокод'], [(p) => ST[p.status] || p.status, 'Статус']], payQuery(c.qs).rows));
  });
  on('GET', /^\/api\/admin\/payments\/([\w-]+)$/, (c, x) => {
    const p = bill.findPay(x[1]); if (!p) throw E(404, 'Платёж не найден');
    const u = p.uid ? store.users.get(p.uid) : null;
    return { pay: { ...p, provider: p.provider || 'platega', at: stats.payAt(p) }, user: u ? { id: u.id, login: u.login, email: u.email || '', plan: bill.planOf(u).id, until: u.until || null } : null,
      others: p.uid ? all('SELECT data FROM payments WHERE uid = ? AND id != ? ORDER BY at DESC LIMIT 10', p.uid, p.id).map((r) => JSON.parse(r.data)) : [] };
  });
  on('POST', /^\/api\/admin\/payments\/([\w-]+)\/refund$/, (c, x) => {
    const p = bill.findPay(x[1]); if (!p) throw E(404, 'Платёж не найден');
    if (p.status !== 'CONFIRMED') throw E(400, 'Возврат возможен только для оплаченного платежа');
    return { ok: true, pay: bill.apply(p, 'CHARGEBACKED') };
  });

  /* ---------- промокоды ---------- */
  const promoStatus = (x, now) => (x.paused ? 'paused' : x.until && x.until < now ? 'expired' : x.max && (x.used || 0) >= x.max ? 'used' : 'active');
  on('GET', /^\/api\/admin\/promos\/list$/, () => {
    const rev = new Map(); for (const p of store.payments.byStatus('CONFIRMED')) if (p.promo) { const e = rev.get(p.promo) || { n: 0, sum: 0 }; e.n++; e.sum += p.amount || 0; rev.set(p.promo, e); }
    const now = Date.now();
    const items = bill.loadPromos().map(({ by, ...x }) => ({ ...x, users: (by || []).length, status: promoStatus(x, now), paidN: (rev.get(x.code) || {}).n || 0, revenue: (rev.get(x.code) || {}).sum || 0 })).reverse();
    return { items, plans: bill.cfg().plans.filter((p) => p.id !== 'free').map((p) => ({ id: p.id, name: p.name, price: p.price })) };
  });
  const promoBase = (b) => {
    const plans = bill.cfg().plans, kind = b.kind === 'gift' ? 'gift' : 'discount';
    const pr = { kind, max: +b.max > 0 ? Math.round(+b.max) : null, used: 0, by: [], until: b.until ? Date.parse(b.until + 'T23:59:59+03:00') || null : null, created: Date.now() };
    if (typeof b.note === 'string' && b.note.trim()) pr.note = b.note.trim().slice(0, 120);
    if (kind === 'gift') { if (!plans.some((x) => x.id === b.plan && x.id !== 'free')) throw E(400, 'Выберите тариф'); pr.plan = b.plan; pr.days = Math.round(+b.days); if (!(pr.days > 0 && pr.days <= 365)) throw E(400, 'Дней: от 1 до 365'); }
    else { pr.percent = Math.round(+b.percent); if (!(pr.percent > 0 && pr.percent < 100)) throw E(400, 'Скидка: от 1 до 99 %'); pr.plan = plans.some((x) => x.id === b.plan && x.id !== 'free') ? b.plan : null; }
    return pr;
  };
  on('POST', /^\/api\/admin\/promos\/bulk$/, (c) => {
    const b = c.body(), prefix = String(b.prefix || '').trim().toUpperCase(), n = Math.round(+b.count);
    if (!/^[A-Z0-9А-ЯЁ_-]{0,12}$/.test(prefix)) throw E(400, 'Префикс: до 12 символов — буквы, цифры, - или _');
    if (!(n >= 1 && n <= 500)) throw E(400, 'Количество: от 1 до 500');
    const base = promoBase({ ...b, max: b.max || 1 }), list = bill.loadPromos(), have = new Set(list.map((x) => x.code)), ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', codes = [];
    const batch = crypto.randomBytes(4).toString('hex');
    while (codes.length < n) {
      const tail = Array.from(crypto.randomBytes(7), (x) => ABC[x % ABC.length]).join(''), code = prefix ? `${prefix}-${tail}` : tail;
      if (have.has(code)) continue; have.add(code); codes.push(code); list.push({ code, ...base, by: [], batch });
    }
    bill.savePromos(list); c.note = `Созданы промокоды пачкой: ${n} шт.`;
    return { ok: true, codes, batch };
  });
  on('POST', /^\/api\/admin\/promos\/delete$/, (c) => {
    const codes = new Set((Array.isArray(c.body().codes) ? c.body().codes : []).map(String)); if (!codes.size) throw E(400, 'Не выбраны промокоды');
    const list = bill.loadPromos(), rest = list.filter((x) => !codes.has(x.code)); bill.savePromos(rest);
    c.note = `Удалены промокоды: ${list.length - rest.length} шт.`; return { ok: true, n: list.length - rest.length };
  });
  on('PATCH', /^\/api\/admin\/promos\/([^/]+)$/, (c, x) => {
    const code = decodeURIComponent(x[1]), b = c.body(), list = bill.loadPromos(), pr = list.find((y) => y.code === code); if (!pr) throw E(404, 'Промокод не найден');
    if ('paused' in b) { if (b.paused) pr.paused = true; else delete pr.paused; }
    if ('max' in b) pr.max = +b.max > 0 ? Math.round(+b.max) : null;
    if ('until' in b) pr.until = b.until ? Date.parse(b.until + 'T23:59:59+03:00') || null : null;
    if ('note' in b) { const n = String(b.note || '').trim().slice(0, 120); if (n) pr.note = n; else delete pr.note; }
    bill.savePromos(list); const { by, ...rest } = pr; return { ...rest, users: (by || []).length, status: promoStatus(pr, Date.now()) };
  });

  /* ---------- отзывы ---------- */
  on('GET', /^\/api\/admin\/reviews\/list$/, (c) => {
    const w = [], a = [], st = c.qs.get('status'), rating = num(c.qs, 'rating', 0), text = String(c.qs.get('q') || '').trim();
    if (['pending', 'approved', 'rejected'].includes(st)) { w.push('status = ?'); a.push(st); }
    if (rating >= 1 && rating <= 5) { w.push('rating = ?'); a.push(rating); }
    if (text) { w.push('(nick LIKE ? OR text LIKE ?)'); const s = '%' + text.replace(/[%_]/g, '') + '%'; a.push(s, s); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '', size = Math.min(200, Math.max(10, num(c.qs, 'size', 30))), page = Math.max(1, num(c.qs, 'page', 1));
    const total = one(`SELECT count(*) n FROM reviews ${where}`, ...a).n || 0;
    const items = all(`SELECT id, uid, nick, rating, text, status, at FROM reviews ${where} ORDER BY status = 'pending' DESC, at DESC, rowid DESC LIMIT ? OFFSET ?`, ...a, size, (page - 1) * size)
      .map((r) => { const u = store.users.get(r.uid); return { ...r, login: u ? u.login : null, plan: u ? bill.planOf(u).id : null }; });
    const s = one("SELECT count(*) total, sum(status = 'pending') pending, sum(status = 'approved') approved, sum(status = 'rejected') rejected, avg(CASE WHEN status = 'approved' THEN rating END) avg FROM reviews");
    const dist = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, 0])); for (const r of all('SELECT rating, count(*) n FROM reviews GROUP BY rating')) dist[r.rating] = r.n;
    return { items, total, page, size, pages: Math.max(1, Math.ceil(total / size)), counts: { all: s.total || 0, pending: s.pending || 0, approved: s.approved || 0, rejected: s.rejected || 0 }, avg: s.avg ? Math.round(s.avg * 10) / 10 : null, dist };
  });
  on('POST', /^\/api\/admin\/reviews\/bulk$/, (c) => {
    const b = c.body(), ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((id) => /^[a-f0-9]{12}$/.test(id)).slice(0, 500);
    if (!ids.length || !['approve', 'reject', 'delete'].includes(b.action)) throw E(400, 'Некорректное действие с отзывами');
    let n = 0;
    store.tx(() => { for (const id of ids) n += (b.action === 'delete' ? q('DELETE FROM reviews WHERE id = ?').run(id) : q('UPDATE reviews SET status = ? WHERE id = ?').run(b.action === 'approve' ? 'approved' : 'rejected', id)).changes; });
    c.note = `Отзывы: ${{ approve: 'одобрено', reject: 'отклонено', delete: 'удалено' }[b.action]} ${n}`; return { ok: true, n };
  });

  /* ---------- рефералы ---------- */
  on('GET', /^\/api\/admin\/referrals\/stats$/, () => ({ ...stats.referralStats(), on: loadSettings().referrals !== false }));
  on('GET', /^\/api\/admin\/referrals\/list$/, (c) => stats.referralList({ status: c.qs.get('status'), q: c.qs.get('q') || '', ref: c.qs.get('ref'), page: Math.max(1, num(c.qs, 'page', 1)), size: Math.min(200, Math.max(10, num(c.qs, 'size', 50))) }));
  on('POST', /^\/api\/admin\/referrals\/([a-f0-9]{4,32})$/, (c, x) => {
    const r = one('SELECT * FROM referrals WHERE id = ?', x[1]); if (!r.id) throw E(404, 'Приглашение не найдено');
    const act = c.body().action;
    if (act === 'delete') q('DELETE FROM referrals WHERE id = ?').run(r.id);
    else if (act === 'activate') { q("UPDATE referrals SET status = 'active' WHERE id = ?").run(r.id); bill.refTierCheck(r.ref); }
    else if (act === 'reject') q("UPDATE referrals SET status = 'rejected' WHERE id = ?").run(r.id);
    else if (act === 'pending') q("UPDATE referrals SET status = 'pending' WHERE id = ?").run(r.id);
    else throw E(400, 'Неизвестное действие');
    c.note = 'Реферал: ' + { delete: 'удалён', activate: 'засчитан', reject: 'отклонён', pending: 'возвращён в ожидание' }[act];
  });

  /* ---------- API и модели ---------- */
  on('GET', /^\/api\/admin\/apistats$/, (c) => ({ ...stats.apiStats(num(c.qs, 'days', 7)), open: loadSettings().api !== false }));
  on('GET', /^\/api\/admin\/apikeys$/, (c) => stats.apiKeys({ q: c.qs.get('q') || '', page: Math.max(1, num(c.qs, 'page', 1)), size: Math.min(200, Math.max(10, num(c.qs, 'size', 50))) }));
  on('POST', /^\/api\/admin\/apikeys\/([\w-]+)\/revoke$/, (c, x) => { const k = one('SELECT uid FROM api_tokens WHERE id = ?', x[1]); if (!k.uid) throw E(404, 'Ключ не найден'); q('DELETE FROM api_tokens WHERE id = ?').run(x[1]); c.extra = { uid: k.uid }; });
  on('GET', /^\/api\/admin\/modelhealth$/, (c) => stats.modelHealth(num(c.qs, 'hours', 24)));

  /* ---------- ошибки сервера ---------- */
  function errorGroups() {
    const res = store.kv.get('admin:errors:resolved', {}) || {}, m = new Map();
    for (const e of monitor.list()) {
      const key = crypto.createHash('sha1').update(e.where + '|' + e.msg).digest('hex').slice(0, 12), g = m.get(key);
      if (!g) m.set(key, { key, where: e.where, msg: e.msg, stack: e.stack, extra: e.extra || '', n: e.n, first: e.at, last: e.at, resolvedAt: res[key] || null });
      else { g.n += e.n; g.first = Math.min(g.first, e.at); g.last = Math.max(g.last, e.at); }
    }
    return [...m.values()].map((g) => ({ ...g, resolved: !!(g.resolvedAt && g.resolvedAt >= g.last) })).sort((a, b) => b.last - a.last);
  }
  on('GET', /^\/api\/admin\/errors$/, () => ({ groups: errorGroups(), stats: monitor.stats() }));
  on('POST', /^\/api\/admin\/errors\/resolve$/, (c) => {
    const b = c.body(), res = store.kv.get('admin:errors:resolved', {}) || {}, now = Date.now();
    const keys = b.all ? errorGroups().map((g) => g.key) : (Array.isArray(b.keys) ? b.keys : [b.key]).map(String).filter(Boolean);
    for (const k of keys) { if (b.undo) delete res[k]; else res[k] = now; }
    for (const [k, at] of Object.entries(res)) if (at < now - 30 * DAY) delete res[k];
    store.kv.set('admin:errors:resolved', res); return { ok: true, n: keys.length };
  });

  /* ---------- журнал действий ---------- */
  on('GET', /^\/api\/admin\/audit$/, (c) => {
    const day = (k, end) => { const v = c.qs.get(k); return v ? Date.parse(v + (end ? 'T23:59:59.999+03:00' : 'T00:00:00+03:00')) || 0 : 0; };
    const r = audit.list({ aid: c.qs.get('aid') || '', q: c.qs.get('q') || '', target: c.qs.get('target') || '', from: day('from'), to: day('to', true), failed: c.qs.get('failed') === '1', page: Math.max(1, num(c.qs, 'page', 1)), size: Math.min(200, Math.max(10, num(c.qs, 'size', 50))) });
    return { ...r, pages: Math.max(1, Math.ceil(r.total / r.size)), admins: auth.list().map((a) => ({ id: a.id, login: a.login, name: a.name })) };
  });

  /* ---------- объявление и техработы ---------- */
  const LEVELS = ['info', 'warn', 'success', 'promo'];
  const okLink = (s) => { s = String(s || '').trim(); if (!s) return ''; if (s.startsWith('/') && !s.startsWith('//')) return s.slice(0, 300); try { const u = new URL(s); if (/^https?:$/.test(u.protocol)) return u.href.slice(0, 300); } catch {} throw E(400, 'Ссылка: https://… или путь на сайте, например /chat'); };
  const tms = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : Date.parse(v) || null);
  on('GET', /^\/api\/admin\/announce$/, () => ({ ...{ on: false, text: '', textEn: '', level: 'info', link: '', linkText: '', from: null, until: null, plans: [], audience: 'all', dismissible: true }, ...(loadSettings().announce || {}), planList: bill.cfg().plans.map((p) => ({ id: p.id, name: p.name })) }));
  on('POST', /^\/api\/admin\/announce$/, (c) => {
    const b = c.body(), st = loadSettings(), old = st.announce || {};
    const a = {
      on: !!b.on, text: String(b.text || '').trim().slice(0, 500), textEn: String(b.textEn || '').trim().slice(0, 500), level: LEVELS.includes(b.level) ? b.level : 'info',
      link: okLink(b.link), linkText: String(b.linkText || '').trim().slice(0, 40), from: tms(b.from), until: tms(b.until),
      plans: Array.isArray(b.plans) ? b.plans.map(String).filter((id) => bill.cfg().plans.some((p) => p.id === id)) : [],
      audience: ['all', 'users', 'guests'].includes(b.audience) ? b.audience : 'all', dismissible: b.dismissible !== false,
    };
    if (a.on && !a.text) throw E(400, 'Напишите текст объявления');
    a.id = old.id && old.text === a.text && old.textEn === a.textEn && old.link === a.link ? old.id : crypto.randomBytes(4).toString('hex'); // новый текст — показать снова всем
    a.updated = Date.now(); st.announce = a; saveSettings(st); c.note = a.on ? 'Объявление опубликовано' : 'Объявление снято'; return a;
  });
  on('GET', /^\/api\/admin\/maintenance$/, () => ({ ...{ on: false, text: '', textEn: '', api: false, until: null }, ...(loadSettings().maintenance || {}) }));
  on('POST', /^\/api\/admin\/maintenance$/, (c) => {
    const b = c.body(), st = loadSettings();
    st.maintenance = { on: !!b.on, text: String(b.text || '').trim().slice(0, 300), textEn: String(b.textEn || '').trim().slice(0, 300), api: !!b.api, until: tms(b.until), since: b.on ? (st.maintenance && st.maintenance.on ? st.maintenance.since : Date.now()) : null };
    saveSettings(st); c.note = b.on ? 'Включён режим техработ' : 'Выключен режим техработ'; return st.maintenance;
  });
  function activeMaintenance() { const m = loadSettings().maintenance; return m && m.on && (!m.until || m.until > Date.now()) ? m : null; }

  /* ---------- оповещения ---------- */
  const EVENTS = { error: true, pay: true, signup: false, model: true, review: true };
  const notifyCfg = () => { const n = loadSettings().notify || {}; return { tgToken: n.tgToken || '', tgChat: n.tgChat || '', hook: n.hook || '', name: n.name || '', events: { ...EVENTS, ...(n.events || {}) } }; };
  on('GET', /^\/api\/admin\/notify$/, () => {
    const n = notifyCfg();
    return { tgToken: mask(n.tgToken, 6, 4), hasToken: !!n.tgToken, tgChat: n.tgChat, hook: n.hook ? mask(n.hook, 16, 4) : '', hasHook: !!n.hook, name: n.name, events: n.events,
      env: { tg: !!(process.env.ALERT_TELEGRAM_TOKEN && process.env.ALERT_TELEGRAM_CHAT), hook: !!process.env.ALERT_WEBHOOK_URL } };
  });
  on('POST', /^\/api\/admin\/notify$/, (c) => {
    const b = c.body(), st = loadSettings(), n = { ...(st.notify || {}) };
    if (typeof b.tgToken === 'string' && b.tgToken.trim()) { if (!/^\d+:[\w-]{20,}$/.test(b.tgToken.trim())) throw E(400, 'Токен бота выглядит так: 123456:AA… (его выдаёт @BotFather)'); n.tgToken = b.tgToken.trim(); }
    if (b.removeToken) delete n.tgToken;
    if (typeof b.tgChat === 'string') n.tgChat = b.tgChat.trim().slice(0, 40);
    if (typeof b.hook === 'string' && b.hook.trim()) { try { if (!/^https?:$/.test(new URL(b.hook.trim()).protocol)) throw 0; } catch { throw E(400, 'Адрес вебхука: https://…'); } n.hook = b.hook.trim().slice(0, 500); }
    if (b.removeHook) delete n.hook;
    if (typeof b.name === 'string') n.name = b.name.trim().slice(0, 40);
    if (b.events && typeof b.events === 'object') n.events = Object.fromEntries(Object.keys(EVENTS).map((k) => [k, k in b.events ? !!b.events[k] : (n.events || EVENTS)[k] ?? EVENTS[k]]));
    st.notify = n; saveSettings(st); return { ok: true };
  });
  on('POST', /^\/api\/admin\/notify\/test$/, async () => monitor.test(`✅ Проверка оповещений Premier — всё работает.`));

  /* ---------- сервер и резервные копии ---------- */
  const fsize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  function listBackups() {
    const out = [];
    for (const [dir, kind] of [[BK_DIR, 'panel'], [CRON_DIR, 'cron']]) {
      try { for (const n of fs.readdirSync(dir)) if (/^premier-[\w.-]+\.(db|tar\.gz)$/.test(n)) { const s = fs.statSync(path.join(dir, n)); out.push({ name: n, kind, size: s.size, at: s.mtimeMs }); } } catch {}
    }
    return out.sort((a, b) => b.at - a.at);
  }
  const tickets = new Map();
  const ticketFor = (kind, name) => {
    const dir = kind === 'cron' ? CRON_DIR : BK_DIR, f = path.join(dir, path.basename(String(name)));
    if (!/^premier-[\w.-]+\.(db|tar\.gz)$/.test(path.basename(f)) || !fs.existsSync(f)) throw E(404, 'Файл не найден');
    const t = crypto.randomBytes(16).toString('hex'); tickets.set(t, { f, exp: Date.now() + 120e3 });
    for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
    return '/api/admin/backup/file/' + t;
  };
  on('GET', /^\/api\/admin\/system$/, () => {
    let disk = null; try { const f = fs.statfsSync(DATA); disk = { free: f.bavail * f.bsize, total: f.blocks * f.bsize }; } catch {}
    const st = loadSettings();
    return {
      ...monitor.stats(), version: VERSION, node: process.version, platform: `${os.type()} ${os.release()}`, cpus: os.cpus().length, totalMb: Math.round(os.totalmem() / 1048576),
      db: { size: fsize(store.FILE), wal: fsize(store.FILE + '-wal') }, disk,
      counts: { users: store.users.count(), payments: one('SELECT count(*) n FROM payments').n || 0, chats: one('SELECT count(*) n FROM chats WHERE data IS NOT NULL').n || 0, sessions: one('SELECT count(*) n FROM sessions WHERE exp >= ?', Date.now()).n || 0, apiKeys: one('SELECT count(*) n FROM api_tokens').n || 0, reviews: one('SELECT count(*) n FROM reviews').n || 0, models: loadModels().length, admins: one('SELECT count(*) n FROM admins').n || 0 },
      flags: { register: st.register !== false, api: st.api !== false, referrals: st.referrals !== false }, publicUrl: process.env.PUBLIC_URL || '',
    };
  });
  on('GET', /^\/api\/admin\/backups$/, (c) => ({ items: listBackups(), canDownload: c.can('backup'), cronDir: CRON_DIR }));
  on('POST', /^\/api\/admin\/backup$/, () => {
    fs.mkdirSync(BK_DIR, { recursive: true, mode: 0o700 });
    const name = `premier-${new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 19).replace(/[T:]/g, '-')}.db`, f = path.join(BK_DIR, name);
    const t0 = Date.now(); store.backup(f); try { fs.chmodSync(f, 0o600); } catch {}
    const mine = fs.readdirSync(BK_DIR).filter((n) => /^premier-.*\.db$/.test(n)).sort().reverse();
    for (const n of mine.slice(5)) try { fs.unlinkSync(path.join(BK_DIR, n)); } catch {} // храним 5 последних
    return { ok: true, name, size: fsize(f), ms: Date.now() - t0, url: ticketFor('panel', name) };
  });
  on('POST', /^\/api\/admin\/backup\/ticket$/, (c) => { const b = c.body(); return { url: ticketFor(b.kind, b.name) }; });
  function sendBackup(res, t) {
    const x = tickets.get(t); tickets.delete(t);
    if (!x || x.exp < Date.now() || !fs.existsSync(x.f)) return json(res, 404, { error: 'Ссылка устарела — нажмите «Скачать» ещё раз' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(x.f)}"`, 'Content-Length': fsize(x.f), 'Cache-Control': 'no-store' });
    fs.createReadStream(x.f).pipe(res);
  }

  /* ---------- вход в обработку: true — ответ уже отправлен, иначе — продолжить в старых маршрутах ---------- */
  async function handle(req, res, url) {
    const p = url.pathname, m = req.method;
    if (p === '/api/admin/login' && m === 'POST') { await login(req, res); return true; }
    const bf = /^\/api\/admin\/backup\/file\/([a-f0-9]{32})$/.exec(p); // ссылка для <a download>: без заголовка, одноразовая, 2 минуты
    if (bf && m === 'GET') { sendBackup(res, bf[1]); return true; }
    const ctx = await gate(req, res, url); if (!ctx) return true;
    return route(req, res, url, ctx);
  }

  /* ---------- для сайта и событий сервера ---------- */
  const probe = new Map();
  return {
    handle, auth, audit, stats,
    // объявление и техработы для /api/config (чат)
    publicConfig(user, lang) {
      const st = loadSettings(), now = Date.now(), a = st.announce, out = {};
      if (a && a.on && a.text && (!a.from || a.from <= now) && (!a.until || a.until > now) && !(a.audience === 'users' && !user) && !(a.audience === 'guests' && user)
        && !(a.plans && a.plans.length && !(user && a.plans.includes(bill.planOf(user).id))))
        out.announce = { id: a.id, text: lang === 'en' && a.textEn ? a.textEn : a.text, level: a.level, link: a.link || '', linkText: a.linkText || '', dismissible: a.dismissible !== false };
      const mt = activeMaintenance();
      if (mt) out.maintenance = { text: (lang === 'en' && mt.textEn) || mt.text || (lang === 'en' ? 'Technical maintenance is in progress. Please try again a bit later.' : 'Идут технические работы. Попробуйте чуть позже.'), until: mt.until || null, api: !!mt.api };
      return out;
    },
    maintenance: (kind) => { const mt = activeMaintenance(); return mt && (kind !== 'api' || mt.api) ? mt : null; },
    onProbe(id, ok, err) {
      const s = probe.get(id) || { ok: true, fails: 0 }, m = loadModels().find((x) => x.id === id); if (!m) return;
      if (ok) { if (!s.ok) monitor.alert(`Модель «${m.name}» снова отвечает`, 'model'); s.ok = true; s.fails = 0; }
      else if (++s.fails >= 2 && s.ok) { s.ok = false; monitor.alert(`Модель «${m.name}» не отвечает: ${err || 'ошибка'}`, 'model'); }
      probe.set(id, s);
    },
    onPaid: (p) => monitor.alert(`Оплата ${p.amount} ₽ · ${p.plan} на ${p.days} дн. · ${p.login || p.uid}${p.promo ? ' · промокод ' + p.promo : ''}`, 'pay'),
    onSignup: (u) => monitor.alert(`Новый пользователь: ${u.login}${u.email ? ' (' + u.email + ')' : ''}`, 'signup'),
    onReview: (r) => monitor.alert(`Новый отзыв ${'★'.repeat(r.rating)} от ${r.nick}: ${String(r.text).slice(0, 200)}`, 'review'),
    notifyConfig: notifyCfg,
  };
}

module.exports = { createAdmin, permFor };
