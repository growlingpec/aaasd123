// Разделы «Модели», «Тарифы и оплата», «Инструменты» — перенесены из прежней панели без изменений логики
// (подключение моделей и импорт от провайдера, тарифы и платёжные системы, поиск/картинки/видео/Python/браузер).
'use strict';
(() => {
/* ---------- модели ---------- */
const PRESETS = [
  { t: 'Kimi K3', s: 'OpenRouter · картинки', name: 'Kimi K3', modelId: 'moonshotai/kimi-k3', baseUrl: 'https://openrouter.ai/api/v1', vision: true },
  { t: 'Kimi K2.5', s: 'OpenRouter · дешевле в 4 раза', name: 'Kimi K2.5', modelId: 'moonshotai/kimi-k2.5', baseUrl: 'https://openrouter.ai/api/v1', vision: true },
  { t: 'Своя модель', s: 'Любой OpenAI-совместимый API', name: '', modelId: '', baseUrl: '', vision: false },
];
const chips = (sel, attr) => S.plans.map((p) => `<button type="button" class="chip${sel.includes(p.id) ? ' on' : ''}" ${attr}="${p.id}"><svg><use href="#i-check"/></svg>${esc(p.name)}</button>`).join('');
R.models = async () => {
  const list = await api('/api/admin/models');
  $('vact').innerHTML = '<button class="btn" id="impOpen"><svg><use href="#i-layers"/></svg>Импорт от провайдера</button><button class="btn" id="chkAll"><svg><use href="#i-bolt"/></svg>Проверить все</button><button class="btn pri" id="addOpen"><svg><use href="#i-plus"/></svg>Добавить модель</button><label class="check" style="margin:0 0 0 6px" title="Ключи и запросы из Cursor, Codex, Claude Code"><input type="checkbox" id="apiOpen"> API для пользователей</label>';
  api('/api/admin/api').then((x) => { const c = $('apiOpen'); if (c) { c.checked = x.open; c.onchange = (e) => post('/api/admin/api', { open: e.target.checked }).then(() => toast(e.target.checked ? 'API включён' : 'API выключен — запросы по ключам отклоняются')).catch(fail()); } }).catch(() => {});
  $('view').innerHTML = `<div class="card" id="impCard" hidden></div><div id="mlist">${list.length ? list.map((m, i) => `<div class="model${m.def ? ' def' : ''}" data-id="${m.id}">
      <div class="mtop"><div class="nm"><b>${esc(m.name)}${m.def ? '<span class="badge ok"><svg style="width:11px;height:11px"><use href="#i-star"/></svg>По умолчанию</span>' : ''}${m.vision ? '<span class="badge">картинки</span>' : ''}${m.prompt ? `<span class="badge" title="${esc(m.prompt.slice(0, 300))}">свой промт${m.promptMode === 'replace' ? ' · замена' : ''}</span>` : ''}</b><small>API: <code style="font-family:var(--p-font-mono,monospace)">${esc(m.slug || '')}</code> · ${m.agent === true ? 'готова для агентов' : m.agent === false ? 'без вызова инструментов — Claude Code и Codex с ней не заработают' : 'инструменты ещё не проверены'}${m.native ? ' · прямой протокол ' + (m.native === 'anthropic' ? 'Anthropic' : 'Responses') : ''}<br>Провайдер: ${esc(m.modelId)} · ${esc(host(m.baseUrl))} · ключ ${esc(m.apiKey)}<br><span class="mstx na" data-mst="${m.id}">статус: загрузка…</span></small></div>
        ${m.def ? '' : '<button class="btn sm" data-mdef>Сделать по умолчанию</button>'}<button class="btn sm" data-mtest>Проверить</button><button class="btn sm" data-medit>Изменить</button><span class="mord"><button class="ib" data-mup title="Выше" aria-label="Выше"${i ? '' : ' disabled'}>↑</button><button class="ib" data-mdown title="Ниже" aria-label="Ниже"${i < list.length - 1 ? '' : ' disabled'}>↓</button></span><button class="ib del" data-mdel title="Удалить модель" aria-label="Удалить модель"><svg><use href="#i-trash"/></svg></button></div>
      <div class="mrow2"><span class="lbl">Доступна в тарифах:</span><div class="chips">${chips(m.plans, 'data-mplan')}</div>
        <label class="weight"><span class="lbl">Стоимость запроса</span><input type="number" min="0.1" max="50" step="0.1" value="${m.weight}" data-mweight title="Сколько сообщений лимита списывает один ответ (мин. 0.1)"></label>
        <label class="check" style="margin:0"><input type="checkbox" data-mvision${m.vision ? ' checked' : ''}> понимает картинки</label></div>
      <form class="medit" data-meditf hidden autocomplete="off"><div class="grid g2" style="gap:0 14px">
        <label class="field"><span>Название на сайте</span><input name="name" value="${esc(m.name)}" required maxlength="60"></label>
        <label class="field"><span>ID модели у провайдера</span><input name="modelId" value="${esc(m.modelId)}" required></label>
        <label class="field"><span>URL API</span><input name="baseUrl" value="${esc(m.baseUrl)}" required></label>
        <label class="field"><span>API-ключ</span><input name="apiKey" type="password" placeholder="${esc(m.apiKey)} — оставьте пустым, чтобы не менять"></label></div>
        <div class="grid g2" style="gap:0 14px"><label class="field"><span>Прямой протокол для API <i class="opt">— необязательно</i></span><select name="native"><option value="">Нет — переводить из OpenAI-формата</option><option value="anthropic"${m.native === 'anthropic' ? ' selected' : ''}>Anthropic Messages — для Claude Code</option><option value="responses"${m.native === 'responses' ? ' selected' : ''}>OpenAI Responses — для Codex</option></select><small>Если провайдер сам понимает этот протокол, запросы идут без перевода: работают кэш промпта и размышления</small></label>
        <label class="field"><span>URL прямого протокола</span><input name="nativeUrl" value="${esc(m.nativeUrl || '')}" placeholder="https://api.anthropic.com"><small>Пусто — тот же, что «URL API»</small></label></div>
        <div class="field mprompt"><span>Системный промт <i class="opt">— необязательно</i></span><textarea name="prompt" rows="4"  placeholder="Например: Ты — опытный юрист. Отвечай кратко, ссылайся на статьи закона.">${esc(m.prompt)}</textarea>
        <div class="pm-row"><label class="radio"><input type="radio" name="promptMode" value="add"${m.promptMode !== 'replace' ? ' checked' : ''}> Добавить к стандартному промту Premier</label><label class="radio"><input type="radio" name="promptMode" value="replace"${m.promptMode === 'replace' ? ' checked' : ''}> Заменить полностью</label><span class="pm-len" data-plen></span></div>
        <small>Пользователи промт не видят. «Добавить» — сохраняются правила Premier (Markdown, сайты, инструменты) и ваши инструкции важнее их.</small></div>
        <div class="ptest"><input class="inp" data-pask placeholder="Вопрос для проверки промта, например: Кто ты?"><button type="button" class="btn" data-ptest>Проверить промт</button></div><div class="preply" data-preply hidden></div>
        <div class="btns"><button type="button" class="btn" data-mecancel>Отмена</button><button class="btn pri">Сохранить</button></div></form>
      <div class="msg" data-mmsg style="margin:8px 0 0;min-height:0"></div></div>`).join('') : '<div class="empty">Моделей пока нет — добавьте первую</div>'}</div>
    <div class="card" id="addCard"${list.length ? ' hidden' : ''}><h2>Новая модель</h2><div class="sub">Выберите заготовку или заполните вручную</div>
      <div class="presets">${PRESETS.map((p, i) => `<button type="button" class="preset" data-preset="${i}"><b>${p.t}</b><small>${p.s}</small></button>`).join('')}</div>
      <form id="addF" autocomplete="off"><div class="grid g2" style="gap:0 14px">
        <label class="field"><span>Название на сайте</span><input name="name" required placeholder="Kimi K3"></label>
        <label class="field"><span>ID модели у провайдера</span><input name="modelId" required placeholder="moonshotai/kimi-k3"></label>
        <label class="field"><span>URL API</span><input name="baseUrl" required placeholder="https://openrouter.ai/api/v1"><small>/chat/completions добавится сам</small></label>
        <label class="field"><span>API-ключ</span><input name="apiKey" type="password" required placeholder="sk-..."></label></div>
        <div class="field"><span>Доступна в тарифах</span><div class="chips" id="addPlans">${chips(S.plans.map((p) => p.id), 'data-aplan')}</div></div>
        <div class="grid g2" style="gap:0 14px"><label class="field"><span>Стоимость запроса</span><input name="weight" type="number" min="0.1" max="50" step="0.1" value="1"><small>Сколько сообщений лимита списывает один ответ (мин. 0.1)</small></label><div></div></div>
        <div class="field mprompt"><span>Системный промт <i class="opt">— необязательно</i></span><textarea name="prompt" rows="4"  placeholder="Например: Ты — опытный юрист. Отвечай кратко, ссылайся на статьи закона."></textarea>
        <div class="pm-row"><label class="radio"><input type="radio" name="promptMode" value="add" checked> Добавить к стандартному промту Premier</label><label class="radio"><input type="radio" name="promptMode" value="replace"> Заменить полностью</label><span class="pm-len" data-plen></span></div>
        <small>Пользователи промт не видят. «Добавить» — сохраняются правила Premier (Markdown, сайты, инструменты) и ваши инструкции важнее их.</small></div>
        <label class="check"><input type="checkbox" name="vision"> Модель понимает картинки</label>
        <label class="check"><input type="checkbox" name="def"${list.length ? '' : ' checked'}> Сделать моделью по умолчанию</label>
        <div class="msg" id="amsg"></div>
        <div class="btns"><button type="button" class="btn" id="addCancel"${list.length ? '' : ' hidden'}>Отмена</button><button type="button" class="btn" id="addTest">Проверить</button><button class="btn pri" id="addSave">Подключить</button></div></form></div>`;
  const f = $('addF'), data = () => ({ ...Object.fromEntries(new FormData(f)), vision: f.vision.checked, def: f.def.checked, plans: [...document.querySelectorAll('#addPlans .chip.on')].map((c) => c.dataset.aplan) });
  $('impOpen').onclick = openImport;
  $('addOpen').onclick = () => { $('impCard').hidden = true; $('addCard').hidden = false; $('addCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('addCancel').onclick = () => { $('addCard').hidden = true; };
  $('addTest').onclick = async () => { if (!f.reportValidity()) return; say('amsg', 'Проверяю…'); try { const j = await post('/api/admin/test', data()); j.ok ? say('amsg', 'Работает. Ответ: ' + (j.reply || '(пусто)').slice(0, 80), 'ok') : say('amsg', j.error, 'err'); } catch (e) { fail('amsg')(e); } };
  f.onsubmit = async (e) => { e.preventDefault(); const d = data(); if (!d.plans.length) return say('amsg', 'Выберите хотя бы один тариф', 'err'); $('addSave').disabled = true; try { await post('/api/admin/models', d); toast('Модель подключена'); R.models(); } catch (err) { fail('amsg')(err); $('addSave').disabled = false; } };
  const mstFmt = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '').replace('.', ',') + 'с' : v + 'мс');
  const mstTm = (v) => (v ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
  const paintStatus = (st) => { if (!Array.isArray(st)) return; document.querySelectorAll('[data-mst]').forEach((el) => { const x = st.find((y) => y.id === el.dataset.mst); const p = x && x.probe; if (!p) { el.className = 'mstx na'; el.textContent = 'статус: данных нет (первый пинг — в течение 5 минут)'; } else if (p.ok) { el.className = 'mstx ok'; el.textContent = 'статус: работает · пинг ' + mstFmt(p.ms) + ' · ' + mstTm(p.at); } else { el.className = 'mstx bad'; el.textContent = 'статус: ' + (p.err || 'ошибка') + ' · ' + mstTm(p.at); } }); };
  api('/api/models/status').then(paintStatus).catch(() => {});
  $('chkAll').onclick = async () => {
    const btn = $('chkAll'); btn.disabled = true;
    document.querySelectorAll('[data-mst]').forEach((el) => { el.className = 'mstx na'; el.textContent = 'статус: проверяю…'; });
    try {
      await post('/api/admin/models/check', {});
      toast('Запускаю проверку всех моделей…');
      const t0 = Date.now();
      const poll = setInterval(async () => {
        try {
          const st = await api('/api/models/status');
          paintStatus(st);
          const fresh = st.filter((x) => x.probe && x.probe.at >= t0 - 10000).length;
          if (fresh >= st.length || Date.now() - t0 > 600000) {
            clearInterval(poll); btn.disabled = false;
            const okN = st.filter((x) => x.probe && x.probe.ok && x.probe.at >= t0 - 10000).length;
            toast(okN === st.length ? 'Проверка готова: работают все ' + st.length + ' моделей' : 'Проверка готова: работает ' + okN + ' из ' + st.length);
          }
        } catch {}
      }, 2500);
    } catch (e) { btn.disabled = false; toast(e.message || 'Не удалось запустить проверку'); }
  };
  $('view').onclick = async (e) => {
    const pr = e.target.closest('[data-preset]'); if (pr) { const p = PRESETS[+pr.dataset.preset]; for (const k of ['name', 'modelId', 'baseUrl']) f[k].value = p[k]; f.vision.checked = p.vision; f.apiKey.focus(); return; }
    const ac = e.target.closest('[data-aplan]'); if (ac) { ac.classList.toggle('on'); return; }
    const card = e.target.closest('.model'); if (!card) return; const id = card.dataset.id, msg = card.querySelector('[data-mmsg]');
    const ch = e.target.closest('[data-mplan]');
    if (ch) { ch.classList.toggle('on'); const plans = [...card.querySelectorAll('[data-mplan].on')].map((c) => c.dataset.mplan); if (!plans.length) { ch.classList.add('on'); return toast('Модель должна входить хотя бы в один тариф'); } post('/api/admin/models/' + id, { plans }, 'PATCH').then(() => toast('Тарифы модели сохранены')).catch(fail()); return; }
    if (e.target.closest('[data-mdef]')) { post('/api/admin/models/' + id, { def: true }, 'PATCH').then(() => { toast('Модель по умолчанию изменена'); R.models(); }).catch(fail()); return; }
    if (e.target.closest('[data-mtest]')) { msg.className = 'msg'; msg.textContent = 'Проверяю…'; try { const j = await post('/api/admin/test', { id }); msg.className = 'msg ' + (j.ok ? 'ok' : 'err'); msg.textContent = j.ok ? 'Работает. Ответ: ' + (j.reply || '(пусто)').slice(0, 80) : j.error; } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; } return; }
    if (e.target.closest('[data-medit]')) { const f2 = card.querySelector('[data-meditf]'); f2.hidden = !f2.hidden; if (!f2.hidden) f2.name.focus(); return; }
    if (e.target.closest('[data-mecancel]')) { card.querySelector('[data-meditf]').hidden = true; return; }
    const mv = e.target.closest('[data-mup],[data-mdown]');
    if (mv) { const ids = list.map((x) => x.id), i = ids.indexOf(id), j = i + (mv.matches('[data-mup]') ? -1 : 1); if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; post('/api/admin/models/order', { ids }).then(() => R.models()).catch(fail()); return; }
    if (e.target.closest('[data-mdel]')) { confirmBox('Удалить модель?', 'Пользователи перестанут её видеть. Настройки модели будут удалены.', { danger: true, ok: 'Удалить' }).then((yes) => yes && api('/api/admin/models/' + id, { method: 'DELETE' }).then(() => { toast('Модель удалена', 'ok'); R.models(); }).catch(fail())); }
  };
  $('view').onchange = (e) => {
    const card = e.target.closest('.model'); if (!card) return; const id = card.dataset.id;
    if (e.target.matches('[data-mweight]')) post('/api/admin/models/' + id, { weight: +e.target.value }, 'PATCH').then(() => toast('Сохранено')).catch(fail());
    if (e.target.matches('[data-mvision]')) post('/api/admin/models/' + id, { vision: e.target.checked }, 'PATCH').then(() => { toast('Сохранено'); R.models(); }).catch(fail());
  };
};

// счётчик длины промта и проверка промта
document.addEventListener('input', (e) => { if (!e.target.matches('.mprompt textarea')) return; const n = e.target.value.length, l = e.target.closest('.mprompt').querySelector('[data-plen]'); if (l) l.textContent = n ? n.toLocaleString('ru-RU') + ' симв.' : ''; });
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ptest]'); if (!b) return;
  const f = b.closest('form'), card = b.closest('.model'), out = f.querySelector('[data-preply]'), ask = f.querySelector('[data-pask]').value.trim() || 'Кто ты и что умеешь? Ответь в двух предложениях.';
  out.hidden = false; out.className = 'preply'; out.textContent = 'Спрашиваю модель…'; b.disabled = true;
  try { const j = await post('/api/admin/test', { id: card.dataset.id, ask, prompt: f.prompt.value, promptMode: f.promptMode.value });
    out.className = 'preply ' + (j.ok ? 'ok' : 'err'); out.textContent = j.ok ? (j.reply || '(пустой ответ)') : j.error; }
  catch (err) { out.className = 'preply err'; out.textContent = err.message; } b.disabled = false;
});
// редактирование модели
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-meditf]'); if (!f) return; e.preventDefault();
  const card = f.closest('.model'), msg = card.querySelector('[data-mmsg]'), d = Object.fromEntries(new FormData(f));
  try { await post('/api/admin/models/' + card.dataset.id, d, 'PATCH'); toast('Модель сохранена'); R.models(); } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
});

