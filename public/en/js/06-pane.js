// Premier — клиент: pane (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- artifact pane ---------- */
function findMsg(mid) { for (const c of S.chats) { const m = c.msgs.find((x) => x.id === mid); if (m) return m; } }
function curArt() { const m = A.mid && findMsg(A.mid); return m ? getArts(m.t)[A.k] : null; }
function paneUI() {
  const a = curArt(); if (!a) return;
  $('ptitle').textContent = a.title;
  document.querySelectorAll('.tabs button').forEach((b) => { const on=b.dataset.tab===A.tab;b.classList.toggle('on',on);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(on)); });
  const versions = A.tab === 'versions';
  $('pVersions').classList.toggle('hide', !versions);
  if (versions) renderVersions();
  const prev = A.tab === 'preview';
  $('pFrame').classList.toggle('hide', !prev || !a.closed);
  $('pWait').classList.toggle('hide', !prev || a.closed);
  $('pCode').classList.toggle('hide', prev || versions);
  if (!prev && !versions && $('pCode').textContent !== a.code) { const pc = $('pCode'), atEnd = pc.scrollHeight - pc.scrollTop - pc.clientHeight < 40; pc.textContent = a.code; if (A.follow && atEnd) pc.scrollTop = pc.scrollHeight; }
  if (prev && a.closed && A.shown !== a.code) { A.shown = a.code; const f = $('pFrame'), n = f.cloneNode(false); n.removeAttribute('srcdoc'); n.srcdoc = withPick(PremierAssets.rewrite(a.code, location.origin)); n.classList.remove('hide'); f.replaceWith(n); if (picking) setPicking(false); }
}
function showArt(mid, k, tab, { inspect = false } = {}) {
  const chat = S.chats.find((c) => c.msgs.some((m) => m.id === mid));
  const message = chat?.msgs.find((m) => m.id === mid);
  if (!inspect && message && (!message.validation || message.validation.status === 'passed') && !message.live && !message.err && !message.cancelled && PremierArtifact.extract(message.t)[k]?.valid) {
    chat.artifactRef = { mid, k }; save();
  }
  const changed = A.mid !== mid || A.k !== k;
  Object.assign(A, { open: true, mid, k, tab: tab || A.tab }); if (changed) A.shown = '';
  $('pane').classList.add('on'); paneUI(); renderPub();
  document.querySelectorAll('.art').forEach((b) => { const on = b.dataset.art === mid + ':' + k; b.classList.toggle('cur', on); b.querySelector('.art-go').textContent = on ? 'Opened' : 'Open'; });
}
function closeArt() { A.open = false; A.follow = false; A.mid = null; A.shown = ''; $('pane').classList.remove('on'); $('pFrame').srcdoc = ''; document.querySelectorAll('.art.cur').forEach((b) => { b.classList.remove('cur'); b.querySelector('.art-go').textContent = 'Open'; }); }
function followArt(msg) {
  const arts = getArts(msg.t); if (!arts.length) return;
  const k = arts.length - 1, a = arts[k];
  if (a.pack) { if (a.closed && A.follow && A.mid === msg.id) { A.follow = false; showArt(msg.id, k, 'preview'); } return; }
  if (!a.closed) { if (!(A.open && A.mid === msg.id && A.k === k)) { A.follow = true; showArt(msg.id, k, 'code'); } else paneUI(); }
  else if (A.follow && A.mid === msg.id && A.k === k) { A.follow = false; showArt(msg.id, k, 'preview'); }
}
function artBlobUrl() { const a = curArt(); return a ? URL.createObjectURL(new Blob([PremierAssets.rewrite(a.code, location.origin)], { type: 'text/html' })) : null; }

/* ---------- developer panel ---------- */
const dlgW = (w) => { const d = $('modal').querySelector('.dlg'); d.classList.toggle('wide', !!w); d.classList.remove('accdlg'); };
function closePanel() { $('modal').classList.remove('on'); }

