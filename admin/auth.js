'use strict';
// Панель: учётные записи администраторов, роли и права, сессии в базе (переживают перезапуск) и вход с 2FA (TOTP).
// Владелец (login «owner») входит паролем из ADMIN_PASSWORD / data/admin-password.txt — как и раньше.
const crypto = require('crypto');

const ROLES = {
  owner: { name: 'Владелец', desc: 'Всё, включая команду, безопасность и резервные копии' },
  admin: { name: 'Администратор', desc: 'Всё, кроме управления командой и резервных копий' },
  manager: { name: 'Менеджер', desc: 'Пользователи, платежи, промокоды, рефералы, отзывы и объявления' },
  support: { name: 'Поддержка', desc: 'Карточки пользователей, выдача сообщений и лимитов, отзывы' },
  viewer: { name: 'Наблюдатель', desc: 'Только просмотр, без изменений' },
};
const PERMS = ['dashboard', 'users.view', 'users.edit', 'users.ban', 'users.create', 'users.delete', 'payments.view', 'payments.manage',
  'promos.view', 'promos.edit', 'referrals.view', 'referrals.edit', 'reviews.view', 'reviews.edit', 'models.view', 'models.edit',
  'api.view', 'api.edit', 'plans.view', 'plans.edit', 'tools.view', 'tools.edit', 'content.view', 'content.edit',
  'system.view', 'system.edit', 'audit.view', 'admins.manage', 'backup'];
const GRANTS = {
  owner: PERMS,
  admin: PERMS.filter((p) => p !== 'admins.manage' && p !== 'backup'),
  manager: ['dashboard', 'users.view', 'users.edit', 'users.ban', 'users.create', 'payments.view', 'payments.manage', 'promos.view', 'promos.edit',
    'referrals.view', 'referrals.edit', 'reviews.view', 'reviews.edit', 'models.view', 'api.view', 'plans.view', 'content.view', 'content.edit'],
  support: ['dashboard', 'users.view', 'users.edit', 'payments.view', 'promos.view', 'referrals.view', 'reviews.view', 'reviews.edit', 'content.view'],
  viewer: PERMS.filter((p) => p === 'dashboard' || p.endsWith('.view')),
};
const TTL = 12 * 3600e3, TTL_LONG = 7 * 864e5;

