/* ---------- Облачный компьютер Premier ----------
   Свой Linux в Premier: модель работает в нём инструментами computer_* (как с ПК через помощник), а пользователь —
   через терминал и файлы в этом окне. Файлы хранятся на сервере, компьютер засыпает без дела. Режим выбирается в меню
   кнопки «Компьютер» (AG.mode, см. agent.js). */
const CL = { st: null, cwd: '~', dir: '~', log: [], hist: [], hi: 0, busy: false, tab: 'term', trash: false };
const clMb = (n) => (n >= 1024 ? +(n / 1024).toFixed(1) + ' GB' : Math.round(n) + ' MB');
const clOk = () => !!CL.st?.ok && CL.st.quotaMB > 0;
const clFiles = () => clOk() || (!!CL.st?.ok && !!CL.st.files); // тариф закончился, а файлы остались — их можно скачать
const clUsable = () => AG.on && AG.mode === 'cloud' && clOk();
const clJoin = (dir, name) => (dir === '~' ? '~/' : dir.replace(/\/+$/, '') + '/') + name;
// интерактивный терминал (xterm.js + WebSocket) — один на страницу, переживает закрытие окна; на телефоне — построчный
const CLX = { el: null, term: null, fit: null, ws: null, failed: false };
const clXtOk = () => 'WebSocket' in window && !CLX.failed && !matchMedia('(pointer: coarse)').matches;

async function clStatus() {
  try { CL.st = await memApi('/api/cloud/status'); } catch { CL.st = null; }
  agRender(); clPaintBar(); if (typeof renderSugg === 'function') renderSugg(); return CL.st;
}
// «5 мин назад» — коротко, без склонений
const clAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

function clOpen() {
  const full = clOk(); if (!full) CL.tab = 'files';
  dlgW(true); $('dtitle').textContent = 'Cloud computer'; $('modal').classList.add('on');
  $('dbody').innerHTML = `<div class="clw" id="clWin">
    <div class="clbar"><span id="clSt" class="clst"></span><span class="sp"></span>${full ? '<button type="button" class="btn" data-cl="stop">Shut down</button>' : ''}</div>
    ${full ? `<div class="agtabs"><button type="button" data-cltab="term">Terminal</button><button type="button" data-cltab="files">Files</button>${CL.st?.preview || CL.st?.publish ? '<button type="button" data-cltab="sites">Websites</button>' : ''}</div>` : ''}
    <div id="clTerm"><div id="clXtSlot"></div><div id="clLine"><pre class="agpre clout" id="clOut"></pre>
      <form class="clin" id="clForm"><code id="clPs"></code><input id="clCmd" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="e.g. python3 --version"><button class="btn pri" type="submit">Run</button></form></div></div>
    <div id="clSites">${CL.st?.publish ? '<div class="clsec"><b>Published</b><span class="dim">open for anyone with the link, even when the computer is asleep</span></div><div class="cllist" id="clPubList"></div>' : ''}
      ${CL.st?.preview ? '<div class="clsec"><b>Running servers</b><span class="dim">only you can see them</span><span class="sp"></span><button type="button" class="btn" data-cl="sites">Refresh</button></div><div class="cllist" id="clSiteList"></div>' : ''}</div>
    <div id="clFiles"><div class="clpath"><span id="clPath" class="clcrumbs"></span><span class="sp"></span><button type="button" class="btn" data-cl="trash" id="clTrashBtn">Trash</button>${full ? '<label class="btn clup" id="clUpBtn">Upload<input type="file" id="clUp" multiple hidden></label>' : ''}</div><div class="cllist" id="clList"></div></div>
    <p class="agl dim clnote">${full ? 'Files are stored in Premier and never disappear. When idle, the computer goes to sleep (background processes stop) and wakes up on the next command.' : 'Your plan has ended: you can download or delete files, and run commands again after renewing.'}</p></div>`;
  $('clForm').onsubmit = (e) => { e.preventDefault(); const i = $('clCmd'); clRun(i.value); i.value = ''; };
  $('clCmd').onkeydown = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault();
    CL.hi = Math.max(0, Math.min(CL.hist.length, CL.hi + (e.key === 'ArrowUp' ? -1 : 1))); e.target.value = CL.hist[CL.hi] || '';
  };
  if ($('clUp')) $('clUp').onchange = (e) => { clUpload([...e.target.files]); e.target.value = ''; };
  clTab(CL.tab); clPaintBar(); clPaintTerm(); clStatus();
}
function clTab(t) {
  CL.tab = t; if (!$('clWin')) return;
  $('dbody').querySelectorAll('[data-cltab]').forEach((b) => b.classList.toggle('on', b.dataset.cltab === t));
  $('clTerm').hidden = t !== 'term'; $('clFiles').hidden = t !== 'files'; $('clSites').hidden = t !== 'sites';
  const xt = t === 'term' && clXtOk(); $('clLine').hidden = xt; $('clXtSlot').hidden = !xt;
  if (t === 'files') CL.trash ? clTrash() : clLs(CL.dir); else if (t === 'sites') clSites(); else if (xt) clXterm(); else setTimeout(() => $('clCmd')?.focus(), 0);
}
function clPaintBar() {
  const el = $('clSt'); if (!el) return; const s = CL.st;
  if (!s) { el.textContent = 'No connection to the server'; return; }
  if (!s.ok) { el.textContent = s.error || 'Unavailable'; return; }
  el.innerHTML = !s.quotaMB ? `<i class="cldot"></i>Files only<span class="dim"> · used ${clMb(s.usedMB)}</span>`
    : `<i class="cldot${s.running ? ' on' : ''}"></i>${s.running ? 'Running' : 'Asleep — wakes up on the next command'}<span class="dim"> · ${clMb(s.usedMB)} of ${clMb(s.quotaMB)}${s.net ? '' : ' · no internet'}</span>`;
}

