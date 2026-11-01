// Раздел «Отзывы»: модерация по одному и пачкой, фильтры по статусу и оценке, распределение оценок.
'use strict';
(() => {
  const STS = { pending: ['На модерации', 'warn'], approved: ['Опубликован', 'ok'], rejected: ['Отклонён', 'bad'] };
  let st = {}, sel = new Set(), first = true;
  R.reviews = async (params) => {
    st = { status: params.status ?? (first ? 'auto' : ''), rating: params.rating || '', q: params.q || '', page: +params.page || 1 };
    first = false; sel = new Set();
    $('view').innerHTML = `<div class="grid g21 mb"><div class="grid g4" id="rvKpi" style="align-content:start"></div><div class="card" id="rvDist" style="margin:0"></div></div>
      <div class="toolbar"><div class="filters" id="rvChips" style="margin:0"></div><span class="sp"></span><div class="seg" id="rvRate"></div><label class="inp-ico" style="width:240px">${I('search')}<input class="inp" id="rvq" placeholder="Ник или текст" value="${esc(st.q)}"></label></div>
      <div class="card" id="rvList"></div><div id="rvBulk"></div>`;
    $('rvq').oninput = debounce(() => { st.q = $('rvq').value.trim(); st.page = 1; load(); }, 250);
    $('rvChips').onclick = (e) => { const b = e.target.closest('[data-st]'); if (b) { st.status = b.dataset.st; st.page = 1; load(); } };
    $('rvRate').onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) { st.rating = b.dataset.r; st.page = 1; load(); } };
    await load();
  };
  async function load() {
    let j = await api('/api/admin/reviews/list' + qstr({ ...st, status: st.status === 'auto' ? 'pending' : st.status }));
    if (st.status === 'auto') { if (!j.counts.pending) { st.status = ''; j = await api('/api/admin/reviews/list' + qstr(st)); } else st.status = 'pending'; }
    if (!$('rvList')) return;
    setHash('reviews', '', { status: st.status, rating: st.rating, q: st.q, page: st.page > 1 ? st.page : '' });
    const c = j.counts;
    $('rvKpi').innerHTML = [['На модерации', num(c.pending), c.pending ? 'ждут решения' : 'всё разобрано'], ['Опубликовано', num(c.approved), 'видны на сайте'], ['Средняя оценка', j.avg ? num(j.avg, 1) + ' ★' : '—', 'среди опубликованных'], ['Отклонено', num(c.rejected), 'не показываются']].map(([t, v, s]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${s}</div></div>`).join('');
    const max = Math.max(1, ...Object.values(j.dist));
    $('rvDist').innerHTML = `<h2>Оценки</h2><div class="sub">Все отзывы, включая неопубликованные</div><div class="bars">${[5, 4, 3, 2, 1].map((n) => `<div class="bar-row" style="grid-template-columns:44px 1fr auto"><span class="stars" style="color:var(--warn)">${n} ★</span><div class="track"><i style="width:${(j.dist[n] / max) * 100}%;background:${n >= 4 ? 'var(--ok)' : n === 3 ? 'var(--warn)' : 'var(--bad)'}"></i></div><b>${num(j.dist[n])}</b></div>`).join('')}</div>`;
    $('rvChips').innerHTML = [['pending', 'На модерации', c.pending], ['approved', 'Опубликованные', c.approved], ['rejected', 'Отклонённые', c.rejected], ['', 'Все', c.all]].map(([k, t, n]) => `<button class="chip${st.status === k ? ' on' : ''}" data-st="${k}">${t} <i>${num(n)}</i></button>`).join('');
    $('rvRate').innerHTML = [['', 'Все'], ['5', '5★'], ['4', '4★'], ['3', '3★'], ['2', '2★'], ['1', '1★']].map(([k, t]) => `<button data-r="${k}" class="${st.rating === k ? 'on' : ''}">${t}</button>`).join('');
    const ed = can('reviews.edit');
    $('rvList').innerHTML = j.items.length ? j.items.map((r) => `<div class="rv" data-id="${r.id}">${ed ? `<label class="ck"><input type="checkbox" data-ck${sel.has(r.id) ? ' checked' : ''} aria-label="Выбрать"></label>` : ''}<div class="body">
        <div class="head"><b>${esc(r.nick)}</b><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span><span class="badge ${STS[r.status][1]}">${STS[r.status][0]}</span>${r.login ? `<a href="#users/${esc(r.uid)}" class="dim">${esc(r.login)}</a> ${planBadge(r.plan)}` : '<span class="dim">аккаунт удалён</span>'}<span class="dim" title="${esc(dtt(r.at))}">· ${ago(r.at)}</span></div>
        <p>${esc(r.text)}</p>
        ${ed ? `<div class="acts">${r.status !== 'approved' ? `<button class="btn sm pri" data-a="approve">${I('check')}Опубликовать</button>` : ''}${r.status !== 'rejected' ? `<button class="btn sm" data-a="reject">${I('x')}Отклонить</button>` : ''}<button class="btn sm ghost danger" data-a="delete">${I('trash')}Удалить</button></div>` : ''}</div></div>`).join('') + (j.pages > 1 ? pagerHTML({ ...j, sizes: [j.size] }) : '')
      : emptyBox(st.status === 'pending' ? 'Все отзывы разобраны' : 'Отзывов нет', '', st.status === 'pending' ? 'check' : 'star');
    bindPager($('rvList'), (p) => { st.page = p; load(); }, () => {});
    $('rvList').onclick = async (e) => {
      const card = e.target.closest('.rv'); if (!card) return;
      if (e.target.matches('[data-ck]')) { e.target.checked ? sel.add(card.dataset.id) : sel.delete(card.dataset.id); return paintBulk(); }
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'delete' && !(await confirmBox('Удалить отзыв?', 'Он исчезнет навсегда. Автор сможет оставить новый под этим же ником.', { danger: true, ok: 'Удалить' }))) return;
      try { await post('/api/admin/reviews', { id: card.dataset.id, action: a }); toast({ approve: 'Опубликован', reject: 'Отклонён', delete: 'Удалён' }[a], 'ok'); sel.delete(card.dataset.id); load(); refreshBadges(); } catch (er) { fail()(er); }
    };
    paintBulk();
  }
  function paintBulk() {
    const box = $('rvBulk'); if (!box) return;
    box.innerHTML = sel.size ? `<div class="bulkbar"><b>Выбрано: ${num(sel.size)}</b><button class="btn sm" data-b="approve">${I('check')}Опубликовать</button><button class="btn sm" data-b="reject">${I('x')}Отклонить</button><button class="btn sm danger" data-b="delete">${I('trash')}Удалить</button><button class="btn sm" data-b="clear">Снять</button></div>` : '';
    box.onclick = async (e) => {
      const a = e.target.closest('[data-b]')?.dataset.b; if (!a) return;
      if (a === 'clear') { sel.clear(); return load(); }
      if (a === 'delete' && !(await confirmBox(`Удалить ${pn(sel.size, 'отзыв', 'отзыва', 'отзывов')}?`, '', { danger: true, ok: 'Удалить' }))) return;
      try { const r = await post('/api/admin/reviews/bulk', { ids: [...sel], action: a }); toast(`Готово: ${pn(r.n, 'отзыв', 'отзыва', 'отзывов')}`, 'ok'); sel.clear(); load(); refreshBadges(); } catch (er) { fail()(er); }
    };
  }
})();
