// Панель управления Premier — компоненты интерфейса: уведомления, окна, боковая карточка, меню, таблицы, графики.
'use strict';
const I = (name, cls = '') => `<svg${cls ? ` class="${cls}"` : ''}><use href="#i-${name}"/></svg>`;
const COLORS = ['var(--p-accent)', 'var(--info)', 'var(--ok)', 'var(--warn)', '#8B5CF6', '#14B8A6', '#EC4899', 'var(--dim)'];

/* ---------- уведомления ---------- */
function toast(text, type = 'info', action) {
  const box = $('toasts'); if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.setAttribute('role', 'status');
  t.innerHTML = `${type === 'ok' ? I('check') : type === 'err' ? I('alert') : I('info')}<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.remove(); action.on(); };
  box.append(t); while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, type === 'err' || action ? 6500 : 3800);
}
async function copyText(text, msg = 'Скопировано') {
  try { await navigator.clipboard.writeText(String(text)); }
  catch { const ta = document.createElement('textarea'); ta.value = String(text); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(msg, 'ok');
}

/* ---------- окна: подтверждение, форма ---------- */
let modalDepth = 0;
function modal({ title, text = '', body = '', ok = 'Готово', cancel = 'Отмена', danger = false, wide = false, onOpen, onOk, hideOk = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement, w = document.createElement('div');
    w.className = 'modal-wrap';
    w.innerHTML = `<form class="modal${wide ? ' wide' : ''}" novalidate autocomplete="off"><h3>${esc(title)}</h3>${text ? `<div class="mtxt">${esc(text)}</div>` : ''}${body}<div class="msg err" data-merr></div><div class="btns">${cancel ? `<button type="button" class="btn" data-cancel>${esc(cancel)}</button>` : ''}${hideOk ? '' : `<button class="btn ${danger ? 'danger solid' : 'pri'}" data-ok>${esc(ok)}</button>`}</div></form>`;
    document.body.append(w); modalDepth++;
    const f = w.firstChild;
    const close = (v) => { w.remove(); modalDepth--; document.removeEventListener('keydown', key, true); if (prev && prev.focus) prev.focus(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); } };
    document.addEventListener('keydown', key, true);
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(null); });
    f.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { const v = onOk ? await busy(f.querySelector('[data-ok]'), () => onOk(f)) : true; if (v === false) return; close(v === undefined ? true : v); }
      catch (er) { if (er.message !== 'auth') say(f.querySelector('[data-merr]'), er.message, 'err'); }
    };
    f.close = close;
    if (onOpen) onOpen(f);
    setTimeout(() => { const el = f.querySelector('[autofocus]') || f.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea') || f.querySelector('[data-ok]'); if (el) el.focus(); }, 30);
  });
}
const confirmBox = (title, text, o = {}) => modal({
  title, text, ok: o.ok || 'Подтвердить', danger: !!o.danger,
  body: o.typeToConfirm ? `<label class="field"><span>Чтобы подтвердить, введите <b>${esc(o.typeToConfirm)}</b></span><input data-typed autocomplete="off" spellcheck="false"></label>` : (o.body || ''),
  onOk: o.typeToConfirm ? (f) => { if (f.querySelector('[data-typed]').value.trim() !== o.typeToConfirm) throw new Error('Текст не совпадает'); return true; } : o.onOk,
});
function fieldHTML(x) {
  const id = 'f_' + x.k, req = x.required ? ' required' : '', hint = x.hint ? `<small>${x.hint}</small>` : '';
  if (x.type === 'html') return x.html;
  if (x.type === 'check') return `<label class="check"><input type="checkbox" name="${x.k}"${x.value ? ' checked' : ''}>${esc(x.label)}</label>`;
  if (x.type === 'switch') return `<div class="setting"><div class="grow"><b>${esc(x.label)}</b>${x.hint ? `<small>${x.hint}</small>` : ''}</div><label class="switch"><input type="checkbox" name="${x.k}"${x.value ? ' checked' : ''}><i></i></label></div>`;
  if (x.type === 'select') return `<label class="field"><span>${esc(x.label)}</span><select name="${x.k}" id="${id}">${x.options.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(x.value ?? '') ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select>${hint}</label>`;
  if (x.type === 'textarea') return `<label class="field"><span>${esc(x.label)}</span><textarea name="${x.k}" id="${id}" rows="${x.rows || 4}" placeholder="${esc(x.placeholder || '')}"${req}>${esc(x.value ?? '')}</textarea>${hint}</label>`;
  return `<label class="field"><span>${esc(x.label)}</span><input name="${x.k}" id="${id}" type="${x.type || 'text'}" value="${esc(x.value ?? '')}" placeholder="${esc(x.placeholder || '')}"${x.min != null ? ` min="${x.min}"` : ''}${x.max != null ? ` max="${x.max}"` : ''}${x.step ? ` step="${x.step}"` : ''}${req}${x.autofocus ? ' autofocus' : ''} autocomplete="off">${hint}</label>`;
}
function readFields(f, fields) {
  const v = {};
  for (const x of fields) {
    if (!x.k || x.type === 'html') continue;
    const el = f.elements[x.k]; if (!el) continue;
    if (x.type === 'check' || x.type === 'switch') v[x.k] = el.checked;
    else if (x.type === 'number') v[x.k] = el.value === '' ? null : Number(el.value);
    else v[x.k] = el.value.trim();
    if (x.required && (v[x.k] === '' || v[x.k] == null)) throw new Error(`Заполните поле «${x.label}»`);
  }
  return v;
}
function formBox({ title, text, fields, ok = 'Сохранить', danger, wide, onOk, onOpen }) {
  return modal({ title, text, ok, danger, wide, onOpen, body: fields.map(fieldHTML).join(''), onOk: async (f) => { const v = readFields(f, fields); if (!onOk) return v; const r = await onOk(v, f); return r === undefined ? v : r; } });
}

/* ---------- карточка справа ---------- */
const DR = { onClose: null };
function drawer({ title, sub = '', avatar = '', actions = '', body = '', onClose }) {
  const d = $('drawer');
  d.innerHTML = `<div class="dh">${avatar}<div class="grow"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${actions}<button class="ib" data-dclose title="Закрыть (Esc)" aria-label="Закрыть">${I('x')}</button></div><div class="db">${body}</div>`;
  d.classList.add('on'); $('scrim').classList.add('on'); DR.onClose = onClose || null;
  d.querySelector('[data-dclose]').onclick = () => closeDrawer();
  d.scrollTop = 0;
  return d;
}
function closeDrawer(silent) {
  const d = $('drawer'); if (!d || !d.classList.contains('on')) return false;
  d.classList.remove('on'); $('scrim').classList.remove('on');
  const f = DR.onClose; DR.onClose = null; if (!silent && f) f();
  return true;
}
const drawerOpen = () => $('drawer').classList.contains('on');

/* ---------- выпадающее меню ---------- */
function closeMenu() { const m = $('menu'); if (m) m.remove(); document.removeEventListener('mousedown', menuOutside, true); }
function menuOutside(e) { if (!e.target.closest('#menu')) closeMenu(); }
function menu(anchor, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.id = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.filter(Boolean).map((it, i) => it === '-' ? '<hr>' : it.href ? `<a href="${esc(it.href)}"${it.blank ? ' target="_blank" rel="noopener"' : ''}>${it.icon ? I(it.icon) : ''}${esc(it.label)}</a>` : `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}"${it.disabled ? ' disabled' : ''}>${it.icon ? I(it.icon) : ''}${esc(it.label)}</button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), list = items.filter(Boolean);
  let top = r.bottom + 4; if (top + m.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 4);
  m.style.top = top + 'px'; m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
  m.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; closeMenu(); list[+b.dataset.i].on(); };
  setTimeout(() => document.addEventListener('mousedown', menuOutside, true), 0);
}

