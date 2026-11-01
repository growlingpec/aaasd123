// Premier — клиент: events (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.closest('.model')) $('menu').classList.remove('open');
  const del = t.closest('[data-del]');
  if (del) { e.stopPropagation(); if (confirm('Delete this chat?')) { S.chats = S.chats.filter((c) => c.id !== del.dataset.del); S.del.push(del.dataset.del); if (busyMap.has(del.dataset.del)) stop(del.dataset.del); if (S.cur === del.dataset.del) { closeArt(); S.cur = null; } save(); render(); } return; }
  const ps = t.closest('[data-pset]');
  if (ps) { e.stopPropagation(); projectModal(ps.dataset.pset); return; }
  const zi = t.closest('[data-zoom]');
  if (zi) { const w = window.open(); if (w) w.document.write('<body style="margin:0;background:#111;display:grid;place-items:center;min-height:100vh"><img src="' + zi.src + '" style="max-width:100%;max-height:100vh">'); return; }
  const b = t.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.versionView) { A.compareVersion=null;showArt(d.versionView,+d.vk,'preview',{inspect:true});return; }
  if (d.versionActivate) { activateVersion(d.versionActivate,+d.vk);return; }
  if (d.versionRollback!==undefined) { rollbackVersion();return; }
  if (d.zip) { downloadPack(d.zip, d.fmt); return; }
  if (d.speak) { speak(d.speak); return; }
  if (d.unpick !== undefined) { PICK = null; renderPick(); return; }
  if (d.delmem) { memApi('/api/memory/' + d.delmem, { method: 'DELETE' }).then(renderMem); return; }
  if (b.id === 'pPick') { setPicking(!picking); return; }
  if (b.id === 'micBtn') { toggleMic(); return; }
  if (b.id === 'meBtn') { openAccount(); return; }
  if (d.acc) { accTab(d.acc); return; }
  if (b.id === 'pcUp' || b.id === 'accPlans') { openPlans(); return; }
  if (b.id === 'pcRst' || b.id === 'accReset') { openReset(); return; }
  if (d.buy) { buyPlan(d.buy, b); return; }
  if (b.id === 'memClear') { if (confirm('Clear everything the model remembers about you?')) memApi('/api/memory', { method: 'DELETE' }).then(renderMem); return; }
  if (d.fdl) { e.preventDefault(); const f = getFiles(findMsg(d.fdl)?.t || '').find((x) => x.path === d.fp); if (f) saveBlob(new Blob([f.code], { type: 'text/plain;charset=utf-8' }), f.path.split('/').pop()); return; }
  if (d.rmatt) { PEND = PEND.filter((x) => x.id !== d.rmatt); renderAtts(); renderSend(); return; }
  if (b.id === 'attachBtn') { $('fileIn').click(); return; }
  if (b.id === 'fsBtn') { fsMenu(); return; }
  if (b.id === 'agBtn') { agMenu(); return; }
  if (b.id === 'webBtn') { S.web = !S.web; save(); renderSend(); toast(S.web ? 'Web search enabled — the model can search online' : 'Web search disabled'); return; }
  if (b.id === 'imgBtn') { S.img = !S.img; save(); renderSend(); toast(S.img ? 'Image mode on — image requests will be drawn' : 'Image mode off'); return; }
  if (b.id === 'pPub') { publishArt(); return; }
  if (d.pubupgrade !== undefined) { openPlans('Badge-free publications are available on an active Pro or Max plan, outside the trial period.'); return; }
  if (d.pubcopy !== undefined) { navigator.clipboard?.writeText(d.pubcopy); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1400); return; }
  if (d.unpub !== undefined) { unpublishArt(); return; }
  if (b.id === 'mbtn') { $('menu').classList.toggle('open'); const on = $('menu').querySelector('.opt.on'); if (on) on.scrollIntoView({ block: 'nearest' }); return; }
  if (b.id === 'logoutBtn') { fetch('/api/auth/logout', { method: 'POST' }).finally(toLogin); return; }
  if (d.art) { const [mid, k] = d.art.split(':'); if (A.open && A.mid === mid && A.k === +k) { closeArt(); return; } const a = getArts(findMsg(mid).t)[+k]; A.follow = !a.closed; showArt(mid, +k, a.closed ? 'preview' : 'code'); return; }
  if (d.tab) { A.tab = d.tab; paneUI(); return; }
  if (b.id === 'pClose') { closeArt(); return; }
  if (b.id === 'pReload') { A.shown = ''; A.tab = 'preview'; paneUI(); return; }
  if (b.id === 'pOpen') { const u = artBlobUrl(); if (u) window.open(u, '_blank'); return; }
  if (b.id === 'pDl') { const u = artBlobUrl(); if (!u) return; const l = document.createElement('a'); l.href = u; l.download = (curArt().title.replace(/[^\wа-яё -]/gi, '').trim() || 'site') + '.html'; l.click(); return; }
  if (b.id === 'pCopy') { navigator.clipboard?.writeText(curArt()?.code || ''); flash(b); return; }
  if (b.id === 'dclose') { closePanel(); return; }
  if (d.m) { $('menu').classList.remove('open'); const mm = MODELS.find((x) => x.id === d.m); if (mm && locked(mm)) { openPlans(`Model “${mm.name}» is available on the plan ${tierName(mm)}`); return; } S.model = d.m; }
  else if (d.p) { switchTo(() => { S.proj = S.proj === d.p ? null : d.p; S.cur = null; }); closeMobile(); save(); return; }
  else if (d.c) { if (d.c === S.cur) { closeMobile(); return; } switchTo(() => { S.cur = d.c; }); closeMobile(); save(); return; }
  else if (d.s) { send(d.s); return; }
  else if (d.copy !== undefined) { navigator.clipboard?.writeText(cur().msgs[+d.copy].t); flash(b); return; }
  else if (d.copycode !== undefined) { navigator.clipboard?.writeText(b.closest('.pre').querySelector('code').innerText); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1400); return; }
  else if (d.redo !== undefined) { const c = cur(); if (busyMap.has(c.id)) return; const i = +d.redo; c.msgs.splice(i); const a = { id: uid(), r: 'a', t: '' }; c.msgs.push(a); stream(c, a); return; }
  else if (d.edit !== undefined) { const c = cur(); if (busyMap.has(c.id)) return; const i = +d.edit, em = c.msgs[i]; $('q').value = em.t; PEND = [...(em.files || []).map((f) => ({ id: uid(), kind: 'file', ...f })), ...(em.images || []).map((u) => ({ id: uid(), kind: 'img', url: u }))]; renderAtts(); PICK = em.pick || null; renderPick(); c.msgs.splice(i); grow(); $('q').focus(); }
  else if (b.id === 'newChat') { switchTo(() => { S.cur = null; }); closeMobile(); save(); $('q').focus(); return; }
  else if (b.id === 'newProj') { projectModal(null); return; }
  else if (b.id === 'closeSide') { if (mobile()) closeMobile(); else S.side = false; }
  else if (b.id === 'openSide') { if (mobile()) { $('side').classList.add('mopen'); $('overlay').classList.add('on'); return; } S.side = true; }
  else return;
  save(); render();
});
$('modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closePanel(); });
$('overlay').onclick = closeMobile;
$('form').onsubmit = (e) => { e.preventDefault(); busyMap.has(S.cur) ? stop(S.cur) : send($('q').value); };
$('q').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busyMap.has(S.cur)) send($('q').value); } };
$('q').oninput = () => { grow(); renderSend(); };
$('find').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); renderSide(); };
addEventListener('resize', () => { renderSide(); grow(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('menu').classList.remove('open'); closeMobile(); if ($('modal').classList.contains('on')) closePanel(); else if (A.open && mobile()) closeArt(); } });
// карточка Telegram-канала: скрывается навсегда после закрытия или подписки
if (!localStorage.getItem('premier-tg-hidden')) $('tgCard').hidden = false;
const hideTg = () => { localStorage.setItem('premier-tg-hidden', '1'); $('tgCard').hidden = true; };
$('tgClose').onclick = hideTg; $('tgCard').querySelector('.tgsub').addEventListener('click', () => setTimeout(hideTg, 300));

document.addEventListener('change',e=>{if(e.target.id==='versionCompare'){A.compareVersion=e.target.value;renderVersions();}});
