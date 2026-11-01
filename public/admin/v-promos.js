// Раздел «Промокоды»: скидочные и подарочные коды, генерация пачкой, пауза, лимиты и статистика выручки.
'use strict';
(() => {
  const ST = { active: ['Активен', 'ok'], paused: ['На паузе', 'warn'], expired: ['Истёк', 'out'], used: ['Исчерпан', 'out'] };
  let all = [], plans = [], filt = '', text = '', sel = new Set();

  const what = (x) => (x.kind === 'gift' ? `Подарок: ${esc(planName(x.plan))} на ${pn(x.days, 'день', 'дня', 'дней')}` : `Скидка ${x.percent}%${x.plan ? ' на ' + esc(planName(x.plan)) : ' на любой тариф'}`);
  const saveCsv = (name, rows) => { const s = '\uFEFF' + rows.map((r) => r.map((v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(';')).join('\r\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

  R.promos = async (params) => {
    const el = $('view'); text = params.q || ''; filt = params.status || ''; sel = new Set();
    $('vact').innerHTML = can('promos.edit') ? `<button class="btn" id="prBulk">${I('layers')}Пачка кодов</button><button class="btn pri" id="prNew">${I('plus')}Промокод</button>` : '';
    if (can('promos.edit')) { $('prNew').onclick = () => createOne(); $('prBulk').onclick = () => createBulk(); }
    el.innerHTML = `<div class="grid g4 mb" id="prKpi"></div><div class="filters" id="prChips"></div>
      <div class="toolbar"><label class="inp-ico">${I('search')}<input class="inp" id="prq" placeholder="Код или описание" value="${esc(text)}" autocomplete="off"></label></div>
      <div class="card tight" id="prCard"></div><div id="prBulkBar"></div>`;
    $('prq').oninput = debounce(() => { text = $('prq').value.trim(); paint(); }, 150);
    $('prChips').onclick = (e) => { const b = e.target.closest('[data-st]'); if (b) { filt = b.dataset.st; paint(); } };
    $('prCard').addEventListener('click', (e) => { const b = e.target.closest('[data-prm]'); if (b) rowMenu(b, all.find((x) => x.code === b.dataset.prm)); });
    await load();
    if (params.new && can('promos.edit')) createOne();
  };
  async function load() { const j = await api('/api/admin/promos/list'); all = j.items; plans = j.plans; paint(); }
  function paint() {
    if (!$('prCard')) return;
    setHash('promos', '', { q: text, status: filt });
    const cnt = (s) => all.filter((x) => x.status === s).length;
    $('prKpi').innerHTML = [['Активных кодов', num(cnt('active')), `всего ${num(all.length)}`], ['Активаций', num(all.reduce((a, x) => a + (x.used || 0), 0)), 'за всё время'], ['Оплат с промокодом', num(all.reduce((a, x) => a + x.paidN, 0)), 'скидочные коды'], ['Выручка с промокодами', rub(all.reduce((a, x) => a + x.revenue, 0)), 'уже со скидкой']]
      .map(([t, v, s]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${s}</div></div>`).join('');
    $('prChips').innerHTML = [['', 'Все', all.length], ['active', 'Активные', cnt('active')], ['paused', 'На паузе', cnt('paused')], ['expired', 'Истекли', cnt('expired')], ['used', 'Исчерпаны', cnt('used')]].map(([k, t, n]) => `<button class="chip${filt === k ? ' on' : ''}" data-st="${k}">${t} <i>${num(n)}</i></button>`).join('');
    const s = text.toLowerCase(), rows = all.filter((x) => (!filt || x.status === filt) && (!s || x.code.toLowerCase().includes(s) || String(x.note || '').toLowerCase().includes(s)));
    const cols = [
      { t: 'Код', render: (x) => `<b class="mono copy" data-copy="${esc(x.code)}" title="Скопировать">${esc(x.code)}</b>${x.note ? `<div class="dim" style="font-size:12px">${esc(x.note)}</div>` : x.batch ? '<div class="dim" style="font-size:12px">из пачки</div>' : ''}` },
      { t: 'Что даёт', render: (x) => what(x) },
      { t: 'Использовано', render: (x) => (x.max ? `<div class="usage"><div class="track"><i style="width:${Math.min(100, ((x.used || 0) / x.max) * 100)}%"></i></div><small>${num(x.used || 0)} из ${num(x.max)}</small></div>` : `${num(x.used || 0)} <span class="dim">· без лимита</span>`) },
      { t: 'Оплаты', cls: 'r', render: (x) => (x.paidN ? `${num(x.paidN)} · <b>${rub(x.revenue)}</b>` : '<span class="dim">—</span>') },
      { t: 'Действует до', render: (x) => (x.until ? `${dt(x.until)}${x.until > Date.now() ? `<div class="dim" style="font-size:12px">${left(x.until)}</div>` : ''}` : '<span class="dim">бессрочно</span>') },
      { t: 'Статус', render: (x) => `<span class="badge ${ST[x.status][1]}">${ST[x.status][0]}</span>` },
      { t: '', cls: 'r', render: (x) => (can('promos.edit') ? `<button class="ib sm" data-prm="${esc(x.code)}" aria-label="Действия">${I('more')}</button>` : '') },
    ];
    $('prCard').innerHTML = tableHTML({ cols, rows, key: 'code', click: false, sel: can('promos.edit') ? sel : null, empty: all.length ? 'Ничего не найдено' : 'Промокодов пока нет', emptyIcon: 'tag' });
    bindTable($('prCard'), { rows, key: 'code', sel, onSel: paintBulk });
    paintBulk();
  }
  function paintBulk() {
    const box = $('prBulkBar'); if (!box) return;
    box.innerHTML = sel.size ? `<div class="bulkbar"><b>Выбрано: ${num(sel.size)}</b><button class="btn sm" data-b="csv">${I('download')}CSV</button><button class="btn sm" data-b="pause">${I('pause')}Пауза</button><button class="btn sm" data-b="resume">${I('play')}Возобновить</button><button class="btn sm danger" data-b="delete">${I('trash')}Удалить</button><button class="btn sm" data-b="clear">${I('x')}Снять</button></div>` : '';
    box.onclick = async (e) => {
      const a = e.target.closest('[data-b]')?.dataset.b; if (!a) return;
      const codes = [...sel], list = all.filter((x) => sel.has(x.code));
      if (a === 'clear') { sel.clear(); return paint(); }
      if (a === 'csv') return saveCsv('promocodes.csv', [['Код', 'Что даёт', 'Использовано', 'Лимит', 'До'], ...list.map((x) => [x.code, what(x).replace(/<[^>]+>/g, ''), x.used || 0, x.max || '', x.until ? isoDay(x.until) : ''])]);
      if (a === 'delete') { if (!(await confirmBox(`Удалить ${pn(codes.length, 'промокод', 'промокода', 'промокодов')}?`, 'Уже выданные скидки и подарки останутся у пользователей.', { danger: true, ok: 'Удалить' }))) return; try { await post('/api/admin/promos/delete', { codes }); toast('Удалено', 'ok'); sel.clear(); load(); } catch (er) { fail()(er); } return; }
      try { for (const c of codes) await post('/api/admin/promos/' + encodeURIComponent(c), { paused: a === 'pause' }, 'PATCH'); toast(a === 'pause' ? 'Поставлены на паузу' : 'Возобновлены', 'ok'); sel.clear(); load(); } catch (er) { fail()(er); }
    };
  }
  function rowMenu(btn, x) {
    menu(btn, [
      { label: 'Скопировать код', icon: 'copy', on: () => copyText(x.code) },
      { label: x.paused ? 'Возобновить' : 'Поставить на паузу', icon: x.paused ? 'play' : 'pause', on: () => patch(x, { paused: !x.paused }, x.paused ? 'Возобновлён' : 'На паузе — код временно не принимается') },
      { label: 'Изменить лимит, срок и описание…', icon: 'edit', on: () => edit(x) },
      '-',
      { label: 'Удалить', icon: 'trash', danger: true, on: async () => { if (await confirmBox(`Удалить ${x.code}?`, 'Уже выданные скидки и подарки останутся у пользователей.', { danger: true, ok: 'Удалить' })) { try { await api('/api/admin/promos/' + encodeURIComponent(x.code), { method: 'DELETE' }); toast('Удалён', 'ok'); load(); } catch (e) { fail()(e); } } } },
    ]);
  }
  const patch = async (x, b, msg) => { try { await post('/api/admin/promos/' + encodeURIComponent(x.code), b, 'PATCH'); toast(msg, 'ok'); load(); } catch (e) { fail()(e); } };
  async function edit(x) {
    const v = await formBox({ title: 'Промокод ' + x.code, fields: [
      { k: 'max', type: 'number', label: 'Сколько раз можно использовать', value: x.max || '', min: 1, placeholder: 'без лимита' },
      { k: 'until', type: 'date', label: 'Действует до (включительно)', value: x.until ? isoDay(x.until) : '', hint: 'Пусто — бессрочно' },
      { k: 'note', label: 'Описание (видно только в панели)', value: x.note || '', placeholder: 'например: блогер Иван, рассылка октябрь' }],
    onOk: (v) => post('/api/admin/promos/' + encodeURIComponent(x.code), { max: v.max, until: v.until, note: v.note }, 'PATCH') });
    if (v) { toast('Сохранено', 'ok'); load(); }
  }
  const kindFields = (code) => [
    code ? { k: 'code', label: 'Код', value: genCode(), required: true, hint: '3–30 символов: буквы, цифры, - или _. <a href="#" data-gen>Сгенерировать другой</a>' } : null,
    { k: 'kind', type: 'select', label: 'Тип', value: 'discount', options: [{ v: 'discount', t: 'Скидка на оплату' }, { v: 'gift', t: 'Подарочный тариф (без оплаты)' }] },
    { k: 'percent', type: 'number', label: 'Скидка, %', value: 20, min: 1, max: 99 },
    { k: 'plan', type: 'select', label: 'Тариф', value: '', options: [{ v: '', t: 'Любой тариф' }, ...plans.map((p) => ({ v: p.id, t: `${p.name} · ${rub(p.price)}` }))] },
    { k: 'days', type: 'number', label: 'Дней тарифа', value: 7, min: 1, max: 365 },
    { k: 'max', type: 'number', label: code ? 'Сколько раз можно использовать' : 'Использований на каждый код', value: code ? '' : 1, min: 1, placeholder: 'без лимита' },
    { k: 'until', type: 'date', label: 'Действует до (включительно)', hint: 'Пусто — бессрочно' },
    { k: 'note', label: 'Описание (видно только в панели)', placeholder: 'например: блогер Иван, рассылка октябрь' },
  ].filter(Boolean);
  const kindToggle = (f) => {
    const upd = () => {
      const gift = f.elements.kind.value === 'gift';
      f.elements.percent.closest('.field').hidden = gift; f.elements.days.closest('.field').hidden = !gift;
      const opt = f.elements.plan.querySelector('option[value=""]'); opt.hidden = gift; if (gift && !f.elements.plan.value) f.elements.plan.value = (plans[0] || {}).id || '';
    };
    f.elements.kind.onchange = upd; upd();
    const g = f.querySelector('[data-gen]'); if (g) g.onclick = (e) => { e.preventDefault(); f.elements.code.value = genCode(); };
  };
  async function createOne() {
    const v = await formBox({ title: 'Новый промокод', fields: kindFields(true), ok: 'Создать', onOpen: kindToggle, onOk: async (v) => {
      const pr = await post('/api/admin/promos', { code: v.code, kind: v.kind, percent: v.percent, plan: v.plan, days: v.days, max: v.max, until: v.until });
      if (v.note) await post('/api/admin/promos/' + encodeURIComponent(pr.code), { note: v.note }, 'PATCH');
      return pr;
    } });
    if (v) { setHash('promos', '', {}); toast('Промокод ' + v.code + ' создан', 'ok', { label: 'Скопировать', on: () => copyText(v.code) }); load(); }
  }
  async function createBulk() {
    const v = await formBox({ title: 'Пачка промокодов', text: 'Каждый код — уникальный, вида ПРЕФИКС-XXXXXXX. Удобно для рассылок, конкурсов и партнёров.', fields: [
      { k: 'prefix', label: 'Префикс', placeholder: 'например: OCT', hint: 'до 12 символов, можно пусто' }, { k: 'count', type: 'number', label: 'Сколько кодов', value: 20, min: 1, max: 500, required: true }, ...kindFields(false)],
    ok: 'Создать', onOpen: kindToggle, onOk: (x) => post('/api/admin/promos/bulk', x) });
    if (!v) return;
    load();
    modal({ title: `Готово: ${pn(v.codes.length, 'код', 'кода', 'кодов')}`, cancel: 'Закрыть', ok: 'Скачать CSV', body: `<textarea class="inp mono" rows="8" readonly style="font-size:13px">${esc(v.codes.join('\n'))}</textarea><div class="btns left"><button type="button" class="btn sm" data-copyall>${I('copy')}Скопировать все</button></div>`,
      onOpen: (f) => { f.querySelector('[data-copyall]').onclick = () => copyText(v.codes.join('\n'), 'Коды скопированы'); },
      onOk: () => { saveCsv(`promocodes-${v.batch}.csv`, [['Код'], ...v.codes.map((c) => [c])]); } });
  }
})();