/* ---------- импорт моделей от провайдера ---------- */
const PROVIDERS = [
  ['OpenRouter', 'https://openrouter.ai/api/v1'], ['OpenAI', 'https://api.openai.com/v1'], ['DeepSeek', 'https://api.deepseek.com/v1'],
  ['Groq', 'https://api.groq.com/openai/v1'], ['Together', 'https://api.together.xyz/v1'], ['Mistral', 'https://api.mistral.ai/v1'],
  ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'], ['xAI', 'https://api.x.ai/v1'], ['Ollama (свой сервер)', 'http://127.0.0.1:11434/v1'],
];
const IMP = { list: [], sel: new Map(), q: '', f: 'chat', src: null };
async function openImport() {
  const c = $('impCard'); c.hidden = false; $('addCard').hidden = true;
  const keys = await api('/api/admin/models/keys').catch(() => []);
  c.innerHTML = `<div class="chead"><div><h2>Импорт моделей от провайдера</h2><div class="sub">Загрузите список по API-ключу, отметьте нужные модели и добавьте их разом</div></div><button type="button" class="ib" id="impClose" aria-label="Закрыть" title="Закрыть"><svg><use href="#i-x"/></svg></button></div>
    <div class="presets">${PROVIDERS.map(([n, u]) => `<button type="button" class="preset" data-prov="${esc(u)}"><b>${esc(n)}</b><small>${esc(host(u))}</small></button>`).join('')}</div>
    <form id="impF" autocomplete="off"><div class="grid g2" style="gap:0 14px">
      <label class="field"><span>URL API</span><input id="impUrl" required placeholder="https://openrouter.ai/api/v1"></label>
      <label class="field"><span>API-ключ</span><input id="impKey" type="password" placeholder="sk-..."></label></div>
      ${keys.length ? `<label class="field"><span>…или ключ уже подключённой модели</span><select id="impFrom"><option value="">— ввести ключ вручную —</option>${keys.map((k) => `<option value="${k.id}" data-url="${esc(k.baseUrl)}">${esc(k.host)} · ${esc(k.key)}</option>`).join('')}</select></label>` : ''}
      <div class="msg" id="impMsg"></div><div class="btns"><button class="btn pri" id="impLoad">Загрузить модели</button></div></form>
    <div id="impRes"></div>`;
  $('impClose').onclick = () => { c.hidden = true; };
  c.querySelectorAll('[data-prov]').forEach((b) => { b.onclick = () => { $('impUrl').value = b.dataset.prov; if ($('impFrom')) { const o = [...$('impFrom').options].find((x) => x.dataset.url && x.dataset.url.replace(/\/+$/, '') === b.dataset.prov); $('impFrom').value = o ? o.value : ''; } $('impKey').focus(); }; });
  if ($('impFrom')) $('impFrom').onchange = () => { const o = $('impFrom').selectedOptions[0]; if (o.dataset.url) $('impUrl').value = o.dataset.url; };
  $('impF').onsubmit = async (e) => {
    e.preventDefault(); const from = $('impFrom')?.value || '', key = $('impKey').value.trim();
    if (!key && !from) return say('impMsg', 'Введите API-ключ или выберите ключ подключённой модели', 'err');
    say('impMsg', 'Загружаю список моделей…'); $('impLoad').disabled = true;
    try { const j = await post('/api/admin/models/fetch', { baseUrl: $('impUrl').value, apiKey: key, fromId: key ? '' : from });
      IMP.list = j.models; IMP.sel = new Map(); IMP.q = ''; IMP.f = j.models.some((x) => x.chat) ? 'chat' : 'all'; IMP.src = { baseUrl: j.baseUrl, apiKey: key, fromId: key ? '' : from };
      say('impMsg', `Найдено моделей: ${j.models.length}`, 'ok'); renderImp(); }
    catch (err) { fail('impMsg')(err); } $('impLoad').disabled = false;
  };
  c.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const fmtCtx = (n) => n ? (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : Math.round(n / 1000) + 'K') : '';
const fmtPrice = (x) => x.free ? 'бесплатно' : x.pin != null ? `$${x.pin} / $${x.pout ?? '?'} за 1M` : '';
function impVisible() {
  const q = IMP.q.toLowerCase();
  return IMP.list.filter((x) => (IMP.f === 'all' || (IMP.f === 'chat' && x.chat) || (IMP.f === 'vision' && x.chat && x.vision) || (IMP.f === 'free' && x.free)) && (!q || x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)));
}
function renderImp() {
  const vis = impVisible(), shown = vis.slice(0, 400), n = IMP.sel.size;
  $('impRes').innerHTML = `<div class="imp-bar"><input class="inp" id="impQ" placeholder="Поиск: kimi, gpt, claude…" value="${esc(IMP.q)}">
      <select class="inp" id="impFl" style="width:auto"><option value="chat"${IMP.f === 'chat' ? ' selected' : ''}>Только чат-модели</option><option value="vision"${IMP.f === 'vision' ? ' selected' : ''}>Понимают картинки</option><option value="free"${IMP.f === 'free' ? ' selected' : ''}>Бесплатные</option><option value="all"${IMP.f === 'all' ? ' selected' : ''}>Все</option></select>
      <button type="button" class="btn sm" id="impAll">Отметить видимые</button><button type="button" class="btn sm" id="impNone"${n ? '' : ' disabled'}>Снять все</button></div>
    <div class="imp-list">${shown.length ? shown.map((x) => { const s = IMP.sel.get(x.id); return `<div class="imp-row${s ? ' on' : ''}${x.added ? ' added' : ''}" data-iid="${esc(x.id)}">
      <label class="imp-ck"><input type="checkbox"${s ? ' checked' : ''}${x.added ? ' disabled' : ''}></label>
      <div class="imp-main"><div class="imp-t">${s ? `<input class="imp-name" value="${esc(s.name)}" maxlength="60" title="Название на сайте">` : `<b>${esc(x.name)}</b>`}${x.added ? '<span class="badge ok">уже добавлена</span>' : ''}${x.vision ? '<span class="badge">картинки</span>' : ''}${x.free ? '<span class="badge warn">free</span>' : ''}</div>
        <small>${esc(x.id)}${x.ctx ? ' · ' + fmtCtx(x.ctx) + ' контекст' : ''}${fmtPrice(x) && !x.free ? ' · ' + fmtPrice(x) : ''}</small></div></div>`; }).join('') : '<div class="empty" style="padding:24px">Ничего не найдено</div>'}
      ${vis.length > shown.length ? `<div class="sub" style="padding:10px 4px">Показаны первые 400 из ${vis.length} — уточните поиск</div>` : ''}</div>
    ${n ? `<div class="imp-foot"><div class="field" style="margin:0"><span>Доступны в тарифах</span><div class="chips" id="impPlans">${chips(S.plans.map((p) => p.id), 'data-iplan')}</div></div>
      <label class="field" style="margin:0;width:150px"><span>Стоимость запроса</span><input id="impW" type="number" min="0.1" max="50" step="0.1" value="1"></label>
      <button type="button" class="btn pri" id="impAdd">Добавить выбранные (${n})</button></div><div class="msg" id="impAddMsg"></div>` : ''}`;
  const q = $('impQ'); q.oninput = () => { IMP.q = q.value; const pos = q.selectionStart; renderImp(); const nq = $('impQ'); nq.focus(); nq.setSelectionRange(pos, pos); };
  $('impFl').onchange = () => { IMP.f = $('impFl').value; renderImp(); };
  $('impAll').onclick = () => { for (const x of impVisible().slice(0, 400)) if (!x.added && !IMP.sel.has(x.id)) IMP.sel.set(x.id, { name: x.name, vision: x.vision }); renderImp(); };
  $('impNone').onclick = () => { IMP.sel.clear(); renderImp(); };
  $('impRes').querySelectorAll('.imp-row').forEach((r) => {
    const id = r.dataset.iid, x = IMP.list.find((y) => y.id === id);
    r.querySelector('input[type=checkbox]').onchange = (e) => { e.target.checked ? IMP.sel.set(id, { name: x.name, vision: x.vision }) : IMP.sel.delete(id); renderImp(); };
    const nm = r.querySelector('.imp-name'); if (nm) nm.oninput = () => { IMP.sel.get(id).name = nm.value; };
  });
  $('impRes').querySelectorAll('[data-iplan]').forEach((c) => { c.onclick = () => c.classList.toggle('on'); });
  if ($('impAdd')) $('impAdd').onclick = async () => {
    const plans = [...document.querySelectorAll('#impPlans .chip.on')].map((c) => c.dataset.iplan); if (!plans.length) return say('impAddMsg', 'Выберите хотя бы один тариф', 'err');
    $('impAdd').disabled = true;
    try { const j = await post('/api/admin/models/bulk', { ...IMP.src, plans, weight: +$('impW').value || 1, models: [...IMP.sel].map(([modelId, v]) => ({ modelId, name: v.name.trim() || modelId, vision: v.vision })) });
      toast(`Добавлено моделей: ${j.added}${j.skipped ? `, пропущено (уже были): ${j.skipped}` : ''}`); IMP.sel.clear(); await R.models(); }
    catch (err) { fail('impAddMsg')(err); $('impAdd').disabled = false; }
  };
}

