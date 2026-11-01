// Панель управления Premier — каркас: вход (с 2FA), меню разделов, маршруты, поиск по всему (Ctrl+K), горячие клавиши, тема.
'use strict';
const NAV = [
  { g: 'Обзор', items: [{ v: 'dashboard', t: 'Дашборд', sub: 'Ключевые цифры и что требует внимания', icon: 'chart', perm: 'dashboard', key: 'd' }] },
  { g: 'Клиенты', items: [
    { v: 'users', t: 'Пользователи', sub: 'Аккаунты, тарифы, лимиты и блокировки', icon: 'users', perm: 'users.view', key: 'u' },
    { v: 'payments', t: 'Платежи', sub: 'Вся история оплат с фильтрами и выгрузкой', icon: 'receipt', perm: 'payments.view', key: 'p' },
    { v: 'promos', t: 'Промокоды', sub: 'Скидки, подарочные тарифы и коды пачкой', icon: 'tag', perm: 'promos.view', key: 'c' },
    { v: 'referrals', t: 'Рефералы', sub: 'Приглашения, лучшие партнёры и подозрительные совпадения', icon: 'gift', perm: 'referrals.view' },
  ] },
  { g: 'Продукт', items: [
    { v: 'models', t: 'Модели', sub: 'Подключение моделей, тарифы и мониторинг работы', icon: 'layers', perm: 'models.view', key: 'm' },
    { v: 'api', t: 'API', sub: 'Запросы, ключи и ошибки API для разработчиков', icon: 'code', perm: 'api.view' },
    { v: 'plans', t: 'Тарифы и оплата', sub: 'Цены, лимиты, пробный период и платёжные системы', icon: 'card', perm: 'plans.view' },
    { v: 'tools', t: 'Инструменты', sub: 'Интернет, картинки, видео, Python и встроенный браузер', icon: 'tool', perm: 'tools.view' },
  ] },
  { g: 'Контент', items: [
    { v: 'reviews', t: 'Отзывы', sub: 'Модерация отзывов пользователей', icon: 'star', perm: 'reviews.view', badge: 'reviews', key: 'r' },
    { v: 'content', t: 'Объявления', sub: 'Баннер в чате и режим технических работ', icon: 'megaphone', perm: 'content.view' },
  ] },
  { g: 'Система', items: [
    { v: 'errors', t: 'Ошибки', sub: 'Ошибки сервера, сгруппированные по месту', icon: 'bug', perm: 'system.view', badge: 'errors', bad: true, key: 'e' },
    { v: 'audit', t: 'Журнал действий', sub: 'Кто, что и когда изменил в панели', icon: 'history', perm: 'audit.view', key: 'a' },
    { v: 'settings', t: 'Настройки', sub: 'Доступ, оповещения, резервные копии и сервер', icon: 'settings', perm: 'system.view', key: 's' },
    { v: 'team', t: 'Команда', sub: 'Администраторы, роли и права доступа', icon: 'shield', perm: 'admins.manage', key: 't' },
  ] },
];
const EXTRA_VIEWS = { profile: { v: 'profile', t: 'Профиль и безопасность', sub: 'Пароль, двухфакторная защита и активные сессии', icon: 'user' } };
const navItems = () => NAV.flatMap((g) => g.items);
const allowedItems = () => navItems().filter((x) => !x.perm || can(x.perm));

/* ---------- тема и меню ---------- */
const THEMES = { system: ['Системная тема', 'monitor'], light: ['Светлая тема', 'sun'], dark: ['Тёмная тема', 'moon'] };
function applyTheme(t = pref.get('theme', 'system')) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}
function cycleTheme() { const order = ['system', 'light', 'dark'], t = order[(order.indexOf(pref.get('theme', 'system')) + 1) % 3]; pref.set('theme', t); applyTheme(t); toast(THEMES[t][0], 'info'); }
function applyMini() { $('app').classList.toggle('mini', !!pref.get('mini', false)); $('miniT').title = pref.get('mini', false) ? 'Развернуть меню' : 'Свернуть меню'; }
const toggleMini = () => { pref.set('mini', !pref.get('mini', false)); applyMini(); };
const closeNav = () => { $('nav').classList.remove('open'); $('overlay').classList.remove('on'); };