/* ---------- таблицы ---------- */
function tableHTML({ cols, rows, sort, sel, key = 'id', click = true, empty = 'Ничего не найдено', emptyIcon = 'search' }) {
  if (!rows.length) return `<div class="empty" style="margin:18px">${I(emptyIcon)}<b>${empty}</b>Попробуйте изменить фильтры или поиск</div>`;
  const allOn = sel && rows.every((r) => sel.has(String(r[key])));
  return `<div class="tw"><table><thead><tr>${sel ? `<th class="ck"><input type="checkbox" data-all aria-label="Выбрать все"${allOn ? ' checked' : ''}></th>` : ''}${cols.map((c) => `<th class="${[c.sort ? 'sort' : '', sort && c.sort && sort.k === c.sort ? sort.dir : '', c.cls || ''].join(' ')}"${c.sort ? ` data-sort="${c.sort}"` : ''}${c.w ? ` style="width:${c.w}"` : ''}>${c.t}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr data-key="${esc(r[key])}" class="${click ? 'click' : ''}${sel && sel.has(String(r[key])) ? ' sel' : ''}">${sel ? `<td class="ck"><input type="checkbox" data-ck aria-label="Выбрать"${sel.has(String(r[key])) ? ' checked' : ''}></td>` : ''}${cols.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function bindTable(root, { rows, key = 'id', sel, onSort, onRow, onSel }) {
  root.onclick = (e) => {
    const th = e.target.closest('th[data-sort]'); if (th && onSort) return onSort(th.dataset.sort);
    if (e.target.matches('[data-all]')) { for (const r of rows) e.target.checked ? sel.add(String(r[key])) : sel.delete(String(r[key])); return onSel && onSel(); }
    if (e.target.matches('[data-ck]')) { const k = e.target.closest('tr').dataset.key; e.target.checked ? sel.add(k) : sel.delete(k); e.target.closest('tr').classList.toggle('sel', e.target.checked); return onSel && onSel(); }
    if (e.target.closest('button,a,input,select,label,.no-row,td.ck')) return;
    const tr = e.target.closest('tbody tr[data-key]'); if (tr && onRow) onRow(rows.find((r) => String(r[key]) === tr.dataset.key), e);
  };
}
function pagerHTML({ page, pages, total, size, sizes = [25, 50, 100, 200] }) {
  if (!total) return '';
  const a = (page - 1) * size + 1, b = Math.min(total, page * size);
  return `<div class="pager"><span>${num(a)}–${num(b)} из ${num(total)}</span><div class="row"><select class="inp sm" data-size aria-label="Строк на странице" style="width:auto">${sizes.map((s) => `<option value="${s}"${s === size ? ' selected' : ''}>${s} на стр.</option>`).join('')}</select><button class="ib sm" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''} aria-label="Назад">${I('left')}</button><span>${page} / ${pages}</span><button class="ib sm" data-page="${page + 1}"${page >= pages ? ' disabled' : ''} aria-label="Вперёд">${I('right')}</button></div></div>`;
}
function bindPager(root, onPage, onSize) {
  const p = root.querySelector('.pager'); if (!p) return;
  p.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) onPage(+b.dataset.page); });
  p.addEventListener('change', (e) => { if (e.target.matches('[data-size]')) onSize(+e.target.value); });
}
const skeleton = (n = 6) => `<div class="card tight"><div style="padding:18px;display:grid;gap:14px">${Array.from({ length: n }, (_, i) => `<div class="sk" style="height:18px;width:${70 + ((i * 37) % 30)}%"></div>`).join('')}</div></div>`;
const emptyBox = (title, text = '', icon = 'inbox') => `<div class="empty">${I(icon)}<b>${esc(title)}</b>${text}</div>`;

