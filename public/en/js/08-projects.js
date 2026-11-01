// Premier — клиент: projects (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- project settings ---------- */
function projectModal(pid) {
  dlgW(false);
  const p = pid ? S.projects.find((x) => x.id === pid) : null;
  $('dtitle').textContent = p ? 'Project settings' : 'New project';
  $('dbody').innerHTML = `<form id="projF">
    <label class="field"><span>Name</span><input name="name" required maxlength="60" value="${esc(p?.name || '')}" placeholder="For example, Marketing"></label>
    <label class="field"><span>Instructions for the model</span><textarea name="instructions" maxlength="6000" placeholder="For example: you are a marketer for the Morning coffee shop. Keep replies short and friendly, and suggest social media ideas.">${esc(p?.instructions || '')}</textarea><small>The model will use these instructions in every chat in this project.</small></label>
    <div class="btns">${p ? '<button type="button" class="btn danger" id="projDel">Delete project</button><div class="sp"></div>' : ''}<button type="button" class="btn" id="projCancel">Cancel</button><button class="btn pri">${p ? 'Save' : 'Create'}</button></div></form>`;
  $('modal').classList.add('on'); setTimeout(() => $('projF').querySelector('[name=name]').focus(), 50);
  $('projCancel').onclick = closePanel;
  if (p) $('projDel').onclick = () => {
    if (!confirm(`Delete project “${p.name}»? Chats will remain in Recent.`)) return;
    S.projects = S.projects.filter((x) => x !== p); S.chats.forEach((c) => { if (c.proj === p.id) c.proj = null; });
    if (S.proj === p.id) S.proj = null; save(); closePanel(); render();
  };
  $('projF').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target), name = f.get('name').trim(), instructions = f.get('instructions').trim();
    if (!name) return;
    if (p) Object.assign(p, { name, instructions }); else { const np = { id: uid(), name, instructions }; S.projects.push(np); S.proj = np.id; S.cur = null; }
    save(); closePanel(); render(); toast(p ? 'Project saved' : 'Project created');
  };
}

/* ---------- publish ---------- */
function pubOf() { const m = A.mid && findMsg(A.mid); return m?.pubs?.[A.k] || null; }
function renderPub() {
  const pb = $('pubbar'), pub = pubOf(), a = curArt();
  $('pPub').hidden = !a || !a.closed;
  if (!pub) { pb.hidden = true; return; }
  const url = location.origin + pub.path;
  pb.hidden = false;
  const branded = BILL ? BILL.publicationBranding !== false : pub.branding !== false;
  const pro = BILL?.plans.find(p => p.id === 'pro');
  const upgrade = branded ? `<div class="pub-upgrade"><span>Free and trial publications include the Premier badge.</span><button type="button" data-pubupgrade>Remove the badge — ${esc(pro?.name || 'Pro')}${pro?.price ? ' for ' + esc(String(pro.price)) + ' ₽' : ''}</button></div>` : '';
  pb.innerHTML = `<span>Published:</span><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a><button data-pubcopy="${esc(url)}">Copy</button><button data-unpub>Unpublish</button>${upgrade}`;
}
async function publishArt() {
  const a = curArt(), m = A.mid && findMsg(A.mid); if (!a || !a.closed || !m) return;
  if (m.pubs?.[A.k]) { renderPub(); return; }
  try {
    const r = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: a.code, title: a.title }) });
    if (r.status === 401) return toLogin();
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    (m.pubs ||= {})[A.k] = { id: j.id, path: j.path, key: j.key, branding: j.branding }; save(); renderPub();
    navigator.clipboard?.writeText(location.origin + j.path).catch(() => {}); toast('Website published, link copied');
  } catch (e) { toast(e.message); }
}
async function unpublishArt() {
  const m = A.mid && findMsg(A.mid), pub = pubOf(); if (!pub) return;
  if (!confirm('Unpublish this website? The link will stop working.')) return;
  try { await fetch('/api/publish/' + pub.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: pub.key }) }); } catch {}
  delete m.pubs[A.k]; save(); renderPub(); toast('Publication removed');
}
