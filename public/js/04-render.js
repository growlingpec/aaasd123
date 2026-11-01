// Premier — клиент: render (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- render ---------- */
function renderSide() {
  $('projects').innerHTML = S.projects.map((p) => `<button class="item ${S.proj === p.id ? 'on' : ''}" data-p="${p.id}"><svg><use href="#i-folder"/></svg><span>${esc(p.name)}</span><span class="gear" data-pset="${p.id}" role="button" aria-label="Настройки проекта" title="Настройки проекта"><svg><use href="#i-gear"/></svg></span></button>`).join('');
  const p = S.projects.find((x) => x.id === S.proj);
  $('chatsHead').textContent = p ? 'Чаты в «' + p.name + '»' : 'Недавние';
  const list = S.chats.filter((c) => (!S.proj || c.proj === S.proj) && (!filter || c.title.toLowerCase().includes(filter)));
  $('chats').innerHTML = list.map((c) => `<button class="item ${c.id === S.cur ? 'on' : ''}" data-c="${c.id}">${busyMap.has(c.id) ? '<i class="busydot" title="Генерация идёт"></i>' : ''}<span>${esc(c.title)}</span><span class="x" data-del="${c.id}" role="button" aria-label="Удалить чат" title="Удалить" style="flex:none;display:grid"><svg style="width:13px;height:13px"><use href="#i-x"/></svg></span></button>`).join('') || `<div class="empty-s">${filter ? 'Ничего не найдено' : 'Здесь появятся ваши чаты'}</div>`;
  requestAnimationFrame(placeHL);
  $('side').classList.toggle('closed', !S.side && !mobile());
  $('openSide').hidden = S.side && !mobile();
}
function placeHL() {
  const hl = $('hl'), on = $('chats').querySelector('.item.on');
  if (!on) { hl.style.opacity = 0; return; }
  hl.style.transform = `translateY(${on.offsetTop}px)`; hl.style.height = on.offsetHeight + 'px'; hl.style.opacity = 1;
  if (hl.classList.contains('noanim')) requestAnimationFrame(() => hl.classList.remove('noanim'));
}
function renderTop() {
  const m = curModel();
  $('mname').textContent = m ? m.name : (MODELS.length ? 'Выберите модель' : 'Нет моделей');
  $('menu').innerHTML = MODELS.length
    ? MODELS.map((x) => `<button type="button" class="opt ${x.id === S.model ? 'on' : ''}${locked(x) ? ' locked' : ''}" data-m="${x.id}" role="menuitem"><div><b>${esc(x.name)}${locked(x) ? ` <span class="lockt">${esc(tierName(x))}</span>` : ''}</b>${x.weight && x.weight !== 1 ? `<small>1 запрос = ${x.weight} ${x.weight < 1 ? 'сообщения' : plural(x.weight, 'сообщение', 'сообщения', 'сообщений')} лимита</small>` : ''}</div><svg class="ck"><use href="#i-check"/></svg></button>`).join('')
    : `<div class="opt" style="cursor:default"><div><b>Модели не подключены</b><small>Разработчик может добавить их в Панели</small></div></div>`;
  const c = cur(), p = S.projects.find((x) => x.id === (c ? c.proj : S.proj));
  $('crumb').innerHTML = (p ? esc(p.name) + (c ? ' / ' : '') : '') + (c ? '<b>' + esc(c.title) + '</b>' : '');
  $('ptag').textContent = p && !c ? 'в проекте «' + p.name + '»' : '';
}
// готовые сценарии на пустом чате: q — отправить сразу; fill — вставить в поле (дописать детали); file — ещё и выбрать файл;
// cloud — нужен облачный компьютер (включается сам, на Free — предложение тарифа)
const SUGG_BOT = { ic: 'i-tg', t: 'Telegram-бот', h: 'Код и запуск в облачном компьютере', cloud: true, fill: 'Сделай Telegram-бота на Python (aiogram 3) для напоминаний: /add 18:30 Купить молоко, /list, /del. Запусти его в облачном компьютере и проверь, что он отвечает. Мой токен от @BotFather: ' };
const SUGG_CODE = { ic: 'i-code', t: 'Помочь с кодом', h: 'Написать или объяснить', q: 'Напиши функцию на JavaScript, которая убирает дубликаты из массива' };
function suggList() {
  const cloud = typeof CL !== 'undefined' && CL.st?.ok;
  return [
    { ic: 'i-globe', t: 'Лендинг', h: 'Сайт с живым превью за минуту', q: 'Сделай лендинг для кофейни «Зерно»: меню с ценами, галерея, отзывы и форма брони столика' },
    { ic: 'i-game', t: 'Игра', h: 'В браузере, сразу можно играть', q: 'Сделай браузерную игру «Змейка»: управление стрелками и свайпами, счёт, рекорд и растущая скорость' },
    cloud ? { ...SUGG_BOT, pro: !clOk() } : SUGG_CODE,
    { ic: 'i-table', t: 'Разбор Excel', h: 'Цифры, тренды и график', file: true, fill: 'Разбери таблицу: главные цифры, тренды и аномалии — и построй понятный график' },
  ];
}
function renderSugg() {
  const c = cur(), empty = !c || !c.msgs.length;
  $('sugg').innerHTML = empty && MODELS.length ? `<div class="sugg">${suggList().map((x, i) => `<button type="button" data-sg="${i}"><svg><use href="#${x.ic}"/></svg><span><b>${x.t}${x.pro ? ' <em class="sgpro">Pro</em>' : ''}</b><small>${x.h}</small></span></button>`).join('')}</div>` : '';
}
function pickSugg(i) {
  const x = suggList()[i]; if (!x) return;
  if (x.q) return send(x.q);
  if (x.cloud) {
    if (!clOk()) return openPlans('Telegram-боты и другие программы работают в облачном компьютере — он есть на тарифах Pro и Max.');
    AG.mode = 'cloud'; AG.on = true; agSave(); agRender(); toast('Модель будет работать в облачном компьютере');
  }
  const q = $('q'); q.value = x.fill; grow(); renderSend(); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
  if (x.file) $('fileIn').click();
}
function greet() {
  const h = new Date().getHours(), g = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const n = ME.id !== 'guest' ? String(ME.name || '').trim().split(/\s+/)[0] : '';
  return esc(n ? g + ', ' + n : g);
}
function renderChat() {
  const c = cur(), col = $('col');
  const empty = !c || !c.msgs.length;
  document.querySelector('.main').classList.toggle('empty', empty);
  renderSugg();
  if (empty) {
    const p = S.projects.find((x) => x.id === S.proj);
    const sub = !MODELS.length ? 'Модели пока не подключены' : (p ? 'Новый чат в этом проекте' : 'Чем займёмся сегодня?');
    col.innerHTML = `<div class="hello"><h1>${p ? esc(p.name) : greet()}</h1><p class="hi-sub">${sub}</p>${p ? `<div class="pinfo">${p.instructions ? 'Инструкции: ' + esc(p.instructions.length > 140 ? p.instructions.slice(0, 140) + '…' : p.instructions) + ' ' : 'У проекта пока нет инструкций. '}<button data-pset="${p.id}">${p.instructions ? 'Изменить' : 'Добавить'}</button></div>` : ''}</div>`;
    return;
  }
  col.innerHTML = c.msgs.map((m, i) => {
    const cls = seen.has(m.id) ? '' : ' in'; seen.add(m.id);
    if (m.r === 'u') return `<div class="msg u-wrap${cls}" data-id="${m.id}">${uAtts(m)}${m.pick ? `<div class="u"><div class="upick"><svg><use href="#i-pick"/></svg>${esc(m.pick.name)}${m.pick.text ? ' — «' + esc(m.pick.text.slice(0, 40)) + '»' : ''}</div></div>` : ''}${m.t ? `<div class="u"><div class="bub">${esc(m.t)}</div></div>` : ''}<div class="acts u"><button class="ib" data-edit="${i}" aria-label="Изменить" title="Изменить"><svg><use href="#i-edit"/></svg></button><button class="ib" data-copy="${i}" aria-label="Копировать" title="Копировать"><svg><use href="#i-copy"/></svg></button></div></div>`;
    const body = m.err ? `<div class="errbox">${esc(m.err)}</div>` : md(stripLog(m.t), m.id) + (m.live && !m.thinking ? '<span class="cursor"></span>' : '');
    return `<div class="msg a${cls}" data-id="${m.id}"><div class="who"><div class="mark${m.thinking ? ' breathe' : ''}"><img src="/icon-p-amber.svg" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>Premier <i>· ${esc(m.m || '')}${m.thinking ? ' · думает…' : ''}</i></div>${thinkHtml(m)}${stepsHtml(m)}${fsHtml(m)}${agHtml(m)}${runsHtml(m)}${m.validation && m.validation.status !== 'passed' ? validationHtml(m) : ''}<div class="md">${body}</div>${outsHtml(m)}${m.validation?.status === 'passed' ? validationHtml(m) : ''}${m.live ? '' : srcHtml(m)}${m.live ? '' : `<div class="acts">${m.err ? `<button class="ib" data-redo="${i}" aria-label="Повторить" title="Повторить — ответ будет сгенерирован заново"><svg><use href="#i-redo"/></svg></button>` : `<button class="ib" data-copy="${i}" aria-label="Копировать" title="Копировать"><svg><use href="#i-copy"/></svg></button>`}<button class="ib" data-redo="${i}" aria-label="Сгенерировать заново" title="Сгенерировать заново"><svg><use href="#i-redo"/></svg></button>${(TTS || VOICES.length) && !m.err && m.t ? `<button class="ib${SPEAK === m.id ? ' on' + (SPEAK_LOAD ? ' load' : '') : ''}" data-speak="${m.id}" aria-label="${SPEAK === m.id ? 'Остановить' : 'Озвучить'}" title="${SPEAK === m.id ? 'Остановить' : 'Озвучить'}"><svg><use href="#i-speak"/></svg></button>` : ''}</div>`}</div>`;
  }).join('');
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
function stepsHtml(m) {
  if (!m.steps?.length) return '';
  return `<div class="steps">${m.steps.map((st, i) => {
    const on = m.live && m.stepOn && i === m.steps.length - 1;
    const [ic, label] = st.s === 'search' ? ['i-search', (on ? 'Ищу: ' : 'Искал: ') + '«' + st.q + '»'] : st.s === 'read' ? ['i-book', (on ? 'Читаю: ' : 'Прочитал: ') + host(st.q)]
      : st.s === 'view' ? ['i-globe', (on ? 'Смотрю: ' : 'Посмотрел: ') + host(st.q)]
      : st.s === 'check' ? ['i-globe', on ? 'Проверяю сайт в браузере…' : st.ok ? 'Проверил сайт в браузере — всё в порядке' : 'Проверил сайт в браузере']
      : st.s === 'fix' ? ['i-warn', on ? 'Нашёл недочёты — исправляю…' : 'Нашёл недочёты и исправил']
      : st.s === 'waiting' ? ['i-brain', st.q]
      : st.s === 'repair' ? ['i-code', on ? 'Запрашиваю полный HTML вместо обещания…' : 'Повторно запросил полный HTML']
      : st.s === 'repair_edit' ? ['i-code', 'Повторная проверка точечных правок']
      : st.s === 'edit' ? ['i-code', 'Режим правки текущей версии: ' + st.q]
      : st.s === 'create' ? ['i-code', 'Режим создания новой версии']
      : st.s === 'mem' ? ['i-brain', 'Запомнил: ' + st.q] : st.s === 'forget' ? ['i-brain', 'Забыл: ' + st.q]
      : st.s === 'code' ? ['i-code', on ? 'Выполняю код…' : 'Выполнил код']
      : st.s === 'image' ? ['i-image', (on ? 'Рисую: ' : 'Нарисовал: ') + '«' + st.q + '»']
      : st.s === 'asset' ? ['i-file', (on ? 'Загружаю 3D-модель: ' : 'Загружал 3D-модель: ') + st.q]
      : st.s === 'video' ? ['i-video', (on ? 'Снимаю видео: ' : 'Сделал видео: ') + '«' + st.q + '»'] : ['i-warn', 'Не удалось: ' + st.q];
    return `<div class="step${on ? ' on' : ''}"><svg><use href="#${ic}"/></svg><span>${esc(label)}</span></div>`;
  }).join('')}</div>`;
}
const OPEN = new Set();
document.addEventListener('toggle', (e) => { const k = e.target.dataset?.key; if (k) e.target.open ? OPEN.add(k) : OPEN.delete(k); }, true);
function thinkHtml(m) {
  if (!m.think) return '';
  const on = m.live && !m.t, k = m.id + ':think';
  return `<details class="think${on ? ' on' : ''}" data-key="${k}"${on || OPEN.has(k) ? ' open' : ''}><summary><svg><use href="#i-brain"/></svg><span>${on ? 'Размышляю…' : 'Размышления' + (m.thinkMs ? ' · ' + Math.max(1, Math.round(m.thinkMs / 1000)) + ' с' : '')}</span></summary><div class="think-b">${esc(m.think.trim())}</div></details>`;
}
function runsHtml(m) {
  if (!m.runs?.length) return '';
  return `<div class="runs">${m.runs.map((r, i) => {
    const k = m.id + ':r' + i, ok = r.exit === 0 && !r.timeout;
    return `<details class="run" data-key="${k}"${OPEN.has(k) ? ' open' : ''}><summary><svg><use href="#i-code"/></svg><b>Python</b><span class="${ok ? '' : 'bad'}">${r.timeout ? 'остановлен по времени' : ok ? 'выполнен' : 'ошибка'} · ${(r.ms / 1000).toFixed(1)} с</span></summary><div class="pre"><div class="bar"><span>python</span><button data-copycode>Копировать</button></div><pre><code>${esc(r.code)}</code></pre>${r.out ? `<div class="outp">${esc(r.out)}</div>` : ''}${r.err ? `<div class="outp err">${esc(r.err)}</div>` : ''}</div></details>`;
  }).join('')}</div>`;
}
// строки-журналы, которые раньше дописывались в ответы; модели иногда пишут их сами, ничего не сделав — не показываем и не отправляем
const LOG_RE = /^[ \t]*\[(Действия на компьютере|Изменения в папке|Нарисованные картинки|Сделанные видео|Созданные файлы):[^\n]*\][ \t]*$/gm;
const stripLog = (t) => String(t || '').replace(LOG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
// история для модели. Что реально выполнено инструментами, сообщаем заметкой в начале СЛЕДУЮЩЕГО сообщения пользователя,
// а не в тексте ответа ассистента — иначе модель копирует формат и «выполняет» действия на словах
function buildHistory(list) {
  const out = []; let log = [];
  for (const x of list) {
    if (x.r === 'u') {
      let c = apiContent(x);
      if (log.length) {
        const note = '(Журнал Premier — что на самом деле выполнили инструменты в прошлом ответе ассистента: ' + log.join('; ') + '. Ассистент такие заметки не пишет.)\n\n';
        c = typeof c === 'string' ? note + c : [{ type: 'text', text: note + (c.find((p) => p.type === 'text')?.text || '') }, ...c.filter((p) => p.type !== 'text')];
        log = [];
      }
      out.push({ role: 'user', content: c });
    } else {
      out.push({ role: 'assistant', content: x.validation && x.validation.status !== 'passed' ? '(Код этой попытки не подтверждён проверкой Premier и не становится активной основой автоматически. Результат: ' + x.validation.status + '; ' + (x.validation.checks || []).filter(c => !['passed','not_required'].includes(c.status)).map(c => c.label + ': ' + c.detail).join('; ') + ')' : stripLog(x.t) || '(ответ без текста)', gens: x.gens?.length ? x.gens.map((g) => ({ url: g.url, prompt: String(g.prompt || '').slice(0, 200) })).slice(0, 4) : undefined, ...(x.validation ? { validation: { status: x.validation.status } } : {}) });
      log = [
        ...(x.runs?.some((r) => r.files?.length) ? ['созданы файлы ' + x.runs.flatMap((r) => (r.files || []).map((f) => f.name)).join(', ')] : []),
        ...(x.assets?.length ? ['скачаны реальные 3D-модели: ' + x.assets.map(a => a.ref + ' (' + a.name + '; лицензия: ' + a.license + ')').join(', ')] : []),
        ...(x.gens?.length ? ['нарисованы картинки: ' + x.gens.map((g) => '«' + (g.prompt || '').slice(0, 200) + '»').join(', ')] : []),
        ...(x.vids?.length ? ['сделаны видео: ' + x.vids.map((g) => '«' + (g.prompt || '').slice(0, 200) + '»').join(', ')] : []),
        fsSummary(x), agSummary(x)].filter(Boolean);
      if ((x.agops?.length || x.fsops?.length) && !log.some((l) => /компьютер|папк/.test(l))) log.push('действий на компьютере и в папке не было');
      else if (!x.agops?.length && !x.fsops?.length && /(удал|созда|переимен|перемест|запуст|выполн)\S*/i.test(x.t || '') && (typeof AG !== 'undefined' && (AG.conn || clUsable()))) log.push('инструменты компьютера в этом ответе НЕ вызывались — значит, ничего на компьютере не изменилось');
    }
  }
  return out;
}
function gensHtml(m) {
  const kind = m.live && m.stepOn ? m.steps?.at(-1)?.s : '', wait = kind === 'image' || kind === 'video';
  const n = (m.gens?.length || 0) + (m.vids?.length || 0) + (wait ? 1 : 0);
  if (!n) return '';
  const dl = '<svg><use href="#i-dl"/></svg>';
  return `<div class="gens${n > 1 ? ' multi' : ''}">${(m.gens || []).map((g, i) => `<figure class="gen"><img src="${esc(g.url)}" alt="${esc(g.prompt || 'Картинка')}" title="${esc(g.prompt || '')}" data-zoom loading="lazy"><a class="gen-dl" href="${esc(g.url)}?dl=1" download="premier-${i + 1}.${esc(g.name.split('.').pop())}" aria-label="Скачать" title="Скачать">${dl}</a></figure>`).join('')}${(m.vids || []).map((v, i) => `<figure class="gen vid"><video src="${esc(v.url)}" controls playsinline loop preload="metadata" title="${esc(v.prompt || '')}"></video><a class="gen-dl" href="${esc(v.url)}?dl=1" download="premier-video-${i + 1}.${esc(v.name.split('.').pop())}" aria-label="Скачать" title="Скачать">${dl}</a></figure>`).join('')}${wait ? drawHtml(m, kind) : ''}</div>`;
}
// «модель рисует»: живая анимация, пока картинка/видео готовится
function drawHtml(m, kind) {
  const v = kind === 'video', p = v && Number.isFinite(m.vprog) ? m.vprog : null;
  m.drawAt ||= Date.now(); const sec = Math.round((Date.now() - m.drawAt) / 1000), t = sec >= 60 ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : sec + ' с';
  return `<figure class="gen draw${v ? ' v' : ''}"><div class="dblobs"><i></i><i></i><i></i><i></i></div><div class="dgrain"></div>
    <div class="dpen"><svg><use href="#i-${v ? 'video' : 'edit'}"/></svg></div>
    <figcaption><b>${v ? 'Снимаю видео' : 'Рисую картинку'}</b><span data-dtime>${p != null ? p + '% · ' : ''}${t}</span>${v ? `<em class="dbar"><i style="width:${p ?? 3}%"></i></em><small>Видео делается 1–5 минут — не закрывайте вкладку</small>` : ''}</figcaption></figure>`;
}
setInterval(() => { // тикаем таймер в карточке рисования без полной перерисовки чата
  const LDM = liveMap.get(S.cur); if (!LDM?.drawAt) return; const el = document.querySelector('.gen.draw [data-dtime]'); if (!el) return;
  const sec = Math.round((Date.now() - LDM.drawAt) / 1000), t = sec >= 60 ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : sec + ' с';
  el.textContent = (Number.isFinite(LDM.vprog) ? LDM.vprog + '% · ' : '') + t;
}, 1000);
function assetHtml(m) {
  const hasCode = !!PremierArtifact.latest(m.t || ''), used = PremierAssets.ids(m.t || '').length;
  if (!m.assets?.length && !used) return '';
  return '<div class="outs">' + (m.assets || []).map(a => `<a class="ofile" href="/a/${esc(a.id)}/model.glb" download="model.glb"><b>${esc(a.name)}</b><small>${fmtB(a.size)} · GLB · ${esc(a.license)} (не проверена автоматически)</small></a>`).join('') +
    (hasCode ? `<button class="btn" data-zip="${esc(m.id)}" data-fmt="zip">Скачать проект с 3D-моделями (ZIP)</button>` : '') + '</div>';
}
function outsHtml(m) {
  const list = (m.runs || []).flatMap((r) => r.files || []); if (!list.length) return gensHtml(m) + assetHtml(m);
  return `<div class="outs">${list.map((f) => f.image
    ? `<div class="imgw"><img src="${esc(f.url)}" alt="${esc(f.name)}" data-zoom loading="lazy"><a href="${esc(f.url)}?dl=1" download="${esc(f.name)}">${esc(f.name)} · скачать</a></div>`
    : `<a class="ofile" href="${esc(f.url)}?dl=1" download="${esc(f.name)}"><span class="art-ic"><svg><use href="#i-file"/></svg></span><span style="min-width:0"><b>${esc(f.name)}</b><small>${fmtB(f.size)} · скачать</small></span></a>`).join('')}</div>` + gensHtml(m) + assetHtml(m);
}
function srcHtml(m) {
  if (!m.sources?.length) return '';
  return `<div class="srcs">${m.sources.map((x, i) => `<a class="src" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title)}"><b>${i + 1}</b><span>${esc(host(x.url))}</span></a>`).join('')}</div>`;
}
function renderSend() {
  $('webBtn').hidden = !CFG.search; $('webBtn').classList.toggle('on', !!S.web); $('webBtn').setAttribute('aria-pressed', String(!!S.web));
  $('imgBtn').hidden = !CFG.image; $('imgBtn').classList.toggle('on', !!S.img); $('imgBtn').setAttribute('aria-pressed', String(!!S.img));
  const st = busyMap.has(S.cur); const b = $('send'); b.classList.toggle('stop', st);
  b.disabled = !st && ((!$('q').value.trim() && !PEND.length) || !MODELS.length);
  b.setAttribute('aria-label', st ? 'Остановить' : 'Отправить');
}
function render() { renderSide(); renderTop(); renderChat(); renderSend(); }
const toBottom = () => { const c = $('chat'); c.scrollTop = c.scrollHeight; };

function validationHtml(m) {
  if (!m.validation) return '';
  const v=m.validation, title=v.status==='passed'?'Техническая проверка пройдена':v.status==='failed'?'Проверка не пройдена':'Работоспособность не подтверждена';
  const labels={passed:'✓',failed:'✕',unverified:'?',not_required:'—'};
  return `<details class="validation-box" ${v.status==='passed'?'':'open'}><summary>${esc(title)}</summary><ul>${(v.checks||[]).map(c=>`<li>${esc(labels[c.status]||'?')} ${esc(c.label)}<small>${esc(c.detail)}</small></li>`).join('')}</ul><small>Это технический smoke-тест, а не полная проверка игрового процесса. Неподтверждённая версия не заменяет активную автоматически.</small></details>`;
}