/* ---------- тарифы и оплата ---------- */
R.plans = async () => {
  const [c, models, pay, cr] = await Promise.all([api('/api/admin/plans'), api('/api/admin/models'), api('/api/admin/pay'), api('/api/admin/crypto')]);
  S.plans = c.plans; const v = (x) => x == null ? '' : x;
  const num = (p, k, label, ph = '∞', dis = false) => `<label class="field"><span>${label}</span><input type="number" min="0" data-k="${k}" value="${v(p[k])}" placeholder="${ph}"${dis ? ' disabled' : ''}></label>`;
  $('view').innerHTML = `<form id="plansF" autocomplete="off"><div class="grid g3">${c.plans.map((p) => {
      const mods = models.filter((m) => m.plans.includes(p.id)).map((m) => esc(m.name) + (m.def ? ' ★' : ''));
      return `<div class="plan${p.tier === 1 ? ' hot' : ''}" data-pid="${p.id}"><h3>${planBadge(p.id)}<span style="flex:1"></span></h3>
        <div class="grid g2" style="gap:0 12px"><label class="field"><span>Название</span><input data-k="name" value="${esc(p.name)}" maxlength="30"></label>${num(p, 'price', 'Цена, ₽', '0', p.id === 'free')}</div>
        <label class="field"><span>Описание</span><input data-k="desc" value="${esc(p.desc || '')}" maxlength="120"></label>
        <div class="grid g2" style="gap:0 12px">${num(p, 'days', 'Срок, дней', '—', p.id === 'free')}${num(p, 'msgs', 'Сообщений в день')}${num(p, 'code', 'Python в день')}${num(p, 'sites', 'Сайтов в день')}${num(p, 'images', 'Картинок в день')}${num(p, 'videos', 'Видео в день')}</div>
        <div class="mods"><b style="color:var(--muted);font-weight:500">Модели:</b> ${mods.length ? mods.join(', ') : 'нет — выберите во вкладке «Модели»'}</div></div>`; }).join('')}</div>
    <div class="card" style="margin-top:16px"><h2>Общие настройки</h2><div class="sub">Пустое поле лимита = без ограничений. Лимиты считаются за сутки по Москве.</div>
      <div class="grid g3" style="gap:0 14px">
        <label class="field"><span>Пробный период, дней</span><input name="trialDays" type="number" min="0" max="90" value="${c.trialDays}"><small>Pro для новых пользователей; 0 — выключен</small></label>
        <label class="field"><span>Антиспам: сообщений за 5 минут</span><input name="burst" type="number" min="0" value="${c.burst}"><small>0 — без проверки</small></label>
        <label class="field"><span>Потолок «безлимита» в день</span><input name="fair" type="number" min="0" value="${v(c.fair)}" placeholder="∞"><small>Защита от злоупотреблений</small></label></div>
      <div class="msg" id="plmsg"></div><div class="btns"><button class="btn pri">Сохранить тарифы</button></div></div></form>
    <div class="card"><div class="chead"><div><h2>Оплата через Platega</h2><div class="sub">Карты и СБП. Ключи — в личном кабинете Platega.</div></div><span class="badge ${pay.ready ? 'ok' : 'warn'}">${pay.ready ? 'Подключено' : 'Не подключено'}</span></div>
      <form id="payF" autocomplete="off"><div class="grid g2" style="gap:0 14px">
        <label class="field"><span>Merchant ID</span><input id="payMid" value="${esc(pay.merchant)}" placeholder="из личного кабинета"${pay.env ? ' disabled' : ''}></label>
        <label class="field"><span>API-секрет</span><input id="paySec" type="password" placeholder="${pay.secret ? esc(pay.secret) + ' (сохранён)' : 'X-Secret'}"${pay.env ? ' disabled' : ''}></label></div>
        <label class="field"><span>Callback URL — вставьте в Platega: Настройки → Callback URLs</span><div class="copyrow"><input class="inp" id="payCb" readonly value="${esc(pay.callback)}"><button type="button" class="btn" id="cbCopy">Копировать</button></div></label>
        ${pay.env ? '<div class="msg">Ключи заданы переменными окружения на сервере</div>' : ''}
        <div class="msg" id="paymsg"></div><div class="btns"><button class="btn pri"${pay.env ? ' disabled' : ''}>Сохранить</button></div></form></div>
    <div class="card"><div class="chead"><div><h2>Оплата через Crypto Bot</h2><div class="sub">USDT, TON, BTC и другие монеты в Telegram. Цена в рублях пересчитывается по курсу Crypto Bot</div></div><span class="badge ${cr.ready ? 'ok' : 'warn'}">${cr.ready ? 'Подключено' + (cr.testnet ? ' · тест' : '') : 'Не подключено'}</span></div>
      <form id="cryF" autocomplete="off">
        <label class="field"><span>API-токен — @CryptoBot → Crypto Pay → My Apps → ваше приложение → API Token</span><input id="cryTok" type="password" placeholder="${cr.token ? esc(cr.token) + ' (сохранён)' : '12345:AAbbCCddEE…'}"${cr.env ? ' disabled' : ''}></label>
        <label class="field"><span>Принимаемые монеты</span><input id="cryAs" value="${esc(cr.assets)}" placeholder="USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC"><small>Через запятую. Пользователь выберет монету при оплате</small></label>
        <label class="field"><span>Webhook URL — вставьте в @CryptoBot: My Apps → приложение → Webhooks → Enable Webhooks</span><div class="copyrow"><input class="inp" id="cryWh" readonly value="${esc(cr.webhook)}"><button type="button" class="btn" id="cryCopy">Копировать</button></div><small>Без вебхука оплата тоже засчитается — сайт проверяет счёт сам, пока пользователь ждёт. Вебхук нужен, если он закроет вкладку</small></label>
        <label class="check"><input type="checkbox" id="cryTest"${cr.testnet ? ' checked' : ''}${cr.env ? ' disabled' : ''}> Тестовая сеть (@CryptoTestnetBot) — для проверки без реальных денег</label>
        ${cr.env ? '<div class="msg">Токен задан переменной окружения CRYPTOPAY_TOKEN на сервере</div>' : ''}
        <div class="msg" id="crymsg"></div><div class="btns">${cr.token && !cr.env ? '<button type="button" class="btn" id="cryDel">Отключить</button>' : ''}<button type="button" class="btn" id="cryChk"><svg><use href="#i-bolt"/></svg>Проверить</button><button class="btn pri">Сохранить</button></div></form></div>`;
  $('plansF').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    const plans = [...f.querySelectorAll('[data-pid]')].map((el) => { const o = { id: el.dataset.pid }; el.querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = ['name', 'desc'].includes(i.dataset.k) ? i.value : i.value === '' ? null : +i.value; }); return o; });
    try { const r = await post('/api/admin/plans', { plans, trialDays: +f.trialDays.value || 0, burst: +f.burst.value || 0, fair: f.fair.value === '' ? null : +f.fair.value }); S.plans = r.plans; say('plmsg', 'Сохранено — цены уже обновились в чате и на лендинге', 'ok'); } catch (err) { fail('plmsg')(err); }
  };
  $('cbCopy').onclick = (e) => { navigator.clipboard?.writeText($('payCb').value); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = 'Копировать'), 1400); };
  const crySave = () => post('/api/admin/crypto', { token: $('cryTok').value, assets: $('cryAs').value, ...(cr.env ? {} : { testnet: $('cryTest').checked }) });
  $('cryCopy').onclick = (e) => { navigator.clipboard?.writeText($('cryWh').value); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = 'Копировать'), 1400); };
  $('cryF').onsubmit = async (e) => { e.preventDefault(); try { await crySave(); toast('Crypto Bot сохранён'); R.plans(); } catch (err) { fail('crymsg')(err); } };
  $('cryChk').onclick = async () => { say('crymsg', 'Проверяю токен…'); try { await crySave(); $('cryTok').value = ''; const j = await post('/api/admin/crypto/test'); j.ok ? say('crymsg', `Работает: приложение «${j.name}» (id ${j.id})`, 'ok') : say('crymsg', j.error, 'err'); } catch (err) { fail('crymsg')(err); } };
  if ($('cryDel')) $('cryDel').onclick = () => { confirmBox('Отключить оплату через Crypto Bot?', 'Пользователи не смогут платить криптовалютой, пока вы не подключите токен снова.', { danger: true, ok: 'Отключить' }).then((yes) => yes && post('/api/admin/crypto', { remove: true }).then(() => { toast('Crypto Bot отключён', 'ok'); R.plans(); }).catch(fail('crymsg'))); };
  $('payF').onsubmit = async (e) => { e.preventDefault(); try { await post('/api/admin/pay', { merchant: $('payMid').value, secret: $('paySec').value }); toast('Ключи Platega сохранены'); R.plans(); } catch (err) { fail('paymsg')(err); } };
};

