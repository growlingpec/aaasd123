/* ---------- Облачный компьютер Premier ----------
   Свой Linux в Premier: модель работает в нём инструментами computer_* (как с ПК через помощник), а пользователь —
   через терминал и файлы в этом окне. Файлы хранятся на сервере, компьютер засыпает без дела. Режим выбирается в меню
   кнопки «Компьютер» (AG.mode, см. agent.js). */
const CL = { st: null, cwd: '~', dir: '~', log: [], hist: [], hi: 0, busy: false, tab: 'term' };
const clMb = (n) => (n >= 1024 ? +(n / 1024).toFixed(1) + ' ГБ' : Math.round(n) + ' МБ');
const clOk = () => !!CL.st?.ok && CL.st.quotaMB > 0;
const clFiles = () => clOk() || (!!CL.st?.ok && !!CL.st.files); // тариф закончился, а файлы остались — их можно скачать
const clUsable = () => AG.on && AG.mode === 'cloud' && clOk();
const clJoin = (dir, name) => (dir === '~' ? '~/' : dir.replace(/\/+$/, '') + '/') + name;

async function clStatus() {
  try { CL.st = await memApi('/api/cloud/status'); } catch { CL.st = null; }
  agRender(); clPaintBar(); return CL.st;
}

function clOpen() {
  const full = clOk(); if (!full) CL.tab = 'files';
  dlgW(true); $('dtitle').textContent = 'Облачный компьютер'; $('modal').classList.add('on');
  $('dbody').innerHTML = `<div class="clw" id="clWin">
    <div class="clbar"><span id="clSt" class="clst"></span><span class="sp"></span>${full ? '<button type="button" class="btn" data-cl="stop">Выключить</button>' : ''}</div>
    ${full ? '<div class="agtabs"><button type="button" data-cltab="term">Терминал</button><button type="button" data-cltab="files">Файлы</button></div>' : ''}
    <div id="clTerm"><pre class="agpre clout" id="clOut"></pre>
      <form class="clin" id="clForm"><code id="clPs"></code><input id="clCmd" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="например: python3 --version"><button class="btn pri" type="submit">Выполнить</button></form></div>
    <div id="clFiles"><div class="clpath"><span id="clPath" class="clcrumbs"></span><span class="sp"></span>${full ? '<label class="btn clup">Загрузить<input type="file" id="clUp" multiple hidden></label>' : ''}</div><div class="cllist" id="clList"></div></div>
    <p class="agl dim clnote">${full ? 'Файлы хранятся в Premier и не пропадают. Без действий компьютер засыпает (фоновые процессы останавливаются) и просыпается по первой команде.' : 'Тариф закончился: файлы можно скачать или удалить, а запускать команды — после продления.'}</p></div>`;
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
  $('clTerm').hidden = t !== 'term'; $('clFiles').hidden = t !== 'files';
  if (t === 'files') clLs(CL.dir); else setTimeout(() => $('clCmd')?.focus(), 0);
}
function clPaintBar() {
  const el = $('clSt'); if (!el) return; const s = CL.st;
  if (!s) { el.textContent = 'Нет связи с сервером'; return; }
  if (!s.ok) { el.textContent = s.error || 'Недоступен'; return; }
  el.innerHTML = !s.quotaMB ? `<i class="cldot"></i>Только файлы<span class="dim"> · занято ${clMb(s.usedMB)}</span>`
    : `<i class="cldot${s.running ? ' on' : ''}"></i>${s.running ? 'Работает' : 'Спит — проснётся по первой команде'}<span class="dim"> · ${clMb(s.usedMB)} из ${clMb(s.quotaMB)}${s.net ? '' : ' · без интернета'}</span>`;
}