/* ---------- терминал: каждая команда — отдельный запуск bash; папка (cd) запоминается ---------- */
function clPaintTerm() {
  const o = $('clOut'); if (!o) return;
  $('clPs').textContent = CL.cwd + ' $';
  o.innerHTML = CL.log.length ? CL.log.map((x) => `<div class="clcmd">${esc(x.cwd)} $ ${esc(x.cmd)}</div>${x.out == null ? '<div class="dim">running…</div>' : `<div class="${x.code ? 'clerr' : ''}">${esc(x.out || '')}${x.code ? `${x.out ? '\n' : ''}[code ${x.code}]` : ''}</div>`}`).join('')
    : '<div class="dim">Linux (Debian) with Python 3, Node.js, git and pip. Commands run one at a time, without interactive input; up to 2 minutes per command. Run long processes in the background: nohup command &gt; log.txt 2&gt;&amp;1 &amp;</div>';
  o.scrollTop = o.scrollHeight;
}
async function clRun(cmd) {
  cmd = String(cmd || '').trim(); if (!cmd || CL.busy) return;
  if (cmd === 'clear') { CL.log = []; clPaintTerm(); return; }
  CL.hist.push(cmd); CL.hi = CL.hist.length; CL.busy = true;
  const x = { cwd: CL.cwd, cmd, out: null }; CL.log.push(x); if (CL.log.length > 200) CL.log.shift(); clPaintTerm();
  try {
    const j = await memApi('/api/cloud/run', { method: 'POST', body: JSON.stringify({ command: cmd, cwd: CL.cwd }) });
    x.out = j.out; x.code = j.killed ? 'stopped: took longer than 2 minutes' : j.code; if (j.cwd) CL.cwd = j.cwd;
  } catch (e) { x.out = e.message; x.code = 'error'; }
  CL.busy = false; clPaintTerm(); clStatus();
}

