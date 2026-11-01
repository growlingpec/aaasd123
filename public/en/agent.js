/* ---------- Компьютер пользователя через программу-помощник Premier Agent ----------
   Помощник запускается на ПК и привязывается по коду. Модель предлагает действие (команду, запись файла…),
   пользователь жмёт «Разрешить» — и только тогда помощник его выполняет. Чтение и просмотр — без подтверждения. */
const AG = { on: true, conn: false, info: {}, auto: false, timer: 0 };
try { AG.on = localStorage.getItem('premier:agon') !== '0'; AG.auto = localStorage.getItem('premier:agauto') === '1'; } catch {}
const AG_LBL = { computer_run: 'Command', computer_list: 'Browsed folder', computer_read: 'Read file', computer_write: 'Write file', computer_edit: 'Edit file', computer_mkdir: 'New folder', computer_move: 'Move', computer_delete: 'Delete', computer_open: 'Open' };
const AG_IC = { computer_run: 'term', computer_list: 'folder', computer_read: 'file', computer_write: 'edit', computer_edit: 'edit', computer_mkdir: 'folder', computer_move: 'edit', computer_delete: 'trash', computer_open: 'ext' };
const agUsable = () => AG.on && AG.conn;
const agSave = () => { try { localStorage.setItem('premier:agon', AG.on ? '1' : '0'); localStorage.setItem('premier:agauto', AG.auto ? '1' : '0'); } catch {} };

async function agStatus() {
  clearTimeout(AG.timer);
  try {
    const j = await memApi('/api/agent/status'), was = AG.conn; AG.conn = !!j.connected; AG.info = j.info || {}; agRender();
    if (!was && AG.conn && $('agSetup')) { closePanel(); AG.on = true; agSave(); agRender(); toast('Computer “' + (AG.info.host || '') + '» connected — the model can work with it'); }
  } catch {}
  AG.timer = setTimeout(agStatus, $('agSetup') && $('modal').classList.contains('on') ? 2500 : 20000);
}
function agInit() { agRender(); agStatus(); document.addEventListener('visibilitychange', () => { if (!document.hidden) agStatus(); }); }
function agRender() {
  const b = $('agBtn'); if (!b) return; const on = agUsable();
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  b.querySelector('span').textContent = AG.conn ? (AG.info.host || 'Computer') : 'Computer';
  b.classList.toggle('dot', AG.conn);
  b.title = !AG.conn ? 'Give the model computer access through the companion app' : on ? 'The model can work with computer “' + (AG.info.host || '') + '»' : 'The companion is connected but disabled for this chat';
}
function agMenu() {
  if (!AG.conn) return agSetup();
  let m = $('agMenu'); if (m) { m.remove(); return; }
  m = document.createElement('div'); m.id = 'agMenu'; m.className = 'fsmenu';
  m.innerHTML = `<div class="fsm-h"><svg><use href="#i-term"/></svg><b>${esc(AG.info.host || 'Computer')}</b></div><div class="agm-sub">${esc(AG.info.os || '')}</div>
    <label class="fsm-ck"><input type="checkbox" id="agOn"${AG.on ? ' checked' : ''}><span>Use in chat</span></label>
    <label class="fsm-ck"><input type="checkbox" id="agAuto"${AG.auto ? ' checked' : ''}><span>Run without confirmation <em>(dangerous)</em></span></label>
    <button type="button" data-agm="help">How it works</button><button type="button" data-agm="off" class="danger">Disconnect computer</button>`;
  $('agBtn').parentElement.appendChild(m);
  m.onclick = async (e) => {
    const b = e.target.closest('[data-agm]'); if (!b) return; m.remove();
    if (b.dataset.agm === 'help') return agSetup(true);
    if (!confirm('Disconnect the companion? You will need a new code to connect again.')) return;
    try { await memApi('/api/agent/off', { method: 'POST' }); AG.conn = false; agRender(); toast('Computer disconnected'); } catch (er) { toast(er.message); }
  };
  $('agOn').onchange = (e) => { AG.on = e.target.checked; agSave(); agRender(); toast(AG.on ? 'The model can work with your computer' : 'Computer access is disabled for this chat'); };
  $('agAuto').onchange = (e) => {
    if (e.target.checked && !confirm('The model will be able to run commands and change files without confirmation. Enable this?')) { e.target.checked = false; return; }
    AG.auto = e.target.checked; agSave(); if (AG.auto) toast('Actions will run immediately — keep an eye on the chat');
  };
  setTimeout(() => document.addEventListener('click', function cl(e) { if (!e.target.closest('#agMenu,#agBtn')) { m.remove(); document.removeEventListener('click', cl); } }), 0);
}