/* ---------- non-destructive version history ---------- */
function versionChat(){return S.chats.find(c=>c.msgs.some(m=>m.id===A.mid));}
function renderVersions(){
  const c=versionChat(), versions=PremierVersions.list(c,PremierArtifact), selected=versions.find(v=>v.mid===A.mid&&v.k===A.k), previous=PremierVersions.previous(c,selected,PremierArtifact);
  if(!selected){$('pVersions').textContent='No completed version';return;}
  let compare=versions.find(v=>v.mid+':'+v.k===A.compareVersion)||previous;
  const state=v=>v.validation?(v.validation.status==='passed'?'verified':v.validation.status==='failed'?'check failed':'unverified'):'unchecked';
  const active=versions.find(v=>PremierVersions.same(v,c.artifactRef))||PremierArtifact.forChat(c);
  const changes=compare?PremierVersions.compare(compare,selected):[];
  $('pVersions').innerHTML=`<h3>Project versions</h3><p>Active base for the next edit: ${esc(active?.title||'not selected')}. Viewing it here does not change the active base.</p>
    <button data-version-rollback ${!PremierVersions.previous(c,active,PremierArtifact)||busyMap.has(c.id)?'disabled':''}>Restore the active version</button>
    <div>${versions.map((v,i)=>`<div class="version-row"><b>Version ${i+1} · ${esc(v.title)} ${PremierVersions.same(v,active)?'· active':''}</b><small>${esc(state(v))}</small><button data-version-view="${esc(v.mid)}" data-vk="${v.k}">View</button><button data-version-activate="${esc(v.mid)}" data-vk="${v.k}" ${busyMap.has(c.id)?'disabled':''}>Make active</button></div>`).join('')}</div>
    <h3>Changes in the selected version</h3><label>Compare with <select id="versionCompare"><option value="">Previous base</option>${versions.filter(v=>!PremierVersions.same(v,selected)).map((v,i)=>`<option value="${esc(v.mid+':'+v.k)}" ${PremierVersions.same(v,compare)?'selected':''}>${esc(v.title)} · ${esc(v.mid.slice(-6))}</option>`).join('')}</select></label>
    ${compare?`<p>${esc(compare.title)} → ${esc(selected.title)}</p>`:'<p>This is the first version — nothing to compare yet.</p>'}
    ${changes.slice(0,50).map(f=>`<details open><summary>${esc(f.path)} · +${f.added} / −${f.removed}${f.coarse?' · simplified comparison':''}</summary><pre class="diff-code">${f.rows.map(r=>`<span class="${r.kind==='+'?'diff-add':r.kind==='-'?'diff-remove':''}">${esc(r.kind+' '+r.text)}</span>`).join('\n')}</pre>${f.truncated?'<small>Showing the first 300 diff lines. Full source is available in the Code tab.</small>':''}</details>`).join('')}${changes.length>50?'<p>Showing the first 50 changed files.</p>':''}${compare&&!changes.length?'<p>The code is identical.</p>':''}`;
}
function activateVersion(mid,k,rollback=false){
  const c=versionChat(); if(!c||busyMap.has(c.id)){toast('Wait for generation to finish');return;}
  const target=PremierVersions.list(c,PremierArtifact).find(v=>v.mid===mid&&v.k===k);if(!target)return;
  const unverified=target.validation?.status!=='passed';
  if(!confirm((rollback?'Restore this version?':'Use this version as the base for future edits?')+(unverified?' Functionality has not been verified; this is a manual selection.':'')))return;
  try{PremierVersions.activate(c,target,PremierArtifact,{allowUnverified:unverified});save();A.compareVersion=null;showArt(mid,k,'preview',{inspect:true});toast(rollback?'Version restored. History has been preserved.':'Active version selected');}catch(e){toast(e.message);}
}
function rollbackVersion(){const c=versionChat(),active=PremierArtifact.forChat(c),previous=PremierVersions.previous(c,active,PremierArtifact);if(previous)activateVersion(previous.mid,previous.k,true);else toast('No previous version');}
