// Раздел «Платежи»: вся история с фильтрами, суммами, выгрузкой и карточкой платежа.
'use strict';
(() => {
  const ST = [['', 'Все', 'all'], ['CONFIRMED', 'Оплачены'], ['PENDING', 'Ожидают'], ['CANCELED', 'Отменены'], ['CHARGEBACKED', 'Возвраты']];
  let st = {}, data = null;

  R.payments = async (params, id) => {
    st = { q: '', status: '', provider: '', plan: '', from: '', to: '', min: '', max: '', uid: '', sort: '', dir: '', page: 1, size: pref.get('paysSize', 50), ...params };
    const el = $('view');
    $('vact').innerHTML = `<button class="btn" id="pExport">${I('download')}CSV</button>`;
    $('pExport').onclick = (e) => busy(e.currentTarget, () => download('/api/admin/payments/export' + qstr({ ...st, page: '', size: '' })).then(() => toast('Файл скачан', 'ok')));
    el.innerHTML = `<div class="grid g4 mb" id="pKpi"></div><div class="filters" id="pChips"></div>
      <div class="toolbar"><label class="inp-ico">${I('search')}<input class="inp" id="pq" placeholder="Заказ, транзакция, логин, промокод" value="${esc(st.q)}" autocomplete="off"></label>
        <select class="inp" id="pProv" style="width:auto"><option value="">Все способы</option>${Object.entries(PROV).map(([k, t]) => `<option value="${k}"${st.provider === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <select class="inp" id="pPlan" style="width:auto"><option value="">Все тарифы</option>${S.plans.filter((p) => p.id !== 'free').map((p) => `<option value="${p.id}"${st.plan === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <input class="inp" type="date" id="pFrom" value="${esc(st.from)}" style="width:auto" title="С даты"><span class="dim">—</span><input class="inp" type="date" id="pTo" value="${esc(st.to)}" style="width:auto" title="По дату">
        <div class="seg" id="pQuick"><button data-r="0">Сегодня</button><button data-r="7">7 дн</button><button data-r="30">30 дн</button><button data-r="">Всё</button></div>
        <span id="pUid"></span></div>
      <div class="card tight" id="pCard"></div>`;
    const change = () => { st.page = 1; load(); };
    $('pq').oninput = debounce(() => { st.q = $('pq').value.trim(); change(); }, 250);
    $('pProv').onchange = () => { st.provider = $('pProv').value; change(); };
    $('pPlan').onchange = () => { st.plan = $('pPlan').value; change(); };
    $('pFrom').onchange = () => { st.from = $('pFrom').value; change(); };
    $('pTo').onchange = () => { st.to = $('pTo').value; change(); };
    $('pQuick').onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b) return; st.to = ''; st.from = b.dataset.r === '' ? '' : isoDay(Date.now() - +b.dataset.r * 864e5); $('pFrom').value = st.from; $('pTo').value = ''; change(); };
    $('pChips').onclick = (e) => { const b = e.target.closest('[data-st]'); if (b) { st.status = b.dataset.st; change(); } };
    $('pCard').addEventListener('click', (e) => { const b = e.target.closest('[data-pmore]'); if (b && data) rowMenu(b, data.items.find((p) => p.id === b.dataset.pmore)); });
    await load();
    if (id) openPay(id);
  };
  const sync = () => setHash('payments', drawerOpen() ? openId : '', { ...st, page: st.page > 1 ? st.page : '', size: '' });
  async function load() {
    sync();
    const j = await api('/api/admin/payments/list' + qstr(st));
    if (!$('pCard')) return;
    data = j; st.page = j.page;
    const pend = j.counts.PENDING || 0;
    $('pKpi').innerHTML = [['Оплачено', rub(j.sum), `${pn(j.paid, 'платёж', 'платежа', 'платежей')} по фильтру`], ['Средний чек', rub(j.paid ? Math.round(j.sum / j.paid) : 0), 'среди оплаченных'], ['Ожидают оплаты', num(pend), pend ? 'клиент ещё не оплатил или не пришёл ответ' : 'нет зависших'], ['Возвраты', num(j.counts.CHARGEBACKED || 0), 'дни тарифа забраны']]
      .map(([t, v, s]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${s}</div></div>`).join('');
    $('pChips').innerHTML = ST.map(([k, t, f]) => `<button class="chip${st.status === k ? ' on' : ''}" data-st="${k}">${t} <i>${num(j.counts[f || k] || 0)}</i></button>`).join('');
    $('pQuick').querySelectorAll('button').forEach((b) => b.classList.toggle('on', !st.to && (b.dataset.r === '' ? !st.from : st.from === isoDay(Date.now() - +b.dataset.r * 864e5))));
    $('pUid').innerHTML = st.uid ? `<span class="tag">Пользователь: ${esc((j.items[0] && j.items[0].uid === st.uid && j.items[0].login) || st.uid)} <button data-clear aria-label="Сбросить">${I('x')}</button></span>` : '';
    if (st.uid) $('pUid').querySelector('[data-clear]').onclick = () => { st.uid = ''; st.page = 1; load(); };
    const cols = [
      { t: 'Дата', sort: 'at', render: (p) => `<span title="${esc(dtt(p.at))}">${dtt(p.at)}</span>` },
      { t: 'Пользователь', render: (p) => `<a href="#users/${esc(p.uid)}" class="no-row" style="text-decoration:none"><b>${esc(p.login || '—')}</b></a>` },
      { t: 'Тариф', render: (p) => `${esc(planName(p.plan))}${p.days ? ` <span class="dim">· ${p.days} дн.</span>` : ''}` },
      { t: 'Способ', render: (p) => esc(PROV[p.provider] || p.provider) },
      { t: 'Промокод', render: (p) => (p.promo ? `<span class="badge out">${esc(p.promo)}</span>` : '<span class="dim">—</span>') },
      { t: 'Сумма', sort: 'amount', cls: 'r', render: (p) => `<b>${rub(p.amount)}</b>` },
      { t: 'Статус', render: (p) => payBadge(p.status) },
      { t: '', cls: 'r', render: (p) => `<button class="ib sm" data-pmore="${esc(p.id)}" aria-label="Действия">${I('more')}</button>` },
    ];
    $('pCard').innerHTML = tableHTML({ cols, rows: j.items, sort: st.sort ? { k: st.sort, dir: st.dir || 'desc' } : { k: 'at', dir: st.dir || 'desc' }, empty: j.counts.all ? 'Платежей по фильтру нет' : 'Платежей пока нет', emptyIcon: 'receipt' }) + pagerHTML(j);
    bindTable($('pCard'), { rows: j.items, onRow: (p) => openPay(p.id), onSort: (k) => { const cur = st.sort || 'at'; st.dir = cur === k && (st.dir || 'desc') === 'desc' ? 'asc' : 'desc'; st.sort = k === 'at' ? '' : k; load(); } });
    bindPager($('pCard'), (n) => { st.page = n; load(); }, (n) => { st.size = n; pref.set('paysSize', n); st.page = 1; load(); });
  }
  function rowMenu(btn, p) {
    menu(btn, [
      { label: 'Подробнее', icon: 'receipt', on: () => openPay(p.id) },
      { label: 'Карточка пользователя', icon: 'user', on: () => go('users', p.uid) },
      { label: 'Скопировать номер заказа', icon: 'copy', on: () => copyText(p.id) },
      can('payments.manage') && p.status !== 'CONFIRMED' && { label: 'Проверить статус у провайдера', icon: 'refresh', on: () => check(p.id) },
    ]);
  }
  async function check(id) {
    try { const r = await post(`/api/admin/payments/${encodeURIComponent(id)}/check`); toast('Статус: ' + ((PST[r.status] || [r.status])[0]), 'ok'); load(); if (openId === id) openPay(id); } catch (e) { fail()(e); }
  }
  let openId = null;
  async function openPay(id) {
    openId = id;
    drawer({ title: 'Платёж', body: skeleton(6), onClose: () => { openId = null; sync(); } }); sync();
    let c; try { c = await api('/api/admin/payments/' + encodeURIComponent(id)); } catch (e) { $('drawer').querySelector('.db').innerHTML = emptyBox('Не удалось открыть', esc(e.message), 'alert'); return; }
    if (openId !== id) return;
    const p = c.pay, u = c.user;
    const d = drawer({
      title: `${rub(p.amount)} ${payBadge(p.status)}`, sub: `${esc(planName(p.plan))}${p.days ? ` на ${p.days} дн.` : ''} · ${dtt(p.at)}`, avatar: `<span class="av lg">${I('receipt')}</span>`, onClose: () => { openId = null; sync(); },
      body: `<div class="card flat"><dl class="kv">
        <dt>Номер заказа</dt><dd><span class="mono copy" data-copy="${esc(p.id)}">${esc(p.id)}</span></dd>
        <dt>Транзакция</dt><dd>${p.tx ? `<span class="mono copy" data-copy="${esc(p.tx)}">${esc(p.tx)}</span>` : '—'}</dd>
        <dt>Способ</dt><dd>${esc(PROV[p.provider] || p.provider)}</dd>
        <dt>Пользователь</dt><dd>${u ? `<a href="#users/${esc(u.id)}">${esc(u.login)}</a> <span class="dim">· ${esc(u.email)}</span>` : esc(p.login || p.uid || '—')}</dd>
        <dt>Тариф</dt><dd>${esc(planName(p.plan))}${p.days ? ' · ' + pn(p.days, 'день', 'дня', 'дней') : ''}</dd>
        <dt>Сумма</dt><dd><b>${rub(p.amount)}</b></dd>
        <dt>Промокод</dt><dd>${p.promo ? esc(p.promo) : '—'}</dd>
        <dt>Создан</dt><dd>${dtt(p.created)}</dd>
        ${p.paid ? `<dt>Оплачен</dt><dd>${dtt(p.paid)}</dd>` : ''}
        ${p.updated ? `<dt>Обновлён</dt><dd>${dtt(p.updated)}</dd>` : ''}
        <dt>Дни начислены</dt><dd>${p.applied ? '<span class="ok-t">да</span>' : 'нет'}</dd>
      </dl></div>
      ${can('payments.manage') ? `<div class="btns left mb">${p.status !== 'CONFIRMED' && p.status !== 'CHARGEBACKED' ? `<button class="btn" data-a="check">${I('refresh')}Проверить статус у провайдера</button>` : ''}${p.status === 'CONFIRMED' ? `<button class="btn danger" data-a="refund">${I('undo')}Отметить возврат</button>` : ''}</div>` : ''}
      ${c.others.length ? `<h3>Другие платежи пользователя</h3><div class="card tight flat">${tableHTML({ cols: [{ t: 'Дата', render: (x) => dtt(x.paid || x.created) }, { t: 'Тариф', render: (x) => esc(planName(x.plan)) }, { t: 'Сумма', cls: 'r', render: (x) => rub(x.amount) }, { t: 'Статус', render: (x) => payBadge(x.status) }], rows: c.others })}</div>` : ''}`,
    });
    const tbl = d.querySelector('.db .card.tight'); if (tbl) bindTable(tbl, { rows: c.others, onRow: (x) => openPay(x.id) });
    d.querySelector('.db').addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'check') busy(e.target.closest('button'), () => check(p.id));
      if (a === 'refund') {
        if (!(await confirmBox('Отметить возврат?', p.plan === 'reset' ? `Используйте, если вернули деньги клиенту в кабинете ${PROV[p.provider] || 'платёжной системы'}. Сброшенные счётчики обратно не восстанавливаются — пользователь сохранит обнулённый лимит. Сами деньги этим действием не возвращаются.` : `Используйте, если вернули деньги клиенту в кабинете ${PROV[p.provider] || 'платёжной системы'}. У пользователя будут забраны ${pn(p.days, 'день', 'дня', 'дней')} тарифа «${planName(p.plan)}». Сами деньги этим действием не возвращаются.`, { danger: true, ok: 'Отметить возврат' }))) return;
        try { await post(`/api/admin/payments/${encodeURIComponent(p.id)}/refund`); toast('Возврат отмечен, дни тарифа забраны', 'ok'); load(); openPay(p.id); } catch (er) { fail()(er); }
      }
    });
  }
})();
