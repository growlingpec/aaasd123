/* ---------- Папка на компьютере пользователя (File System Access API) ----------
   Доступ даёт сам пользователь (выбор папки + разрешение браузера). Модель читает файлы,
   а каждое изменение показывается как diff и применяется только после «Применить». */
const FS = { h: null, name: '', perm: '', auto: false, undo: new Map(), wait: new Map() };
const FS_OK = typeof window.showDirectoryPicker === 'function' && window.isSecureContext && !/Mobi|Android/i.test(navigator.userAgent);
const FS_SKIP = /^(node_modules|\.git|\.svn|\.hg|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.cache|\.parcel-cache|__pycache__|\.venv|venv|env|\.idea|\.vscode|coverage|target|vendor|\.DS_Store|Thumbs\.db)$/;
const FS_WRITE = new Set(['folder_edit', 'folder_write', 'folder_rename', 'folder_delete']);
try { FS.auto = localStorage.getItem('premier:fsauto') === '1'; } catch {}

// handle папки хранится в IndexedDB, чтобы после перезагрузки не выбирать заново (браузер всё равно спросит разрешение)
function fsDb(fn) {
  return new Promise((ok, fail) => { const r = indexedDB.open('premier-fs', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onerror = () => fail(r.error);
    r.onsuccess = () => { const tx = r.result.transaction('h', 'readwrite'), st = tx.objectStore('h'), q = fn(st); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => fail(tx.error); }; });
}
async function fsInit() {
  if (!FS_OK) return; $('fsBtn').hidden = false;
  try { const h = await fsDb((st) => st.get('dir')); if (h) { FS.h = h; FS.name = h.name; FS.perm = await h.queryPermission({ mode: 'readwrite' }); } } catch {}
  fsRender();
}
function fsRender() {
  const b = $('fsBtn'); if (!b) return; const on = FS.h && FS.perm === 'granted';
  b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on));
  $('fsName').textContent = FS.h ? (on ? FS.name : FS.name + ' — allow') : 'Folder';
  b.title = !FS.h ? 'Give the model access to a folder on your computer' : on ? 'The model is working with folder “' + FS.name + '»' : 'Click to allow access to “' + FS.name + '»';
}
async function fsPick() {
  try {
    const h = await window.showDirectoryPicker({ id: 'premier', mode: 'readwrite' });
    FS.h = h; FS.name = h.name; FS.perm = await h.queryPermission({ mode: 'readwrite' });
    if (FS.perm !== 'granted') FS.perm = await h.requestPermission({ mode: 'readwrite' });
    try { await fsDb((st) => st.put(h, 'dir')); } catch {}
    fsRender(); if (FS.perm === 'granted') toast('Folder “' + FS.name + '» connected — the model can access its files');
  } catch (e) { if (e.name !== 'AbortError') toast('Could not open folder: ' + e.message); }
}
async function fsOff() { FS.h = null; FS.name = ''; FS.perm = ''; try { await fsDb((st) => st.delete('dir')); } catch {} fsRender(); toast('Folder disconnected'); }
function fsMenu() {
  if (!FS.h) return fsPick();
  if (FS.perm !== 'granted') { FS.h.requestPermission({ mode: 'readwrite' }).then((p) => { FS.perm = p; fsRender(); if (p === 'granted') toast('Access to “' + FS.name + '» allowed'); }).catch(() => {}); return; }
  let m = $('fsMenu'); if (m) { m.remove(); return; }
  m = document.createElement('div'); m.id = 'fsMenu'; m.className = 'fsmenu';
  m.innerHTML = `<div class="fsm-h"><svg><use href="#i-folder"/></svg><b>${esc(FS.name)}</b></div>
    <label class="fsm-ck"><input type="checkbox" id="fsAuto"${FS.auto ? ' checked' : ''}><span>Apply changes without confirmation</span></label>
    <button type="button" data-fsm="pick">Choose another folder</button><button type="button" data-fsm="off" class="danger">Disconnect folder</button>`;
  $('fsBtn').parentElement.appendChild(m);
  m.onclick = (e) => { const b = e.target.closest('[data-fsm]'); if (!b) return; m.remove(); b.dataset.fsm === 'pick' ? fsPick() : fsOff(); };
  $('fsAuto').onchange = (e) => { FS.auto = e.target.checked; try { localStorage.setItem('premier:fsauto', FS.auto ? '1' : '0'); } catch {} if (FS.auto) toast('Changes will be applied immediately — use Undo to revert them'); };
  setTimeout(() => document.addEventListener('click', function cl(e) { if (!e.target.closest('#fsMenu,#fsBtn')) { m.remove(); document.removeEventListener('click', cl); } }), 0);
}

