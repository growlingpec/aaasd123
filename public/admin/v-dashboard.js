// Раздел «Дашборд»: выручка, рост, активность, воронка, что требует внимания.
'use strict';
(() => {
  const PERIODS = [[7, '7 дней'], [30, '30 дней'], [90, '90 дней'], [365, 'Год']];
  const METRICS = { revenue: ['Выручка', rub, 'var(--p-accent)'], signups: ['Регистрации', num, 'var(--info)'], messages: ['Сообщения', num, 'var(--ok)'], active: ['Активные', num, '#8B5CF6'], api: ['Запросы API', num, '#14B8A6'] };
  let metric = 'revenue';

  R.dashboard = async (params) => {
    const el = $('view'), days = +params.days || pref.get('dashDays', 30);
    $('vact').innerHTML = `<div class="seg" id="dPer">${PERIODS.map(([d, t]) => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    $('dPer').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; pref.set('dashDays', +b.dataset.d); setHash('dashboard', '', { days: b.dataset.d }); R.dashboard({ days: b.dataset.d }); };
    const d = await api('/api/admin/dashboard?days=' + days);
    if (!el.isConnected) return;
    const k = d.kpi, ser = d.series, col = (key) => ser.map((x) => x[key]);
    const kpi = (title, v, x, key, fmt = num, opts = {}) => `<div class="kpi${opts.href ? ' click' : ''}"${opts.href ? ` data-href="${opts.href}"` : ''}><small>${title}</small><b title="${esc(fmt(v))}">${fmt(v)}</b><div class="meta">${x ? delta(x.v, x.prev, opts.invert) : ''}<span>${opts.note || (x ? 'к прошлым ' + pn(days, 'дню', 'дням', 'дням') : '')}</span></div>${key ? spark(col(key), METRICS[key] ? METRICS[key][2] : undefined) : ''}</div>`;
    const att = [];
    const a = d.attention;
    if (a.maintenance) att.push(`<a class="attn bad" href="#content">${I('alert')}<span class="grow">Включён режим технических работ</span>${I('right')}</a>`);
    if (a.modelsDown.length) att.push(`<a class="attn bad" href="#models?tab=health">${I('layers')}<span class="grow">Не отвечают: ${esc(a.modelsDown.map((m) => m.name).join(', '))}</span>${I('right')}</a>`);
    if (a.errors) att.push(`<a class="attn bad" href="#errors">${I('bug')}<span class="grow">${pn(a.errors, 'новая ошибка', 'новые ошибки', 'новых ошибок')} сервера за сутки</span>${I('right')}</a>`);
    if (a.reviews) att.push(`<a class="attn" href="#reviews">${I('star')}<span class="grow">${pn(a.reviews, 'отзыв ждёт', 'отзыва ждут', 'отзывов ждут')} модерации</span>${I('right')}</a>`);
    if (a.stalePays) att.push(`<a class="attn" href="#payments?status=PENDING">${I('receipt')}<span class="grow">${pn(a.stalePays, 'платёж завис', 'платежа зависли', 'платежей зависли')} в ожидании — проверьте статус</span>${I('right')}</a>`);
    if (d.expiring.n) att.push(`<a class="attn" href="#users?status=expiring&sort=until&dir=asc">${I('clock')}<span class="grow">У ${pn(d.expiring.n, 'клиента', 'клиентов', 'клиентов')} подписка закончится в ближайшие 3 дня</span>${I('right')}</a>`);
    const planIds = Object.keys(d.plans), planSegs = planIds.map((id, i) => ({ label: d.planNames[id] || id, value: d.plans[id], color: id === 'free' ? 'var(--line2)' : COLORS[i % 7] }));
    const totalPlans = planSegs.reduce((s, x) => s + x.value, 0) || 1;
    const bars = (list, fmtV, max = Math.max(1, ...list.map((x) => x.v))) => list.length ? `<div class="bars">${list.map((x) => `<div class="bar-row"><span class="ell" title="${esc(x.t)}">${esc(x.t)}</span><div class="track"><i style="width:${(x.v / max) * 100}%;${x.c ? 'background:' + x.c : ''}"></i></div><b>${fmtV(x)}</b></div>`).join('')}</div>` : emptyBox('Пока пусто', '', 'chart');
    const f = d.funnel, fmax = Math.max(1, f.signups);
    el.innerHTML = `
      ${att.length ? `<div class="card"><div class="chead"><div><h2>${I('bell')}Требует внимания</h2></div></div><div class="grid g2" style="gap:8px">${att.join('')}</div></div>` : ''}
      <div class="grid g4 mb">
        ${kpi('Выручка', k.revenue.v, k.revenue, 'revenue', rub, { href: '#payments?status=CONFIRMED' })}
        ${kpi('Новые пользователи', k.signups.v, k.signups, 'signups', num, { href: '#users?status=new7' })}
        ${kpi('Активные пользователи', k.active.v, k.active, 'active')}
        ${kpi('Сообщений отправлено', k.messages.v, k.messages, 'messages', compact)}
      </div>
      <div class="grid g4 mb">
        ${kpi('Конверсия в оплату', k.conversion.v, k.conversion, null, pctf, { note: 'новых пользователей оплатили' })}
        ${kpi('Средний чек', k.avgCheck.v, k.avgCheck, null, rub)}
        ${kpi('MRR (оценка)', k.mrr, null, null, rub, { note: `${pn(k.paying, 'платящий', 'платящих', 'платящих')} сейчас`, href: '#users?status=paid' })}
        ${kpi('Отток', k.churnRate, null, null, pctf, { note: `${pn(k.churned, 'подписка закончилась', 'подписки закончились', 'подписок закончились')} без продления` })}
      </div>
      <div class="grid g21 mb">
        <div class="card" style="margin:0"><div class="chead"><div><h2>Динамика</h2><div class="sub">По дням, московское время</div></div><div class="seg" id="dMet">${Object.entries(METRICS).map(([key, m]) => `<button data-m="${key}" class="${key === metric ? 'on' : ''}">${m[0]}</button>`).join('')}</div></div><div id="dChart"></div></div>
        <div class="card" style="margin:0"><div class="chead"><div><h2>Пользователи по тарифам</h2><div class="sub">${pn(k.users, 'аккаунт', 'аккаунта', 'аккаунтов')} · пробный у ${num(k.trials)}${k.banned ? ` · заблокировано ${num(k.banned)}` : ''}</div></div></div>
          <div class="donut-wrap">${donut(planSegs)}<div class="stack" style="gap:8px;flex:1">${planSegs.map((s) => `<a class="row between" href="#users?plan=${esc(planIds[planSegs.indexOf(s)])}" style="text-decoration:none;font-size:13.5px"><span class="row" style="gap:8px"><i style="width:10px;height:10px;border-radius:3px;background:${s.color}"></i>${esc(s.label)}</span><b>${num(s.value)} <span class="dim" style="font-weight:400">${num((s.value / totalPlans) * 100, 0)}%</span></b></a>`).join('')}</div></div>
          <div class="divider"></div>
          <div class="grid g3" style="gap:8px;text-align:center">${[['DAU', k.dau, 'за сегодня'], ['WAU', k.wau, 'за 7 дней'], ['MAU', k.mau, 'за 30 дней']].map(([t, v, s]) => `<div><div class="dim" style="font-size:12px">${t}</div><b style="font:700 20px var(--p-font-display)">${num(v)}</b><div class="dim" style="font-size:11.5px">${s}</div></div>`).join('')}</div>
        </div>
      </div>
      <div class="grid g3 mb">
        <div class="card" style="margin:0"><h2>Воронка</h2><div class="sub">Зарегистрировались за период → писали в чат → оплатили</div>
          <div class="funnel">${[['Регистрации', f.signups], ['Писали в чат', f.active], ['Оплатили', f.paid]].map(([t, v]) => `<div class="st"><span>${t}</span><b>${num(v)}${f.signups && t !== 'Регистрации' ? ` <span class="dim" style="font-weight:400">· ${num((v / f.signups) * 100, 1)}%</span>` : ''}</b><div class="track"><i style="width:${Math.max(v ? 2 : 0, (v / fmax) * 100)}%"></i></div></div>`).join('')}</div></div>
        <div class="card" style="margin:0"><h2>Выручка по способам оплаты</h2><div class="sub">За выбранный период</div>${bars(d.byProvider.map((x) => ({ t: PROV[x.key] || x.key, v: x.sum, n: x.n })), (x) => rub(x.v))}
          <div class="divider"></div><h3>По тарифам</h3>${bars(d.byPlan.map((x, i) => ({ t: planName(x.key), v: x.sum, n: x.n, c: COLORS[(i + 1) % 8] })), (x) => `${rub(x.v)} <span class="dim" style="font-weight:400">· ${x.n}</span>`)}</div>
        <div class="card" style="margin:0"><h2>Популярные модели</h2><div class="sub">Ответы в чате за последние ${days < 7 ? days : 7} дней и доля успешных</div>${bars(d.models.map((m) => ({ t: m.name, v: m.n, ok: m.ok, c: m.ok != null && m.ok < 90 ? 'var(--warn)' : undefined })), (x) => `${num(x.v)} <span class="${x.ok != null && x.ok < 90 ? 'warn-t' : 'dim'}" style="font-weight:400">· ${pctf(x.ok)}</span>`)}</div>
      </div>
      <div class="grid g3">
        <div class="card" style="margin:0"><div class="chead"><h2>Последние оплаты</h2><a class="btn sm ghost" href="#payments">Все ${I('right')}</a></div>${d.recentPays.length ? d.recentPays.map((p) => `<div class="list-row click" data-pay="${esc(p.id)}"><span class="av sm">${esc(initials(p.login))}</span><div class="grow"><b class="ell" style="display:block">${esc(p.login || '—')}</b><small class="dim">${esc(planName(p.plan))} · ${esc(PROV[p.provider] || p.provider)} · ${ago(p.at)}</small></div><b>${rub(p.amount)}</b></div>`).join('') : emptyBox('Оплат пока не было', '', 'receipt')}</div>
        <div class="card" style="margin:0"><div class="chead"><h2>Новые пользователи</h2><a class="btn sm ghost" href="#users">Все ${I('right')}</a></div>${d.recentUsers.length ? d.recentUsers.map((u) => `<div class="list-row click" data-user="${esc(u.id)}"><span class="av sm">${esc(initials(u.login))}</span><div class="grow"><b class="ell" style="display:block">${esc(u.login)}</b><small class="dim ell" style="display:block">${esc(u.email)} · ${ago(u.created)}</small></div>${planBadge(u.plan)}</div>`).join('') : emptyBox('Пока никого', '', 'users')}</div>
        <div class="card" style="margin:0"><div class="chead"><h2>Подписка заканчивается</h2><a class="btn sm ghost" href="#users?status=expiring&sort=until&dir=asc">Все ${I('right')}</a></div>${d.expiring.list.length ? d.expiring.list.map((u) => `<div class="list-row click" data-user="${esc(u.id)}"><span class="av sm">${esc(initials(u.login))}</span><div class="grow"><b class="ell" style="display:block">${esc(u.login)}</b><small class="dim">${esc(planName(u.plan))} · до ${dtt(u.until)}</small></div><span class="badge warn">${left(u.until)}</span></div>`).join('') : emptyBox('В ближайшие 3 дня — ни у кого', '', 'clock')}</div>
      </div>`;
    const drawChart = () => { const m = METRICS[metric]; chart($('dChart'), { labels: ser.map((x) => x.d), xFmt: dayLabel, tipTitle: (i) => dt(ser[i].d + 'T12:00:00'), type: days > 120 ? 'area' : metric === 'revenue' ? 'bar' : 'area', yFmt: metric === 'revenue' ? (v) => compact(v) + ' ₽' : compact, series: [{ name: m[0], data: col(metric), color: m[2], fmt: m[1] }], height: 250 }); };
    drawChart();
    $('dMet').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; metric = b.dataset.m; qsa('#dMet button').forEach((x) => x.classList.toggle('on', x === b)); drawChart(); };
    el.onclick = (e) => {
      const h = e.target.closest('[data-href]'); if (h) return (location.hash = h.dataset.href);
      const u = e.target.closest('[data-user]'); if (u) return go('users', u.dataset.user);
      const p = e.target.closest('[data-pay]'); if (p) return go('payments', p.dataset.pay);
    };
  };
})();
