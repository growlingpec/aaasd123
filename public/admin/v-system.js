// Разделы «Ошибки», «Журнал действий» и «Настройки» (доступ, оповещения, резервные копии, сервер).
'use strict';
(() => {
  /* ---------- ошибки ---------- */
  let errFilter = 'new';
  R.errors = async () => {
    const el = $('view'), j = await api('/api/admin/errors');
    if (!el.isConnected) return;
    const s = j.stats, groups = j.groups, open = groups.filter((g) => !g.resolved);
    $('vact').innerHTML = can('system.edit') && open.length ? `<button class="btn" id="erAll">${I('check')}Все исправлены</button>` : '';
    if ($('erAll')) $('erAll').onclick = async () => { if (!(await confirmBox('Отметить все ошибки исправленными?', 'Если ошибка повторится, она снова появится в списке новых.', { ok: 'Отметить' }))) return; await post('/api/admin/errors/resolve', { all: true }).catch(fail()); toast('Готово', 'ok'); refreshBadges(); R.errors(); };
    const list = groups.filter((g) => (errFilter === 'new' ? !g.resolved : errFilter === 'done' ? g.resolved : true));
    el.innerHTML = `<div class="grid g4 mb">${[['Сервер работает', uptime(s.uptime), `память ${num(s.rssMb)} МБ · нагрузка ${num(s.load, 2)}`], ['Ошибок за сутки', num(s.errors24h), 'в коде сервера'], ['Ответов 5xx', num(s.e5xx), `из ${compact(s.requests)} запросов с запуска`], ['Оповещения', s.alerts ? '<span class="ok-t">включены</span>' : '<span class="warn-t">выключены</span>', s.alerts ? 'приходят в Telegram или на вебхук' : '<a href="#settings?tab=notify">настроить →</a>']].map(([t, v, x]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${x}</div></div>`).join('')}</div>
      <div class="toolbar"><div class="filters" style="margin:0" id="erChips">${[['new', 'Новые', open.length], ['done', 'Исправленные', groups.length - open.length], ['all', 'Все', groups.length]].map(([k, t, n]) => `<button class="chip${errFilter === k ? ' on' : ''}" data-f="${k}">${t} <i>${n}</i></button>`).join('')}</div><span class="sp"></span><span class="dim" style="font-size:12.5px">Журнал хранится в памяти сервера (последние 200 записей) и очищается при перезапуске</span></div>
      <div class="card tight">${list.length ? list.map((g) => `<div class="err-g${g.resolved ? ' resolved' : ''}" data-k="${g.key}"><div class="head"><span class="badge ${g.resolved ? 'out' : 'bad'}">${num(g.n)}×</span><div class="grow"><b>${esc(g.msg)}</b><small><span class="mono">${esc(g.where)}</span> · последняя ${ago(g.last)}${g.n > 1 ? ` · первая ${ago(g.first)}` : ''}${g.extra ? ' · ' + esc(g.extra) : ''}</small></div>
        <button class="ib sm" data-copy="${esc(`${g.where}: ${g.msg}\n${g.stack}`)}" title="Скопировать">${I('copy')}</button>${can('system.edit') ? (g.resolved ? `<button class="btn sm" data-undo>Вернуть</button>` : `<button class="btn sm" data-res>${I('check')}Исправлено</button>`) : ''}</div>
        ${g.stack ? `<details><summary class="dim" style="font-size:12.5px;cursor:pointer;margin-top:6px">Где случилась</summary><pre>${esc(g.stack.split(' ← ').join('\n'))}</pre></details>` : ''}</div>`).join('') : emptyBox(errFilter === 'new' ? 'Новых ошибок нет' : 'Пусто', errFilter === 'new' ? 'Сервер работает без сбоев' : '', errFilter === 'new' ? 'check' : 'bug')}</div>`;
    $('erChips').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { errFilter = b.dataset.f; R.errors(); } };
    el.querySelector('.card.tight').onclick = async (e) => {
      const row = e.target.closest('[data-k]'); if (!row) return;
      const res = e.target.closest('[data-res]'), undo = e.target.closest('[data-undo]'); if (!res && !undo) return;
      try { await post('/api/admin/errors/resolve', { key: row.dataset.k, undo: !!undo }); toast(undo ? 'Возвращено в новые' : 'Отмечено исправленной', 'ok'); refreshBadges(); R.errors(); } catch (er) { fail()(er); }
    };
  };

  /* ---------- журнал действий ---------- */
  let au = {};
  R.audit = async (params) => {
    au = { q: '', aid: '', from: '', to: '', failed: '', target: '', page: 1, ...params };
    $('view').innerHTML = `<div class="toolbar"><label class="inp-ico">${I('search')}<input class="inp" id="auQ" placeholder="Действие, объект, IP, данные" value="${esc(au.q)}"></label><select class="inp" id="auA" style="width:auto"><option value="">Все администраторы</option></select>
      <input class="inp" type="date" id="auFrom" value="${esc(au.from)}" style="width:auto"><span class="dim">—</span><input class="inp" type="date" id="auTo" value="${esc(au.to)}" style="width:auto">
      <label class="check" style="margin:0"><input type="checkbox" id="auFail"${au.failed ? ' checked' : ''}>Только отказы и ошибки</label><span id="auT"></span></div><div class="card tight" id="auList"></div>`;
    const ch = () => { au.page = 1; load(); };
    $('auQ').oninput = debounce(() => { au.q = $('auQ').value.trim(); ch(); }, 250);
    $('auA').onchange = () => { au.aid = $('auA').value; ch(); };
    $('auFrom').onchange = () => { au.from = $('auFrom').value; ch(); };
    $('auTo').onchange = () => { au.to = $('auTo').value; ch(); };
    $('auFail').onchange = () => { au.failed = $('auFail').checked ? '1' : ''; ch(); };
    await load();
  };
  const diffHTML = (d) => (d && d.length ? `<div class="diff">${d.map((x) => `<span class="p">${esc(x.p)}</span><span>${x.from != null ? `<del>${esc(x.from)}</del> → ` : ''}<ins>${esc(x.to ?? '—')}</ins></span>`).join('')}</div>` : '');
  const targetLink = (t) => { if (!t) return '<span class="dim">—</span>'; const [k, v] = [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1)]; const href = { user: '#users/' + v, payment: '#payments/' + v, promo: '#promos?q=' + v }[k]; const lbl = { user: 'пользователь', payment: 'платёж', promo: 'промокод', model: 'модель', admin: 'администратор', review: 'отзыв', referral: 'реферал', apikey: 'API-ключ' }[k] || k; return `${href ? `<a href="${esc(href)}">` : ''}<span class="dim">${lbl}</span> <span class="mono" style="font-size:12px">${esc(v.slice(0, 24))}</span>${href ? '</a>' : ''}`; };
  async function load() {
    setHash('audit', '', { ...au, page: au.page > 1 ? au.page : '' });
    const j = await api('/api/admin/audit' + qstr(au));
    if (!$('auList')) return;
    const sel = $('auA'); if (sel.options.length === 1) sel.insertAdjacentHTML('beforeend', j.admins.map((a) => `<option value="${a.id}"${au.aid === a.id ? ' selected' : ''}>${esc(a.name)} (${esc(a.login)})</option>`).join(''));
    $('auT').innerHTML = au.target ? `<span class="tag">${targetLink(au.target)} <button data-clr>${I('x')}</button></span>` : '';
    if (au.target) $('auT').querySelector('[data-clr]').onclick = () => { au.target = ''; au.page = 1; load(); };
    $('auList').innerHTML = tableHTML({ rows: j.items, empty: 'Записей нет', emptyIcon: 'history', cols: [
      { t: 'Когда', render: (a) => `<span title="${esc(dtt(a.at))}">${dtt(a.at)}</span>` },
      { t: 'Кто', render: (a) => (a.login ? `<div class="who"><span class="av sm">${esc(initials(a.login))}</span><b>${esc(a.login)}</b></div>` : '<span class="dim">не вошёл</span>') },
      { t: 'Действие', cls: 'wrap', render: (a) => `<b style="font-weight:550">${esc(a.action)}</b>${a.data && a.data.diff ? `<div class="dim" style="font-size:12px">${pn(a.data.diff.length, 'изменение', 'изменения', 'изменений')}</div>` : ''}` },
      { t: 'Объект', render: (a) => targetLink(a.target) },
      { t: 'IP', render: (a) => `<span class="mono dim" style="font-size:12px">${esc(a.ip || '')}</span>` },
      { t: '', cls: 'r', render: (a) => (a.status >= 400 ? `<span class="badge bad">${a.status}</span>` : `<span class="badge ok">${I('check')}</span>`) }] }) + pagerHTML({ ...j, sizes: [50, 100, 200] });
    bindTable($('auList'), { rows: j.items, onRow: openEntry });
    bindPager($('auList'), (p) => { au.page = p; load(); }, (n) => { au.size = n; au.page = 1; load(); });
  }
  function openEntry(a) {
    const body = a.data && a.data.body && Object.keys(a.data.body).length ? JSON.stringify(a.data.body, null, 2) : '';
    drawer({ title: esc(a.action), sub: `${esc(a.login || 'не вошёл')} · ${dtt(a.at)}`, avatar: `<span class="av lg">${esc(initials(a.login || '?'))}</span>`,
      body: `<div class="card flat"><dl class="kv"><dt>Результат</dt><dd>${a.status >= 400 ? `<span class="bad-t">отказ, код ${a.status}</span>` : '<span class="ok-t">выполнено</span>'}</dd><dt>Объект</dt><dd>${targetLink(a.target)}</dd><dt>IP</dt><dd class="mono">${esc(a.ip || '—')}</dd>${a.path ? `<dt>Запрос</dt><dd class="mono" style="font-size:12px">${esc(a.method)} ${esc(a.path)}</dd>` : ''}${a.data && a.data.ua ? `<dt>Браузер</dt><dd style="font-size:12px">${esc(a.data.ua)}</dd>` : ''}</dl></div>
        ${a.data && a.data.diff ? `<div class="card flat"><h3>Что изменилось</h3>${diffHTML(a.data.diff)}</div>` : ''}
        ${body ? `<div class="card flat"><h3>Данные запроса</h3><div class="sub">Пароли, ключи и токены скрыты</div><pre class="mono" style="font-size:12px;white-space:pre-wrap;word-break:break-all;background:var(--p-surface-2);padding:12px;border-radius:10px">${esc(body)}</pre></div>` : ''}` });
  }

  /* ---------- настройки ---------- */
  const TABS = [['access', 'Доступ', 'lock'], ['notify', 'Оповещения', 'bell'], ['backup', 'Резервные копии', 'database'], ['server', 'Сервер', 'server']];
  R.settings = async (params) => {
    const tab = TABS.some((t) => t[0] === params.tab) ? params.tab : 'access';
    $('view').innerHTML = `<div class="tabs" id="seTabs">${TABS.map(([k, t, i]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${I(i)}${t}</button>`).join('')}</div><div id="seBody">${skeleton(5)}</div>`;
    $('seTabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; qsa('#seTabs button').forEach((x) => x.classList.toggle('on', x === b)); setHash('settings', '', { tab: b.dataset.t }); $('seBody').innerHTML = skeleton(5); PANES[b.dataset.t](); };
    await PANES[tab]();
  };
  const sw = (id, title, hint, on, dis) => `<div class="setting"><div class="grow"><b>${title}</b><small>${hint}</small></div><label class="switch"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${dis ? ' disabled' : ''}><i></i></label></div>`;
  const PANES = {
    async access() {
      const s = await api('/api/admin/system'), f = s.flags;
      $('seBody').innerHTML = `<div class="card">${sw('fReg', 'Открытая регистрация', 'Новые пользователи могут зарегистрироваться через Google или GitHub. Выключите — войдут только существующие аккаунты и созданные в панели.', f.register, !can('system.edit'))}
        ${sw('fApi', 'API для разработчиков', 'Доступ к /v1 по API-ключам: Cursor, Codex, Claude Code и другие программы.', f.api, !can('api.edit'))}
        ${sw('fRef', 'Реферальная программа', 'Бонусы за приглашённых друзей. Уже начисленные награды останутся.', f.referrals, !can('referrals.edit'))}</div>
        <div class="note info">Блокировка отдельных пользователей — в карточке пользователя. Режим технических работ — в разделе <a href="#content">Объявления</a>.</div>`;
      const bind = (id, url, key, msg) => { $(id).onchange = async (e) => { try { await post(url, { [key]: e.target.checked }); toast(msg(e.target.checked), 'ok'); } catch (er) { e.target.checked = !e.target.checked; fail()(er); } }; };
      bind('fReg', '/api/admin/register', 'open', (x) => (x ? 'Регистрация открыта' : 'Регистрация закрыта'));
      bind('fApi', '/api/admin/api', 'open', (x) => (x ? 'API открыт' : 'API закрыт'));
      bind('fRef', '/api/admin/referrals', 'on', (x) => (x ? 'Реферальная программа включена' : 'Реферальная программа выключена'));
    },
    async notify() {
      const n = await api('/api/admin/notify'), ed = can('system.edit'), dis = ed ? '' : ' disabled';
      const EV = [['pay', 'Оплаты', 'Сумма, тариф и пользователь'], ['signup', 'Новые пользователи', 'Каждая регистрация'], ['error', 'Ошибки сервера', 'Не чаще раза в 10 минут на одну ошибку'], ['model', 'Модели', 'Модель перестала отвечать и снова заработала'], ['review', 'Новые отзывы', 'Когда отзыв ждёт модерации']];
      $('seBody').innerHTML = `<form class="grid g2" id="ntF" autocomplete="off">
        <div class="card" style="margin:0"><h2>${I('send')}Куда присылать</h2><div class="sub">Telegram-бот и/или свой адрес (POST JSON {"text": …})</div>
          <label class="field"><span>Токен бота Telegram</span><input name="tgToken" placeholder="${n.hasToken ? esc(n.tgToken) + ' — оставьте пустым, чтобы не менять' : '123456:AA… от @BotFather'}"${dis}><small>Создайте бота в <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> и напишите ему что-нибудь</small></label>
          <label class="field"><span>ID чата</span><input name="tgChat" value="${esc(n.tgChat)}" placeholder="например: 123456789 или -100…"${dis}><small>Свой ID можно узнать у <a href="https://t.me/userinfobot" target="_blank" rel="noopener">@userinfobot</a></small></label>
          <label class="field"><span>Вебхук <span class="dim">(необязательно)</span></span><input name="hook" placeholder="${n.hasHook ? esc(n.hook) : 'https://…'}"${dis}></label>
          <label class="field"><span>Имя сервера в сообщениях</span><input name="name" value="${esc(n.name)}" placeholder="по умолчанию — имя машины"${dis}></label>
          ${n.hasToken && ed ? '<label class="check"><input type="checkbox" name="removeToken">Удалить сохранённый токен бота</label>' : ''}
          ${n.env.tg || n.env.hook ? '<div class="note info mb">На сервере также заданы переменные ALERT_* — они используются, если здесь поле пустое.</div>' : ''}
        </div>
        <div class="card" style="margin:0"><h2>${I('bell')}О чём сообщать</h2><div class="sub">Можно включить только нужное</div>
          ${EV.map(([k, t, h]) => `<div class="setting"><div class="grow"><b>${t}</b><small>${h}</small></div><label class="switch"><input type="checkbox" name="ev_${k}"${n.events[k] ? ' checked' : ''}${dis}><i></i></label></div>`).join('')}
          <div class="msg" id="ntMsg"></div>
          <div class="btns"><button type="button" class="btn" id="ntTest">${I('send')}Отправить проверку</button>${ed ? '<button class="btn pri">Сохранить</button>' : ''}</div>
        </div></form>`;
      const f = $('ntF');
      f.onsubmit = async (e) => {
        e.preventDefault();
        const b = { tgChat: f.elements.tgChat.value, name: f.elements.name.value, events: Object.fromEntries(EV.map(([k]) => [k, f.elements['ev_' + k].checked])) };
        if (f.elements.tgToken.value.trim()) b.tgToken = f.elements.tgToken.value.trim();
        if (f.elements.hook.value.trim()) b.hook = f.elements.hook.value.trim();
        if (f.elements.removeToken && f.elements.removeToken.checked) b.removeToken = true;
        try { await busy(f.querySelector('.btn.pri'), () => post('/api/admin/notify', b)); toast('Сохранено', 'ok'); PANES.notify(); } catch (er) { say('ntMsg', er.message, 'err'); }
      };
      $('ntTest').onclick = async (e) => { try { const r = await busy(e.currentTarget, () => post('/api/admin/notify/test')); r.ok ? say('ntMsg', 'Отправлено — проверьте Telegram', 'ok') : say('ntMsg', r.error, 'err'); } catch (er) { say('ntMsg', er.message, 'err'); } };
    },
    async backup() {
      const j = await api('/api/admin/backups');
      $('seBody').innerHTML = `<div class="card"><div class="chead"><div><h2>${I('database')}Резервная копия базы</h2><div class="sub">Пользователи, платежи, чаты, настройки и ключи — целиком, без остановки сервера. Храним 5 последних копий из панели.</div></div>${j.canDownload ? `<button class="btn pri" id="bkNew">${I('download')}Создать и скачать</button>` : ''}</div>
        ${j.canDownload ? '' : '<div class="note warn mb">Скачивать копии может только владелец — в них все данные пользователей и ключи.</div>'}
        ${j.items.length ? `<div class="card tight flat" style="margin:0">${tableHTML({ rows: j.items, key: 'name', click: false, cols: [{ t: 'Файл', render: (b) => `<span class="mono" style="font-size:12.5px">${esc(b.name)}</span>` }, { t: 'Откуда', render: (b) => (b.kind === 'panel' ? 'из панели' : 'по расписанию') }, { t: 'Размер', cls: 'r', render: (b) => bytes(b.size) }, { t: 'Создан', render: (b) => `${dtt(b.at)} <span class="dim">· ${ago(b.at)}</span>` }, { t: '', cls: 'r', render: (b) => (j.canDownload ? `<button class="btn sm" data-dl="${esc(b.name)}" data-kind="${b.kind}">${I('download')}Скачать</button>` : '') }] })}</div>` : emptyBox('Копий пока нет', 'Создайте первую кнопкой выше', 'database')}</div>
        <div class="note info">Автоматические копии по расписанию: <span class="mono">deploy/backup.sh</span> и таймер <span class="mono">premier-backup.timer</span> (папка <span class="mono">${esc(j.cronDir)}</span>). Как восстановить — в DEPLOY.md.</div>`;
      const dl = (url) => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove(); };
      if ($('bkNew')) $('bkNew').onclick = async (e) => { try { const r = await busy(e.currentTarget, () => post('/api/admin/backup')); toast(`Копия готова: ${bytes(r.size)} за ${msf(r.ms)}`, 'ok'); dl(r.url); PANES.backup(); } catch (er) { fail()(er); } };
      $('seBody').onclick = async (e) => { const b = e.target.closest('[data-dl]'); if (!b) return; try { const r = await busy(b, () => post('/api/admin/backup/ticket', { name: b.dataset.dl, kind: b.dataset.kind })); dl(r.url); } catch (er) { fail()(er); } };
    },
    async server() {
      const s = await api('/api/admin/system');
      const diskPct = s.disk ? 100 - (s.disk.free / s.disk.total) * 100 : null;
      $('seBody').innerHTML = `<div class="grid g4 mb">${[['Работает', uptime(s.uptime), `с ${dtt(Date.now() - s.uptime * 1000)}`], ['Память процесса', num(s.rssMb) + ' МБ', `свободно на сервере ${num(s.freeMb)} из ${num(s.totalMb)} МБ`], ['Нагрузка', num(s.load, 2), `${s.cpus} ${plural(s.cpus, 'ядро', 'ядра', 'ядер')}`], ['Диск', s.disk ? `${num(diskPct, 0)}%` : '—', s.disk ? `свободно ${bytes(s.disk.free)}` : 'нет данных']].map(([t, v, x]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${x}</div></div>`).join('')}</div>
        <div class="grid g2"><div class="card" style="margin:0"><h2>База данных</h2><dl class="kv mt8"><dt>Размер</dt><dd>${bytes(s.db.size)}${s.db.wal ? ` <span class="dim">+ журнал ${bytes(s.db.wal)}</span>` : ''}</dd>${Object.entries({ users: 'Пользователей', payments: 'Платежей', chats: 'Чатов', sessions: 'Активных сессий', apiKeys: 'API-ключей', reviews: 'Отзывов', models: 'Моделей', admins: 'Администраторов' }).map(([k, t]) => `<dt>${t}</dt><dd>${num(s.counts[k])}</dd>`).join('')}</dl></div>
        <div class="card" style="margin:0"><h2>Окружение</h2><dl class="kv mt8"><dt>Версия Node.js</dt><dd>${esc(s.node)}</dd><dt>Система</dt><dd>${esc(s.platform)}</dd>${s.version ? `<dt>Premier</dt><dd>${esc(s.version)}</dd>` : ''}<dt>Адрес сайта</dt><dd>${s.publicUrl ? esc(s.publicUrl) : '<span class="warn-t">PUBLIC_URL не задан</span>'}</dd><dt>Запросов с запуска</dt><dd>${num(s.requests)} <span class="dim">· 5xx: ${num(s.e5xx)}</span></dd><dt>Ошибок за сутки</dt><dd>${num(s.errors24h)} <a href="#errors">открыть →</a></dd><dt>Оповещения</dt><dd>${s.alerts ? '<span class="ok-t">включены</span>' : '<a href="#settings?tab=notify">настроить →</a>'}</dd></dl></div></div>`;
    },
  };
})();