// окно подключения: скачать помощник и ввести код
async function agSetup(help) {
  dlgW(false); $('dtitle').textContent = 'Computer access'; $('modal').classList.add('on');
  const win = /Win/i.test(navigator.platform || navigator.userAgent), mob = /Mobi|Android/i.test(navigator.userAgent);
  $('dbody').innerHTML = `<div class="agset" id="agSetup"><p class="agl">The model can run commands, create folders and files anywhere (including your desktop), and launch websites and games. <b>You confirm each action first</b> with the Allow button.</p>
    ${mob ? '<p class="agwarn">The companion app runs on your computer. Connect it there, then you can control it from your phone too.</p>' : ''}
    <div class="agtabs"><button type="button" data-agos="win" class="${win ? 'on' : ''}">Windows</button><button type="button" data-agos="nix" class="${win ? '' : 'on'}">macOS / Linux</button></div>
    <div id="agSteps"><div class="agwait">Getting a code…</div></div>
    <p class="agl dim">While the companion window is open, the model can work with your computer. Close it to revoke access. The companion blocks clearly dangerous commands such as formatting drives or deleting system folders.</p></div>`;
  let code = '', server = location.origin;
  try { const j = await memApi('/api/agent/code', { method: 'POST' }); code = j.code; server = j.server || server; } catch (e) { $('agSteps').innerHTML = `<div class="agwarn">${esc(e.message)}</div>`; return; }
  const os = () => $('dbody').querySelector('[data-agos].on')?.dataset.agos || 'win';
  const paint = () => {
    const el = $('agSteps'); if (!el) return;
    const nix = `curl -fsSL ${server}/premier-agent.js -o ~/premier-agent.js && node ~/premier-agent.js ${code}`;
    el.innerHTML = os() === 'win'
      ? `<ol class="agol"><li><a class="btn pri agdl" href="/premier-agent.cmd?code=${code}" download="Premier-Agent.cmd"><svg><use href="#i-dl"/></svg>Download Premier-Agent.cmd</a> and double-click to run it — Node.js is installed automatically if needed (1–3 minutes, Windows will ask for confirmation).<div class="dim agsm">If Windows shows “Windows protected your PC”, click “More info” → “Run anyway”.</div></li>
        <li>The code is already included in the file. If the companion asks for it: <span class="agcode">${code}</span></li></ol>`
      : `<ol class="agol"><li>Install <a href="https://nodejs.org/" target="_blank" rel="noopener">Node.js</a> 18+, if it is not installed yet.</li>
        <li>Open Terminal and run:<div class="agcmd"><code>${esc(nix)}</code><button type="button" class="ib" data-agcopy="${esc(nix)}" title="Copy" aria-label="Copy"><svg><use href="#i-copy"/></svg></button></div></li>
        <li>Code (if prompted): <span class="agcode">${code}</span></li></ol>`;
    el.insertAdjacentHTML('beforeend', `<div class="agwait"><i class="agspin"></i>Waiting for connection… The code is valid for 10 minutes</div>`);
  };
  paint();
  $('dbody').querySelectorAll('[data-agos]').forEach((b) => (b.onclick = () => { $('dbody').querySelectorAll('[data-agos]').forEach((x) => x.classList.toggle('on', x === b)); paint(); }));
  agStatus();
}

