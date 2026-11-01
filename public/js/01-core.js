// Premier — клиент
let MODELS = [], CFG = { search: false }, VOICES = [];
const ME = window.ME || { id: 'guest', login: 'Гость' };
function fpHash() { try { const s = [navigator.userAgent, Intl.DateTimeFormat().resolvedOptions().timeZone || '', screen.width + 'x' + screen.height, navigator.language || ''].join('|'); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); } catch { return ''; } }
const KEY = 'premier-v4:' + ME.id;
// старые чаты (до появления аккаунтов) достаются первому вошедшему в этом браузере
if (!localStorage.getItem(KEY) && localStorage.getItem('premier-v4')) { localStorage.setItem(KEY, localStorage.getItem('premier-v4')); localStorage.removeItem('premier-v4'); }
const toLogin = () => location.replace('/login');
const FRESH = !localStorage.getItem(KEY); // новое устройство: настройки (проекты и т. п.) берём с сервера
const S = JSON.parse(localStorage.getItem(KEY) || 'null') || { projects: [{ id: 'p1', name: 'Работа' }, { id: 'p2', name: 'Учёба' }], chats: [], cur: null, proj: null, model: null, side: true };
S.del ||= [];
/* ---------- синхронизация с сервером: чаты одинаковые на всех устройствах ----------
   Отправляются только изменённые чаты (сверка по хэшу), сервер хранит версию каждого чата.
   SYNC.rev — последняя полученная ревизия, SYNC.sent — хэши чатов в том виде, в каком их знает сервер. */