/* ---------- инструменты ---------- */
const vOk = (v) => !!(v.on && v.modelId && v.hasKey && (v.baseUrl || v.effMode !== 'openai'));
R.tools = async () => {
  const [w, c, b, im, vd, wm] = await Promise.all([api('/api/admin/search'), api('/api/admin/code'), api('/api/admin/browser'), api('/api/admin/image'), api('/api/admin/video'), api('/api/admin/watermark').catch(() => ({ on: true }))]);
  $('view').innerHTML = `<div class="card"><div class="chead"><div><h2>Поиск в интернете</h2><div class="sub">Модель ищет свежую информацию и даёт ссылки на источники</div></div></div>
      <form id="webF" autocomplete="off"><div class="grid g2" style="gap:0 14px"><label class="field"><span>Поисковик</span><select id="wProv">${Object.entries(w.providers).map(([k, v]) => `<option value="${k}"${k === w.provider ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field"><span>Ключ поисковика</span><input id="wKey" type="password"></label></div>
        <div class="msg" id="wmsg"></div><div class="btns"><button type="button" class="btn" id="wTest">Проверить</button><button class="btn pri">Сохранить</button></div></form></div>
        <div class="card"><div class="chead"><div><h2>Вотермарк публикаций</h2><div class="sub">Бейдж «Сделано в Premier» под опубликованными сайтами. На free — всегда включён, на pro/max — по желанию при публикации</div></div><span class="badge ${wm.on !== false ? 'ok' : 'warn'}" id="wmBadge">${wm.on !== false ? 'Включено' : 'Выключено'}</span></div>
      <label class="check"><input type="checkbox" id="wmOn"${wm.on !== false ? ' checked' : ''}> Показывать бейдж на опубликованных сайтах</label></div>
    <div class="card"><div class="chead"><div><h2>Генерация изображений</h2><div class="sub">Модель рисует картинки по просьбе пользователя. Лимит в день — во вкладке «Тарифы»</div></div><span class="badge ${im.on && im.baseUrl && im.modelId && im.hasKey ? 'ok' : 'warn'}" id="iBadge">${im.on && im.baseUrl && im.modelId && im.hasKey ? 'Включено' : im.baseUrl ? 'Выключено' : 'Не настроено'}</span></div>
      <div class="ipre"><span>Быстро заполнить:</span><button type="button" class="btn sm" data-ipre="or">OpenRouter · Gemini</button><button type="button" class="btn sm" data-ipre="oai">OpenAI · gpt-image-1</button><button type="button" class="btn sm" data-ipre="tg">Together · Flux</button></div>
      <form id="imgF" autocomplete="off">
        <div class="grid g2" style="gap:0 14px">
          <label class="field"><span>URL API</span><input id="iUrl" value="${esc(im.baseUrl)}" placeholder="https://openrouter.ai/api/v1"><small>Базовый адрес, как у моделей. Можно и полный: …/images/generations</small></label>
          <label class="field"><span>ID модели</span><input id="iModel" value="${esc(im.modelId)}" placeholder="google/gemini-2.5-flash-image"></label>
          <label class="field"><span>API-ключ</span><input id="iKey" type="password" placeholder="${im.hasKey ? esc(im.apiKey) + ' (сохранён)' : 'sk-...'}"></label>
          <label class="field"><span>Формат API</span><select id="iMode"><option value="auto"${im.mode === 'auto' ? ' selected' : ''}>Авто${im.effMode ? ' (сейчас: ' + (im.effMode === 'chat' ? 'chat' : 'images') + ')' : ''}</option><option value="images"${im.mode === 'images' ? ' selected' : ''}>images/generations — OpenAI, Together и др.</option><option value="chat"${im.mode === 'chat' ? ' selected' : ''}>chat/completions — OpenRouter, Gemini</option></select></label>
          <label class="field"><span>Размер (для images)</span><input id="iSize" value="${esc(im.size)}" placeholder="авто по пропорциям"><small>Тьер 1K/2K/3K/4K (пропорция — по запросу модели) или точный, например 1024x1024. «none» — не передавать размер</small></label>
          <label class="field"><span>Доп. параметры, JSON</span><input id="iExtra" value="${esc(im.extra)}" placeholder='{"quality":"medium"}'><small>Добавятся в запрос как есть</small></label>
        </div>
        <label class="check"><input type="checkbox" id="iOn"${im.on ? ' checked' : ''}> Модель может рисовать картинки</label>
        <div class="msg" id="imsg"></div><div class="iprev" id="iPrev" hidden></div>
        <div class="btns"><button type="button" class="btn" id="iTest"><svg><use href="#i-bolt"/></svg>Проверить</button><button class="btn pri">Сохранить</button></div></form></div>
    <div class="card"><div class="chead"><div><h2>Генерация видео</h2><div class="sub">Короткие ролики по просьбе пользователя («сделай видео…», «оживи картинку»). Лимит в день — во вкладке «Тарифы» (Free по умолчанию 0)</div></div><span class="badge ${vOk(vd) ? 'ok' : 'warn'}" id="vBadge">${vOk(vd) ? 'Включено' : vd.modelId ? 'Выключено' : 'Не настроено'}</span></div>
      <div class="ipre"><span>Быстро заполнить:</span><button type="button" class="btn sm" data-vpre="fal">fal.ai · Kling</button><button type="button" class="btn sm" data-vpre="falveo">fal.ai · Veo 3 Fast</button><button type="button" class="btn sm" data-vpre="oai">OpenAI · Sora 2</button><button type="button" class="btn sm" data-vpre="rep">Replicate · Wan</button></div>
      <form id="vidF" autocomplete="off">
        <div class="grid g2" style="gap:0 14px">
          <label class="field"><span>URL API</span><input id="vUrl" value="${esc(vd.baseUrl)}" placeholder="https://queue.fal.run"><small>fal.ai, Replicate или OpenAI-совместимый (/videos)</small></label>
          <label class="field"><span>ID модели</span><input id="vModel" value="${esc(vd.modelId)}" placeholder="fal-ai/kling-video/v2.1/standard/text-to-video"></label>
          <label class="field"><span>API-ключ</span><input id="vKey" type="password" placeholder="${vd.hasKey ? esc(vd.apiKey) + ' (сохранён)' : 'ключ сервиса'}"></label>
          <label class="field"><span>Формат API</span><select id="vMode">${[['auto', 'Авто' + (vd.effMode ? ' (сейчас: ' + vd.effMode + ')' : '')], ['fal', 'fal.ai — очередь задач'], ['replicate', 'Replicate — predictions'], ['openai', 'OpenAI — /videos (Sora)']].map(([k, n]) => `<option value="${k}"${vd.mode === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field"><span>Длительность, секунд</span><input id="vSec" value="${esc(vd.seconds)}" placeholder="по умолчанию модели"><small>Например 5 или 8. Чем длиннее — тем дороже</small></label>
          <label class="field"><span>Доп. параметры, JSON</span><input id="vExtra" value="${esc(vd.extra)}" placeholder='{"resolution":"720p"}'><small>Добавятся в запрос как есть</small></label>
        </div>
        <label class="check"><input type="checkbox" id="vOn"${vd.on ? ' checked' : ''}> Модель может делать видео</label>
        <div class="msg" id="vmsg"></div><div class="iprev" id="vPrev" hidden></div>
        <div class="btns"><button type="button" class="btn" id="vTest"><svg><use href="#i-bolt"/></svg>Проверить (платно, 1–5 мин)</button><button class="btn pri">Сохранить</button></div></form></div>
    <div class="card"><div class="chead"><div><h2>Выполнение кода (Python)</h2><div class="sub">Расчёты, графики, Excel/Word/PDF-файлы</div></div><span class="badge ${c.ok ? 'ok' : 'bad'}">${c.ok ? (c.mode === 'local' ? 'local — без изоляции' : 'Docker-песочница') : 'недоступно'}</span></div>
      ${c.ok ? '' : `<div class="msg err">${esc(c.error || '')}</div>`}
      <label class="check"><input type="checkbox" id="cOn"${c.enabled ? ' checked' : ''}> Модель может запускать Python</label>
      <div class="msg" id="cmsg"></div><div class="btns"><button type="button" class="btn" id="cTest"><svg><use href="#i-bolt"/></svg>Проверить</button></div></div>
    <div class="card"><div class="chead"><div><h2>Встроенный браузер</h2><div class="sub">Chromium: чтение сложных сайтов, скриншоты, самопроверка созданных сайтов</div></div><span class="badge ${b.installed ? 'ok' : 'bad'}">${b.installed ? 'установлен · ' + esc(b.lib) : 'не установлен'}</span></div>
      ${b.installed ? (b.error ? `<div class="msg err">Последняя ошибка: ${esc(b.error)}</div>` : '') : '<div class="msg">Выполните в папке проекта: npm install (см. README)</div>'}
      <label class="check"><input type="checkbox" id="bOn"${b.browser ? ' checked' : ''}> Модель открывает страницы в настоящем браузере</label>
      <label class="check"><input type="checkbox" id="bCheck"${b.selfcheck ? ' checked' : ''}> Самопроверка сайтов: модель открывает свой сайт и исправляет ошибки</label>
      <div class="msg" id="bmsg"></div><div class="btns"><button type="button" class="btn" id="bTest"><svg><use href="#i-bolt"/></svg>Проверить браузер</button></div></div>`;
  const ph = () => { const need = ['tavily', 'brave', 'serper'].includes($('wProv').value); $('wKey').disabled = !need; $('wKey').placeholder = need ? (w.hasKey ? w.key + ' (сохранён)' : 'вставьте ключ') : 'не нужен'; };
  $('wProv').onchange = ph; ph();
  const wsave = () => post('/api/admin/search', { provider: $('wProv').value, key: $('wKey').value });
  $('webF').onsubmit = async (e) => { e.preventDefault(); try { await wsave(); $('wKey').value = ''; say('wmsg', 'Сохранено', 'ok'); } catch (err) { fail('wmsg')(err); } };
  $('wTest').onclick = async () => { say('wmsg', 'Ищу «новости сегодня»…'); try { await wsave(); const j = await post('/api/admin/search/test'); j.ok ? say('wmsg', 'Работает: ' + j.results.map((x) => host(x.url)).join(', '), 'ok') : say('wmsg', j.error, 'err'); } catch (err) { fail('wmsg')(err); } };
  const IPRE = { or: ['https://openrouter.ai/api/v1', 'google/gemini-2.5-flash-image', 'chat', ''], oai: ['https://api.openai.com/v1', 'gpt-image-1', 'images', '{"quality":"medium"}'], tg: ['https://api.together.xyz/v1', 'black-forest-labs/FLUX.1-schnell', 'images', '{"response_format":"b64_json","steps":4}'] };
  document.querySelectorAll('[data-ipre]').forEach((x) => { x.onclick = () => { const v = IPRE[x.dataset.ipre]; $('iUrl').value = v[0]; $('iModel').value = v[1]; $('iMode').value = v[2]; $('iExtra').value = v[3]; $('iSize').value = ''; $('iKey').focus(); say('imsg', 'Вставьте ключ этого сервиса и нажмите «Проверить»'); }; });
  const isave = async () => { const j = await post('/api/admin/image', { baseUrl: $('iUrl').value, modelId: $('iModel').value, apiKey: $('iKey').value, mode: $('iMode').value, size: $('iSize').value, extra: $('iExtra').value, on: $('iOn').checked }); $('iKey').value = ''; if (j.hasKey) $('iKey').placeholder = j.apiKey + ' (сохранён)'; const okk = j.on && j.baseUrl && j.modelId && j.hasKey; $('iBadge').className = 'badge ' + (okk ? 'ok' : 'warn'); $('iBadge').textContent = okk ? 'Включено' : j.baseUrl ? 'Выключено' : 'Не настроено'; return j; };
  $('imgF').onsubmit = async (e) => { e.preventDefault(); try { const j = await isave(); say('imsg', j.on && !(j.baseUrl && j.modelId && j.hasKey) ? 'Сохранено, но не хватает URL, модели или ключа' : 'Сохранено', j.on && !(j.baseUrl && j.modelId && j.hasKey) ? 'err' : 'ok'); } catch (err) { fail('imsg')(err); } };
  $('iOn').onchange = () => isave().then(() => say('imsg', 'Сохранено', 'ok')).catch(fail('imsg'));
  $('wmOn').onchange = async () => { try { await post('/api/admin/watermark', { on: $('wmOn').checked }); $('wmBadge').className = 'badge ' + ($('wmOn').checked ? 'ok' : 'warn'); $('wmBadge').textContent = $('wmOn').checked ? 'Включено' : 'Выключено'; } catch (e) { console.error(e); } };
  $('iTest').onclick = async () => { $('iTest').disabled = true; $('iPrev').hidden = true; say('imsg', 'Сохраняю и рисую тестовую картинку… (обычно 5–30 секунд)');
    try { await isave(); const j = await post('/api/admin/image/test'); if (j.ok) { say('imsg', `Работает: ${(j.ms / 1000).toFixed(1)} с, ${Math.round(j.size / 1024)} КБ`, 'ok'); $('iPrev').innerHTML = `<img src="${j.image}" alt="Тестовая картинка">`; $('iPrev').hidden = false; } else say('imsg', j.error, 'err'); }
    catch (err) { fail('imsg')(err); } $('iTest').disabled = false; };
  const VPRE = { fal: ['https://queue.fal.run', 'fal-ai/kling-video/v2.1/standard/text-to-video', 'fal', '5', ''], falveo: ['https://queue.fal.run', 'fal-ai/veo3/fast', 'fal', '8s', '{"generate_audio":false}'], oai: ['https://api.openai.com/v1', 'sora-2', 'openai', '4', ''], rep: ['https://api.replicate.com/v1', 'wan-video/wan-2.2-t2v-fast', 'replicate', '', ''] };
  document.querySelectorAll('[data-vpre]').forEach((x) => { x.onclick = () => { const v = VPRE[x.dataset.vpre]; $('vUrl').value = v[0]; $('vModel').value = v[1]; $('vMode').value = v[2]; $('vSec').value = v[3]; $('vExtra').value = v[4]; $('vKey').focus(); say('vmsg', 'Вставьте ключ этого сервиса и нажмите «Сохранить» или «Проверить»'); }; });
  const vsave = async () => { const j = await post('/api/admin/video', { baseUrl: $('vUrl').value, modelId: $('vModel').value, apiKey: $('vKey').value, mode: $('vMode').value, seconds: $('vSec').value, extra: $('vExtra').value, on: $('vOn').checked }); $('vKey').value = ''; if (j.hasKey) $('vKey').placeholder = j.apiKey + ' (сохранён)'; $('vBadge').className = 'badge ' + (vOk(j) ? 'ok' : 'warn'); $('vBadge').textContent = vOk(j) ? 'Включено' : j.modelId ? 'Выключено' : 'Не настроено'; return j; };
  $('vidF').onsubmit = async (e) => { e.preventDefault(); try { const j = await vsave(); say('vmsg', j.on && !vOk(j) ? 'Сохранено, но не хватает модели или ключа' : 'Сохранено', j.on && !vOk(j) ? 'err' : 'ok'); } catch (err) { fail('vmsg')(err); } };
  $('vOn').onchange = () => vsave().then(() => say('vmsg', 'Сохранено', 'ok')).catch(fail('vmsg'));
  const vwatch = async () => { // тест идёт в фоне на сервере — опрашиваем
    const t = (await api('/api/admin/video')).test || {}; if (!$('vmsg')) return;
    if (t.state === 'run') { say('vmsg', `Делаю тестовое видео… ${t.p ? t.p + '% · ' : ''}${Math.round((Date.now() - t.at) / 1000)} с`); return setTimeout(vwatch, 3000); }
    $('vTest').disabled = false;
    if (t.state === 'ok') { say('vmsg', `Работает: ${(t.ms / 1000).toFixed(0)} с, ${(t.size / 1048576).toFixed(1)} МБ`, 'ok'); $('vPrev').innerHTML = `<video src="${t.url}" controls autoplay muted loop playsinline style="max-width:100%;border-radius:10px"></video>`; $('vPrev').hidden = false; }
    else if (t.state === 'err') say('vmsg', t.error, 'err');
  };
  $('vTest').onclick = async () => { $('vTest').disabled = true; $('vPrev').hidden = true; try { await vsave(); const j = await post('/api/admin/video/test'); if (!j.ok) { say('vmsg', j.error, 'err'); $('vTest').disabled = false; return; } vwatch(); } catch (err) { fail('vmsg')(err); $('vTest').disabled = false; } };
  if (vd.test?.state === 'run') { $('vTest').disabled = true; vwatch(); }
  $('cOn').onchange = () => post('/api/admin/code', { enabled: $('cOn').checked }).then(() => say('cmsg', 'Сохранено', 'ok')).catch(fail('cmsg'));
  $('cTest').onclick = async () => { say('cmsg', 'Запускаю…'); $('cTest').disabled = true; try { const j = await post('/api/admin/code/test'); j.ok ? say('cmsg', j.out + ' · ' + (j.ms / 1000).toFixed(1) + ' с', 'ok') : say('cmsg', j.error, 'err'); } catch (err) { fail('cmsg')(err); } $('cTest').disabled = false; };
  const bsave = () => post('/api/admin/browser', { browser: $('bOn').checked, selfcheck: $('bCheck').checked }).then(() => say('bmsg', 'Сохранено', 'ok')).catch(fail('bmsg'));
  $('bOn').onchange = bsave; $('bCheck').onchange = bsave;
  $('bTest').onclick = async () => { say('bmsg', 'Запускаю браузер… (первый запуск — до 10 секунд)'); $('bTest').disabled = true; try { const j = await post('/api/admin/browser/test'); j.ok ? say('bmsg', 'Работает — страница открыта за ' + (j.ms / 1000).toFixed(1) + ' с', 'ok') : say('bmsg', j.error, 'err'); } catch (err) { fail('bmsg')(err); } $('bTest').disabled = false; };
};

})();