/* ---------- терминал: каждая команда — отдельный запуск bash; папка (cd) запоминается ---------- */
function clPaintTerm() {
  const o = $('clOut'); if (!o) return;
  $('clPs').textContent = CL.cwd + ' $';
  o.innerHTML = CL.log.length ? CL.log.map((x) => `<div class="clcmd">${esc(x.cwd)} $ ${esc(x.cmd)}</div>${x.out == null ? '<div class="dim">выполняется…</div>' : `<div class="${x.code ? 'clerr' : ''}">${esc(x.out || '')}${x.code ? `${x.out ? '\n' : ''}[код ${x.code}]` : ''}</div>`}`).join('')
    : '<div class="dim">Linux (Debian) с Python 3, Node.js, git и pip. Команды выполняются по одной, без интерактивного ввода; на команду — до 2 минут. Долгий процесс запустите в фоне: nohup команда &gt; журнал.txt 2&gt;&amp;1 &amp;</div>';
  o.scrollTop = o.scrollHeight;
}
async function clRun(cmd) {
  cmd = String(cmd || '').trim(); if (!cmd || CL.busy) return;
  if (cmd === 'clear') { CL.log = []; clPaintTerm(); return; }
  CL.hist.push(cmd); CL.hi = CL.hist.length; CL.busy = true;
  const x = { cwd: CL.cwd, cmd, out: null }; CL.log.push(x); if (CL.log.length > 200) CL.log.shift(); clPaintTerm();
  try {
    const j = await memApi('/api/cloud/run', { method: 'POST', body: JSON.stringify({ command: cmd, cwd: CL.cwd }) });
    x.out = j.out; x.code = j.killed ? 'остановлено: дольше 2 минут' : j.code; if (j.cwd) CL.cwd = j.cwd;
  } catch (e) { x.out = e.message; x.code = 'ошибка'; }
  CL.busy = false; clPaintTerm(); clStatus();
}

/* ---------- файлы ---------- */
async function clLs(p) {
  const el = $('clList'); if (!el) return; el.innerHTML = '<div class="dim clempty">Загружаю…</div>';
  try {
    const j = await memApi('/api/cloud/files?path=' + encodeURIComponent(p)); CL.dir = j.path;
    const parts = j.path.split('/'); // ~/a/b → крошки ~ › a › b
    $('clPath').innerHTML = parts.map((n, i) => `<button type="button" data-clopen="${esc(parts.slice(0, i + 1).join('/') || '/')}">${esc(n || '/')}</button>`).join('<span class="dim">/</span>');
    el.innerHTML = j.entries.length ? j.entries.map((e) => {
      const full = clJoin(j.path, e.name);
      return `<div class="clrow"><svg><use href="#i-${e.dir ? 'folder' : 'file'}"/></svg>${e.dir ? `<button type="button" class="clnm" data-clopen="${esc(full)}">${esc(e.name)}</button><span></span>` : `<a class="clnm" href="/api/cloud/file?path=${encodeURIComponent(full)}" download="${esc(e.name)}" title="Скачать">${esc(e.name)}</a><span class="dim">${fmtSize(e.size)}</span>`}<button type="button" class="ib" data-cldel="${esc(full)}" title="Удалить" aria-label="Удалить ${esc(e.name)}"><svg><use href="#i-trash"/></svg></button></div>`;
    }).join('') : '<div class="dim clempty">Папка пуста. Загрузите файлы или попросите модель что-нибудь создать.</div>';
  } catch (e) { el.innerHTML = `<div class="agwarn">${esc(e.message)}</div>`; }
}
async function clUpload(list) {
  for (const f of list) {
    if (f.size > 20 * 1048576) { toast(`«${f.name}» больше 20 МБ`); continue; }
    try {
      const r = await fetch(`/api/cloud/upload?dir=${encodeURIComponent(CL.dir)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Ошибка ' + r.status);
    } catch (e) { toast(`«${f.name}»: ${e.message}`); }
  }
  clLs(CL.dir); clStatus();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cltab],[data-clopen],[data-cldel],[data-cl]'); if (!t || !t.closest('#clWin')) return;
  if (t.dataset.cltab) return clTab(t.dataset.cltab);
  if (t.dataset.clopen) return clLs(t.dataset.clopen);
  if (t.dataset.cldel) {
    if (!confirm(`Удалить «${t.dataset.cldel}»? Восстановить не получится.`)) return;
    try { await memApi('/api/cloud/delete', { method: 'POST', body: JSON.stringify({ path: t.dataset.cldel }) }); } catch (er) { toast(er.message); }
    return (clLs(CL.dir), clStatus());
  }
  if (t.dataset.cl === 'stop') {
    try { await memApi('/api/cloud/stop', { method: 'POST' }); toast('Облачный компьютер выключен — файлы сохранены'); } catch (er) { toast(er.message); }
    clStatus();
  }
});
window.addEventListener('DOMContentLoaded', clStatus);