function renderNav() {
  $('navList').innerHTML = NAV.map((g) => {
    const items = g.items.filter((x) => !x.perm || can(x.perm)); if (!items.length) return '';
    return `<div class="nav-g"><b>${esc(g.g)}</b>${items.map((x) => `<a class="it" href="#${x.v}" data-v="${x.v}" title="${esc(x.t)}">${I(x.icon)}<span class="lbl">${esc(x.t)}</span>${x.badge ? `<span class="nb${x.bad ? ' bad' : ''}" data-badge="${x.badge}" hidden></span><span class="nb-dot" data-dot="${x.badge}" hidden></span>` : ''}</a>`).join('')}</div>`;
  }).join('');
}
function renderMe() {
  const a = S.me;
  $('meBtn').innerHTML = `<span class="av sm">${esc(initials(a.name || a.login))}</span><div class="grow"><b class="ell">${esc(a.name || a.login)}</b><small>${esc([a.login !== a.name && a.login, a.name !== a.roleName && a.roleName, a.totp && '2FA'].filter(Boolean).join(' · '))}</small></div>${I('more')}`;
}
$('meBtn').onclick = (e) => menu(e.currentTarget, [
  { label: 'Профиль и безопасность', icon: 'user', on: () => go('profile') },
  { label: THEMES[pref.get('theme', 'system')][0] + ' — сменить', icon: THEMES[pref.get('theme', 'system')][1], on: cycleTheme },
  { label: 'Горячие клавиши', icon: 'keyboard', on: showKeys },
  '-',
  { label: 'Открыть Premier', icon: 'ext', href: '/chat', blank: true },
  { label: 'Выйти', icon: 'out', danger: true, on: () => logout() },
]);
$('miniT').onclick = toggleMini;
$('burger').onclick = () => { $('nav').classList.add('open'); $('overlay').classList.add('on'); };
$('overlay').onclick = closeNav;
$('scrim').onclick = () => closeDrawer();
$('searchBtn').onclick = () => palette();
$('refreshBtn').onclick = () => { refreshBadges(); route(); };