let saveWarned = false, pushT = null, pushing = false;
const persistLocal = () => {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { if (!saveWarned) { saveWarned = true; toast('Память браузера заполнена — чаты всё равно сохраняются на сервере'); } }
  try { localStorage.setItem(KEY + ':sync', JSON.stringify(SYNC)); } catch {}
};
const save = () => { persistLocal(); clearTimeout(pushT); pushT = setTimeout(push, 1200); };
const TRANSIENT = new Set(['live', 'thinking', 'stepOn', 'pendingGen']);
const clean = (x) => JSON.stringify(x, (k, v) => TRANSIENT.has(k) ? undefined : v);
const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + ':' + s.length; };
// «мета» — всё, кроме чатов и настроек этого устройства (открытый чат, проект, боковая панель)
const LOCAL_KEYS = new Set(['chats', 'cur', 'proj', 'side']);
const metaOf = () => { const m = {}; for (const k of Object.keys(S)) if (!LOCAL_KEYS.has(k)) m[k] = S[k]; m.order = S.chats.map((c) => c.id); return m; };
const SYNC = (() => { const x = JSON.parse(localStorage.getItem(KEY + ':sync') || 'null'); return x && x.sent ? x : { rev: 0, sent: {}, metaSent: '', fresh: FRESH }; })();
const weight = (c) => c.msgs.length * 1e7 + c.msgs.reduce((n, m) => n + (m.t || '').length, 0);
// применить изменения с сервера { rev, meta, chats: [{ id, v, data }] }; возвращает true, если что-то поменялось
function applyRemote(j) {
  let changed = false; const del = new Set(S.del);
  for (const x of j.chats || []) {
    const i = S.chats.findIndex((c) => c.id === x.id), loc = S.chats[i];
    if (!x.data) { // удалён на другом устройстве
      delete SYNC.sent[x.id]; if (!del.has(x.id)) { S.del.push(x.id); del.add(x.id); }
      if (loc) { S.chats.splice(i, 1); changed = true; }
      continue;
    }
    const h = hash(clean(x.data));
    if (!loc) { if (!del.has(x.id)) { S.chats.unshift(x.data); SYNC.sent[x.id] = h; changed = true; } continue; }
    const lh = hash(clean(loc)), known = SYNC.sent[x.id];
    if (h === lh) SYNC.sent[x.id] = h; // одинаковые
    else if (h === known) {} // на сервере то, что мы уже знаем, — локальная правка уйдёт следующей отправкой
    else if (lh === known || weight(x.data) > weight(loc)) { S.chats[i] = x.data; SYNC.sent[x.id] = h; changed = true; } // у нас без правок — берём серверный; иначе конфликт: остаётся более полный
    else SYNC.sent[x.id] = h; // конфликт, оставляем свой — он перезапишет серверный
  }
  const M = j.meta;
  if (M && JSON.stringify(M) !== SYNC.metaSent) {
    const mine = SYNC.fresh || JSON.stringify(metaOf()) === SYNC.metaSent; // локально мету не меняли (или это новое устройство)
    const rdel = new Set(M.del || []);
    if (mine) { for (const k of Object.keys(S)) if (!LOCAL_KEYS.has(k)) delete S[k]; for (const k of Object.keys(M)) if (k !== 'order' && !LOCAL_KEYS.has(k)) S[k] = M[k]; }
    else { // правили на обоих устройствах — объединяем
      const pids = new Set(S.projects.map((x) => x.id)); S.projects = [...S.projects, ...(M.projects || []).filter((x) => !pids.has(x.id))];
      S.del = [...new Set([...S.del, ...rdel])].slice(-500);
    }
    S.projects ||= []; S.del ||= [];
    const n = S.chats.length; S.chats = S.chats.filter((c) => !rdel.has(c.id)); if (S.chats.length !== n) changed = true;
    if (Array.isArray(M.order)) { const ord = new Map(M.order.map((id, k) => [id, k])); S.chats.sort((a, b) => (ord.has(a.id) ? ord.get(a.id) : -1) - (ord.has(b.id) ? ord.get(b.id) : -1)); }
    if (mine) SYNC.metaSent = JSON.stringify(M); // если локально есть что-то сверх — уйдёт следующей отправкой
    changed = true;
  }
  delete SYNC.fresh;
  if (S.cur && !S.chats.some((c) => c.id === S.cur)) S.cur = null;
  if (S.proj && !S.projects.some((p) => p.id === S.proj)) S.proj = null;
  return changed;
}
function afterRemote() { prep(); if (A.open && !findMsg(A.mid)) closeArt(); render(); try { if (typeof startPendingResume === 'function') startPendingResume(); } catch {} }
async function push() {
  if (pushing || anyBusy()) { clearTimeout(pushT); pushT = setTimeout(push, 1500); return; }
  clearTimeout(pushT); pushing = true; let again = false;
  try {
    const put = [], sending = {}; let size = 0;
    for (const c of S.chats) {
      const s = clean(c), h = hash(s); if (SYNC.sent[c.id] === h) continue;
      if (size && size + s.length > 8e6) { again = true; break; } // большие объёмы отправляем частями
      put.push(s); sending[c.id] = h; size += s.length;
    }
    const ids = new Set(S.chats.map((c) => c.id)), del = Object.keys(SYNC.sent).filter((id) => !ids.has(id));
    const ms = JSON.stringify(metaOf()), meta = ms !== SYNC.metaSent ? ms : null;
    if (!put.length && !del.length && !meta) return;
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"base":${SYNC.rev},"put":[${put.join(',')}],"del":${JSON.stringify(del)},"meta":${meta || 'null'}}` });
    if (r.status === 401) return toLogin();
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    const conf = new Set(j.conflicts || []);
    for (const id of Object.keys(sending)) if (!conf.has(id)) SYNC.sent[id] = sending[id];
    for (const id of del) delete SYNC.sent[id];
    if (meta && !j.metaConflict) SYNC.metaSent = ms;
    const changed = applyRemote(j); SYNC.rev = j.rev; persistLocal();
    if (conf.size || j.metaConflict) again = true;
    if (changed) afterRemote();
  } catch { clearTimeout(pushT); pushT = setTimeout(push, 10000); again = false; }
  finally { pushing = false; if (again) push(); }
}
function prep() { S.chats.forEach((c) => c.msgs.forEach((m) => { m.id = m.id || uid(); if (!liveMap.has(m.id)) { m.live = false; m.thinking = false; } seen.add(m.id); })); }
// Параллельная генерация: в разных чатах — отдельные запросы (chatId -> AbortController / активное сообщение)
const busyMap = new Map(), liveMap = new Map(), resumeMap = new Map();
const anyBusy = () => busyMap.size > 0;
async function pull() {
  if (anyBusy() || pushing) return;
  try {
    const r = await fetch('/api/sync?since=' + SYNC.rev); if (r.status === 401) return toLogin();
    const j = await r.json(); if (anyBusy() || pushing || !r.ok) return;
    const changed = applyRemote(j); SYNC.rev = j.rev; persistLocal();
    if (changed) afterRemote();
    push(); // отправить то, что изменилось здесь
  } catch {}
}
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cur = () => S.chats.find((c) => c.id === S.cur);
const curModel = () => MODELS.find((m) => m.id === S.model);
const mobile = () => matchMedia('(max-width:860px)').matches;
let filter = '';
const A = { open: false, mid: null, k: 0, tab: 'preview', follow: false, shown: '' };
S.chats.forEach((c) => c.msgs.forEach((m) => { m.id = m.id || uid(); m.live = false; m.thinking = false; }));
const seen = new Set(S.chats.flatMap((c) => c.msgs.map((m) => m.id)));
const markSeen = () => { const c = cur(); if (c) c.msgs.forEach((m) => seen.add(m.id)); };
// Prefill from /chat?q=... (переход с главной: «Напишите свою идею»)
try { const _q0 = new URLSearchParams(location.search).get('q'); if (_q0) { const _ta = document.getElementById('q'); if (_ta) { _ta.value = _q0.slice(0, 2000); _ta.style.height = 'auto'; _ta.style.height = Math.min(200, _ta.scrollHeight) + 'px'; _ta.focus(); _ta.setSelectionRange(_ta.value.length, _ta.value.length); _ta.dispatchEvent(new Event('input')); } } } catch (e) {}
