// Разделы «Команда» (администраторы и роли) и «Профиль и безопасность» (пароль, 2FA, сессии).
'use strict';
(() => {
  const PL = { dashboard: 'Дашборд', 'users.view': 'Пользователи — просмотр', 'users.edit': 'Тарифы, лимиты, заметки', 'users.ban': 'Блокировка аккаунтов', 'users.create': 'Создание аккаунтов', 'users.delete': 'Удаление аккаунтов',
    'payments.view': 'Платежи — просмотр', 'payments.manage': 'Проверка платежей и возвраты', 'promos.view': 'Промокоды — просмотр', 'promos.edit': 'Промокоды — изменение', 'referrals.view': 'Рефералы — просмотр', 'referrals.edit': 'Рефералы — модерация',
    'reviews.view': 'Отзывы — просмотр', 'reviews.edit': 'Отзывы — модерация', 'models.view': 'Модели — просмотр', 'models.edit': 'Модели — изменение', 'api.view': 'API — статистика', 'api.edit': 'API — ключи и доступ',
    'plans.view': 'Тарифы и оплата — просмотр', 'plans.edit': 'Тарифы и платёжные системы', 'tools.view': 'Инструменты — просмотр', 'tools.edit': 'Инструменты — изменение', 'content.view': 'Объявления — просмотр', 'content.edit': 'Объявления и техработы',
    'system.view': 'Ошибки и сервер', 'system.edit': 'Доступ и оповещения', 'audit.view': 'Журнал действий', 'admins.manage': 'Команда и роли', backup: 'Резервные копии' };
  const roleBadge = (r, name) => `<span class="badge ${{ owner: 'acc', admin: 'info', manager: 'ok', support: 'warn' }[r] || 'out'}">${esc(name || r)}</span>`;
  const credsBox = (title, login, pw) => modal({ title, cancel: '', ok: 'Готово', text: 'Пароль показывается один раз — передайте его безопасным способом. После входа его можно сменить в профиле.', body: `<div class="card flat"><dl class="kv"><dt>Адрес</dt><dd class="mono">${esc(location.origin)}/panelp</dd><dt>Логин</dt><dd class="mono">${esc(login)}</dd><dt>Пароль</dt><dd class="mono"><b>${esc(pw)}</b></dd></dl></div><button type="button" class="btn" data-cp>${I('copy')}Скопировать всё</button>`, onOpen: (f) => { f.querySelector('[data-cp]').onclick = () => copyText(`${location.origin}/panelp\nЛогин: ${login}\nПароль: ${pw}`); } });

  R.team = async () => {
    const el = $('view'), j = await api('/api/admin/admins');
    if (!el.isConnected) return;
    $('vact').innerHTML = `<button class="btn pri" id="tmNew">${I('plus')}Администратор</button>`;
    $('tmNew').onclick = () => create(j.roles);
    el.innerHTML = `<div class="card tight"><div id="tmList"></div></div>
      <div class="card"><div class="chead"><div><h2>Роли и права</h2><div class="sub">Права проверяет сервер — кнопки без доступа просто не сработают</div></div></div>
        <div class="tw"><table><thead><tr><th>Право</th>${j.roles.map((r) => `<th class="r">${roleBadge(r.id, r.name)}</th>`).join('')}</tr></thead><tbody>${j.perms.map((p) => `<tr><td>${esc(PL[p] || p)}</td>${j.roles.map((r) => `<td class="r">${r.perms.includes(p) ? I('check', 'ok-t') : '<span class="dim">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="grid g3 mt">${j.roles.map((r) => `<div class="note"><b>${esc(r.name)}</b><div style="margin-top:2px">${esc(r.desc)}</div></div>`).join('')}</div></div>`;
    $('tmList').innerHTML = tableHTML({ rows: j.items, click: false, cols: [
      { t: 'Администратор', render: (a) => `<div class="who"><span class="av">${esc(initials(a.name))}</span><div class="grow"><b>${esc(a.name)}${a.id === S.me.id ? ' <span class="dim" style="font-weight:400">(вы)</span>' : ''}</b><small class="mono">${esc(a.login)}</small></div></div>` },
      { t: 'Роль', render: (a) => roleBadge(a.role, a.roleName) },
      { t: '2FA', render: (a) => (a.totp ? `<span class="badge ok">${I('shield')}включена</span>` : '<span class="badge warn">нет</span>') },
      { t: 'Последний вход', render: (a) => (a.lastLogin ? `${ago(a.lastLogin)}<div class="dim mono" style="font-size:12px">${esc(a.lastIp)}</div>` : '<span class="dim">не входил</span>') },
      { t: 'Сессий', cls: 'r', render: (a) => num(a.sessions) },
      { t: 'Статус', render: (a) => (a.disabled ? '<span class="badge bad">отключён</span>' : '<span class="badge ok">активен</span>') },
      { t: '', cls: 'r', render: (a) => `<button class="ib sm" data-am="${esc(a.id)}" aria-label="Действия">${I('more')}</button>` }] });
    $('tmList').onclick = (e) => {
      const b = e.target.closest('[data-am]'); if (!b) return;
      const a = j.items.find((x) => x.id === b.dataset.am), owner = a.id === 'owner', self = a.id === S.me.id;
      const upd = async (body, msg, after) => { try { const r = await post('/api/admin/admins/' + a.id, body, 'PATCH'); toast(msg, 'ok'); if (after) await after(r); R.team(); } catch (er) { fail()(er); } };
      menu(b, [
        !owner && { label: 'Изменить роль…', icon: 'shield', on: async () => { const v = await formBox({ title: 'Роль: ' + a.name, fields: [{ k: 'role', type: 'select', label: 'Роль', value: a.role, options: j.roles.filter((r) => r.id !== 'owner').map((r) => ({ v: r.id, t: `${r.name} — ${r.desc}` })) }], onOk: (v) => post('/api/admin/admins/' + a.id, v, 'PATCH') }); if (v) { toast('Роль изменена', 'ok'); R.team(); } } },
        !owner && { label: 'Сбросить пароль', icon: 'key', on: async () => { if (await confirmBox('Сбросить пароль ' + a.login + '?', 'Будет создан новый пароль, все сессии этого администратора завершатся.', { ok: 'Сбросить' })) upd({ resetPassword: true }, 'Пароль сброшен', (r) => credsBox('Новый пароль', a.login, r.password)); } },
        a.totp && !self && { label: 'Отключить 2FA', icon: 'shield', on: async () => { if (await confirmBox('Отключить 2FA у ' + a.login + '?', 'Используйте, если администратор потерял телефон. Он сможет включить защиту заново.', { ok: 'Отключить', danger: true })) upd({ resetTotp: true }, '2FA отключена'); } },
        !self && a.sessions && { label: 'Завершить все сессии', icon: 'out', on: () => upd({ logout: true }, 'Сессии завершены') },
        !owner && (a.disabled ? { label: 'Включить доступ', icon: 'check', on: () => upd({ disabled: false }, 'Доступ включён') } : { label: 'Отключить доступ', icon: 'ban', danger: true, on: async () => { if (await confirmBox('Отключить ' + a.login + '?', 'Администратор сразу потеряет доступ к панели.', { danger: true, ok: 'Отключить' })) upd({ disabled: true }, 'Доступ отключён'); } }),
        !owner && !self && '-',
        !owner && !self && { label: 'Удалить', icon: 'trash', danger: true, on: async () => { if (!(await confirmBox('Удалить ' + a.login + '?', 'Записи в журнале действий останутся.', { danger: true, ok: 'Удалить' }))) return; try { await api('/api/admin/admins/' + a.id, { method: 'DELETE' }); toast('Удалён', 'ok'); R.team(); } catch (er) { fail()(er); } } },
        owner && self && { label: 'Пароль и 2FA — в профиле', icon: 'user', on: () => go('profile') },
      ]);
    };
  };
  async function create(roles) {
    const v = await formBox({ title: 'Новый администратор', text: 'Выдайте минимальную роль, которой хватит для работы — права можно расширить позже.', fields: [
      { k: 'login', label: 'Логин', placeholder: 'например: anna', required: true, autofocus: true, hint: 'латиница, цифры, точка, - или _' },
      { k: 'name', label: 'Имя', placeholder: 'Анна, поддержка' },
      { k: 'role', type: 'select', label: 'Роль', value: 'support', options: roles.filter((r) => r.id !== 'owner').map((r) => ({ v: r.id, t: `${r.name} — ${r.desc}` })) },
      { k: 'password', type: 'password', label: 'Пароль', placeholder: 'пусто — создадим надёжный автоматически', hint: 'от 12 символов' }],
    ok: 'Добавить', onOk: (x) => post('/api/admin/admins', x) });
    if (!v) return;
    R.team();
    if (v.password) credsBox('Администратор добавлен', v.admin.login, v.password); else toast('Администратор добавлен', 'ok');
  }

  /* ---------- профиль ---------- */
  R.profile = async () => {
    const el = $('view');
    const [me, ss] = await Promise.all([api('/api/admin/me'), api('/api/admin/me/sessions')]);
    if (!el.isConnected) return;
    const a = me.admin; S.me = a; renderMe();
    const ua = (s) => { const x = String(s || ''); const b = /Edg\//.test(x) ? 'Edge' : /OPR\//.test(x) ? 'Opera' : /YaBrowser/.test(x) ? 'Яндекс Браузер' : /Chrome\//.test(x) ? 'Chrome' : /Firefox\//.test(x) ? 'Firefox' : /Safari\//.test(x) ? 'Safari' : 'Браузер'; const o = /Windows/.test(x) ? 'Windows' : /Android/.test(x) ? 'Android' : /iPhone|iPad/.test(x) ? 'iOS' : /Mac OS/.test(x) ? 'macOS' : /Linux/.test(x) ? 'Linux' : ''; return b + (o ? ' · ' + o : ''); };
    el.innerHTML = `<div class="grid g2">
      <div class="stack">
        <div class="card" style="margin:0"><div class="row" style="gap:14px"><span class="av lg">${esc(initials(a.name))}</span><div class="grow"><h2 style="margin:0">${esc(a.name)}</h2><div class="dim"><span class="mono">${esc(a.login)}</span> · ${roleBadge(a.role, a.roleName)}</div></div></div>
          <div class="divider"></div><dl class="kv"><dt>Последний вход</dt><dd>${a.lastLogin ? dtt(a.lastLogin) : '—'}</dd><dt>IP</dt><dd class="mono">${esc(a.lastIp || '—')}</dd><dt>Права</dt><dd>${pn(a.perms.length, 'право', 'права', 'прав')} — <a href="${can('admins.manage') ? '#team' : '#'}" ${can('admins.manage') ? '' : 'onclick="return false"'}>${esc(a.roleName)}</a></dd></dl></div>
        <form class="card" id="pwF" style="margin:0" autocomplete="off"><h2>${I('lock')}Пароль</h2>
          ${a.pwFromEnv ? '<div class="note">Пароль владельца задан в переменной ADMIN_PASSWORD на сервере — поменяйте его там и перезапустите Premier.</div>' : `<div class="sub">После смены другие устройства выйдут из панели</div>
          <label class="field"><span>Текущий пароль</span><input type="password" name="old" autocomplete="current-password" required></label>
          <label class="field"><span>Новый пароль</span><input type="password" name="password" autocomplete="new-password" required minlength="12"><small>От 12 символов, не только цифры</small></label>
          <label class="field"><span>Ещё раз</span><input type="password" name="password2" autocomplete="new-password" required></label>
          <div class="msg" id="pwMsg"></div><div class="btns"><button class="btn pri">Сменить пароль</button></div>`}</form>
      </div>
      <div class="stack">
        <div class="card" style="margin:0" id="tfa"></div>
        <div class="card tight" style="margin:0"><div class="chead"><div><h2>${I('monitor')}Активные сессии</h2><div class="sub">Где вы сейчас вошли в панель</div></div>${ss.items.length > 1 ? '<button class="btn sm" id="ssOthers">Завершить остальные</button>' : ''}</div>
          ${tableHTML({ rows: ss.items, click: false, cols: [{ t: 'Устройство', render: (s) => `<b style="font-weight:550">${esc(ua(s.ua))}</b>${s.id === ss.current ? ' <span class="badge ok">это устройство</span>' : ''}<div class="dim mono" style="font-size:12px">${esc(s.ip)}</div>` }, { t: 'Активность', render: (s) => `${ago(s.last)}<div class="dim" style="font-size:12px">вход ${dt(s.created)}</div>` }, { t: '', cls: 'r', render: (s) => (s.id === ss.current ? '' : `<button class="btn sm" data-sx="${s.id}">Завершить</button>`) }] })}</div>
      </div></div>`;
    paint2fa(a);
    const f = $('pwF');
    if (!a.pwFromEnv) f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.elements.password.value !== f.elements.password2.value) return say('pwMsg', 'Пароли не совпадают', 'err');
      try { await busy(f.querySelector('.btn.pri'), () => post('/api/admin/me/password', { old: f.elements.old.value, password: f.elements.password.value })); f.reset(); say('pwMsg', 'Пароль изменён', 'ok'); } catch (er) { say('pwMsg', er.message, 'err'); }
    };
    if ($('ssOthers')) $('ssOthers').onclick = async () => { try { const r = await post('/api/admin/me/sessions/revoke', { id: 'others' }); toast(`Завершено: ${r.n}`, 'ok'); R.profile(); } catch (er) { fail()(er); } };
    el.addEventListener('click', async (e) => { const b = e.target.closest('[data-sx]'); if (!b) return; try { await post('/api/admin/me/sessions/revoke', { id: b.dataset.sx }); toast('Сессия завершена', 'ok'); R.profile(); } catch (er) { fail()(er); } });
  };
  function paint2fa(a) {
    const box = $('tfa');
    if (a.totp) {
      box.innerHTML = `<div class="chead"><div><h2>${I('shield', 'ok-t')}Двухфакторная защита включена</h2><div class="sub">При входе нужен код из приложения-аутентификатора</div></div><span class="badge ok">защищено</span></div><div class="btns left"><button class="btn danger" id="tfOff">Выключить 2FA</button></div>`;
      $('tfOff').onclick = async () => { const v = await formBox({ title: 'Выключить 2FA?', text: 'Введите текущий код из приложения, чтобы подтвердить.', danger: true, ok: 'Выключить', fields: [{ k: 'code', label: 'Код', placeholder: '000000', required: true, autofocus: true }], onOk: (x) => post('/api/admin/me/totp/disable', x) }); if (v) { toast('2FA выключена', 'ok'); R.profile(); } };
      return;
    }
    box.innerHTML = `<div class="chead"><div><h2>${I('shield')}Двухфакторная защита</h2><div class="sub">Даже если пароль утечёт, без телефона войти не получится</div></div><span class="badge warn">выключена</span></div>
      <div class="note mb">Подойдёт любое приложение: Google Authenticator, Яндекс Ключ, 1Password, Bitwarden, Microsoft Authenticator.</div><div class="btns left"><button class="btn pri" id="tfOn">${I('shield')}Включить</button></div>`;
    $('tfOn').onclick = async (e) => {
      let s; try { s = await busy(e.currentTarget, () => post('/api/admin/me/totp/setup')); } catch (er) { return fail()(er); }
      const v = await modal({ title: 'Подключите приложение', ok: 'Включить 2FA', wide: true, body: `<div class="row top" style="gap:20px;flex-wrap:nowrap"><div class="qr">${qrSVG(s.uri)}</div><div class="grow"><ol style="padding-left:18px;font-size:13.5px;color:var(--muted);line-height:1.7"><li>Откройте приложение-аутентификатор</li><li>Отсканируйте QR-код или введите ключ вручную</li><li>Введите 6 цифр, которые покажет приложение</li></ol><div class="field mt8"><span>Ключ</span><div class="secret copy" data-copy="${esc(s.secret)}">${esc(s.secret.replace(/(.{4})/g, '$1 ').trim())}</div></div><label class="field"><span>Код из приложения</span><input name="code" class="code-inp" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code" autofocus></label></div></div>`,
        onOk: (f) => post('/api/admin/me/totp/enable', { code: f.elements.code.value.trim() }) });
      if (v) { toast('2FA включена — при следующем входе понадобится код', 'ok'); R.profile(); }
    };
  }
})();
