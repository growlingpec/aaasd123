// Premier — клиент: picker (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- выбор элемента на сайте ---------- */
let PICK = null, picking = false;
function pickAgent() {
  let on = false, box = null, lab = null;
  const mk = () => { box = document.createElement('div'); box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #5e9fe8;background:rgba(94,159,232,.12);border-radius:3px;display:none'; lab = document.createElement('div'); lab.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#5e9fe8;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:2px 7px;border-radius:4px;display:none;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis'; document.documentElement.append(box, lab); };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const sel = (e) => { const p = []; while (e && e.nodeType === 1 && e !== document.body && p.length < 6) { if (e.id) { p.unshift('#' + CSS.escape(e.id)); break; } let s = e.tagName.toLowerCase(); const sib = [...e.parentNode.children].filter((x) => x.tagName === e.tagName); if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'; p.unshift(s); e = e.parentElement; } return p.join(' > ') || 'body'; };
  const set = (v) => { on = v; if (!box) mk(); if (!v) { box.style.display = lab.style.display = 'none'; } document.documentElement.style.cursor = v ? 'crosshair' : ''; };
  addEventListener('mouseover', (ev) => { const e = ev.target; if (!on || !e || e === document.documentElement || e === document.body) return; const r = e.getBoundingClientRect(); Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', display: 'block' }); lab.textContent = name(e); Object.assign(lab.style, { left: Math.max(0, r.left) + 'px', top: (r.top > 24 ? r.top - 22 : r.bottom + 4) + 'px', display: 'block' }); }, true);
  for (const t of ['mousedown', 'pointerdown', 'mouseup']) addEventListener(t, (ev) => { if (on) { ev.preventDefault(); ev.stopPropagation(); } }, true);
  addEventListener('click', (ev) => { if (!on) return; ev.preventDefault(); ev.stopPropagation(); const e = ev.target; parent.postMessage({ premier: 'picked', sel: sel(e), name: name(e), text: (e.innerText || e.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 120), html: e.outerHTML.slice(0, 2500) }, '*'); set(false); }, true);
  addEventListener('keydown', (e) => { if (on && e.key === 'Escape') { set(false); parent.postMessage({ premier: 'pickoff' }, '*'); } }, true);
  addEventListener('message', (e) => { if (e.data && e.data.premier === 'pick') set(!!e.data.on); });
}
const PICK_TAG = '<script>(' + pickAgent.toString() + ')()<\/script>';
const withPick = (code) => /<\/body>/i.test(code) ? code.replace(/<\/body>(?![\s\S]*<\/body>)/i, PICK_TAG + '</body>') : code + PICK_TAG;
function setPicking(v) {
  picking = v; $('pPick').classList.toggle('on', v);
  if (v && A.tab !== 'preview') { A.tab = 'preview'; paneUI(); }
  $('pFrame').contentWindow?.postMessage({ premier: 'pick', on: v }, '*');
  if (v) toast('Наведите на элемент сайта и нажмите на него');
}
addEventListener('message', (e) => {
  if (e.source !== $('pFrame').contentWindow || !e.data?.premier) return;
  if (e.data.premier === 'pickoff') { picking = false; $('pPick').classList.remove('on'); return; }
  if (e.data.premier !== 'picked') return;
  picking = false; $('pPick').classList.remove('on');
  PICK = { sel: String(e.data.sel).slice(0, 300), name: String(e.data.name).slice(0, 80), text: String(e.data.text || '').slice(0, 120), html: String(e.data.html).slice(0, 2500), title: curArt()?.title || 'Сайт' };
  renderPick(); if (mobile()) closeArt(); $('q').focus();
});
function renderPick() {
  const c = $('pickChip'); c.hidden = !PICK;
  c.innerHTML = PICK ? `<svg><use href="#i-pick"/></svg><span>Элемент: <b>${esc(PICK.name)}</b>${PICK.text ? ' — «' + esc(PICK.text.slice(0, 60)) + '»' : ''}</span><button type="button" data-unpick aria-label="Убрать элемент"><svg><use href="#i-x"/></svg></button>` : '';
  $('q').placeholder = PICK ? 'Что изменить в этом элементе?' : 'Спросите что угодно';
}