/* ---------- файловые операции ---------- */
const fsParts = (p) => { const a = String(p || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.'); if (a.some((x) => x === '..')) throw new Error('path is outside the folder'); return a; };
async function fsDir(a, create) { let d = FS.h; for (const x of a) d = await d.getDirectoryHandle(x, { create }); return d; }
async function fsFile(p, create) { const a = fsParts(p); if (!a.length) throw new Error('no file specified'); return (await fsDir(a.slice(0, -1), create)).getFileHandle(a.at(-1), { create }); }
const fsErr = (e, p) => e.name === 'NotFoundError' ? new Error('not found: ' + p) : e.name === 'TypeMismatchError' ? new Error(p + ' — this is a folder, not a file') : e.name === 'NotAllowedError' ? new Error('the browser denied access — the user needs to allow the folder again') : e;
const isBin = (t) => t.slice(0, 8000).includes('\u0000');
async function fsRead(p) { try { const f = await (await fsFile(p)).getFile(); return { file: f, text: f.size > 3e6 ? null : await f.text() }; } catch (e) { if (e.name === 'NotFoundError') return null; throw fsErr(e, p); } }
async function fsPut(p, data) { const h = await fsFile(p, true), w = await h.createWritable(); await w.write(data); await w.close(); }
async function fsRemove(p) { const a = fsParts(p); await (await fsDir(a.slice(0, -1))).removeEntry(a.at(-1)); }
async function* fsWalk(dir, pre = '', depth = 99) {
  const items = []; for await (const [n, h] of dir.entries()) if (!FS_SKIP.test(n)) items.push([n, h]);
  items.sort((a, b) => (a[1].kind === b[1].kind ? a[0].localeCompare(b[0]) : a[1].kind === 'directory' ? -1 : 1));
  for (const [n, h] of items) { yield { path: pre + n, h, depth: pre.split('/').length - 1 }; if (h.kind === 'directory' && depth > 1) yield* fsWalk(h, pre + n + '/', depth - 1); }
}
const kb = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
async function fsList(path, depth = 2, max = 400) {
  const a = fsParts(path), d = a.length ? await fsDir(a).catch((e) => { throw fsErr(e, path); }) : FS.h, lines = [];
  for await (const x of fsWalk(d, '', Math.min(4, Math.max(1, depth | 0 || 2)))) {
    if (lines.length >= max) { lines.push('… (showing the first ' + max + ' — browse subfolders separately)'); break; }
    const name = x.path.split('/').pop(); let size = '';
    if (x.h.kind === 'file') { try { size = ' (' + kb((await x.h.getFile()).size) + ')'; } catch {} }
    lines.push('  '.repeat(x.depth) + name + (x.h.kind === 'directory' ? '/' : size));
  }
  return lines.join('\n') || '(empty folder)';
}
async function fsInfo() { if (!FS.h || FS.perm !== 'granted') return null; let tree = ''; try { tree = await fsList('', 2, 250); } catch {} return { name: FS.name, tree }; }

// построчный diff: общий начало/конец отрезаем, середину — LCS
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n'); let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const x = A.slice(s, ea), y = B.slice(s, eb), mid = [];
  if (x.length * y.length > 4e6) { x.forEach((l) => mid.push(['-', l])); y.forEach((l) => mid.push(['+', l])); }
  else {
    const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0; while (i < n || j < m) { if (i < n && j < m && x[i] === y[j]) { mid.push([' ', x[i]]); i++; j++; } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) mid.push(['-', x[i++]]); else mid.push(['+', y[j++]]); }
  }
  const rows = [...A.slice(0, s).map((l) => [' ', l]), ...mid, ...A.slice(ea).map((l) => [' ', l])];
  // оставляем только изменения с 3 строками контекста
  const keep = new Array(rows.length).fill(false); rows.forEach((r, k) => { if (r[0] !== ' ') for (let d = -3; d <= 3; d++) if (rows[k + d]) keep[k + d] = true; });
  const out = []; let gap = false, add = 0, del = 0;
  rows.forEach((r, k) => { if (r[0] === '+') add++; if (r[0] === '-') del++; if (keep[k]) { if (gap) out.push(['…', '']); gap = false; out.push(r); } else gap = true; });
  return { rows: out.slice(0, 400).map(([t, l]) => [t, l.length > 400 ? l.slice(0, 400) + '…' : l]), cut: out.length > 400, add, del };
}

