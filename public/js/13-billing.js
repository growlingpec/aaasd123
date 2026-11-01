// Premier — клиент: billing (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- тарифы и оплата ---------- */
let BILL = null;
const PL = { promo: null };
const fmtD = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const rub = (n) => Number(n).toLocaleString('ru-RU') + ' ₽';
const tierName = (m) => (BILL?.plans.filter((p) => (m.plans || []).includes(p.id)).sort((a, b) => a.price - b.price)[0] || {}).name || 'Pro';
const locked = (m) => !!BILL && !(m.plans || []).includes(BILL.plan.id);
async function loadBill() {
  try { const r = await fetch('/api/billing'); if (r.status === 401) return toLogin(); if (r.ok) BILL = await r.json(); } catch {}
  pickModel(); renderPlan(); renderTop(); renderPub();
}
// модель по умолчанию; недоступную по тарифу меняем на доступную
function pickModel() {
  const ok = (m) => m && !locked(m), c = curModel();
  if (ok(c)) return;
  const d = MODELS.find((m) => m.def);
  const next = ok(d) ? d : MODELS.find(ok) || d || MODELS[0];
  if (next && next.id !== S.model) { S.model = next.id; save(); }
}
function renderPlan() {
  const b = BILL; $('planCard').hidden = !b; if (!b) return;
  const top = Math.max(...b.plans.map((p) => p.tier));
  $('pcName').innerHTML = esc(b.plan.name) + (b.plan.trial ? ' <span class="pc-badge">пробный</span>' : '');
  $('pcUp').textContent = b.plan.tier >= top ? 'Тарифы' : 'Улучшить';
  const pcRst = $('pcRst'); if (pcRst) pcRst.hidden = !(b.pay && b.plan.id === 'max');
  const L = b.limits.m, u = b.used.m, bar = !b.unlimited && L != null;
  $('pcBarW').hidden = !bar;
  if (bar) { $('pcBar').style.width = Math.min(100, u / L * 100) + '%'; $('pcBarW').className = 'pc-bar' + (u >= L ? ' out' : L - u <= Math.max(2, L * 0.15) ? ' low' : ''); }
  $('pcText').textContent = (bar ? `${Math.min(u, L)} из ${L} ${plural(L, 'сообщения', 'сообщений', 'сообщений')} сегодня` : 'Без ограничений') + (b.plan.until ? ' · до ' + fmtD(b.plan.until) : '');
}
function planFeats(p) {
  const top = Math.max(...BILL.plans.map((x) => x.tier)), mods = MODELS.filter((m) => (m.plans || []).includes(p.id)).map((m) => m.name);
  const lim = (n, one, few, many, unl) => n == null ? unl : `${n} ${plural(n, one, few, many)} в день`;
  return [
    lim(p.msgs, 'сообщение', 'сообщения', 'сообщений', 'Сообщения без ограничений'),
    mods.length && mods.length === MODELS.length && MODELS.length > 1 ? 'Все модели: ' + mods.join(', ') : mods.length ? 'Модели: ' + mods.join(', ') : 'Базовые модели',
    lim(p.code, 'запуск', 'запуска', 'запусков', 'Python без ограничений').replace(/в день$/, 'Python в день'),
    lim(p.sites, 'сайт', 'сайта', 'сайтов', 'Сайты без ограничений'),
    ...(BILL.images ? [lim(p.images, 'картинка', 'картинки', 'картинок', 'Картинки без ограничений')] : []),
    ...(BILL.videos ? [p.videos === 0 ? 'Без видео' : lim(p.videos, 'видео', 'видео', 'видео', 'Видео без ограничений')] : []),
    ...(BILL.cloud ? [p.pc === 0 ? 'Без облачного компьютера' : 'Облачный компьютер' + (p.pc ? ' · ' + (p.pc >= 1024 ? +(p.pc / 1024).toFixed(1) + ' ГБ' : p.pc + ' МБ') : '')] : []),
    p.id === 'pro' || p.id === 'max' || p.tier > 0 ? 'Публикации без плашки Premier' : 'Публикации с плашкой Premier',
    'Интернет, память, файлы и голос',
  ];
}
function openPlans(reason) {
  if (!BILL) { loadBill().then(() => BILL && openPlans(reason)); return; }
  dlgW(true); $('dtitle').textContent = 'Тарифы Premier'; $('modal').classList.add('on');
  const top = Math.max(...BILL.plans.map((x) => x.tier)), pro = BILL.plans.find((x) => x.tier === 1);
  const cards = BILL.plans.map((p) => {
    const cur = p.id === BILL.plan.id, disc = PL.promo && (!PL.promo.plan || PL.promo.plan === p.id) && p.price > 0 ? Math.max(1, Math.round(p.price * (100 - PL.promo.discount) / 100)) : null;
    let btn;
    if (!p.price) btn = `<button class="btn" disabled>${cur ? 'Ваш тариф' : 'Бесплатно'}</button>`;
    else if (!BILL.pay) btn = `<button class="btn" disabled>Оплата скоро</button>`;
    else btn = `<button class="btn ${p === pro || cur ? 'pri' : ''}" data-buy="${p.id}">${cur ? 'Продлить' : p.tier < BILL.plan.tier ? 'Перейти' : 'Оплатить'} ${rub(disc ?? p.price)}</button>`;
    return `<div class="plan${p === pro ? ' hot' : ''}${cur ? ' cur' : ''}">${p === pro ? '<span class="tag">Популярный</span>' : ''}
      <div><h3>${esc(p.name)}${cur ? ' <span class="pc-badge">сейчас</span>' : ''}</h3><p>${esc(p.desc || '')}</p></div>
      <div class="price">${p.price ? (disc != null ? `<s>${p.price}</s>` : '') + rub(disc ?? p.price) + ` <small>/ ${p.days} дн.</small>` : '0 ₽'}</div>
      <ul>${planFeats(p).map((f) => `<li><svg><use href="#i-check"/></svg><span>${esc(f)}</span></li>`).join('')}</ul>${btn}</div>`;
  }).join('');
  $('dbody').innerHTML = `${reason ? `<div class="reason">${esc(reason)}</div>` : ''}
    ${BILL.plan.until ? `<div class="msgline">Сейчас: <b>${esc(BILL.plan.name)}</b>${BILL.plan.trial ? ' (пробный период)' : ''} до ${fmtD(BILL.plan.until)}. Продление добавляет дни к текущему сроку.</div>` : ''}
    ${BILL.methods && [BILL.methods.card, BILL.methods.robokassa, BILL.methods.cispay, BILL.methods.crypto].filter(Boolean).length > 1 ? `<div class="paym" role="radiogroup" aria-label="Способ оплаты"><span>Способ оплаты</span><div class="seg">${BILL.methods.card ? `<button type="button" data-paym="card" aria-checked="${payMethod() === 'card'}">Карта</button>` : ''}${BILL.methods.robokassa ? `<button type="button" data-paym="robokassa" aria-checked="${payMethod() === 'robokassa'}">Зарубежная карта (Visa/MC)</button>` : ''}${BILL.methods.cispay ? `<button type="button" data-paym="cispay" aria-checked="${payMethod() === 'cispay'}">СБП (cISPay)</button>` : ''}${BILL.methods.crypto ? `<button type="button" data-paym="crypto" aria-checked="${payMethod() === 'crypto'}">Криптовалюта</button>` : ''}</div></div>` : ''}
    <div class="plans">${cards}</div>
    <form class="promo" id="promoF" autocomplete="off"><input id="promoIn" placeholder="Промокод" maxlength="30" value="${esc(PL.promo?.code || '')}"><button class="btn">Применить</button><span class="msgline" id="promoMsg">${PL.promo ? `Скидка ${PL.promo.discount}% применится при оплате` : ''}</span></form>
    <div class="msgline" id="payMsg"></div>
    <p class="pnote">${BILL.pay ? (payMethod() === 'crypto' ? 'Оплата в @CryptoBot: USDT, TON, BTC и другие монеты — сумма пересчитывается из рублей по курсу.' : payMethod() === 'cispay' ? 'Оплата через СБП (cISPay) — откроется страница оплаты, платёж подтверждается в приложении банка.' : payMethod() === 'robokassa' ? 'Оплата зарубежной картой Visa/Mastercard (130+ стран) — сумма спишется в валюте вашей карты.' : 'Оплата картой или через СБП (Platega).') + ' Без автопродления — тариф действует оплаченный срок.' : 'Онлайн-оплата скоро появится — а пока тариф можно получить через <a href="https://t.me/freeb404f" target="_blank" rel="noopener">наш Telegram</a>.'} Лимиты обновляются в полночь по Москве.</p>`;
  $('dbody').querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.paym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openPlans(reason); }; });
  $('promoF').onsubmit = async (e) => {
    e.preventDefault(); const code = $('promoIn').value.trim(); if (!code) return;
    const say = (t, c = '') => { $('promoMsg').className = 'msgline ' + c; $('promoMsg').textContent = t; };
    try {
      const j = await memApi('/api/billing/promo', { method: 'POST', body: JSON.stringify({ code }) });
      if (j.gift) { PL.promo = null; BILL = j.billing; renderPlan(); renderTop(); openPlans(); toast(`Промокод активирован: ${BILL.plan.name} до ${fmtD(BILL.plan.until)}`); }
      else { PL.promo = j; openPlans(reason); }
    } catch (err) { say(err.message, 'err'); }
  };
}
// платный сброс дневного лимита: модалка с выбором способа оплаты (кнопка в карточке плана)
function openReset() {
  if (!BILL) { loadBill().then(() => BILL && openReset()); return; }
  if (!BILL.pay) return;
  dlgW(true); $('dtitle').textContent = 'Сброс дневного лимита'; $('modal').classList.add('on');
  const m = BILL.methods || {};
  const opts = [m.card && `<button type="button" data-paym="card" aria-checked="${payMethod() === 'card'}">Карта</button>`, m.robokassa && `<button type="button" data-paym="robokassa" aria-checked="${payMethod() === 'robokassa'}">Зарубежная карта (Visa/MC)</button>`, m.cispay && `<button type="button" data-paym="cispay" aria-checked="${payMethod() === 'cispay'}">СБП (cISPay)</button>`, m.crypto && `<button type="button" data-paym="crypto" aria-checked="${payMethod() === 'crypto'}">Криптовалюта</button>`].filter(Boolean);
  $('dbody').innerHTML = `<div class="msgline">Сброс обнуляет счётчики текущих суток (по Москве): сообщения, запуски Python, сайты, картинки и видео. Действует сразу после оплаты.</div>
    ${opts.length > 1 ? `<div class="paym" role="radiogroup" aria-label="Способ оплаты"><span>Способ оплаты</span><div class="seg">${opts.join('')}</div></div>` : ''}
    <button class="btn pri" id="resetGo" style="width:100%;margin-top:12px">Сбросить лимит — ${rub(BILL.resetPrice ?? 125)}</button>
    <div class="msgline" id="payMsg"></div>
    <p class="pnote">Без автопродлений. Лимит обновится в полночь по Москве в любом случае.</p>`;
  $('dbody').querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.paym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openReset(); }; });
  $('resetGo').onclick = () => buyPlan('reset', $('resetGo'));
}
function payMethod() {
  const m = BILL?.methods || {}; const avail = ['card', 'robokassa', 'cispay', 'crypto'].filter((k) => m[k]);
  if (!avail.length) return 'card';
  if (!PL.method) { try { PL.method = localStorage.getItem('premier:paym'); } catch {} }
  return avail.includes(PL.method) ? PL.method : avail[0];
}
async function buyPlan(id, b) {
  const method = payMethod(), crypto_ = method === 'crypto';
  // счёт Crypto Bot открываем в новой вкладке (Telegram), а здесь ждём оплату; окно открываем сразу, иначе браузер заблокирует
  const w = crypto_ && !/Telegram/i.test(navigator.userAgent) ? window.open('', '_blank') : null;
  b.disabled = true; const t = b.textContent; b.textContent = crypto_ ? 'Создаю счёт…' : 'Переходим к оплате…';
  try {
    const j = await memApi('/api/pay/create', { method: 'POST', body: JSON.stringify({ plan: id, method, promo: id === 'reset' ? '' : (PL.promo && (!PL.promo.plan || PL.promo.plan === id) ? PL.promo.code : '') }) });
    if (method === 'robokassa') { const d = document.createElement('div'); d.style.display = 'none'; d.innerHTML = j.form || ''; document.body.appendChild(d); const f = d.querySelector('form'); if (!f) throw new Error('Не удалось открыть страницу оплаты — попробуйте другой способ'); b.textContent = 'Переходим к оплате…'; f.submit(); return; }
    if (!crypto_) { location.href = j.url; return; }
    if (w) { w.location.href = j.url; } else { location.href = j.url; return; }
    b.textContent = 'Жду оплату…'; const pm = $('payMsg'); if (pm) pm.className = 'msgline';
    if (pm) pm.innerHTML = `Счёт открыт в Crypto Bot. Не видите? <a href="${esc(j.url)}" target="_blank" rel="noopener">Открыть счёт</a>. ${id === 'reset' ? 'Лимит сбросится сам после оплаты.' : 'Тариф включится сам после оплаты.'}`;
    watchPay(j.order, 1200).finally(() => { b.disabled = false; b.textContent = t; });
  }
  catch (err) { if (w) w.close(); b.disabled = false; b.textContent = t; const pm = $('payMsg'); if (pm) { pm.className = 'msgline err'; pm.textContent = err.message; } else toast(err.message); }
}
// ждём подтверждения платежа (возврат со страницы оплаты или счёт в Crypto Bot)
async function watchPay(order, tries = 20) {
  let plan = null;
  for (let i = 0; i < tries; i++) {
    try {
      const j = await (await fetch('/api/pay/check?order=' + encodeURIComponent(order))).json(); plan = j.plan || plan;
      if (j.status === 'CONFIRMED') { BILL = j.billing; renderPlan(); renderTop(); if ($('modal').classList.contains('on') && ['Тарифы Premier', 'Сброс дневного лимита'].includes($('dtitle').textContent)) $('modal').classList.remove('on'); toast(j.plan === 'reset' ? 'Оплата прошла! Дневной лимит сброшен' : `Оплата прошла! ${BILL.plan.name} активен до ${fmtD(BILL.plan.until)}`); return 'ok'; }
      if (j.status === 'CANCELED') { toast('Платёж отменён или счёт истёк'); return 'cancel'; }
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  toast(plan === 'reset' ? 'Платёж ещё обрабатывается — лимит сбросится автоматически' : 'Платёж ещё обрабатывается — тариф включится автоматически'); return 'wait';
}
// возврат со страницы оплаты
(async () => {
  const q = new URLSearchParams(location.search), st = q.get('pay'), order = q.get('order'); if (!st) return;
  history.replaceState(null, '', '/chat');
  if (st === 'fail') { toast('Оплата не прошла — попробуйте ещё раз'); return; }
  toast('Проверяю оплату…');
  await watchPay(order);
})();