/* ---------- действия в сообщении ---------- */
function agHandle(o, msg) {
  (msg.agops ||= []).push({ id: o.cid, name: o.name, args: o.args || {}, write: !!o.write, state: o.ask ? 'ask' : 'run', ...(o.why ? { why: o.why } : {}) });
  msg.stepOn = false; renderChat(); toBottom();
}
function agResult(o, msg) {
  const op = (msg.agops || []).find((x) => x.id === o.cid); if (!op) return;
  op.state = o.state; if (o.out != null) op.out = String(o.out); renderChat(); if (o.state !== 'run') toBottom();
}
function agSummary(m) {
  const ch = (m.agops || []).filter((o) => o.write); if (!ch.length) return '';
  return 'on computer: ' + ch.map((o) => `${o.state === 'ok' ? 'completed' : o.state === 'no' ? 'denied by the user' : 'error/interrupted'} — ${AG_LBL[o.name] || o.name} ${String(o.args.command || o.args.path || o.args.target || o.args.from || '').slice(0, 120)}${o.state === 'err' && o.out ? ' (' + String(o.out).slice(0, 120) + ')' : ''}`).join(', ');
}
const agWhat = (o) => o.args.command || o.args.target || (o.args.from ? o.args.from + ' → ' + o.args.to : '') || o.args.path || '';
function agHtml(m) {
  if (!m.agops?.length) return '';
  return `<div class="fsops">${m.agops.map((o0) => {
    const o = (o0.state === 'ask' || o0.state === 'run') && !m.live ? { ...o0, state: o0.state === 'ask' ? 'no' : 'err', out: o0.out || 'interrupted' } : o0;
    if (!o.write) { // просмотр/чтение — компактная строка
      const on = o.state === 'run' || o.state === 'ask';
      return `<div class="step${on ? ' on' : ''}${o.state === 'err' ? ' bad' : ''}"><svg><use href="#i-${o.state === 'err' ? 'warn' : AG_IC[o.name]}"/></svg><span>${esc(o.state === 'err' ? 'Failed: ' + (o.out || '').replace(/^Ошибка:\s*/, '') : (on ? (o.name === 'computer_list' ? 'Browsing folder ' : 'Reading ') : AG_LBL[o.name] + ' ') + (o.args.path || ''))}</span></div>`;
    }
    const st = { ask: 'Awaiting permission', run: 'Running…', ok: 'Completed', no: 'Denied', err: 'Error' }[o.state];
    const c = o.args.content ?? (o.name === 'computer_edit' ? null : undefined);
    const body = o.name === 'computer_edit' ? `<div class="fsdiff">${String(o.args.old || '').split('\n').slice(0, 60).map((l) => `<div class="dl del"><i>-</i><span>${esc(l) || ' '}</span></div>`).join('')}${String(o.args.new || '').split('\n').slice(0, 60).map((l) => `<div class="dl add"><i>+</i><span>${esc(l) || ' '}</span></div>`).join('')}</div>`
      : c != null ? `<pre class="agpre">${esc(String(c).slice(0, 6000))}${String(c).length > 6000 ? '\n…' : ''}</pre>` : '';
    const k = m.id + ':ag:' + o.id, open = o.state === 'ask' || OPEN.has(k) || (o.name === 'computer_run' && o.state !== 'ask' && o.out != null && OPEN.has(k));
    const outB = o.out != null && o.state !== 'ask' && o.state !== 'run' ? `<pre class="agpre agout${o.state === 'err' ? ' err' : ''}">${esc(o.out)}</pre>` : '';
    return `<details class="fsop agop ${o.state}${o.name === 'computer_delete' ? ' agdanger' : ''}" data-key="${k}"${open ? ' open' : ''}><summary><svg><use href="#i-${AG_IC[o.name]}"/></svg><b>${AG_LBL[o.name]}</b><code>${esc(agWhat(o))}</code>${o.args.cwd ? `<span class="fsc dim">in ${esc(o.args.cwd)}</span>` : ''}<span class="fss">${st}</span></summary>
      ${body}${outB}
      ${o.state === 'ask' && o.why === 'web' ? `<div class="agwarn agsm">Automatic mode paused: the model read web pages in this response, and their text may have suggested an untrusted command. Review this action.</div>` : ''}
      ${o.state === 'ask' ? `<div class="fsbtns"><button type="button" class="btn" data-agno="${o.id}">Deny</button><button type="button" class="btn pri" data-agok="${o.id}">Allow</button></div>` : ''}</details>`;
  }).join('')}</div>`;
}
document.addEventListener('click', async (e) => {
  const cp = e.target.closest('[data-agcopy]'); if (cp) { navigator.clipboard?.writeText(cp.dataset.agcopy); toast('Copied'); return; }
  const b = e.target.closest('[data-agok],[data-agno]'); if (!b) return; e.preventDefault();
  const id = b.dataset.agok || b.dataset.agno, ok = !!b.dataset.agok;
  b.closest('.fsbtns').querySelectorAll('button').forEach((x) => (x.disabled = true));
  try { await memApi('/api/chat/agent', { method: 'POST', body: JSON.stringify({ cid: id, ok }) }); }
  catch (er) { toast('Failed: ' + er.message); b.closest('.fsbtns').querySelectorAll('button').forEach((x) => (x.disabled = false)); return; }
  for (const c of S.chats) for (const m of c.msgs) for (const o of m.agops || []) if (o.id === id && o.state === 'ask') o.state = ok ? 'run' : 'no';
  renderChat();
});