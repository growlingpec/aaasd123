'use strict';
// Превью сайтов из облачного компьютера. Код сайта пишет пользователь или модель, поэтому сайт открывается не на
// адресе Premier, а на отдельном (CLOUD_PREVIEW_URL): там нет cookie Premier, а запросы с него к API Premier
// отклоняются (fromPreview в server.js).
//   CLOUD_PREVIEW_URL=https://pc.example.ru    — один адрес; в браузере открыт один сайт за раз
//   CLOUD_PREVIEW_URL=https://*.pc.example.ru  — у каждого сайта свой поддомен (нужен сертификат *.pc.example.ru)
// Вход: Premier выдаёт одноразовую ссылку (open), адрес превью обменивает её на свою cookie и проксирует запросы
// (и WebSocket) в контейнер пользователя на нужный порт — через ретранслятор (cloud.connect).
const http = require('http');
const crypto = require('crypto');
const cloud = require('./cloud');

const RAW = (process.env.CLOUD_PREVIEW_URL || '').trim().replace(/\/+$/, '');
const m = /^(https?):\/\/(\*\.)?([a-z0-9.-]+(?::\d+)?)$/i.exec(RAW);
const MAIN = (() => { try { return new URL(process.env.PUBLIC_URL).host.toLowerCase(); } catch { return ''; } })();
const CFG = m && m[3].toLowerCase() !== MAIN ? { proto: m[1].toLowerCase(), wild: !!m[2], host: m[3].toLowerCase() } : null;
if (RAW && !CFG) console.log('CLOUD_PREVIEW_URL не распознан или совпадает с адресом Premier (нужен отдельный, например https://pc.example.ru) — превью сайтов выключено');
const COOKIE = 'premier_pc', TOKEN_TTL = 60e3, SESSION_TTL = 12 * 3600e3;
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const rand = (n) => crypto.randomBytes(n).toString('hex');
const hostOf = (req) => String(req.headers.host || '').toLowerCase();
let allow = () => false; // init: тариф пользователя ещё позволяет облачный компьютер

const tokens = new Map(), sessions = new Map(); // одноразовые ссылки и вошедшие браузеры
setInterval(() => { const now = Date.now(); for (const mp of [tokens, sessions]) for (const [k, v] of mp) if (v.exp < now) mp.delete(k); }, 60e3).unref();

function label(host) { // поддомен превью (режим *.) или '' для единственного адреса; null — чужой адрес
  if (!CFG) return null;
  if (!CFG.wild) return host === CFG.host ? '' : null;
  const sub = host.endsWith('.' + CFG.host) ? host.slice(0, -CFG.host.length - 1) : '';
  return /^[a-f0-9]{16}$/.test(sub) ? sub : null;
}
const match = (req) => label(hostOf(req)) != null;
// запрос пришёл со страницы превью (защита API Premier от чужого кода сайта)
function fromPreview(req) {
  const o = req.headers.origin; if (!CFG || !o) return false;
  try { const h = new URL(o).host.toLowerCase(); return h === CFG.host || h.endsWith('.' + CFG.host); } catch { return false; }
}

function open(uid, port) {
  const id = CFG.wild ? rand(8) : '', t = rand(24);
  tokens.set(t, { uid, port, id, exp: Date.now() + TOKEN_TTL });
  return `${CFG.proto}://${id ? id + '.' : ''}${CFG.host}/__premier/open?t=${t}`;
}

const page = (res, code, title, text, retry) => {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${retry ? '<meta http-equiv="refresh" content="3">' : ''}<title>${title}</title><body style="font:16px/1.6 system-ui;background:#101014;color:#ccc;padding:32px;max-width:640px"><h2 style="color:#eee;font-weight:600">${title}</h2><p>${text}</p></body></html>`);
};
function session(req) {
  const c = String(req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(COOKIE + '='));
  const [sid, secret] = (c ? c.slice(COOKIE.length + 1) : '').split('.');
  const s = sid && sessions.get(sid), id = label(hostOf(req));
  if (!s || s.exp < Date.now() || s.id !== id || !secret || secret.length !== s.secret.length || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(s.secret))) return null;
  return allow(s.uid) ? s : null;
}
// заголовки для сервера в контейнере: Host — localhost (dev-серверы вроде Vite не пускают чужие имена), без cookie превью
function headersFor(req, s, upgrade) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) || (upgrade && (k === 'connection' || k === 'upgrade'))) h[k] = v;
  h.host = 'localhost:' + s.port;
  const ck = String(req.headers.cookie || '').split(/;\s*/).filter((x) => x && !x.startsWith(COOKIE + '=')).join('; ');
  if (ck) h.cookie = ck; else delete h.cookie;
  h['x-forwarded-host'] = hostOf(req); h['x-forwarded-proto'] = CFG.proto;
  return h;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__premier/open') {
    const t = tokens.get(url.searchParams.get('t') || ''); tokens.delete(url.searchParams.get('t') || '');
    if (!t || t.exp < Date.now() || t.id !== label(hostOf(req))) return page(res, 403, 'Ссылка устарела', 'Откройте сайт заново из Premier — кнопкой «Открыть сайт».');
    const sid = rand(9), secret = rand(24);
    sessions.set(sid, { uid: t.uid, port: t.port, id: t.id, secret, exp: Date.now() + SESSION_TTL });
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=${sid}.${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${CFG.proto === 'https' ? '; Secure' : ''}` });
    return res.end();
  }
  const s = session(req);
  if (!s) return page(res, 401, 'Нет доступа', 'Сайты облачного компьютера видит только владелец. Откройте сайт из Premier кнопкой «Открыть сайт».');
  if (!cloud.awake(s.uid)) return page(res, 503, 'Облачный компьютер спит', 'Без действий компьютер засыпает, и серверы останавливаются. Запустите сервер снова в Premier — страница обновится сама.', true);
  cloud.touch(s.uid);
  const up = http.request({ createConnection: () => cloud.connect(s.uid, s.port), method: req.method, path: req.url, headers: headersFor(req, s) }, (r) => {
    const h = { ...r.headers };
    for (const k of Object.keys(h)) if (HOP.has(k)) delete h[k];
    // перенаправления сервера на localhost:порт ведут на адрес превью
    if (h.location) h.location = String(h.location).replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:${s.port})?(?=/|$)`, 'i'), '') || '/';
    res.writeHead(r.statusCode, r.statusMessage, h);
    r.pipe(res);
  });
  up.on('error', (e) => {
    if (res.headersSent) return res.destroy();
    page(res, 502, `На порту ${s.port} ничего не отвечает`, `Сервер на этом порту не запущен. Запустите его в Premier — страница обновится сама.<br><small style="color:#888">${String(e.code || e.message).replace(/[<&]/g, '')}</small>`, true);
  });
  req.on('aborted', () => up.destroy());
  req.pipe(up);
}

async function upgrade(req, socket, head) {
  const s = session(req);
  if (!s || !cloud.awake(s.uid)) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  cloud.touch(s.uid);
  const up = cloud.connect(s.uid, s.port), h = headersFor(req, s, true);
  up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}\r\n`)).join('') + '\r\n');
  if (head?.length) up.write(head);
  up.pipe(socket); socket.pipe(up);
  const done = () => { up.destroy(); socket.destroy(); };
  up.on('error', done); socket.on('error', done); up.on('close', done); socket.on('close', done);
  up.on('data', () => cloud.touch(s.uid));
}

module.exports = { on: !!CFG, init: (x) => { allow = x.allow; }, match, fromPreview, open, handle, upgrade, CFG };
