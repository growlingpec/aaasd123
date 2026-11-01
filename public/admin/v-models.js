// Раздел «Модели»: вкладка «Подключение» (из прежней панели) + «Мониторинг» — доля успешных ответов, скорость и ошибки.
'use strict';
(() => {
  const legacy = R.models;
  let hours = 24;
  const tabs = (tab) => `<div class="tabs" id="mTabs"><button data-t="list" class="${tab === 'list' ? 'on' : ''}">${I('layers')}Подключение</button><button data-t="health" class="${tab === 'health' ? 'on' : ''}">${I('activity')}Мониторинг</button></div>`;
  R.models = async (params) => {
    const tab = params && params.tab === 'health' ? 'health' : 'list';
    if (!$('mTabs')) {
      $('view').insertAdjacentHTML('beforebegin', tabs(tab));
      $('mTabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; qsa('#mTabs button').forEach((x) => x.classList.toggle('on', x === b)); setHash('models', '', b.dataset.t === 'health' ? { tab: 'health' } : {}); $('vact').innerHTML = ''; $('view').innerHTML = skeleton(); R.models({ tab: b.dataset.t }); };
    }
    if (tab === 'list') return legacy();
    return health();
  };
  async function health() {
    const el = $('view');
    $('vact').innerHTML = `<div class="seg" id="mhPer">${[[6, '6 ч'], [24, '24 ч'], [72, '3 дня'], [168, '7 дней']].map(([h, t]) => `<button data-h="${h}" class="${h === hours ? 'on' : ''}">${t}</button>`).join('')}</div>${can('models.edit') ? `<button class="btn" id="mhCheck">${I('refresh')}Проверить все</button>` : ''}`;
    $('mhPer').onclick = (e) => { const b = e.target.closest('[data-h]'); if (b) { hours = +b.dataset.h; health(); } };
    if ($('mhCheck')) $('mhCheck').onclick = async (e) => { try { await busy(e.currentTarget, () => post('/api/admin/models/check')); toast('Проверка запущена — результаты появятся через минуту', 'ok'); setTimeout(() => { if (S.view === 'models') health(); }, 45000); } catch (er) { fail()(er); } };
    const j = await api('/api/admin/modelhealth?hours=' + hours);
    if (!el.isConnected) return;
    if (!j.models.length) { el.innerHTML = emptyBox('Моделей пока нет', 'Подключите модель на вкладке «Подключение»', 'layers'); return; }
    const sum = j.models.reduce((a, m) => ({ n: a.n + m.chats.n, ok: a.ok + m.chats.ok, down: a.down + (m.probes.last && !m.probes.last.ok ? 1 : 0) }), { n: 0, ok: 0, down: 0 });
    const lbl = (i) => { const t = j.since + i * j.step; return hours > 24 ? dtt(t) : tm(t); };
    el.innerHTML = `<div class="grid g4 mb">${[['Ответов в чате', num(sum.n), `за ${hours > 24 ? pn(hours / 24, 'день', 'дня', 'дней') : pn(hours, 'час', 'часа', 'часов')}`], ['Успешных', pctf(sum.n ? (sum.ok / sum.n) * 100 : null), `${num(sum.n - sum.ok)} с ошибкой`], ['Моделей', num(j.models.length), sum.down ? `<span class="bad-t">${sum.down} не отвечает</span>` : 'все отвечают'], ['Автопроверка', '20 мин', 'интервал коротких проверочных запросов']].map(([t, v, s]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${s}</div></div>`).join('')}</div>
      ${j.models.map((m) => {
        const lp = m.probes.last, state = !lp ? ['', 'нет данных'] : lp.ok ? ['ok', 'отвечает'] : ['bad', 'не отвечает'];
        const bad = m.chats.pct != null && m.chats.pct < 90;
        return `<div class="card"><div class="chead"><div class="row" style="gap:10px"><span class="dot ${state[0]}${state[0] === 'bad' ? ' pulse' : ''}"></span><div><h2 style="margin:0">${esc(m.name)}</h2><div class="sub" style="margin:0">${esc(m.modelId)} · ${esc(m.host)}${lp ? ` · последняя проверка ${ago(lp.at)}${lp.ms ? ', ' + msf(lp.ms) : ''}` : ''}</div></div></div><span class="badge ${state[0] || 'out'}">${state[1]}</span></div>
          <div class="grid g5 mb" style="gap:12px">${[['Ответов', num(m.chats.n)], ['Успешных', `<span class="${bad ? 'warn-t' : ''}">${pctf(m.chats.pct)}</span>`], ['Время ответа', `${msf(m.chats.p50)} <span class="dim" style="font-size:12px">медиана</span>`], ['Медленные 5%', msf(m.chats.p95)], ['Первые слова', msf(m.chats.first50)]].map(([t, v]) => `<div><div class="dim" style="font-size:12px">${t}</div><b style="font-size:16px">${v}</b></div>`).join('')}</div>
          <div class="tl" title="Каждая полоска — ${Math.round(j.step / 60000)} мин">${m.timeline.map((b, i) => `<i class="${!b.n ? '' : b.f === 0 ? 'ok' : b.f / b.n > 0.5 ? 'bad' : 'warn'}" title="${esc(lbl(i))}: ${b.n ? `${b.n - b.f} из ${b.n} успешно` : 'нет запросов'}"></i>`).join('')}</div>
          <div class="row between dim" style="font-size:11.5px;margin-top:4px"><span>${esc(lbl(0))}</span><span>Проверки: ${pctf(m.probes.pct)} успешных из ${num(m.probes.n)}</span><span>сейчас</span></div>
          ${m.errors.length ? `<div class="divider"></div><div class="sub" style="margin-bottom:6px">Частые ошибки</div>${m.errors.map((x) => `<div class="row" style="font-size:13px;margin-bottom:4px"><span class="badge bad">${x.n}×</span><span class="grow ell" title="${esc(x.err)}">${esc(x.err)}</span></div>`).join('')}` : ''}
        </div>`;
      }).join('')}`;
  }
})();