// подготовить изменение (ничего не записывая) — возвращает функцию применения и данные для отката
async function fsPlan(name, a) {
  if (name === 'folder_edit') {
    const p = String(a.path || ''), cur = await fsRead(p); if (!cur) throw new Error('file not found: ' + p + ' (use folder_write for a new file)');
    if (cur.text == null || isBin(cur.text)) throw new Error('file is too large or is not text');
    let old = String(a.old ?? ''), nw = String(a.new ?? ''); if (!old) throw new Error('empty old fragment');
    if (cur.text.includes('\r\n') && !old.includes('\r')) { old = old.replace(/\n/g, '\r\n'); nw = nw.replace(/\n/g, '\r\n'); }
    const n = cur.text.split(old).length - 1;
    if (!n) throw new Error('the old fragment was not found in ' + p + ' — reread the file (folder_read) and copy the fragment exactly');
    if (n > 1) throw new Error('the old fragment occurs in ' + p + ' ' + n + ' times — include adjacent lines to make it unique');
    const after = cur.text.replace(old, () => nw);
    return { op: 'edit', path: p, diff: lineDiff(cur.text.replace(/\r\n/g, '\n'), after.replace(/\r\n/g, '\n')), apply: () => fsPut(p, after), undo: () => fsPut(p, cur.text) };
  }
  if (name === 'folder_write') {
    const p = String(a.path || ''), content = String(a.content ?? ''), cur = await fsRead(p);
    if (cur && (cur.text == null || isBin(cur.text))) throw new Error('the existing file is too large or not text — overwriting is forbidden');
    return { op: cur ? 'write' : 'create', path: p, diff: lineDiff(cur ? cur.text.replace(/\r\n/g, '\n') : '', content), apply: () => fsPut(p, content), undo: () => (cur ? fsPut(p, cur.text) : fsRemove(p)) };
  }
  if (name === 'folder_rename') {
    const from = String(a.from || ''), to = String(a.to || ''), cur = await fsRead(from); if (!cur) throw new Error('file not found: ' + from);
    if (await fsRead(to)) throw new Error('file ' + to + ' already exists');
    const data = await cur.file.arrayBuffer();
    return { op: 'rename', path: from, to, apply: async () => { await fsPut(to, data); await fsRemove(from); }, undo: async () => { await fsPut(from, data); await fsRemove(to); } };
  }
  if (name === 'folder_delete') {
    const p = String(a.path || ''), cur = await fsRead(p); if (!cur) throw new Error('file not found: ' + p);
    const data = await cur.file.arrayBuffer();
    return { op: 'delete', path: p, size: cur.file.size, apply: () => fsRemove(p), undo: () => fsPut(p, data) };
  }
  throw new Error('unknown operation');
}
const OPN = { edit: 'Change', write: 'Overwrite', create: 'New file', rename: 'Rename', delete: 'Delete' };
const RES = { edit: 'modified', write: 'overwritten', create: 'created', rename: 'renamed', delete: 'deleted' };