/* ---------- интерактивный терминал ---------- */
const clLoad = (tag, attrs) => new Promise((ok, fail) => { const e = Object.assign(document.createElement(tag), attrs, { onload: ok, onerror: () => fail(new Error('could not load the terminal')) }); document.head.appendChild(e); });
async function clXterm() {
  const slot = $('clXtSlot'); if (!slot) return;
  if (!CLX.term) {
    try {
      if (!window.Terminal) {
        await Promise.all([clLoad('link', { rel: 'stylesheet', href: '/vendor/xterm/xterm.css?v=5.5.0' }), clLoad('script', { src: '/vendor/xterm/xterm.js?v=5.5.0' })]);
        await clLoad('script', { src: '/vendor/xterm/addon-fit.js?v=0.10.0' });
      }
    } catch { CLX.failed = true; return clTab('term'); } // без xterm — построчный режим
    CLX.el = document.createElement('div'); CLX.el.className = 'clxt'; slot.appendChild(CLX.el);
    const cs = getComputedStyle(CLX.el); // цвета темы страницы (светлая или тёмная)
    const t = CLX.term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', scrollback: 5000, theme: { background: cs.backgroundColor, foreground: cs.color, cursor: cs.color, selectionBackground: 'rgba(127,127,127,.35)' } });
    CLX.fit = new FitAddon.FitAddon(); t.loadAddon(CLX.fit); t.open(CLX.el);
    t.onData((d) => { if (CLX.ws?.readyState === 1) CLX.ws.send(JSON.stringify({ d })); else if (!CLX.ws && d === '\r') clXtConnect(); });
    t.onResize(({ cols, rows }) => { if (CLX.ws?.readyState === 1) CLX.ws.send(JSON.stringify({ r: [cols, rows] })); });
    new ResizeObserver(() => { if (CLX.el.offsetWidth) try { CLX.fit.fit(); } catch {} }).observe(CLX.el);
  } else if (CLX.el.parentElement !== slot) slot.appendChild(CLX.el);
  try { CLX.fit.fit(); } catch {}
  if (!CLX.ws) clXtConnect();
  CLX.term.focus();
}
function clXtConnect() {
  const t = CLX.term, ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/cloud/tty?cols=${t.cols}&rows=${t.rows}`);
  ws.binaryType = 'arraybuffer'; CLX.ws = ws;
  let first = true; // компьютер мог только что проснуться — обновить статус, когда пошёл вывод
  ws.onmessage = (e) => { t.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data)); if (first) { first = false; clStatus(); } };
  ws.onclose = () => { if (CLX.ws !== ws) return; CLX.ws = null; t.write('\r\n\x1b[2m[terminal closed — press Enter to reopen]\x1b[0m\r\n'); clStatus(); };
}

/* ---------- сайты: серверы в облачном компьютере открываются на отдельном адресе (cloud-preview.js) ---------- */
async function clSites() {
  clPubs();
  const el = $('clSiteList'); if (!el) return; el.innerHTML = '<div class="dim clempty">Checking…</div>';
  try {
    const j = await memApi('/api/cloud/ports');
    el.innerHTML = j.ports.length ? j.ports.map((p) => `<div class="clrow"><svg><use href="#i-globe"/></svg><span class="clnm">Port ${p.port}</span><a class="btn pri clgo" href="/api/cloud/open?port=${p.port}" target="_blank" rel="noopener">Open site</a><span></span></div>`).join('')
      : '<div class="dim clempty">No servers are running. Start a server — for example, <code>python3 -m http.server 8000</code> — or ask the model to build a site.</div>';
  } catch (e) { el.innerHTML = `<div class="agwarn">${esc(e.message)}</div>`; }
}

// опубликованные папки: постоянная ссылка /s/<id> (cloud-sites.js)
async function clPubs() {
  const el = $('clPubList'); if (!el) return; el.innerHTML = '<div class="dim clempty">Loading…</div>';
  try {
    const j = await memApi('/api/cloud/sites');
    el.innerHTML = j.sites.length ? j.sites.map((x) => `<div class="clrow"><svg><use href="#i-share"/></svg><span class="clnm" title="${esc(x.src)}">${esc(x.title)}<small>${esc(x.src)} · ${fmtSize(x.bytes)} · ${clAgo(Date.parse(x.updated))}</small></span><span class="clacts"><a class="btn pri clgo" href="${x.path}" target="_blank" rel="noopener">Open</a><button type="button" class="btn clgo" data-clpub="${esc(x.src)}" title="Republish from ${esc(x.src)}">Republish</button></span><button type="button" class="ib" data-clunpub="${x.id}" title="Unpublish" aria-label="Unpublish ${esc(x.title)}"><svg><use href="#i-x"/></svg></button></div>`).join('')
      : '<div class="dim clempty">Nothing yet. Publish a folder with a site — use the <svg class="clinl"><use href="#i-share"/></svg> icon next to the folder in the «Files» tab — or ask the model to publish the site.</div>';
  } catch (e) { el.innerHTML = `<div class="agwarn">${esc(e.message)}</div>`; }
}
async function clPublish(src) {
  if (!confirm(`Publish «${src}» at a permanent link?\nAll files in the folder except hidden ones will be available to anyone with the link.`)) return;
  try {
    const j = await memApi('/api/cloud/sites', { method: 'POST', body: JSON.stringify({ path: src }) });
    navigator.clipboard?.writeText(location.origin + j.path).catch(() => {});
    toast((j.updated ? 'Site updated' : 'Published') + ' — link copied'); clTab('sites');
  } catch (e) { toast(e.message); }
}

/* ---------- корзина: удалённое хранится 7 дней ---------- */
async function clTrash() {
  CL.trash = true; const el = $('clList'); if (!el) return;
  if ($('clUpBtn')) $('clUpBtn').hidden = true; $('clTrashBtn').hidden = true;
  $('clPath').innerHTML = '<button type="button" data-clopen="' + esc(CL.dir) + '">← Files</button><span class="dim">/</span><b class="cltr">Trash</b>';
  el.innerHTML = '<div class="dim clempty">Loading…</div>';
  try {
    const j = await memApi('/api/cloud/trash');
    el.innerHTML = j.items.length ? `<div class="clrow clhint"><span></span><span class="dim">Deleted items are kept for ${j.days} days, then removed automatically.</span><button type="button" class="btn clgo" data-cltdel="all">Empty</button><span></span></div>` + j.items.map((x) => `<div class="clrow"><svg><use href="#i-${x.dir ? 'folder' : 'file'}"/></svg><span class="clnm" title="${esc(x.from)}">${esc(x.name)}<small>${esc(x.from)} · ${fmtSize(x.size)} · ${clAgo(x.at)}</small></span><button type="button" class="btn clgo" data-clres="${x.id}">Restore</button><button type="button" class="ib" data-cltdel="${x.id}" title="Delete permanently" aria-label="Delete permanently ${esc(x.name)}"><svg><use href="#i-trash"/></svg></button></div>`).join('')
      : '<div class="dim clempty">The trash is empty. Deleted files are kept here for 7 days.</div>';
  } catch (e) { el.innerHTML = `<div class="agwarn">${esc(e.message)}</div>`; }
}

/* ---------- файлы ---------- */
async function clLs(p) {
  const el = $('clList'); if (!el) return; el.innerHTML = '<div class="dim clempty">Loading…</div>';
  CL.trash = false; if ($('clUpBtn')) $('clUpBtn').hidden = false; if ($('clTrashBtn')) $('clTrashBtn').hidden = false;
  try {
    const j = await memApi('/api/cloud/files?path=' + encodeURIComponent(p)); CL.dir = j.path;
    const parts = j.path.split('/'); // ~/a/b → крошки ~ › a › b
    $('clPath').innerHTML = parts.map((n, i) => `<button type="button" data-clopen="${esc(parts.slice(0, i + 1).join('/') || '/')}">${esc(n || '/')}</button>`).join('<span class="dim">/</span>');
    el.innerHTML = j.entries.length ? j.entries.map((e) => {
      const full = clJoin(j.path, e.name);
      return `<div class="clrow"><svg><use href="#i-${e.dir ? 'folder' : 'file'}"/></svg>${e.dir ? `<button type="button" class="clnm" data-clopen="${esc(full)}">${esc(e.name)}</button>${CL.st?.publish && clOk() ? `<button type="button" class="ib" data-clpub="${esc(full)}" title="Publish the folder at a link" aria-label="Publish ${esc(e.name)}"><svg><use href="#i-share"/></svg></button>` : '<span></span>'}` : `<a class="clnm" href="/api/cloud/file?path=${encodeURIComponent(full)}" download="${esc(e.name)}" title="Download">${esc(e.name)}</a><span class="dim">${fmtSize(e.size)}</span>`}<button type="button" class="ib" data-cldel="${esc(full)}" title="Delete" aria-label="Delete ${esc(e.name)}"><svg><use href="#i-trash"/></svg></button></div>`;
    }).join('') : '<div class="dim clempty">The folder is empty. Upload files or ask the model to create something.</div>';
  } catch (e) { el.innerHTML = `<div class="agwarn">${esc(e.message)}</div>`; }
}
async function clUpload(list) {
  for (const f of list) {
    if (f.size > 20 * 1048576) { toast(`«${f.name}» is larger than 20 MB`); continue; }
    try {
      const r = await fetch(`/api/cloud/upload?dir=${encodeURIComponent(CL.dir)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error ' + r.status);
    } catch (e) { toast(`«${f.name}»: ${e.message}`); }
  }
  clLs(CL.dir); clStatus();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cltab],[data-clopen],[data-cldel],[data-cl],[data-clpub],[data-clunpub],[data-clres],[data-cltdel]'); if (!t || !t.closest('#clWin')) return;
  const api = async (url, body, ok) => { try { await memApi(url, { method: 'POST', body: JSON.stringify(body) }); if (ok) toast(ok); } catch (er) { toast(er.message); } };
  if (t.dataset.clpub) return clPublish(t.dataset.clpub);
  if (t.dataset.clunpub) {
    if (!confirm('Unpublish this website? The link will stop working.')) return;
    try { await memApi('/api/cloud/sites/' + t.dataset.clunpub, { method: 'DELETE' }); } catch (er) { toast(er.message); }
    return clPubs();
  }
  if (t.dataset.clres) { await api('/api/cloud/trash/restore', { id: t.dataset.clres }, 'Restored'); return (clTrash(), clStatus()); }
  if (t.dataset.cltdel) {
    if (!confirm(t.dataset.cltdel === 'all' ? 'Empty the trash? Files will be deleted permanently.' : 'Delete permanently? This cannot be undone.')) return;
    await api('/api/cloud/trash/delete', t.dataset.cltdel === 'all' ? { all: true } : { id: t.dataset.cltdel }); return clTrash();
  }
  if (t.dataset.cl === 'trash') return clTrash();
  if (t.dataset.cltab) return clTab(t.dataset.cltab);
  if (t.dataset.clopen) return clLs(t.dataset.clopen);
  if (t.dataset.cldel) {
    if (!confirm(`Delete «${t.dataset.cldel}»? It will go to the trash — you can restore it within 7 days.`)) return;
    await api('/api/cloud/delete', { path: t.dataset.cldel }, 'Moved to trash');
    return (clLs(CL.dir), clStatus());
  }
  if (t.dataset.cl === 'sites') return clSites();
  if (t.dataset.cl === 'stop') {
    try { await memApi('/api/cloud/stop', { method: 'POST' }); toast('Cloud computer shut down — files are kept'); } catch (er) { toast(er.message); }
    clStatus();
  }
});
window.addEventListener('DOMContentLoaded', clStatus);
