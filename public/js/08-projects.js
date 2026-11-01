// Premier — клиент: projects (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- project settings ---------- */
function projectModal(pid) {
  dlgW(false);
  const p = pid ? S.projects.find((x) => x.id === pid) : null;
  $('dtitle').textContent = p ? 'Настройки проекта' : 'Новый проект';
  $('dbody').innerHTML = `<form id="projF">
    <label class="field"><span>Название</span><input name="name" required maxlength="60" value="${esc(p?.name || '')}" placeholder="Например, Маркетинг"></label>
    <label class="field"><span>Инструкции для модели</span><textarea name="instructions" maxlength="6000" placeholder="Например: ты маркетолог в кофейне «Утро». Отвечай кратко, по-дружески, предлагай идеи для соцсетей.">${esc(p?.instructions || '')}</textarea><small>Модель будет учитывать их во всех чатах этого проекта.</small></label>
    <div class="btns">${p ? '<button type="button" class="btn danger" id="projDel">Удалить проект</button><div class="sp"></div>' : ''}<button type="button" class="btn" id="projCancel">Отмена</button><button class="btn pri">${p ? 'Сохранить' : 'Создать'}</button></div></form>`;
  $('modal').classList.add('on'); setTimeout(() => $('projF').querySelector('[name=name]').focus(), 50);
  $('projCancel').onclick = closePanel;
  if (p) $('projDel').onclick = () => {
    if (!confirm(`Удалить проект «${p.name}»? Чаты останутся в «Недавних».`)) return;
    S.projects = S.projects.filter((x) => x !== p); S.chats.forEach((c) => { if (c.proj === p.id) c.proj = null; });
    if (S.proj === p.id) S.proj = null; save(); closePanel(); render();
  };
  $('projF').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target), name = f.get('name').trim(), instructions = f.get('instructions').trim();
    if (!name) return;
    if (p) Object.assign(p, { name, instructions }); else { const np = { id: uid(), name, instructions }; S.projects.push(np); S.proj = np.id; S.cur = null; }
    save(); closePanel(); render(); toast(p ? 'Проект сохранён' : 'Проект создан');
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
  const upgrade = branded ? `<div class="pub-upgrade"><span>На Free и в пробном периоде публикации — с плашкой Premier.</span><button type="button" data-pubupgrade>Убрать плашку — ${esc(pro?.name || 'Pro')}${pro?.price ? ' за ' + esc(String(pro.price)) + ' ₽' : ''}</button></div>` : '';
  pb.innerHTML = `<span>Опубликовано:</span><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a><button data-pubcopy="${esc(url)}">Копировать</button><button data-unpub>Снять</button>${upgrade}`;
}
async function publishArt() {
  const a = curArt(), m = A.mid && findMsg(A.mid); if (!a || !a.closed || !m) return;
  if (m.pubs?.[A.k]) { renderPub(); return; }
  try {
    const r = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: a.code, title: a.title }) });
    if (r.status === 401) return toLogin();
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
    (m.pubs ||= {})[A.k] = { id: j.id, path: j.path, key: j.key, branding: j.branding }; save(); renderPub();
    navigator.clipboard?.writeText(location.origin + j.path).catch(() => {}); toast('Сайт опубликован, ссылка скопирована');
  } catch (e) { toast(e.message); }
}
async function unpublishArt() {
  const m = A.mid && findMsg(A.mid), pub = pubOf(); if (!pub) return;
  if (!confirm('Снять сайт с публикации? Ссылка перестанет работать.')) return;
  try { await fetch('/api/publish/' + pub.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: pub.key }) }); } catch {}
  delete m.pubs[A.k]; save(); renderPub(); toast('Публикация снята');
}
