// Раздел «Рефералы»: приглашения, лучшие партнёры, подозрительные совпадения и ручная модерация.
'use strict';
(() => {
  const STS = { pending: ['Ждёт активации', 'warn'], active: ['Активен', 'ok'], rejected: ['Отклонён', 'bad'] };
  let st = {};

  R.referrals = async (params) => {
    st = { status: '', q: '', page: 1, size: 50, ...params };
    const el = $('view');
    const s = await api('/api/admin/referrals/stats');
    if (!el.isConnected) return;
    $('vact').innerHTML = `<label class="switch"><input type="checkbox" id="refOn"${s.on ? ' checked' : ''}${can('referrals.edit') ? '' : ' disabled'}><i></i><span style="font-size:13.5px">Программа ${s.on ? 'включена' : 'выключена'}</span></label>`;
    $('refOn').onchange = async (e) => { try { await post('/api/admin/referrals', { on: e.target.checked }); toast(e.target.checked ? 'Реферальная программа включена' : 'Реферальная программа выключена', 'ok'); e.target.nextElementSibling.nextElementSibling.textContent = 'Программа ' + (e.target.checked ? 'включена' : 'выключена'); } catch (er) { e.target.checked = !e.target.checked; fail()(er); } };
    const sus = s.dupIp.length + s.dupFp.length + s.idle.length;
    const grp = (list, label) => list.map((g) => `<div class="list-row"><span class="badge warn">${g.n}×</span><div class="grow"><b class="mono" style="font-size:12.5px">${label}: ${esc(String(g.v).slice(0, 24))}</b><small class="dim" style="display:block">приглашали: ${g.inviters.map((x) => `<a href="#users/${esc(x.id)}">${esc(x.login || x.id)}</a>`).join(', ')} · ${ago(g.last)}</small></div><button class="btn sm" data-q="${esc(g.v)}">Показать</button></div>`).join('');
    el.innerHTML = `
      <div class="grid g4 mb">${[['Приглашений', num(s.total), 'за всё время'], ['Активных', num(s.active), `${pctf(s.convActive)} от приглашённых`], ['Оплатили', num(s.paid), `${pctf(s.convPaid)} от приглашённых`], ['Ждут активации', num(s.pending), 'нужно 3 сообщения в чате']].map(([t, v, x]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${x}</div></div>`).join('')}</div>
      <div class="grid g21 mb">
        <div class="card" style="margin:0"><div class="chead"><div><h2>Приглашения за 30 дней</h2><div class="sub">Сколько пришло и сколько из них стали активными</div></div><div class="legend"><span><i style="background:var(--info)"></i>Пришли</span><span><i style="background:var(--ok)"></i>Активны</span></div></div><div id="refChart"></div></div>
        <div class="card" style="margin:0"><h2>Как работает программа</h2><div class="sub">Активный приглашённый — написал 3 сообщения в чат</div>
          <div class="stack" style="gap:6px;font-size:13.5px">${[['3', '+50 сообщений бонусом'], ['10', 'Pro на 7 дней'], ['25', 'Pro на 14 дней'], ['50', 'Pro на 30 дней'], ['100', 'Max на 30 дней']].map(([n, t]) => `<div class="row between"><span class="dim">${n} активных</span><b>${t}</b></div>`).join('')}
          <div class="divider" style="margin:8px 0"></div><div class="row between"><span class="dim">Приглашённый оплатил</span><b>+2 дня тарифа</b></div><div class="row between"><span class="dim">Приглашённому</span><b>+50 сообщений на 3 дня</b></div></div></div>
      </div>
      <div class="grid g2 mb">
        <div class="card tight" style="margin:0"><div class="chead"><div><h2>Лучшие партнёры</h2><div class="sub">По числу активных приглашённых</div></div></div><div id="refTop"></div></div>
        <div class="card" style="margin:0"><h2>${sus ? I('alert', 'warn-t') : I('shield', 'ok-t')}Подозрительные совпадения</h2><div class="sub">Несколько приглашений с одного адреса или устройства — частый признак накрутки</div>
          ${sus ? grp(s.dupIp, 'IP') + grp(s.dupFp, 'Устройство') + s.idle.map((g) => `<div class="list-row"><span class="badge warn">${g.active}/${g.n}</span><div class="grow"><b><a href="#users/${esc(g.ref)}">${esc(g.login || g.ref)}</a></b><small class="dim" style="display:block">почти никто из приглашённых не стал активным</small></div><button class="btn sm" data-ref="${esc(g.ref)}">Показать</button></div>`).join('') : emptyBox('Ничего подозрительного', '', 'shield')}</div>
      </div>
      <div class="card tight"><div class="chead"><div><h2>Все приглашения</h2></div><div class="row"><div class="filters" id="refChips" style="margin:0"></div><label class="inp-ico" style="width:240px">${I('search')}<input class="inp sm" id="refQ" placeholder="Логин, ID или IP" value="${esc(st.q)}"></label></div></div><div id="refList"></div></div>`;
    chart($('refChart'), { labels: s.series.map((x) => x.d), xFmt: dayLabel, type: 'bar', height: 200, series: [{ name: 'Пришли', data: s.series.map((x) => x.n), color: 'var(--info)' }, { name: 'Активны', data: s.series.map((x) => x.active), color: 'var(--ok)' }] });
    $('refTop').innerHTML = tableHTML({ rows: s.top, key: 'ref', empty: 'Пока никто никого не пригласил', emptyIcon: 'gift', cols: [
      { t: 'Партнёр', render: (r) => `<b>${esc(r.login || r.ref)}</b>` }, { t: 'Пригласил', cls: 'r', render: (r) => num(r.n) }, { t: 'Активных', cls: 'r', render: (r) => `<b>${num(r.active)}</b>` },
      { t: 'Оплатили', cls: 'r', render: (r) => num(r.paid) }, { t: 'Последний', render: (r) => ago(r.last) }] });
    bindTable($('refTop'), { rows: s.top, key: 'ref', onRow: (r) => go('users', r.ref) });
    el.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]'); if (q) { st.q = q.dataset.q; st.ref = ''; $('refQ').value = st.q; st.page = 1; list(); $('refList').scrollIntoView({ behavior: 'smooth' }); }
      const r = e.target.closest('[data-ref]'); if (r) { st.ref = r.dataset.ref; st.q = ''; $('refQ').value = ''; st.page = 1; list(); $('refList').scrollIntoView({ behavior: 'smooth' }); }
    });
    $('refQ').oninput = debounce(() => { st.q = $('refQ').value.trim(); st.ref = ''; st.page = 1; list(); }, 250);
    $('refChips').onclick = (e) => { const b = e.target.closest('[data-st]'); if (b) { st.status = b.dataset.st; st.page = 1; list(); } };
    await list();
  };
  async function list() {
    setHash('referrals', '', { status: st.status, q: st.q, ref: st.ref, page: st.page > 1 ? st.page : '' });
    $('refChips').innerHTML = [['', 'Все'], ['pending', 'Ждут'], ['active', 'Активные'], ['rejected', 'Отклонённые']].map(([k, t]) => `<button class="chip${st.status === k ? ' on' : ''}" data-st="${k}">${t}</button>`).join('');
    const j = await api('/api/admin/referrals/list' + qstr(st));
    if (!$('refList')) return;
    const cols = [
      { t: 'Приглашённый', render: (r) => `<a href="#users/${esc(r.id)}" style="text-decoration:none"><b>${esc(r.login || r.id)}</b></a>${r.login ? '' : ' <span class="dim">(удалён)</span>'}` },
      { t: 'Пригласил', render: (r) => `<a href="#users/${esc(r.ref)}" style="text-decoration:none">${esc(r.refLogin || r.ref)}</a>` },
      { t: 'Статус', render: (r) => `<span class="badge ${(STS[r.status] || ['', ''])[1]}">${(STS[r.status] || [r.status])[0]}</span>${r.paid ? ' <span class="badge acc">оплатил</span>' : ''}` },
      { t: 'Сообщений', cls: 'r', render: (r) => num(r.msg) },
      { t: 'IP / устройство', render: (r) => `<span class="mono" style="font-size:12px">${esc(r.ip || '—')}</span>${r.dupIp ? ' <span class="badge warn" title="С этого IP были и другие приглашения">повтор IP</span>' : ''}${r.dupFp ? ' <span class="badge warn" title="С этого устройства были и другие приглашения">повтор устройства</span>' : ''}` },
      { t: 'Когда', render: (r) => `<span title="${esc(dtt(r.at))}">${ago(r.at)}</span>` },
      { t: '', cls: 'r', render: (r) => (can('referrals.edit') ? `<button class="ib sm" data-rm="${esc(r.id)}" aria-label="Действия">${I('more')}</button>` : '') },
    ];
    $('refList').innerHTML = (st.ref ? `<div style="padding:0 18px 10px"><span class="tag">Пригласил: ${esc(st.ref)} <button data-clr>${I('x')}</button></span></div>` : '') + tableHTML({ cols, rows: j.items, click: false, empty: 'Приглашений нет', emptyIcon: 'gift' }) + pagerHTML({ ...j, pages: Math.max(1, Math.ceil(j.total / j.size)) });
    const clr = $('refList').querySelector('[data-clr]'); if (clr) clr.onclick = () => { st.ref = ''; list(); };
    bindPager($('refList'), (p) => { st.page = p; list(); }, (n) => { st.size = n; st.page = 1; list(); });
    $('refList').onclick = (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      const r = j.items.find((x) => x.id === b.dataset.rm);
      const act = async (action, msg, confirmText) => { if (confirmText && !(await confirmBox(confirmText, '', { danger: action === 'delete', ok: 'Да' }))) return; try { await post('/api/admin/referrals/' + r.id, { action }); toast(msg, 'ok'); list(); } catch (er) { fail()(er); } };
      menu(b, [
        r.status !== 'active' && { label: 'Засчитать вручную', icon: 'check', on: () => act('activate', 'Засчитано — партнёру начислены награды, если достигнут порог') },
        r.status !== 'rejected' && { label: 'Отклонить (накрутка)', icon: 'ban', on: () => act('reject', 'Приглашение отклонено') },
        r.status !== 'pending' && { label: 'Вернуть в ожидание', icon: 'undo', on: () => act('pending', 'Возвращено в ожидание') },
        '-',
        { label: 'Удалить запись', icon: 'trash', danger: true, on: () => act('delete', 'Запись удалена', 'Удалить запись о приглашении? Пользователь сможет привязаться к другому партнёру.') },
      ]);
    };
  }
})();