/* ---------- TOTP (RFC 6238): 6 цифр, шаг 30 секунд, SHA-1 — понимают все приложения-аутентификаторы ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32dec(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(s).replace(/[\s=-]/g, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; val = ((val << 5) | i) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function hotp(key, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
// номер шага, если код верный (и ещё не использован), иначе 0; допускаем расхождение часов на ±1 шаг
function totpCheck(secret, code, last = 0, now = Date.now()) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6 || !secret) return 0;
  const key = b32dec(secret), t = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) { const c = t + d; if (c > last && crypto.timingSafeEqual(Buffer.from(hotp(key, c)), Buffer.from(code))) return c; }
  return 0;
}

const weakPw = (x) => !x || x.length < 12 || /^\d+$/.test(x) || /^(admin|password|qwerty|premier)/i.test(x);
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function createAuth({ store, owner }) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, login TEXT NOT NULL, name TEXT, role TEXT NOT NULL, salt TEXT, hash TEXT,
      totp TEXT, totp_on INTEGER NOT NULL DEFAULT 0, totp_last INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, last_login INTEGER, last_ip TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS admins_login ON admins (lower(login));
    CREATE TABLE IF NOT EXISTS admin_sessions (h TEXT PRIMARY KEY, aid TEXT NOT NULL, created INTEGER NOT NULL, exp INTEGER NOT NULL,
      ttl INTEGER NOT NULL, last INTEGER NOT NULL, ip TEXT, ua TEXT);
    CREATE INDEX IF NOT EXISTS admin_sessions_aid ON admin_sessions (aid);
  `);
  const q = (sql) => db.prepare(sql);
  if (!q("SELECT 1 x FROM admins WHERE id = 'owner'").get()) q("INSERT INTO admins (id, login, name, role, created) VALUES ('owner', 'owner', 'Владелец', 'owner', ?)").run(Date.now());
  const purge = () => { try { q('DELETE FROM admin_sessions WHERE exp < ?').run(Date.now()); } catch {} };
  purge(); setInterval(purge, 3600e3).unref();

  const get = (id) => q('SELECT * FROM admins WHERE id = ?').get(String(id)) || null;
  const byLogin = (l) => q('SELECT * FROM admins WHERE lower(login) = lower(?)').get(String(l)) || null;
  const can = (a, perm) => !!a && (GRANTS[a.role] || []).includes(perm);
  const pub = (a) => a && ({ id: a.id, login: a.login, name: a.name || a.login, role: a.role, roleName: (ROLES[a.role] || {}).name || a.role,
    totp: !!a.totp_on, disabled: !!a.disabled, created: a.created, lastLogin: a.last_login || null, lastIp: a.last_ip || '',
    perms: GRANTS[a.role] || [], pwFromEnv: a.id === 'owner' ? owner.fromEnv() : false });
  const err = (status, error, extra) => Object.assign(new Error(error), { status, ...extra });

  function checkPassword(a, pw) {
    if (!a || a.disabled) { hashPw(pw, 'dummy-salt'); return false; } // одинаковое время ответа для несуществующих логинов
    if (a.id === 'owner') return owner.check(pw);
    if (!a.hash || !a.salt) return false;
    return crypto.timingSafeEqual(Buffer.from(hashPw(pw, a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
  }
  function startSession(a, ip, ua, remember) {
    const token = crypto.randomBytes(32).toString('hex'), now = Date.now(), ttl = remember ? TTL_LONG : TTL;
    q('INSERT INTO admin_sessions (h, aid, created, exp, ttl, last, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(sha(token), a.id, now, now + ttl, ttl, now, String(ip || '').slice(0, 64), String(ua || '').slice(0, 200));
    q('UPDATE admins SET last_login = ?, last_ip = ? WHERE id = ?').run(now, String(ip || '').slice(0, 64), a.id);
    return token;
  }

  return {
    ROLES, PERMS, GRANTS, can, pub, get, weakPw,
    // { token, admin } или ошибка со status; totp: true — нужен (или неверен) код 2FA, fail: true — засчитать неудачную попытку
    login(b, ip, ua) {
      const login = String(b.login || '').trim().slice(0, 60) || 'owner', pw = String(b.password || '').slice(0, 200);
      const a = byLogin(login);
      if (!checkPassword(a, pw)) throw err(401, 'Неверный логин или пароль', { fail: true });
      if (a.totp_on) {
        if (!String(b.code || '').trim()) throw err(401, 'Введите код из приложения-аутентификатора', { totp: true });
        const c = totpCheck(a.totp, b.code, a.totp_last);
        if (!c) throw err(401, 'Неверный код подтверждения', { totp: true, fail: true });
        q('UPDATE admins SET totp_last = ? WHERE id = ?').run(c, a.id);
      }
      return { token: startSession(a, ip, ua, !!b.remember), admin: pub(get(a.id)) };
    },
    // сессия по заголовку Authorization: Bearer <token>; короткие сессии продлеваются при активности
    session(req) {
      const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!/^[a-f0-9]{32,64}$/.test(t)) return null;
      const h = sha(t), s = q('SELECT * FROM admin_sessions WHERE h = ?').get(h);
      if (!s) return null;
      const now = Date.now();
      if (s.exp < now) { q('DELETE FROM admin_sessions WHERE h = ?').run(h); return null; }
      const a = get(s.aid); if (!a || a.disabled) return null;
      if (now - s.last > 60e3) q('UPDATE admin_sessions SET last = ?, exp = max(exp, ?) WHERE h = ?').run(now, now + s.ttl, h);
      return { admin: a, h, sid: h.slice(0, 12) };
    },
    logout(h) { q('DELETE FROM admin_sessions WHERE h = ?').run(h); },
    sessions: (aid) => q('SELECT h, created, last, exp, ip, ua FROM admin_sessions WHERE aid = ? AND exp >= ? ORDER BY last DESC').all(aid, Date.now())
      .map((s) => ({ id: s.h.slice(0, 12), created: s.created, last: s.last, exp: s.exp, ip: s.ip, ua: s.ua })),
    // what: id сессии (12 символов), 'others' (кроме текущей) или 'all'
    revoke(aid, what, keepH) {
      if (what === 'all') return q('DELETE FROM admin_sessions WHERE aid = ?').run(aid).changes;
      if (what === 'others') return q('DELETE FROM admin_sessions WHERE aid = ? AND h != ?').run(aid, keepH || '').changes;
      return q('DELETE FROM admin_sessions WHERE aid = ? AND substr(h, 1, 12) = ?').run(aid, String(what || '')).changes;
    },
    list: () => q('SELECT * FROM admins ORDER BY id = \'owner\' DESC, created').all().map((a) => ({ ...pub(a), sessions: q('SELECT count(*) n FROM admin_sessions WHERE aid = ? AND exp >= ?').get(a.id, Date.now()).n })),
    create(b) {
      const login = String(b.login || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) throw err(400, 'Логин: 3–32 символа — латиница, цифры, точка, - или _');
      if (byLogin(login)) throw err(400, 'Такой логин уже есть');
      const role = String(b.role || 'viewer'); if (!ROLES[role] || role === 'owner') throw err(400, 'Выберите роль');
      let pw = typeof b.password === 'string' && b.password ? b.password : '', generated = false;
      if (!pw) { pw = crypto.randomBytes(12).toString('base64url'); generated = true; }
      if (weakPw(pw)) throw err(400, 'Пароль: от 12 символов, не только цифры и не «admin…», «password…»');
      const salt = crypto.randomBytes(16).toString('hex'), id = crypto.randomBytes(6).toString('hex');
      const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 60) || login;
      q('INSERT INTO admins (id, login, name, role, salt, hash, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, login, name, role, salt, hashPw(pw, salt), Date.now());
      return { admin: pub(get(id)), password: generated ? pw : undefined };
    },
    update(id, b) {
      const a = get(id); if (!a) throw err(404, 'Администратор не найден');
      const out = {};
      if (typeof b.name === 'string' && b.name.trim()) q('UPDATE admins SET name = ? WHERE id = ?').run(b.name.trim().replace(/\s+/g, ' ').slice(0, 60), id);
      if (a.id !== 'owner') {
        if ('role' in b) { if (!ROLES[b.role] || b.role === 'owner') throw err(400, 'Неизвестная роль'); q('UPDATE admins SET role = ? WHERE id = ?').run(b.role, id); }
        if ('disabled' in b) { q('UPDATE admins SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, id); if (b.disabled) q('DELETE FROM admin_sessions WHERE aid = ?').run(id); }
        if (b.resetPassword) {
          const pw = crypto.randomBytes(12).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
          q('UPDATE admins SET salt = ?, hash = ? WHERE id = ?').run(salt, hashPw(pw, salt), id); q('DELETE FROM admin_sessions WHERE aid = ?').run(id);
          out.password = pw;
        }
      }
      if (b.resetTotp) q('UPDATE admins SET totp = NULL, totp_on = 0, totp_last = 0 WHERE id = ?').run(id);
      if (b.logout) q('DELETE FROM admin_sessions WHERE aid = ?').run(id);
      return { admin: pub(get(id)), ...out };
    },
    remove(id) {
      if (id === 'owner') throw err(400, 'Владельца удалить нельзя');
      if (!get(id)) throw err(404, 'Администратор не найден');
      q('DELETE FROM admin_sessions WHERE aid = ?').run(id); q('DELETE FROM admins WHERE id = ?').run(id);
    },
    changePassword(a, old, pw, keepH) {
      if (!checkPassword(a, String(old || ''))) throw err(400, 'Текущий пароль неверный');
      pw = String(pw || '');
      if (weakPw(pw)) throw err(400, 'Новый пароль: от 12 символов, не только цифры и не «admin…», «password…»');
      if (a.id === 'owner') { if (owner.fromEnv()) throw err(400, 'Пароль владельца задан в ADMIN_PASSWORD — поменяйте его в окружении сервера'); owner.set(pw); }
      else { const salt = crypto.randomBytes(16).toString('hex'); q('UPDATE admins SET salt = ?, hash = ? WHERE id = ?').run(salt, hashPw(pw, salt), a.id); }
      q('DELETE FROM admin_sessions WHERE aid = ? AND h != ?').run(a.id, keepH || ''); // остальные устройства — заново войти
    },
    totpSetup(a) {
      if (a.totp_on) throw err(400, '2FA уже включена');
      const secret = b32enc(crypto.randomBytes(20));
      q('UPDATE admins SET totp = ?, totp_on = 0, totp_last = 0 WHERE id = ?').run(secret, a.id);
      const label = encodeURIComponent('Premier:' + a.login);
      return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Premier&algorithm=SHA1&digits=6&period=30` };
    },
    totpEnable(a, code) {
      const cur = get(a.id); if (!cur.totp) throw err(400, 'Сначала получите ключ');
      const c = totpCheck(cur.totp, code, cur.totp_last); if (!c) throw err(400, 'Код не подошёл — проверьте время на телефоне и введите новый');
      q('UPDATE admins SET totp_on = 1, totp_last = ? WHERE id = ?').run(c, a.id);
    },
    totpDisable(a, code) {
      const cur = get(a.id); if (!cur.totp_on) return;
      const c = totpCheck(cur.totp, code, cur.totp_last); if (!c) throw err(400, 'Неверный код подтверждения');
      q('UPDATE admins SET totp = NULL, totp_on = 0, totp_last = 0 WHERE id = ?').run(a.id);
    },
  };
}

module.exports = { createAuth, ROLES, PERMS, GRANTS, totpCheck, hotp, b32enc, b32dec, weakPw };
