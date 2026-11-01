// Раздел «API»: запросы разработчиков, модели и клиенты, крупнейшие пользователи, ошибки и все ключи.
'use strict';
(() => {
  let days = 7, kq = '', kpage = 1;
  R.api = async () => {
    const el = $('view');
    const j = await api('/api/admin/apistats?days=' + days);
    if (!el.isConnected) return;
    $('vact').innerHTML = `<div class="seg" id="apiPer">${[[1, 'Сегодня'], [7, '7 дней'], [30, '30 дней']].map(([d, t]) => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${t}</button>`).join('')}</div><label class="switch" title="Доступ к API для пользователей"><input type="checkbox" id="apiOpenT"${j.open ? ' checked' : ''}${can('api.edit') ? '' : ' disabled'}><i></i><span style="font-size:13.5px">API ${j.open ? 'открыт' : 'закрыт'}</span></label>`;
    $('apiPer').onclick = (e) => { const b = e.target.closest('[data-d]'); if (b) { days = +b.dataset.d; R.api(); } };
    $('apiOpenT').onchange = async (e) => { try { await post('/api/admin/api', { open: e.target.checked }); toast(e.target.checked ? 'API открыт' : 'API закрыт — новые запросы получат отказ', 'ok'); e.target.parentElement.querySelector('span').textContent = 'API ' + (e.target.checked ? 'открыт' : 'закрыт'); } catch (er) { e.target.checked = !e.target.checked; fail()(er); } };
    const t = j.total, errPct = t.req ? (t.errs / t.req) * 100 : null;
    const bars = (list, label, val, max = Math.max(1, ...list.map((x) => x.n))) => list.length ? `<div class="bars">${list.map((x) => `<div class="bar-row"><span class="ell" title="${esc(label(x))}">${esc(label(x))}</span><div class="track"><i style="width:${(x.n / max) * 100}%"></i></div><b>${val(x)}</b></div>`).join('')}</div>` : emptyBox('Запросов не было', '', 'code');
    el.innerHTML = `
      <div class="grid g4 mb">${[['Запросов', num(t.req), `${num(t.users)} ${plural(t.users, 'пользователь', 'пользователя', 'пользователей')}`], ['Ошибок', `<span class="${errPct > 5 ? 'bad-t' : ''}">${pctf(errPct)}</span>`, `${num(t.errs)} шт.`], ['Списано сообщений', num(t.cost, 1), `${compact(t.tin)} → ${compact(t.tout)} токенов`], ['Скорость', msf(t.ms), `первый токен ${msf(t.ttft)}`]].map(([a, b, c]) => `<div class="kpi"><small>${a}</small><b>${b}</b><div class="meta">${c}</div></div>`).join('')}</div>
      <div class="card"><div class="chead"><div><h2>Запросы ${days === 1 ? 'по часам' : 'по дням'}</h2><div class="sub">Активных ключей: ${num(j.keys.active)} из ${num(j.keys.total)}</div></div><div class="legend"><span><i style="background:#14B8A6"></i>Запросы</span><span><i style="background:var(--bad)"></i>Ошибки</span></div></div><div id="apiChart"></div></div>
      <div class="grid g3 mb">
        <div class="card" style="margin:0"><h2>Модели</h2><div class="sub">Запросы и средняя скорость</div>${bars(j.byModel, (x) => x.model || '—', (x) => `${num(x.n)}${x.e ? ` <span class="bad-t" style="font-weight:400">· ${num(x.e)} ош.</span>` : ''}`)}</div>
        <div class="card" style="margin:0"><h2>Программы</h2><div class="sub">Cursor, Codex, Claude Code и другие</div>${bars(j.byClient, (x) => x.client, (x) => num(x.n))}</div>
        <div class="card tight" style="margin:0"><div class="chead"><div><h2>Больше всех</h2><div class="sub">По числу запросов</div></div></div><div id="apiTop"></div></div>
      </div>
      <div class="card tight"><div class="chead"><div><h2>Последние ошибки</h2></div></div><div id="apiErr"></div></div>
      <div class="card tight"><div class="chead"><div><h2>Все API-ключи</h2><div class="sub">Отзыв ключа сразу останавливает программы, которые им пользуются</div></div><label class="inp-ico" style="width:260px">${I('search')}<input class="inp sm" id="kq" placeholder="Название, пользователь, IP" value="${esc(kq)}"></label></div><div id="apiKeys"></div></div>`;
    const ser = days === 1 ? j.hours : j.series;
    chart($('apiChart'), { labels: ser.map((x) => (days === 1 ? x.h : x.d)), xFmt: days === 1 ? (h) => String(h).padStart(2, '0') + ':00' : dayLabel, type: 'bar', height: 220, series: [{ name: 'Запросы', data: ser.map((x) => x.n), color: '#14B8A6' }, { name: 'Ошибки', data: ser.map((x) => x.e), color: 'var(--bad)' }] });
    $('apiTop').innerHTML = tableHTML({ rows: j.top, key: 'uid', empty: 'Запросов не было', emptyIcon: 'code', cols: [{ t: 'Пользователь', render: (x) => `<b>${esc(x.login || x.uid)}</b>` }, { t: 'Запросов', cls: 'r', render: (x) => num(x.n) }, { t: 'Сообщ.', cls: 'r', render: (x) => num(x.cost, 1) }] });
    bindTable($('apiTop'), { rows: j.top, key: 'uid', onRow: (x) => go('users', x.uid) });
    $('apiErr').innerHTML = tableHTML({ rows: j.errors.map((x, i) => ({ ...x, i })), key: 'i', click: false, empty: 'Ошибок нет — всё работает', emptyIcon: 'check', cols: [
      { t: 'Когда', render: (x) => `<span title="${esc(dtt(x.at))}">${ago(x.at)}</span>` }, { t: 'Пользователь', render: (x) => `<a href="#users/${esc(x.uid)}">${esc(x.login || x.uid)}</a>` }, { t: 'Модель', render: (x) => esc(x.model || '—') },
      { t: 'Код', render: (x) => `<span class="badge bad">${x.status || '—'}</span>` }, { t: 'Ошибка', cls: 'wrap', render: (x) => `<span class="muted" style="font-size:12.5px">${esc(String(x.err || '').slice(0, 200))}</span>` }, { t: 'Программа', render: (x) => esc(x.client || '—') }] });
    $('kq').oninput = debounce(() => { kq = $('kq').value.trim(); kpage = 1; keys(); }, 250);
    keys();
  };
  async function keys() {
    const j = await api('/api/admin/apikeys' + qstr({ q: kq, page: kpage }));
    if (!$('apiKeys')) return;
    $('apiKeys').innerHTML = tableHTML({ rows: j.items, click: false, empty: kq ? 'Ничего не найдено' : 'Ключей пока нет', emptyIcon: 'key', cols: [
      { t: 'Ключ', render: (k) => `<b>${esc(k.name)}</b><div class="dim mono" style="font-size:12px">${esc(k.hint)}</div>` },
      { t: 'Пользователь', render: (k) => `<a href="#users/${esc(k.uid)}">${esc(k.login || k.uid)}</a>` },
      { t: 'Ограничения', render: (k) => [k.models ? `${k.models.length} мод.` : '', k.ips ? `${k.ips.length} IP` : '', k.expires ? `до ${dt(k.expires)}` : ''].filter(Boolean).join(' · ') || '<span class="dim">нет</span>' },
      { t: 'Сегодня', cls: 'r', render: (k) => num(k.today) },
      { t: 'Использован', render: (k) => (k.last_used ? `${ago(k.last_used)}<div class="dim" style="font-size:12px">${esc(k.last_client || '')} ${esc(k.last_ip || '')}</div>` : '<span class="dim">никогда</span>') },
      { t: 'Создан', render: (k) => dt(k.created) },
      { t: '', cls: 'r', render: (k) => (can('api.edit') ? `<button class="btn sm danger" data-kr="${esc(k.id)}">Отозвать</button>` : '') }] }) + pagerHTML({ ...j, pages: Math.max(1, Math.ceil(j.total / j.size)), sizes: [50] });
    bindPager($('apiKeys'), (p) => { kpage = p; keys(); }, () => {});
    $('apiKeys').onclick = async (e) => {
      const b = e.target.closest('[data-kr]'); if (!b) return;
      const k = j.items.find((x) => x.id === b.dataset.kr);
      if (!(await confirmBox(`Отозвать ключ «${k.name}»?`, `Владелец: ${k.login || k.uid}. Программы с этим ключом сразу перестанут работать.`, { danger: true, ok: 'Отозвать' }))) return;
      try { await post(`/api/admin/apikeys/${encodeURIComponent(k.id)}/revoke`); toast('Ключ отозван', 'ok'); keys(); } catch (er) { fail()(er); }
    };
  }
})();