// вызов инструмента от модели (через сервер): выполнить и отправить результат обратно
async function fsHandle(req, msg) {
  const op = { id: req.cid, tool: req.name, path: String(req.args.path || req.args.from || req.args.query || ''), state: 'run' };
  (msg.fsops ||= []).push(op); renderChat(); toBottom();
  let result;
  try {
    if (!FS.h || FS.perm !== 'granted') throw new Error('the folder is not connected or access is denied — ask the user to click the folder button');
    const a = req.args || {};
    if (req.name === 'folder_list') { result = 'Contents ' + (a.path ? '«' + a.path + '»' : 'folder root') + ':\n' + await fsList(a.path, a.depth); op.state = 'ok'; }
    else if (req.name === 'folder_read') {
      const p = String(a.path || ''), cur = await fsRead(p); if (!cur) throw new Error('file not found: ' + p);
      if (cur.text == null) throw new Error('file is larger than 3 MB (' + kb(cur.file.size) + ') — cannot be read');
      if (isBin(cur.text)) throw new Error('this is not a text file (' + kb(cur.file.size) + ')');
      const lines = cur.text.split('\n'), s = Math.max(1, a.start_line | 0 || 1), e = Math.min(lines.length, a.end_line | 0 || lines.length);
      let body = lines.slice(s - 1, e).join('\n'), more = '';
      if (body.length > 120000) { body = body.slice(0, 120000); more = '\n…[truncated — read in chunks using start_line/end_line]'; }
      result = `File ${p} (${lines.length} lines, ${kb(cur.file.size)})${s > 1 || e < lines.length ? `, lines ${s}–${e}` : ''}:\n${body}${more}`; op.state = 'ok';
    } else if (req.name === 'folder_search') {
      const q = String(a.query || '').toLowerCase(); if (!q) throw new Error('empty request');
      const base = fsParts(a.path), d = base.length ? await fsDir(base) : FS.h, pre = base.length ? base.join('/') + '/' : '', hits = []; let files = 0;
      for await (const x of fsWalk(d, '')) {
        if (x.h.kind !== 'file' || hits.length >= 150 || files >= 3000) continue; files++;
        const f = await x.h.getFile(); if (f.size > 1e6) continue; const t = await f.text(); if (isBin(t) || !t.toLowerCase().includes(q)) continue;
        t.split('\n').forEach((l, i) => { if (hits.length < 150 && l.toLowerCase().includes(q)) hits.push(`${pre}${x.path}:${i + 1}: ${l.trim().slice(0, 200)}`); });
      }
      result = hits.length ? `Found (${hits.length}${hits.length >= 150 ? '+' : ''}):\n${hits.join('\n')}` : `«${a.query}» not found (files searched: ${files})`; op.state = 'ok';
    } else if (FS_WRITE.has(req.name)) {
      const plan = await fsPlan(req.name, a);
      Object.assign(op, { op: plan.op, path: plan.path, to: plan.to, diff: plan.diff, size: plan.size });
      const ok = FS.auto ? true : await new Promise((res) => { op.state = 'ask'; FS.wait.set(op.id, res); renderChat(); toBottom(); });
      if (ok === 'cancel') { op.state = 'no'; result = 'The user stopped the response — no changes were applied.'; }
      else if (!ok) { op.state = 'no'; result = `The user DENIED this change (${plan.path}) — it was not applied. Do not repeat it; ask what should be done differently.`; }
      else { await plan.apply(); FS.undo.set(op.id, plan.undo); op.state = 'ok'; result = `Done: ${plan.path}${plan.to ? ' → ' + plan.to : ''} ${RES[plan.op]}` + (plan.diff ? ` (+${plan.diff.add} −${plan.diff.del} lines)` : '') + '.'; }
    } else throw new Error('unknown tool');
  } catch (e) { const er = fsErr(e, op.path); op.state = 'err'; op.err = er.message; result = 'Error: ' + er.message; }
  FS.wait.delete(op.id); renderChat();
  try { await memApi('/api/chat/tool', { method: 'POST', body: JSON.stringify({ cid: req.cid, result }) }); } catch {}
}
// ответ остановлен — снимаем ожидающие подтверждения
function fsCancel(msg) { for (const op of msg?.fsops || []) if (op.state === 'ask' || op.state === 'run') { const w = FS.wait.get(op.id); if (w) w('cancel'); else op.state = 'no'; } }
function fsSummary(m) {
  const ch = (m.fsops || []).filter((o) => o.op); if (!ch.length) return '';
  return 'in folder: ' + ch.map((o) => `${o.state === 'ok' ? 'applied' : o.state === 'undone' ? 'cancelled by the user' : o.state === 'no' ? 'denied' : 'error'} — ${OPN[o.op].toLowerCase()} ${o.path}${o.to ? ' → ' + o.to : ''}`).join(', ');
}
function fsHtml(m) {
  if (!m.fsops?.length) return '';
  return `<div class="fsops">${m.fsops.map((o0) => {
    // после перезагрузки страницы ждать подтверждения уже некому — показываем как не применённое
    const o = (o0.state === 'ask' || o0.state === 'run') && !FS.wait.has(o0.id) && !m.live ? { ...o0, state: o0.op ? 'no' : 'err', err: o0.op ? '' : 'interrupted' } : o0;
    if (!o.op) { // чтение/просмотр/поиск — компактная строка
      const on = o.state === 'run', lbl = o.tool === 'folder_list' ? (on ? 'Browsing folder' : 'Browsed folder') + (o.path ? ' ' + o.path : '') : o.tool === 'folder_search' ? (on ? 'Searching' : 'Searched') + ' «' + o.path + '»' : (on ? 'Reading ' : 'Read ') + o.path;
      return `<div class="step${on ? ' on' : ''}${o.state === 'err' ? ' bad' : ''}"><svg><use href="#i-${o.state === 'err' ? 'warn' : o.tool === 'folder_search' ? 'search' : o.tool === 'folder_list' ? 'folder' : 'file'}"/></svg><span>${esc(o.state === 'err' ? 'Failed: ' + o.err : lbl)}</span></div>`;
    }
    const d = o.diff, st = { ask: '', ok: 'Applied', no: 'Denied', err: 'Error', undone: 'Cancelled', run: '' }[o.state];
    const body = d && d.rows.length ? `<div class="fsdiff">${d.rows.map(([t, l]) => `<div class="dl ${t === '+' ? 'add' : t === '-' ? 'del' : t === '…' ? 'gap' : ''}"><i>${t === '…' ? '⋯' : t}</i><span>${esc(l) || ' '}</span></div>`).join('')}${d.cut ? '<div class="dl gap"><i>⋯</i><span>the change is long — showing the beginning</span></div>' : ''}</div>`
      : o.op === 'delete' ? `<div class="fsnote">The file will be deleted (${kb(o.size || 0)})</div>` : o.op === 'rename' ? `<div class="fsnote">${esc(o.path)} → ${esc(o.to)}</div>` : '';
    const k = m.id + ':fs:' + o.id, open = o.state === 'ask' || OPEN.has(k);
    return `<details class="fsop ${o.state}" data-key="${k}"${open ? ' open' : ''}><summary><svg><use href="#i-${o.op === 'delete' ? 'trash' : 'edit'}"/></svg><b>${OPN[o.op]}</b><code>${esc(o.path)}${o.to ? ' → ' + esc(o.to) : ''}</code>${d ? `<span class="fsc"><em class="a">+${d.add}</em><em class="d">−${d.del}</em></span>` : ''}${st ? `<span class="fss">${st}</span>` : ''}</summary>
      ${body}${o.err ? `<div class="fsnote err">${esc(o.err)}</div>` : ''}
      ${o.state === 'ask' ? `<div class="fsbtns"><button type="button" class="btn" data-fsno="${o.id}">Deny</button><button type="button" class="btn pri" data-fsok="${o.id}">Apply</button></div>` : ''}
      ${o.state === 'ok' && FS.undo.has(o.id) ? `<div class="fsbtns"><button type="button" class="btn" data-fsundo="${o.id}">Undo</button></div>` : ''}</details>`;
  }).join('')}</div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-fsok],[data-fsno],[data-fsundo]'); if (!b) return; e.preventDefault();
  const id = b.dataset.fsok || b.dataset.fsno || b.dataset.fsundo;
  if (b.dataset.fsundo) {
    const u = FS.undo.get(id); if (!u) return; b.disabled = true;
    try { await u(); FS.undo.delete(id); for (const c of S.chats) for (const m of c.msgs) for (const o of m.fsops || []) if (o.id === id) o.state = 'undone'; save(); renderChat(); toast('Change undone'); }
    catch (err) { b.disabled = false; toast('Could not undo: ' + fsErr(err, '').message); }
    return;
  }
  const w = FS.wait.get(id); if (w) { b.closest('.fsbtns').querySelectorAll('button').forEach((x) => (x.disabled = true)); w(!!b.dataset.fsok); }
});