/* ---------- графики (SVG, без библиотек) ---------- */
const niceStep = (max, ticks = 4) => { const raw = max / ticks || 1, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
let chartSeq = 0;
// el — контейнер; labels — подписи по X; series — [{ name, data, color, fmt }]; type — 'area' | 'bar' | 'line'
function chart(el, { labels, series, type = 'area', height = 220, yFmt = compact, xFmt = (x) => x, tipTitle = (i) => labels[i] }) {
  const id = ++chartSeq;
  el.classList.add('chart-wrap');
  const draw = () => {
    const W = Math.max(280, el.clientWidth), H = height, pl = 46, pr = 10, pt = 10, pb = 26, n = labels.length, iw = W - pl - pr, ih = H - pt - pb;
    const maxV = Math.max(0, ...series.flatMap((s) => s.data.map(Number))), step = niceStep(maxV || 1), top = Math.max(step, Math.ceil(maxV / step) * step), ticks = Math.round(top / step);
    const band = iw / Math.max(1, n), x = type === 'bar' ? (i) => pl + band * i + band / 2 : (i) => pl + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => pt + ih * (1 - Number(v || 0) / top);
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><defs>${series.map((sr, k) => `<linearGradient id="cg${id}_${k}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${sr.color || COLORS[k]}" stop-opacity=".26"/><stop offset="1" stop-color="${sr.color || COLORS[k]}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
    for (let t = 0; t <= ticks; t++) { const v = step * t, yy = y(v); s += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="ax" x="${pl - 8}" y="${yy + 4}" text-anchor="end">${esc(yFmt(v))}</text>`; }
    labels.forEach((l, i) => { if (i % every === 0 || i === n - 1 && n - 1 - i < every) s += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(xFmt(l))}</text>`; });
    if (type === 'bar') {
      const bw = Math.max(2, Math.min(34, (band * 0.72) / series.length));
      series.forEach((sr, k) => sr.data.forEach((v, i) => { const h = Math.max(v > 0 ? 2 : 0, ih * (Number(v || 0) / top)), bx = x(i) - (bw * series.length) / 2 + k * bw; s += `<rect x="${bx}" y="${pt + ih - h}" width="${bw - 1}" height="${h}" rx="3" fill="${sr.color || COLORS[k]}" opacity=".9"/>`; }));
    } else {
      series.forEach((sr, k) => {
        const pts = sr.data.map((v, i) => [x(i), y(v)]), c = sr.color || COLORS[k];
        const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
        if (type === 'area' && pts.length) s += `<path d="${line}L${pts[pts.length - 1][0]} ${pt + ih}L${pts[0][0]} ${pt + ih}Z" fill="url(#cg${id}_${k})"/>`;
        s += `<path d="${line}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${sr.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
      });
    }
    s += `<line class="hov" x1="0" x2="0" y1="${pt}" y2="${pt + ih}" opacity="0"/><g class="dots"></g><rect x="${pl}" y="0" width="${iw}" height="${H}" fill="transparent" class="hit"/></svg><div class="tip"></div>`;
    el.innerHTML = s;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hov = el.querySelector('.hov'), dots = el.querySelector('.dots');
    const show = (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, type === 'bar' ? Math.floor((px - pl) / band) : Math.round(((px - pl) / iw) * (n - 1))));
      hov.setAttribute('x1', x(i)); hov.setAttribute('x2', x(i)); hov.setAttribute('opacity', '1');
      dots.innerHTML = type === 'bar' ? '' : series.map((sr, k) => `<circle cx="${x(i)}" cy="${y(sr.data[i])}" r="4" fill="var(--card)" stroke="${sr.color || COLORS[k]}" stroke-width="2"/>`).join('');
      tip.innerHTML = `<b>${esc(tipTitle(i))}</b>${series.map((sr, k) => `<div class="k"><i style="background:${sr.color || COLORS[k]}"></i>${esc(sr.name)}: <b>${esc((sr.fmt || num)(sr.data[i]))}</b></div>`).join('')}`;
      tip.style.left = Math.min(r.width - 70, Math.max(70, (x(i) / W) * r.width)) + 'px'; tip.style.top = (Math.min(...series.map((sr) => y(sr.data[i]))) / H) * r.height + 'px'; tip.classList.add('on');
    };
    const hide = () => { tip.classList.remove('on'); hov.setAttribute('opacity', '0'); dots.innerHTML = ''; };
    const hit = el.querySelector('.hit'); hit.addEventListener('mousemove', show); hit.addEventListener('mouseleave', hide);
    hit.addEventListener('touchstart', (e) => show(e.touches[0]), { passive: true }); hit.addEventListener('touchend', () => setTimeout(hide, 1500));
  };
  draw();
  if (el._ro) el._ro.disconnect();
  let w0 = el.clientWidth; el._ro = new ResizeObserver(debounce(() => { if (Math.abs(el.clientWidth - w0) > 4) { w0 = el.clientWidth; draw(); } }, 120)); el._ro.observe(el);
}
function spark(values, color = 'var(--p-accent)') {
  const v = values.map(Number), n = v.length; if (n < 2) return '';
  const max = Math.max(...v, 1), min = Math.min(...v, 0), y = (a) => 28 - ((a - min) / (max - min || 1)) * 26;
  const pts = v.map((a, i) => `${((i / (n - 1)) * 100).toFixed(2)},${y(a).toFixed(2)}`);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="M0,30 L${pts.join(' L')} L100,30Z" fill="${color}" opacity=".12"/><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
function donut(segs, size = 128, th = 18) {
  const total = segs.reduce((a, s) => a + s.value, 0), r = (size - th) / 2, c = 2 * Math.PI * r; let off = 0;
  const arcs = total ? segs.filter((s) => s.value > 0).map((s, k) => { const len = (s.value / total) * c, el = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${s.color || COLORS[k]}" stroke-width="${th}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return el; }).join('') : '';
  return `<svg class="donut" style="width:${size}px;height:${size}px" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--p-surface-2)" stroke-width="${th}"/>${arcs}</svg>`;
}
function delta(cur, prev, invert = false) {
  if (cur == null || prev == null) return '';
  if (!prev) return cur ? '<span class="delta up" title="В прошлом периоде было 0">новое</span>' : '<span class="delta flat">0%</span>';
  const d = ((cur - prev) / Math.abs(prev)) * 100, good = invert ? d < 0 : d > 0, cls = Math.abs(d) < 0.5 ? 'flat' : good ? 'up' : 'down';
  return `<span class="delta ${cls}" title="Прошлый период: ${esc(num(prev, 1))}">${d > 0.5 ? '↑' : d < -0.5 ? '↓' : ''}${num(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)}%</span>`;
}
const usageBar = (used, lim) => lim == null ? `<div class="usage"><small>${num(used, 1)} · без лимита</small></div>` : `<div class="usage"><div class="track"><i style="width:${Math.min(100, (used / Math.max(1, lim)) * 100)}%"></i></div><small>${num(used, 1)} из ${num(lim)}</small></div>`;
const who = (u, sub) => `<div class="who"><span class="av">${esc(initials(u.name || u.login))}</span><div class="grow"><b>${esc(u.login || '—')}</b><small>${sub ?? esc(u.email || '')}</small></div></div>`;
function qrSVG(text) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
}
