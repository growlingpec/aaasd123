// Premier — клиент: chat (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- models ---------- */
async function loadModels() {
  try { MODELS = await (await fetch('/api/models')).json(); } catch { MODELS = []; }
  try { CFG = await (await fetch('/api/config')).json(); } catch { CFG = { search: false }; }
  pickModel();
  save(); render();
}

/* ---------- chat ---------- */
// Сервер держит генерацию после ухода клиента (телефон в фон, вкладка закрыта):
// до 10 минут без подписчиков и 30 минут после завершения. Если вкладку закрыли
// на середине ответа, при следующем входе добираем его через /api/chat/resume.
const PENDING_TTL = 30 * 60000;
function findPending() {
  if (anyBusy()) return null;
  let best = null;
  for (const c of S.chats) for (const m of c.msgs) {
    if (m.r === 'a' && m.pendingGen && !m.err && !m.cancelled && Date.now() - m.pendingGen < PENDING_TTL) {
      if (!best || m.pendingGen > best.m.pendingGen) best = { c, m };
    }
  }
  return best;
}
function startPendingResume() {
  const f = findPending(); if (!f) return;
  if (S.cur !== f.c.id) { S.cur = f.c.id; persistLocal(); }
  render();
  stream(f.c, f.m, true);
}
async function tryResume(msg, from, handle, ra) {
  let saved = false;
  for (let i = 0; i < 45 && msg.live && !saved; i++) {
    if (ra.signal.aborted) break;
    try {
      const rr = await fetch('/api/chat/resume?g=' + encodeURIComponent(msg.id) + '&from=' + from, { signal: ra.signal });
      if (rr.ok && rr.body) {
        saved = true;
        const rd = rr.body.getReader(), dec2 = new TextDecoder();
        let buf2 = '';
        for (;;) {
          if (ra.signal.aborted) { try { rd.cancel(); } catch {} break; }
          const { done, value } = await rd.read(); if (done) break;
          buf2 += dec2.decode(value, { stream: true });
          const ls = buf2.split('\n'); buf2 = ls.pop();
          for (const line of ls) { if (!line.trim()) continue; let o2; try { o2 = JSON.parse(line); } catch { continue; } handle(o2); }
        }
        break;
      }
      if (rr.status === 404) break;
    } catch (e2) { if (e2.name === 'AbortError') break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return saved;
}
async function stream(c, msg, resumed) {
  const model = curModel();
  if (!model && !resumed) { msg.err = 'No model selected.'; delete msg.pendingGen; save(); render(); return; }
  const pinned = PremierArtifact.forChat(c, msg.id);
  msg.artifactParent = pinned ? { mid: pinned.mid, k: pinned.k } : null;
  msg.m = resumed ? (msg.m || (model && model.name) || '') : model.name;
  msg.live = true; msg.thinking = true; msg.t = '';
  delete msg.err; delete msg.cancelled; delete msg.diag; delete msg.validation; delete msg.steps; delete msg.sources; delete msg.think; delete msg.thinkMs; delete msg.runs; delete msg.gens; delete msg.vids; delete msg.assets; delete msg.vprog; delete msg.drawAt; delete msg.fsops; delete msg.agops;
  msg.stepOn = false;
  msg.pendingGen = resumed ? (msg.pendingGen || Date.now()) : Date.now();
  liveMap.set(c.id, msg);
  const history = resumed ? [] : buildHistory(c.msgs.filter((x) => x !== msg && !x.err && !x.cancelled && (x.t || x.files?.length || x.images?.length || x.agops?.length || x.fsops?.length))).slice(-40);
  // Старые большие версии не должны раздувать транспорт. Последнее сообщение
  // пользователя не обрезаем; закреплённый исходник передаётся отдельно.
  while (history.length > 1 && JSON.stringify(history).length > 8 * 1024 * 1024) history.shift();
  const proj = S.projects.find((p) => p.id === c.proj);
  const ac = new AbortController(); busyMap.set(c.id, ac);
  let thinkAt = 0; // Нужен и после try: ответ только с reasoning не должен ломать завершение.
  let first = true, pending = false;
  let raw = '', srvThink = '', inThink = '', applied = 0;
  const setThink = () => { const t = srvThink + (inThink ? (srvThink ? '\n' : '') + inThink : ''); if (t) { msg.think = t; thinkAt ||= Date.now(); } };
  const tb = () => { if (c.id === S.cur) toBottom(); };
  const paint = () => {
    pending = false;
    if (!msg.live || c.id !== S.cur) return; // ответ закончился или чат в фоне — его DOM сейчас не отображается, скролл не трогаем
    const ch = $('chat'), near = ch.scrollHeight - ch.scrollTop - ch.clientHeight < 80;
    const el = document.querySelector(`[data-id="${msg.id}"] .md`);
    if (el) el.innerHTML = md(msg.t, msg.id) + (msg.t ? '<span class="cursor"></span>' : '');
    const tb = document.querySelector(`[data-id="${msg.id}"] .think-b`);
    if (msg.think && !tb) renderChat(); else if (tb && tb.textContent !== msg.think.trim()) { const atEnd = tb.scrollHeight - tb.scrollTop - tb.clientHeight < 30; tb.textContent = msg.think.trim(); if (atEnd) tb.scrollTop = tb.scrollHeight; }
    followArt(msg);
    if (near) toBottom();
  };
  const handle = (o) => { applied++; msg.lastAt = Date.now();
    if (o.reset) {
      raw = ''; inThink = ''; msg.t = ''; first = true;
      if (A.mid === msg.id) closeArt();
      renderChat();
    } else if (o.t) {
      raw += o.t;
      const tm = raw.match(/^\s*think([\s\S]*?)(<\/think>\s*|$)/);
      if (tm) { inThink = tm[1]; msg.t = tm[2] ? raw.slice(tm[0].length) : ''; setThink(); }
      else msg.t = raw.trim() && 'think'.startsWith(raw.trimStart()) ? '' : raw;
      if (msg.t && msg.think && !msg.thinkMs) { msg.thinkMs = Date.now() - thinkAt; renderChat(); }
      if ((first && msg.t) || (msg.stepOn && msg.t)) { first = false; msg.thinking = false; msg.stepOn = false; renderChat(); }
      if (!pending) { pending = true; requestAnimationFrame(paint); }
    } else if (o.r) {
      srvThink += o.r; setThink(); msg.thinking = false;
      if (!pending) { pending = true; requestAnimationFrame(paint); }
    } else if (o.fs) {
      fsHandle(o.fs, msg);
    } else if (o.ag) { agHandle(o.ag, msg);
    } else if (o.agres) { agResult(o.agres, msg);
    } else if (o.asset) {
      (msg.assets ||= []).push(o.asset); msg.stepOn = false; renderChat(); tb();
    } else if (o.img) {
      (msg.gens ||= []).push(o.img); msg.stepOn = false; delete msg.drawAt; renderChat(); tb();
    } else if (o.vid) {
      (msg.vids ||= []).push(o.vid); msg.stepOn = false; delete msg.drawAt; delete msg.vprog; renderChat(); tb();
    } else if (o.vp != null) {
      msg.vprog = o.vp; const b = document.querySelector('.gen.draw .dbar i'); if (b) b.style.width = Math.max(3, o.vp) + '%';
    } else if (o.run) {
      (msg.runs ||= []).push(o.run); msg.stepOn = false; renderChat(); tb();
    } else if (o.s === 'ok') { const ch = (msg.steps || []).filter((x) => x.s === 'check').pop(); if (ch) ch.ok = true; msg.stepOn = false; renderChat(); }     else if (o.s) { (msg.steps ||= []).push({ s: o.s, q: o.q }); msg.stepOn = o.s !== 'fail'; renderChat(); tb(); }
    else if (o.src) msg.sources = o.src;
    else if (o.bill) { BILL = o.bill; renderPlan(); }
    else if (o.validation) { msg.validation = o.validation; renderChat(); }
    else if (o.diag) msg.diag = o.diag;
    else if (o.e) msg.err = o.e; // Дочитываем bill/diag после ошибки.
  };
  render(); if (c.id === S.cur) toBottom();
  const folderInfo = resumed ? null : await fsInfo();
  let saved = false;
  try {
    if (resumed) {
      const ra0 = new AbortController(); resumeMap.set(c.id, ra0);
      saved = await tryResume(msg, 0, handle, ra0);
      resumeMap.delete(c.id);
      if (saved) {
        msg._resumed = true;
        if (!msg.t && !(msg.gens || []).length && !(msg.vids || []).length) { msg.cancelled = true; msg.t = 'Generation stopped.'; }
        else if (msg.live) toast('Connection restored');
      } else {
        msg.err = 'Connection dropped — the answer did not finish. Press "Retry" to generate it again.';
      }
    } else {
      const r = await fetch('/api/chat', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: model.id, messages: history, instructions: proj?.instructions || '', web: !!(S.web && CFG.search), img: !!S.img, mid: msg.id,
        ...(pinned ? { currentArtifact: { source: pinned.source } } : {}),
        ...(folderInfo ? { folder: folderInfo } : {}), ...(agUsable() ? { agent: true, agentAuto: AG.auto } : {}),
      }) });
      if (r.status === 401) return toLogin();
      if (!r.ok) { const j = await r.json().catch(() => ({})); if (j.code === 'limit' || j.code === 'model') { setTimeout(() => openPlans(j.error), 300); loadBill(); } throw new Error(j.error || 'Server error ' + r.status); }
      const reader = r.body.getReader(), dec = new TextDecoder();
      const ndjson = (r.headers.get('content-type') || '').includes('ndjson');
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        const chunk = dec.decode(value, { stream: true });
        if (!ndjson) { handle({ t: chunk }); continue; }
        buf += chunk;
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } handle(o); }
      }
      if (!msg.err && !msg.t && !msg.gens?.length && !msg.vids?.length && !msg.fsops?.some((o) => o.op) && !msg.agops?.some((o) => o.write)) msg.err = 'The model returned an empty response.';
    }
  } catch (e) {
    if (!resumed && msg.live && msg.id && (e.name !== 'AbortError' || msg.stale === true)) {
      const ra2 = new AbortController(); resumeMap.set(c.id, ra2);
      saved = await tryResume(msg, applied, handle, ra2);
      resumeMap.delete(c.id);
      if (saved) { msg._resumed = true; if (!msg.t && !(msg.gens || []).length && !(msg.vids || []).length) { msg.cancelled = true; msg.t = 'Generation stopped.'; } else if (msg.live) toast('Connection restored'); }
    }
    if (!saved) {
      msg.stale = false;
      if (!resumed && ac.signal.aborted) { msg.cancelled = true; if (!msg.t) msg.t = 'Generation stopped.'; }
      else if (!resumed) { const mid = !!(msg.t || (msg.steps || []).length || msg.gens?.length || msg.vids?.length); msg.err = mid ? 'Connection dropped — the answer did not finish. Press "Retry" to generate it again.' : (/Failed to fetch|network/i.test(e.message || '') ? 'Could not connect to the server — check your network and press "Retry".' : (e.message || 'Could not get a response.')); }
    }
  }
  fsCancel(msg); busyMap.delete(c.id); liveMap.delete(c.id); msg.live = false; msg.thinking = false; msg.stepOn = false; delete msg.pendingGen;
  if (!msg.err && !msg.cancelled && (!ac.signal.aborted || msg._resumed === true) && (!msg.validation || msg.validation.status === 'passed')) {
    const versions = PremierArtifact.extract(msg.t);
    for (let k = versions.length - 1; k >= 0; k--) {
      if (versions[k].valid) {
        c.artifactRef = { mid: msg.id, k };
        if (msg.diag?.artifactMode === 'edit' && S.cur === c.id) showArt(msg.id, k, 'preview');
        break;
      }
    }
  }
  if (msg.think && !msg.thinkMs && thinkAt) msg.thinkMs = Date.now() - thinkAt;
  if (A.follow && A.mid === msg.id) { A.follow = false; const a = getArts(msg.t)[A.k]; if (a) showArt(msg.id, A.k, 'preview', { inspect: !!msg.validation && msg.validation.status !== 'passed' }); }
  save(); render();
}
function stop(chatId) {
  const cid = chatId || S.cur, lm = liveMap.get(cid);
  if (lm && lm.id) { try { fetch('/api/chat/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid: lm.id }) }); } catch {} }
  const ac = busyMap.get(cid); if (ac) ac.abort();
  const ra = resumeMap.get(cid); if (ra) { try { ra.abort(); } catch {} resumeMap.delete(cid); }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) for (const [cid, lm] of liveMap) if (lm.live && Date.now() - (lm.lastAt || 0) > 60000) { lm.stale = true; const ac = busyMap.get(cid); if (ac) ac.abort(); }
});
window.addEventListener('online', () => {
  for (const [cid, lm] of liveMap) if (lm.live && Date.now() - (lm.lastAt || 0) > 30000) { lm.stale = true; const ac = busyMap.get(cid); if (ac) ac.abort(); }
});
function send(t) {
  t = t.trim();
  const files = PEND.filter((x) => x.kind === 'file' && x.text != null), images = PEND.filter((x) => x.kind === 'img' && x.url);
  if ((!t && !files.length && !images.length) || busyMap.has(S.cur) || !MODELS.length) return;
  if (PEND.some((x) => x.loading)) { toast('Please wait while files are being read'); return; }
  if (images.length && !curModel()?.vision) { toast('This model does not support images — choose another one'); return; }
  const cm = curModel();
  if (cm && locked(cm)) { openPlans(`Model “${cm.name}” is available on the plan ${tierName(cm)}. Choose another model or upgrade your plan.`); return; }
  if (BILL && BILL.limits.m != null && BILL.used.m + (cm?.weight || 1) > BILL.limits.m) { openPlans(BILL.unlimited ? 'Daily limit reached. It resets at midnight Moscow time.' : `You have used today’s messages (${BILL.plan.name}: ${BILL.limits.m} per day). The limit resets at midnight Moscow time — or upgrade your plan now.`); return; }
  let c = cur();
  const title = t || files[0]?.name || 'Image';
  if (!c) { c = { id: uid(), title: title.length > 42 ? title.slice(0, 42) + '…' : title, proj: S.proj, msgs: [] }; S.chats.unshift(c); S.cur = c.id; }
  const um = { id: uid(), r: 'u', t };
  if (files.length) um.files = files.map((f) => ({ name: f.name, size: f.size, text: f.text }));
  if (images.length) um.images = images.map((x) => x.url);
  if (PICK) { um.pick = PICK; PICK = null; renderPick(); }
  if (rec) rec.stop();
  c.msgs.push(um); PEND = []; renderAtts();
  const a = { id: uid(), r: 'a', t: '' }; c.msgs.push(a);
  $('q').value = ''; grow(); save(); stream(c, a);
}
function grow() {
  const q = $('q'), m = $('mirror'); m.style.width = q.clientWidth + 'px'; m.style.font = getComputedStyle(q).font; m.textContent = q.value + ' ';
  const h = Math.max(26, Math.min(200, m.scrollHeight)); q.style.height = h + 'px'; q.style.overflowY = m.scrollHeight > 200 ? 'auto' : 'hidden';
}
function switchTo(fn) {
  const col = $('col'); closeArt(); col.classList.add('fade'); fn(); renderSide(); renderTop();
  setTimeout(() => { markSeen(); renderChat(); renderSend(); toBottom(); col.classList.remove('fade'); }, 150);
}
function closeMobile() { $('side').classList.remove('mopen'); $('overlay').classList.remove('on'); }
function flash(b) { b.innerHTML = '<svg class="pop"><use href="#i-check"/></svg>'; setTimeout(() => (b.innerHTML = '<svg class="pop"><use href="#i-copy"/></svg>'), 1200); }
