// Раздел «Пользователи»: список с фильтрами, сортировкой и массовыми действиями + карточка пользователя справа.
'use strict';
(() => {
  const STATUS = [['', 'Все', 'all'], ['paid', 'Платные'], ['trial', 'Пробный'], ['free', 'Free'], ['expiring', 'Заканчивается'], ['expired', 'Истекла'], ['new7', 'Новые за 7 дней'],
    ['active7', 'Активны 7 дней'], ['inactive30', 'Неактивны 30+ дней'], ['payers', 'Платили'], ['api', 'С API-ключами'], ['ext', 'Повышен лимит'], ['noted', 'С заметками'], ['banned', 'Заблокированы']];
  const LIM = [['m', 'Сообщения', 'msgs'], ['c', 'Python', 'code'], ['s', 'Сайты', 'sites'], ['i', 'Картинки', 'images'], ['v', 'Видео', 'videos']];
  let st = {}, data = null, sel = new Set(), regOpen = null;

  const viaBadge = (u) => (u.google ? '<span class="badge out" title="Вход через Google">G</span>' : u.github ? '<span class="badge out" title="Вход через GitHub">GH</span>' : '');
  const planCell = (u) => `${planBadge(u.plan)}${u.trial ? ' <span class="badge info">пробный</span>' : ''}${u.ext ? ' <span class="badge acc" title="Повышенный лимит">+лимит</span>' : ''}<div class="dim" style="font-size:12px;margin-top:3px">${u.until ? 'до ' + dt(u.until) + ' · ' + left(u.until) : u.expired ? 'подписка истекла' : 'бессрочно'}</div>`;

  R.users = async (params, id) => {
    st = { q: '', plan: '', status: '', via: '', tag: '', sort: 'created', dir: 'desc', page: 1, size: pref.get('usersSize', 50), ...params };
    sel = new Set();
    const el = $('view');
    $('vact').innerHTML = `<button class="btn" id="uExport">${I('download')}CSV</button>${can('users.create') ? `<button class="btn pri" id="uNew">${I('plus')}Аккаунт</button>` : ''}`;
    $('uExport').onclick = (e) => busy(e.currentTarget, () => download('/api/admin/users/export' + qstr({ ...st, page: '', size: '' })).then(() => toast('Файл скачан', 'ok')));
    if ($('uNew')) $('uNew').onclick = createUser;
    el.innerHTML = `<div class="filters" id="uChips"></div>
      <div class="toolbar"><label class="inp-ico">${I('search')}<input class="inp" id="uq" placeholder="Логин, почта, имя, ID или метка" value="${esc(st.q)}" autocomplete="off"></label>
        <select class="inp" id="uPlan" style="width:auto"><option value="">Все тарифы</option>${S.plans.map((p) => `<option value="${p.id}"${st.plan === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <select class="inp" id="uVia" style="width:auto"><option value="">Любой вход</option><option value="google"${st.via === 'google' ? ' selected' : ''}>Google</option><option value="github"${st.via === 'github' ? ' selected' : ''}>GitHub</option><option value="email"${st.via === 'email' ? ' selected' : ''}>По почте</option></select>
        <select class="inp" id="uTag" style="width:auto" hidden></select>
        <span class="sp"></span><span id="uReg"></span></div>
      <div class="card tight" id="uCard"></div><div id="uBulk"></div>`;
    $('uq').oninput = debounce(() => { st.q = $('uq').value.trim(); st.page = 1; load(); }, 250);
    $('uPlan').onchange = () => { st.plan = $('uPlan').value; st.page = 1; load(); };
    $('uVia').onchange = () => { st.via = $('uVia').value; st.page = 1; load(); };
    $('uTag').onchange = () => { st.tag = $('uTag').value; st.page = 1; load(); };
    $('uCard').addEventListener('click', (e) => { const b = e.target.closest('[data-more]'); if (b && data) rowMenu(b, data.items.find((u) => u.id === b.dataset.more)); });
    $('uChips').onclick = (e) => { const b = e.target.closest('[data-st]'); if (!b) return; st.status = b.dataset.st; st.page = 1; load(); };
    if (can('system.edit') || can('users.view')) api('/api/admin/users').then((j) => { regOpen = j.register; paintReg(); }).catch(() => {});
    await load();
    if (id) openUser(id);
  };
  function paintReg() {
    const box = $('uReg'); if (!box || regOpen == null) return;
    box.innerHTML = `<label class="switch" title="Новые пользователи могут зарегистрироваться сами"><input type="checkbox" id="regT"${regOpen ? ' checked' : ''}${can('system.edit') ? '' : ' disabled'}><i></i><span class="muted" style="font-size:13px">Открытая регистрация</span></label>`;
    $('regT').onchange = async (e) => { try { await post('/api/admin/register', { open: e.target.checked }); regOpen = e.target.checked; toast(regOpen ? 'Регистрация открыта' : 'Регистрация закрыта — войти смогут только существующие аккаунты', 'ok'); } catch (er) { e.target.checked = !e.target.checked; fail()(er); } };
  }
  const sync = () => setHash('users', drawerOpen() ? openId : '', { ...st, page: st.page > 1 ? st.page : '', size: '', sort: st.sort === 'created' ? '' : st.sort, dir: st.dir === 'desc' ? '' : st.dir });

  async function load() {
    sync();
    const j = await api('/api/admin/users/list' + qstr(st));
    if (!$('uCard')) return;
    data = j; st.page = j.page;
    $('uChips').innerHTML = STATUS.filter(([k]) => !k || j.facets[k] || st.status === k).map(([k, t, f]) => `<button class="chip${st.status === k ? ' on' : ''}" data-st="${k}">${t} <i>${num(j.facets[f || k] || 0)}</i></button>`).join('');
    const tg = $('uTag'); tg.hidden = !j.tags.length; tg.innerHTML = `<option value="">Все метки</option>${j.tags.map((t) => `<option${st.tag === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}`;
    const cols = [
      { t: 'Пользователь', sort: 'login', render: (u) => `<div class="who"><span class="av">${esc(initials(u.name || u.login))}</span><div class="grow"><b>${esc(u.login)} ${viaBadge(u)}${u.banned ? ' <span class="badge bad">заблокирован</span>' : ''}</b><small>${esc(u.email || u.name || '—')}${u.tags.length ? ' · ' + u.tags.map((t) => `<span class="tag" style="height:18px;font-size:11px">${esc(t)}</span>`).join(' ') : ''}${u.note ? ' ' + I('edit', 'dim') : ''}</small></div></div>` },
      { t: 'Тариф', sort: 'until', render: planCell },
      { t: 'Сегодня', sort: 'used', render: (u) => usageBar(u.used, u.msgLimit) },
      { t: 'Оплачено', sort: 'spent', cls: 'r', render: (u) => (u.spent ? `<b>${rub(u.spent)}</b><div class="dim" style="font-size:12px">${pn(u.pays, 'платёж', 'платежа', 'платежей')}</div>` : '<span class="dim">—</span>') },
      { t: 'Был в сети', sort: 'seen', render: (u) => (u.seen ? `<span title="${esc(dtt(u.seen))}">${ago(u.seen)}</span>` : '<span class="dim">—</span>') + (u.keys ? `<div class="dim" style="font-size:12px">${I('key', 'dim')} ${pn(u.keys, 'API-ключ', 'API-ключа', 'API-ключей')}</div>` : '') },
      { t: 'Регистрация', sort: 'created', render: (u) => `<span title="${esc(dtt(u.created))}">${dt(u.created)}</span>` },
      { t: '', cls: 'r', render: (u) => `<button class="ib sm" data-more="${esc(u.id)}" aria-label="Действия">${I('more')}</button>` },
    ];
    $('uCard').innerHTML = tableHTML({ cols, rows: j.items, sort: { k: st.sort, dir: st.dir }, sel, empty: j.facets.all ? 'Никого не нашлось' : 'Пользователей пока нет', emptyIcon: 'users' }) + pagerHTML(j);
    bindTable($('uCard'), {
      rows: j.items, sel,
      onSort: (k) => { st.dir = st.sort === k && st.dir === 'desc' ? 'asc' : 'desc'; st.sort = k; load(); },
      onRow: (u) => openUser(u.id),
      onSel: paintBulk,
    });
    bindPager($('uCard'), (p) => { st.page = p; load(); }, (n) => { st.size = n; pref.set('usersSize', n); st.page = 1; load(); });
    paintBulk();
  }
  function rowMenu(btn, u) {
    menu(btn, [
      { label: 'Открыть карточку', icon: 'user', on: () => openUser(u.id) },
      { label: 'Скопировать ID', icon: 'copy', on: () => copyText(u.id) },
      { label: 'Платежи пользователя', icon: 'receipt', on: () => go('payments', '', { uid: u.id }) },
      can('users.edit') && '-',
      can('users.edit') && { label: 'Изменить тариф…', icon: 'card', on: () => changePlan(u, refreshAll) },
      can('users.edit') && { label: 'Выдать сообщения…', icon: 'plus', on: () => giveMsgs(u, refreshAll) },
      can('users.ban') && (u.banned ? { label: 'Разблокировать', icon: 'check', on: () => ban(u, false) } : { label: 'Заблокировать…', icon: 'ban', danger: true, on: () => ban(u, true) }),
      can('users.delete') && { label: 'Удалить аккаунт…', icon: 'trash', danger: true, on: () => delUser(u) },
    ]);
  }
  function paintBulk() {
    const box = $('uBulk'); if (!box) return;
    if (!sel.size) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="bulkbar"><b>Выбрано: ${num(sel.size)}</b>
      ${can('users.edit') ? `<button class="btn sm" data-b="plan">${I('card')}Тариф</button><button class="btn sm" data-b="tag">${I('tag')}Метка</button><button class="btn sm" data-b="logout">${I('out')}Выйти везде</button>` : ''}
      ${can('users.ban') ? `<button class="btn sm" data-b="ban">${I('ban')}Заблокировать</button><button class="btn sm" data-b="unban">Разблокировать</button>` : ''}
      ${can('users.delete') ? `<button class="btn sm danger" data-b="delete">${I('trash')}Удалить</button>` : ''}
      <button class="btn sm" data-b="clear">${I('x')}Снять</button></div>`;
    box.onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) bulk(b.dataset.b); };
  }
  async function bulk(action) {
    if (action === 'clear') { sel.clear(); return load(); }
    const ids = [...sel], n = pn(ids.length, 'пользователь', 'пользователя', 'пользователей');
    let body = { ids, action };
    if (action === 'plan') {
      const v = await formBox({ title: 'Тариф для ' + n, fields: planFields(), ok: 'Применить' }); if (!v) return; Object.assign(body, v);
    } else if (action === 'tag') {
      const v = await formBox({ title: 'Метка для ' + n, fields: [{ k: 'tag', label: 'Метка', placeholder: 'например: vip, партнёр, жалоба', required: true, autofocus: true }, { k: 'remove', type: 'check', label: 'Снять эту метку, а не добавить' }], ok: 'Применить' });
      if (!v) return; body.tag = v.tag; if (v.remove) body.action = 'untag';
    } else if (action === 'ban') {
      const v = await formBox({ title: 'Заблокировать ' + n + '?', text: 'Они сразу выйдут со всех устройств, а их API-ключи перестанут работать.', fields: [{ k: 'reason', label: 'Причина (видна только в панели)', placeholder: 'спам, мультиаккаунты…' }], ok: 'Заблокировать', danger: true }); if (!v) return; body.reason = v.reason;
    } else if (action === 'delete') {
      if (!(await confirmBox(`Удалить ${n}?`, 'Будут удалены аккаунты вместе с чатами, памятью и файлами. Отменить нельзя.', { danger: true, ok: 'Удалить навсегда', typeToConfirm: 'удалить' }))) return;
    } else if (!(await confirmBox({ logout: 'Выйти на всех устройствах', unban: 'Разблокировать' }[action] + ' — ' + n + '?', '', { ok: 'Да' }))) return;
    try { const r = await post('/api/admin/users/bulk', body); toast(`Готово: ${pn(r.done, 'пользователь', 'пользователя', 'пользователей')}`, 'ok'); sel.clear(); load(); } catch (e) { fail()(e); }
  }

  /* ---------- действия ---------- */
  const planFields = (cur) => [
    { k: 'plan', type: 'select', label: 'Тариф', value: cur && cur !== 'free' ? cur : (S.plans.find((p) => p.id !== 'free') || {}).id, options: S.plans.map((p) => ({ v: p.id, t: p.name + (p.price ? ` · ${rub(p.price)}` : '') })) },
    { k: 'days', type: 'number', label: 'Дней', value: 30, min: 1, max: 3650, hint: 'Для Free не важно — тариф просто сбросится' },
    { k: 'extend', type: 'check', label: 'Продлить от текущей даты окончания (если тариф тот же)', value: true },
  ];
  async function changePlan(u, after) {
    const v = await formBox({ title: 'Тариф: ' + u.login, fields: planFields(u.plan), ok: 'Сохранить', onOk: (x) => post(`/api/admin/users/${u.id}/plan`, x) });
    if (v) { toast('Тариф обновлён', 'ok'); after && after(); }
  }
  async function giveMsgs(u, after) {
    const v = await formBox({ title: 'Сообщения на сегодня: ' + u.login, text: 'Выдать — уменьшает сегодняшний расход (не ниже нуля). Забрать — увеличивает.', fields: [
      { k: 'action', type: 'select', label: 'Действие', value: 'give', options: [{ v: 'give', t: 'Выдать сообщения' }, { v: 'take', t: 'Забрать сообщения' }] },
      { k: 'amount', type: 'number', label: 'Количество', value: 20, min: 1, max: 100000, required: true }], ok: 'Применить', onOk: (x) => post('/api/admin/usage', { uid: u.id, ...x }) });
    if (v) { toast(v.msgLeft == null ? 'Готово' : `Готово — осталось ${num(v.msgLeft, 1)} сообщений`, 'ok'); after && after(); }
  }
  async function extLimit(u, after) {
    const v = await formBox({ title: 'Повысить дневной лимит: ' + u.login, text: 'Временный лимит сообщений в день — только вверх от тарифного.', fields: [
      { k: 'limit', type: 'number', label: 'Сообщений в день', value: 500, min: 1, max: 10000, required: true }, { k: 'days', type: 'number', label: 'На сколько дней', value: 7, min: 1, max: 30, required: true }],
    ok: 'Повысить', onOk: (x) => post('/api/admin/msg-ext', { uid: u.id, ...x }) });
    if (v) { toast('Лимит повышен', 'ok'); after && after(); }
  }
  async function ban(u, on) {
    if (on) {
      const v = await formBox({ title: 'Заблокировать ' + u.login + '?', text: 'Пользователь сразу выйдет со всех устройств, не сможет войти, а его API-ключи перестанут работать. Разблокировать можно в любой момент.', fields: [{ k: 'reason', label: 'Причина (видна только в панели)', placeholder: 'спам, мультиаккаунты, жалоба…' }], ok: 'Заблокировать', danger: true, onOk: (x) => post(`/api/admin/users/${u.id}/ban`, { on: true, reason: x.reason }) });
      if (!v) return; toast('Аккаунт заблокирован', 'ok');
    } else { try { await post(`/api/admin/users/${u.id}/ban`, { on: false }); toast('Аккаунт разблокирован', 'ok'); } catch (e) { return fail()(e); } }
    refreshAll();
  }
  async function delUser(u) {
    if (!(await confirmBox(`Удалить аккаунт ${u.login}?`, 'Будут удалены чаты, память и файлы пользователя. Он сразу потеряет доступ. Отменить нельзя.', { danger: true, ok: 'Удалить навсегда', typeToConfirm: u.login }))) return;
    try { await api('/api/admin/users/' + u.id, { method: 'DELETE' }); toast('Аккаунт удалён', 'ok'); closeDrawer(); load(); } catch (e) { fail()(e); }
  }
  async function createUser() {
    const v = await formBox({ title: 'Создать аккаунт', text: 'Аккаунт привяжется к Google или GitHub при первом входе с этой почтой.', fields: [
      { k: 'email', type: 'email', label: 'Почта', placeholder: 'name@gmail.com', required: true, autofocus: true }, { k: 'name', label: 'Имя (необязательно)' }], ok: 'Создать', onOk: (x) => post('/api/admin/users', x) });
    if (v) { toast('Аккаунт создан: ' + v.login, 'ok'); load(); openUser(v.id); }
  }
  const refreshAll = () => { load(); if (drawerOpen() && openId) openUser(openId, tab); };

  /* ---------- карточка ---------- */
  let openId = null, tab = 'overview';
  async function openUser(id, keepTab) {
    openId = id; tab = keepTab || 'overview';
    const d0 = drawer({ title: 'Загрузка…', body: skeleton(8), onClose: () => { openId = null; sync(); } });
    sync();
    let c; try { c = await api('/api/admin/users/' + id); } catch (e) { d0.querySelector('.db').innerHTML = emptyBox('Не удалось открыть', esc(e.message), 'alert'); return; }
    if (openId !== id) return;
    const u = c.user, TABS = [['overview', 'Обзор'], ['payments', 'Платежи', c.payments.length], ['usage', 'Расход'], ['api', 'API', c.keys.length], ['refs', 'Рефералы', c.referral.invited.length], ['reviews', 'Отзывы', c.reviews.length], c.audit.length ? ['history', 'История', c.audit.length] : null].filter(Boolean);
    const d = drawer({
      title: esc(u.login) + ' ' + viaBadge(u), sub: esc(u.email || u.name || ''), avatar: `<span class="av lg">${esc(initials(u.name || u.login))}</span>`,
      actions: `<button class="ib" id="cMore" aria-label="Действия">${I('more')}</button>`, onClose: () => { openId = null; sync(); },
      body: `<div id="cBody"></div>`,
    });
    d.querySelector('.dh').insertAdjacentHTML('afterend', `<div class="tabs" id="cTabs">${TABS.map(([k, t, n]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${t}${n ? ` <i>${n}</i>` : ''}</button>`).join('')}</div>`);
    $('cTabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; qsa('#cTabs button').forEach((x) => x.classList.toggle('on', x === b)); paintTab(c); };
    $('cMore').onclick = (e) => menu(e.currentTarget, [
      { label: 'Скопировать ID', icon: 'copy', on: () => copyText(u.id) },
      { label: 'Все платежи в разделе «Платежи»', icon: 'receipt', on: () => go('payments', '', { uid: u.id }) },
      can('users.edit') && { label: 'Выйти на всех устройствах', icon: 'out', on: async () => { try { const r = await post(`/api/admin/users/${u.id}/logout`); toast(`Завершено сессий: ${r.n}`, 'ok'); openUser(u.id, tab); } catch (er) { fail()(er); } } },
      can('users.edit') && c.keys.length && { label: 'Отозвать все API-ключи', icon: 'key', on: async () => { if (await confirmBox('Отозвать все API-ключи?', 'Программы пользователя перестанут работать, пока он не создаст новый ключ.', { danger: true, ok: 'Отозвать' })) { await post(`/api/admin/users/${u.id}/keys/revoke`).catch(fail()); toast('Ключи отозваны', 'ok'); openUser(u.id, 'api'); } } },
      can('users.ban') && '-',
      can('users.ban') && (u.banned ? { label: 'Разблокировать', icon: 'check', on: () => ban(u, false) } : { label: 'Заблокировать…', icon: 'ban', danger: true, on: () => ban(u, true) }),
      can('users.delete') && { label: 'Удалить аккаунт…', icon: 'trash', danger: true, on: () => delUser(u) },
    ]);
    paintTab(c);
  }
  function paintTab(c) {
    const u = c.user, box = $('cBody'); if (!box) return;
    const plan = planOf(u.plan) || {}, today = c.usage[c.usage.length - 1] || {};
    if (tab === 'overview') {
      box.innerHTML = `
        ${u.banned ? `<div class="note bad mb row">${I('ban')}<div class="grow"><b>Аккаунт заблокирован</b> ${dtt(u.banned.at)}${u.banned.by ? ' · ' + esc(u.banned.by) : ''}${u.banned.reason ? `<div>Причина: ${esc(u.banned.reason)}</div>` : ''}</div>${can('users.ban') ? '<button class="btn sm" data-a="unban">Разблокировать</button>' : ''}</div>` : ''}
        <div class="card flat"><div class="chead"><div><h2>${planBadge(u.plan)}${u.trial ? ' <span class="badge info">пробный</span>' : ''}</h2><div class="sub">${u.until ? `Действует до ${dtt(u.until)} · осталось ${left(u.until)}` : u.expired ? 'Подписка истекла' : 'Бесплатный тариф, бессрочно'}${u.ext ? `<br>Повышенный лимит: ${num(u.ext.limit)} в день до ${dt(u.ext.until)}` : ''}${u.refBonus ? `<br>Бонус за приглашения: ${num(u.refBonus.n)} сообщений до ${dt(u.refBonus.until)}` : ''}</div></div></div>
          ${can('users.edit') ? `<div class="btns left"><button class="btn sm" data-a="plan">${I('card')}Изменить тариф</button><button class="btn sm" data-a="msgs">${I('plus')}Сообщения</button><button class="btn sm" data-a="ext">${I('bolt')}Повысить лимит</button>${u.ext ? '<button class="btn sm ghost" data-a="extreset">Сбросить лимит</button>' : ''}</div>` : ''}</div>
        <div class="card flat"><h3>Сегодня</h3><div class="grid g5" style="gap:10px">${LIM.map(([k, t, pk]) => { const lim = k === 'm' ? u.msgLimit : plan[pk], used = today[k] || 0; return `<div><div class="dim" style="font-size:12px">${t}</div><b style="font-size:16px">${num(used, 1)}</b><span class="dim"> / ${lim == null ? '∞' : num(lim)}</span></div>`; }).join('')}</div></div>
        <div class="card flat"><dl class="kv">
          <dt>ID</dt><dd><span class="mono copy" data-copy="${esc(u.id)}">${esc(u.id)}</span></dd>
          <dt>Имя</dt><dd>${esc(u.name || '—')}</dd>
          <dt>Вход</dt><dd>${u.google ? 'Google' : ''}${u.google && u.github ? ', ' : ''}${u.github ? 'GitHub' + (u.ghLogin ? ` (<a href="https://github.com/${esc(u.ghLogin)}" target="_blank" rel="noopener">${esc(u.ghLogin)}</a>)` : '') : ''}${!u.google && !u.github ? 'ещё не входил (аккаунт создан заранее)' : ''}</dd>
          <dt>Регистрация</dt><dd>${dtt(u.created)}</dd>
          <dt>Был в сети</dt><dd>${u.seen ? ago(u.seen) + ` <span class="dim">· ${dtt(u.seen)}</span>` : '—'}</dd>
          <dt>Активных сессий</dt><dd>${num(u.sessions)}</dd>
          <dt>Чатов</dt><dd>${num(c.chats.n)}${c.chats.last ? ` <span class="dim">· последний ${ago(c.chats.last)}</span>` : ''}</dd>
          <dt>Фактов в памяти</dt><dd>${num(c.memory)}</dd>
          <dt>Оплачено всего</dt><dd><b>${rub(u.spent)}</b> <span class="dim">· ${pn(u.pays, 'платёж', 'платежа', 'платежей')}</span></dd>
          <dt>API за 30 дней</dt><dd>${pn(c.api30.n, 'запрос', 'запроса', 'запросов')} · ${num(c.api30.cost, 1)} сообщ.</dd>
          ${c.referral.by ? `<dt>Пригласил</dt><dd><a href="#users/${esc(c.referral.by.id)}">${esc(c.referral.by.login || c.referral.by.id)}</a> <span class="dim">· ${esc(c.referral.by.status)}</span></dd>` : ''}
        </dl></div>
        <div class="card flat"><h3>Заметка и метки</h3><div class="sub">Видны только администраторам</div>
          <label class="field"><textarea id="cNote" rows="3" placeholder="Например: просил продлить, VIP, жаловался на скорость…"${can('users.edit') ? '' : ' disabled'}>${esc(u.note)}</textarea></label>
          <label class="field"><span>Метки через запятую</span><input id="cTags" value="${esc(u.tags.join(', '))}" placeholder="vip, партнёр"${can('users.edit') ? '' : ' disabled'}></label>
          ${can('users.edit') ? '<div class="btns"><button class="btn sm pri" data-a="note">Сохранить</button></div>' : ''}</div>`;
    } else if (tab === 'payments') {
      box.innerHTML = c.payments.length ? `<div class="card tight flat">${tableHTML({ cols: [
        { t: 'Дата', render: (p) => dtt(p.paid || p.created) }, { t: 'Тариф', render: (p) => `${esc(planName(p.plan))}${p.days ? ` · ${p.days} дн.` : ''}` },
        { t: 'Способ', render: (p) => esc(PROV[p.provider || 'platega'] || p.provider) }, { t: 'Сумма', cls: 'r', render: (p) => `<b>${rub(p.amount)}</b>${p.promo ? `<div class="dim" style="font-size:12px">${esc(p.promo)}</div>` : ''}` }, { t: 'Статус', render: (p) => payBadge(p.status) }],
      rows: c.payments })}</div>` : emptyBox('Платежей нет', '', 'receipt');
      if (c.payments.length) bindTable(box.firstElementChild, { rows: c.payments, onRow: (p) => go('payments', p.id) });
    } else if (tab === 'usage') {
      const sum = (k) => c.usage.reduce((a, x) => a + (x[k] || 0), 0);
      box.innerHTML = `<div class="grid g5 mb" style="gap:10px">${LIM.map(([k, t]) => `<div class="kpi" style="padding:12px 14px"><small>${t}</small><b style="font-size:20px">${num(sum(k), 1)}</b><div class="meta">за 30 дней</div></div>`).join('')}</div><div class="card flat"><h3>Сообщения по дням</h3><div id="cChart"></div></div>`;
      chart($('cChart'), { labels: c.usage.map((x) => x.d), xFmt: dayLabel, type: 'bar', height: 200, series: [{ name: 'Сообщения', data: c.usage.map((x) => x.m) }, { name: 'Картинки', data: c.usage.map((x) => x.i), color: 'var(--info)' }] });
    } else if (tab === 'api') {
      box.innerHTML = c.keys.length ? `<div class="card tight flat">${tableHTML({ click: false, cols: [
        { t: 'Ключ', render: (k) => `<b>${esc(k.name)}</b><div class="dim mono" style="font-size:12px">${esc(k.hint)}</div>` },
        { t: 'Использован', render: (k) => (k.last_used ? `${ago(k.last_used)}<div class="dim" style="font-size:12px">${esc(k.last_client || '')} ${esc(k.last_ip || '')}</div>` : '<span class="dim">никогда</span>') },
        { t: 'Создан', render: (k) => dt(k.created) + (k.expires ? `<div class="dim" style="font-size:12px">до ${dt(k.expires)}</div>` : '') },
        { t: '', cls: 'r', render: (k) => (can('users.edit') ? `<button class="btn sm danger" data-revoke="${esc(k.id)}">Отозвать</button>` : '') }], rows: c.keys })}</div>` : emptyBox('API-ключей нет', '', 'key');
    } else if (tab === 'refs') {
      const info = c.referral.info;
      box.innerHTML = `<div class="grid g3 mb" style="gap:10px">${[['Приглашено', info.total], ['Активных', info.active], ['Ждут активации', info.pending]].map(([t, v]) => `<div class="kpi" style="padding:12px 14px"><small>${t}</small><b style="font-size:20px">${num(v)}</b></div>`).join('')}</div>
        ${c.referral.by ? `<div class="note mb">Этого пользователя пригласил <a href="#users/${esc(c.referral.by.id)}">${esc(c.referral.by.login || c.referral.by.id)}</a> ${ago(c.referral.by.at)} · ${esc(c.referral.by.status)}${c.referral.by.paid ? ' · оплатил' : ''}</div>` : ''}
        ${c.referral.invited.length ? `<div class="card tight flat">${tableHTML({ cols: [{ t: 'Пользователь', render: (r) => esc(r.login || r.id) }, { t: 'Статус', render: (r) => `<span class="badge ${r.status === 'active' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}">${esc(r.status)}</span>${r.paid ? ' <span class="badge acc">оплатил</span>' : ''}` }, { t: 'Сообщений', cls: 'r', k: 'msg' }, { t: 'Когда', render: (r) => ago(r.at) }], rows: c.referral.invited })}</div>` : emptyBox('Никого не приглашал', '', 'gift')}`;
      if (c.referral.invited.length) bindTable(box.lastElementChild, { rows: c.referral.invited, onRow: (r) => go('users', r.id) });
    } else if (tab === 'reviews') {
      box.innerHTML = c.reviews.length ? c.reviews.map((r) => `<div class="rv"><div class="body"><div class="head"><b>${esc(r.nick)}</b><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span><span class="badge ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}">${{ approved: 'опубликован', rejected: 'отклонён', pending: 'на модерации' }[r.status]}</span><span class="dim">${ago(r.at)}</span></div><p>${esc(r.text)}</p></div></div>`).join('') : emptyBox('Отзывов нет', '', 'star');
    } else if (tab === 'history') {
      box.innerHTML = c.audit.map((a) => `<div class="list-row" style="align-items:flex-start"><span class="av sm">${esc(initials(a.login || '?'))}</span><div class="grow"><b>${esc(a.action)}</b> <span class="dim">· ${esc(a.login || 'система')} · ${dtt(a.at)}</span>${(a.data && a.data.diff || []).length ? `<div class="diff">${a.data.diff.map((x) => `<span class="p">${esc(x.p.replace(/^user\./, ''))}</span><span>${x.from != null ? `<del>${esc(x.from)}</del> → ` : ''}<ins>${esc(x.to ?? '—')}</ins></span>`).join('')}</div>` : ''}</div></div>`).join('');
    }
    box.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a, rv = e.target.closest('[data-revoke]');
      const after = () => openUser(u.id, tab) && load();
      if (a === 'plan') changePlan(u, refreshAll);
      else if (a === 'msgs') giveMsgs(u, refreshAll);
      else if (a === 'ext') extLimit(u, refreshAll);
      else if (a === 'extreset') { try { await post('/api/admin/msg-ext', { uid: u.id, action: 'reset' }); toast('Лимит сброшен до тарифного', 'ok'); refreshAll(); } catch (er) { fail()(er); } }
      else if (a === 'unban') ban(u, false);
      else if (a === 'note') {
        try { await busy(e.target.closest('button'), () => post(`/api/admin/users/${u.id}/note`, { note: $('cNote').value, tags: $('cTags').value.split(',') })); toast('Сохранено', 'ok'); load(); } catch (er) { fail()(er); }
      } else if (rv) {
        if (!(await confirmBox('Отозвать ключ?', 'Программы с этим ключом сразу перестанут работать.', { danger: true, ok: 'Отозвать' }))) return;
        try { await post(`/api/admin/users/${u.id}/keys/revoke`, { id: rv.dataset.revoke }); toast('Ключ отозван', 'ok'); after(); } catch (er) { fail()(er); }
      }
    };
  }
  R.users.open = openUser;
})();