/* ---------- вход и выход ---------- */
function showLogin(note = '') {
  S.token = null; S.me = null; localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); clearInterval(S.bt);
  closeDrawer(true); closeMenu(); closePalette();
  $('app').hidden = true; $('login').hidden = false; $('step1').hidden = false; $('step2').hidden = true; $('back').hidden = true; $('code').value = '';
  $('lbtn').textContent = 'Войти'; say('lmsg', note, 'err'); $('pw').value = '';
  setTimeout(() => $('pw').focus(), 50);
}
function logout(note) {
  if (S.token && !note) fetch('/api/admin/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token } }).catch(() => {});
  showLogin(note);
}
$('loginF').onsubmit = async (e) => {
  e.preventDefault();
  const two = !$('step2').hidden, body = { login: $('lg').value.trim(), password: $('pw').value, remember: $('remember').checked };
  if (two) body.code = $('code').value.trim();
  try {
    const j = await busy($('lbtn'), () => post('/api/admin/login', body));
    S.token = j.token; (body.remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, j.token);
    start();
  } catch (er) {
    if (er.data && er.data.totp) {
      $('step1').hidden = true; $('step2').hidden = false; $('back').hidden = false; $('lbtn').textContent = 'Подтвердить';
      say('lmsg', two ? er.message : '', 'err'); $('code').value = ''; setTimeout(() => $('code').focus(), 30);
    } else { say('lmsg', er.message, 'err'); if (!two) $('pw').select(); }
  }
};
$('code').oninput = () => { $('code').value = $('code').value.replace(/\D/g, '').slice(0, 6); if ($('code').value.length === 6) $('loginF').requestSubmit(); };
$('back').onclick = () => showLogin();

async function start() {
  $('login').hidden = true; $('app').hidden = false;
  try {
    const me = await api('/api/admin/me'); S.me = me.admin; S.roles = me.roles || {};
    S.plans = (await api('/api/admin/plans')).plans || [];
  } catch (e) { if (e.message !== 'auth') showLogin(e.message); return; }
  renderNav(); renderMe(); applyMini(); route(); refreshBadges();
  clearInterval(S.bt); S.bt = setInterval(refreshBadges, 60000);
}

/* ---------- маршруты ---------- */
S.seq = 0;
async function route() {
  if (!S.me) return;
  closeMenu(); closeDrawer(true); closePalette(); closeNav();
  const h = parseHash(), allowed = allowedItems();
  let v = h.v;
  if (!R[v] || !(EXTRA_VIEWS[v] || allowed.some((x) => x.v === v))) { v = (allowed[0] || EXTRA_VIEWS.profile).v; history.replaceState(null, '', '#' + v); }
  const meta = navItems().find((x) => x.v === v) || EXTRA_VIEWS[v];
  S.view = v; const seq = ++S.seq;
  qsa('#navList a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
  $('vtitle').textContent = meta.t; $('vsub').textContent = meta.sub; $('vact').innerHTML = ''; document.title = meta.t + ' · Панель Premier';
  const root = $('viewRoot'); root.innerHTML = `<div id="view">${skeleton()}</div>`;
  root.style.animation = 'none'; void root.offsetHeight; root.style.animation = '';
  try { await R[v](h.params, h.id); }
  catch (e) { if (e.message !== 'auth' && seq === S.seq && $('view')) $('view').innerHTML = `<div class="empty">${I('alert')}<b>Не удалось загрузить раздел</b>${esc(e.message)}<div class="btns" style="justify-content:center;margin-top:12px"><button class="btn" onclick="route()">${I('refresh')}Повторить</button></div></div>`; }
}
addEventListener('hashchange', route);

/* ---------- счётчики в меню ---------- */
async function refreshBadges() {
  if (!S.token || !S.me) return;
  try { S.badges = await api('/api/admin/badges'); } catch { return; }
  for (const el of qsa('[data-badge]')) { const n = S.badges[el.dataset.badge] || 0; el.textContent = n > 99 ? '99+' : n; el.hidden = !n; }
  for (const el of qsa('[data-dot]')) el.hidden = !S.badges[el.dataset.dot];
  $('pills').innerHTML = S.badges.maintenance ? `<a class="pill warn" href="#content">${I('alert')}Техработы</a>` : '';
}
addEventListener('focus', () => refreshBadges());

/* ---------- поиск по всему: Ctrl+K ---------- */
function closePalette() { const p = $('cmdk'); if (p) p.remove(); }
function palette() {
  if ($('cmdk')) return;
  const w = document.createElement('div'); w.className = 'cmdk'; w.id = 'cmdk';
  w.innerHTML = `<div class="cmdk-box" role="dialog" aria-label="Поиск"><div class="cmdk-in">${I('search')}<input placeholder="Пользователь, платёж, промокод, модель или раздел…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><div class="cmdk-list" role="listbox"></div><div class="cmdk-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span><kbd>?</kbd> горячие клавиши</span></div></div>`;
  document.body.append(w);
  const inp = w.querySelector('input'), list = w.querySelector('.cmdk-list');
  const actions = [
    { t: 'Профиль и безопасность', icon: 'user', run: () => go('profile') },
    { t: 'Сменить тему', icon: 'sun', run: cycleTheme },
    can('promos.edit') && { t: 'Создать промокод', icon: 'plus', run: () => go('promos', '', { new: '1' }) },
    can('content.edit') && { t: 'Опубликовать объявление', icon: 'megaphone', run: () => go('content') },
    can('backup') && { t: 'Резервная копия базы', icon: 'database', run: () => go('settings', '', { tab: 'backup' }) },
    { t: 'Горячие клавиши', icon: 'keyboard', run: showKeys },
    { t: 'Открыть Premier', icon: 'ext', run: () => window.open('/chat', '_blank') },
    { t: 'Выйти', icon: 'out', run: () => logout() },
  ].filter(Boolean);
  let opts = [], idx = 0, found = null;
  const paint = () => {
    const s = inp.value.trim().toLowerCase();
    const sections = allowedItems().filter((x) => !s || x.t.toLowerCase().includes(s) || x.sub.toLowerCase().includes(s)).map((x) => ({ g: 'Разделы', t: x.t, icon: x.icon, hint: x.key ? 'G ' + x.key.toUpperCase() : '', run: () => go(x.v) }));
    const acts = actions.filter((x) => !s || x.t.toLowerCase().includes(s)).map((x) => ({ ...x, g: 'Действия' }));
    const ext = [];
    if (found && found.q === s) {
      for (const u of found.users) ext.push({ g: 'Пользователи', t: u.login, hint: u.email || planName(u.plan), icon: u.banned ? 'ban' : 'user', run: () => go('users', u.id) });
      for (const p of found.payments) ext.push({ g: 'Платежи', t: `${rub(p.amount)} · ${p.login || ''}`, hint: (PST[p.status] || [p.status])[0] + ' · ' + dt(p.at), icon: 'receipt', run: () => go('payments', p.id) });
      for (const p of found.promos) ext.push({ g: 'Промокоды', t: p.code, hint: p.kind === 'gift' ? 'подарок' : 'скидка', icon: 'tag', run: () => go('promos', '', { q: p.code }) });
      for (const m of found.models) ext.push({ g: 'Модели', t: m.name, hint: m.modelId, icon: 'layers', run: () => go('models') });
    }
    opts = s ? [...ext, ...sections, ...acts] : [...sections, ...acts];
    idx = Math.min(idx, Math.max(0, opts.length - 1));
    let g = '';
    list.innerHTML = opts.length ? opts.map((o, i) => (o.g !== g ? `<div class="g">${esc((g = o.g))}</div>` : '') + `<div class="o${i === idx ? ' on' : ''}" data-i="${i}" role="option">${I(o.icon)}<span class="ell">${esc(o.t)}</span>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</div>`).join('')
      : `<div class="empty" style="margin:10px;border:0">${s.length < 2 ? 'Введите хотя бы 2 символа' : 'Ничего не найдено'}</div>`;
    list.querySelector('.o.on')?.scrollIntoView({ block: 'nearest' });
  };
  const find = debounce(async () => { const s = inp.value.trim().toLowerCase(); if (s.length < 2) return; try { const r = await api('/api/admin/find' + qstr({ q: s })); found = { ...r, q: s }; if ($('cmdk')) paint(); } catch {} }, 180);
  const run = (i) => { const o = opts[i]; if (!o) return; closePalette(); o.run(); };
  inp.oninput = () => { idx = 0; paint(); find(); };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(opts.length - 1, idx + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(idx); }
  };
  list.onclick = (e) => { const o = e.target.closest('[data-i]'); if (o) run(+o.dataset.i); };
  list.onmousemove = (e) => { const o = e.target.closest('[data-i]'); if (o && +o.dataset.i !== idx) { idx = +o.dataset.i; qsa('.o', list).forEach((x) => x.classList.toggle('on', +x.dataset.i === idx)); } };
  w.onmousedown = (e) => { if (e.target === w) closePalette(); };
  paint(); inp.focus();
}

/* ---------- горячие клавиши ---------- */
function showKeys() {
  const rows = allowedItems().filter((x) => x.key).map((x) => `<span><kbd>G</kbd> <kbd>${x.key.toUpperCase()}</kbd></span><span>${esc(x.t)}</span>`).join('');
  modal({ title: 'Горячие клавиши', cancel: '', ok: 'Понятно', body: `<div class="keys"><span><kbd>Ctrl</kbd> <kbd>K</kbd> или <kbd>/</kbd></span><span>Поиск по всему</span><span><kbd>Esc</kbd></span><span>Закрыть карточку или окно</span><span><kbd>?</kbd></span><span>Эта подсказка</span>${rows}</div>` });
}
let gWait = 0;
document.addEventListener('keydown', (e) => {
  if (modalDepth || !S.me) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('cmdk') ? closePalette() : palette(); return; }
  if (e.key === 'Escape') { if ($('cmdk')) closePalette(); else if ($('menu')) closeMenu(); else if (drawerOpen()) closeDrawer(); else closeNav(); return; }
  if (e.target.closest('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || $('cmdk')) return;
  if (e.key === '/') { e.preventDefault(); palette(); }
  else if (e.key === '?') showKeys();
  else if (gWait && Date.now() - gWait < 1200) { gWait = 0; const it = allowedItems().find((x) => x.key === e.key.toLowerCase()); if (it) go(it.v); }
  else if (e.key.toLowerCase() === 'g') gWait = Date.now();
});
document.addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) { e.preventDefault(); copyText(c.dataset.copy); } });

applyTheme();
if (S.token) start(); else showLogin();
