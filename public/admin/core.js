// Панель управления Premier (/panelp) — общее: состояние, запросы к серверу, форматирование, настройки интерфейса.
// Файлы подключаются по порядку обычными <script>: core → ui → shell → разделы (каждый раздел — в своей области видимости).
'use strict';
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TOKEN_KEY = 'premier-admin';
const S = { token: localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY), me: null, view: null, plans: [], badges: {}, roles: {} };
const R = {}; // разделы: R[имя] = async (params, id) => {}
const can = (perm) => !!(S.me && S.me.perms.includes(perm));

/* ---------- форматирование ---------- */
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const num = (n, d = 0) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const rub = (n) => num(n) + ' ₽';
const compact = (n) => { n = Number(n || 0); const a = Math.abs(n); return a >= 1e6 ? num(n / 1e6, 1) + ' млн' : a >= 1e5 ? num(n / 1e3, 0) + ' тыс' : num(n, n % 1 ? 1 : 0); };
const plural = (n, a, b, c) => { n = Math.abs(Math.round(n)); return n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c; };
const pn = (n, a, b, c) => num(n) + ' ' + plural(n, a, b, c);
const toTime = (t) => (typeof t === 'number' ? t : Date.parse(t || '') || 0);
const dt = (t, o) => { const x = toTime(t); if (!x) return '—'; return new Date(x).toLocaleDateString('ru-RU', o || { day: 'numeric', month: 'short', year: new Date(x).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
const dtt = (t) => { const x = toTime(t); return x ? new Date(x).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: new Date(x).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
const tm = (t) => { const x = toTime(t); return x ? new Date(x).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''; };
const dayLabel = (d) => { const [, m, day] = String(d).split('-'); return +day + ' ' + MON[+m - 1]; };
function ago(t) {
  const x = toTime(t); if (!x) return '—';
  const s = (Date.now() - x) / 1000;
  if (s < 0) return 'через ' + left(x);
  if (s < 60) return 'только что';
  if (s < 3600) return pn(Math.floor(s / 60), 'минуту', 'минуты', 'минут') + ' назад';
  if (s < 86400) return pn(Math.floor(s / 3600), 'час', 'часа', 'часов') + ' назад';
  if (s < 172800) return 'вчера в ' + tm(x);
  if (s < 30 * 86400) return pn(Math.floor(s / 86400), 'день', 'дня', 'дней') + ' назад';
  return dt(x);
}
function left(t) {
  const s = (toTime(t) - Date.now()) / 1000;
  if (s <= 0) return 'истёк';
  if (s < 3600) return pn(Math.max(1, Math.round(s / 60)), 'минута', 'минуты', 'минут');
  if (s < 86400) return pn(Math.round(s / 3600), 'час', 'часа', 'часов');
  return pn(Math.round(s / 86400), 'день', 'дня', 'дней');
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const bytes = (n) => { n = Number(n || 0); return n >= 1073741824 ? num(n / 1073741824, 1) + ' ГБ' : n >= 1048576 ? num(n / 1048576, 1) + ' МБ' : n >= 1024 ? num(n / 1024, 0) + ' КБ' : n + ' Б'; };
const msf = (n) => (n == null ? '—' : n < 1000 ? Math.round(n) + ' мс' : num(n / 1000, 1) + ' с');
const pctf = (v) => (v == null ? '—' : num(v, 1) + '%');
const initials = (s) => String(s || '?').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, 2).map((w) => w[0]).join('') || '?';
const uptime = (sec) => (sec < 3600 ? Math.max(1, Math.round(sec / 60)) + ' мин' : sec < 172800 ? Math.round(sec / 3600) + ' ч' : Math.round(sec / 86400) + ' дн');
const isoDay = (t = Date.now()) => new Date(toTime(t) + 3 * 3600e3).toISOString().slice(0, 10);

/* ---------- тарифы, статусы ---------- */
const planOf = (id) => S.plans.find((p) => p.id === id);
const planName = (id) => (id === 'reset' ? 'Сброс лимита' : (planOf(id) || {}).name) || id;
const planBadge = (id) => { const p = planOf(id); return `<span class="badge p${p ? p.tier : 0}">${esc(p ? p.name : id)}</span>`; };
const PST = { CONFIRMED: ['Оплачен', 'ok'], PENDING: ['Ожидает', 'warn'], CANCELED: ['Отменён', 'out'], CHARGEBACKED: ['Возврат', 'bad'] };
const payBadge = (s) => { const x = PST[s] || [s, '']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; };
const PROV = { platega: 'Platega', crypto: 'Crypto Bot', robokassa: 'Robokassa', cispay: 'cISPay' };

/* ---------- настройки интерфейса (в этом браузере) ---------- */
const pref = {
  all() { try { return JSON.parse(localStorage.getItem('premier-admin:prefs') || '{}'); } catch { return {}; } },
  get(k, d) { const v = pref.all()[k]; return v === undefined ? d : v; },
  set(k, v) { const a = pref.all(); a[k] = v; localStorage.setItem('premier-admin:prefs', JSON.stringify(a)); },
};

/* ---------- запросы ---------- */
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}), ...(opts.headers || {}) } });
  if (r.status === 401 && path !== '/api/admin/login') { logout('Сессия истекла — войдите снова'); throw new Error('auth'); }
  if (opts.raw) { if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Ошибка ' + r.status); } return r; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Ошибка ' + r.status), { status: r.status, data: j });
  return j;
}
const post = (p, b, m = 'POST') => api(p, { method: m, body: JSON.stringify(b || {}) });
const say = (id, t, c = '') => { const el = typeof id === 'string' ? $(id) : id; if (el) { el.className = 'msg ' + c; el.textContent = t; } };
const fail = (id) => (e) => { if (e.message !== 'auth') id ? say(id, e.message, 'err') : toast(e.message, 'err'); };
const qstr = (o) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== '' && v != null && v !== false) u.set(k, v); const s = u.toString(); return s ? '?' + s : ''; };
// скачать файл с заголовком авторизации (CSV и т.п.)
async function download(path) {
  const r = await api(path, { raw: true }), blob = await r.blob();
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || 'premier.csv';
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// кнопка «в работе» на время запроса
async function busy(btn, fn) {
  if (!btn || btn.classList.contains('loading')) return;
  btn.classList.add('loading'); btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; }
}
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- адрес раздела: #раздел/id?параметры ---------- */
function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1)), [pathPart, query = ''] = h.split('?'), [v, ...rest] = pathPart.split('/');
  return { v: v || '', id: rest.join('/') || '', params: Object.fromEntries(new URLSearchParams(query)) };
}
function hashOf(v, id, params) { return '#' + v + (id ? '/' + encodeURIComponent(id) : '') + qstr(params); }
// обновить адрес без перерисовки (фильтры, открытая карточка)
function setHash(v, id, params) { const h = hashOf(v, id, params); if (location.hash !== h) history.replaceState(null, '', h); }
const go = (v, id, params) => { location.hash = hashOf(v, id, params).slice(1); };
