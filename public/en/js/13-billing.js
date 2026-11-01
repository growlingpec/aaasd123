// Premier — клиент: billing (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- тарифы и оплата ---------- */
let BILL = null;
const PL = { promo: null };
const fmtD = (t) => new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
const rub = (n) => Number(n).toLocaleString('en-US') + ' ₽';
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
  $('pcName').innerHTML = esc(b.plan.name) + (b.plan.trial ? ' <span class="pc-badge">trial</span>' : '');
  $('pcUp').textContent = b.plan.tier >= top ? 'Plans' : 'Upgrade';
  const pcRst = $('pcRst'); if (pcRst) pcRst.hidden = !(b.pay && b.plan.id === 'max');
  const L = b.limits.m, u = b.used.m, bar = !b.unlimited && L != null;
  $('pcBarW').hidden = !bar;
  if (bar) { $('pcBar').style.width = Math.min(100, u / L * 100) + '%'; $('pcBarW').className = 'pc-bar' + (u >= L ? ' out' : L - u <= Math.max(2, L * 0.15) ? ' low' : ''); }
  $('pcText').textContent = (bar ? `${Math.min(u, L)} of ${L} ${plural(L, 'messages', 'messages', 'messages')} today` : 'Unlimited') + (b.plan.until ? ' · until ' + fmtD(b.plan.until) : '');
}
function planFeats(p) {
  const top = Math.max(...BILL.plans.map((x) => x.tier)), mods = MODELS.filter((m) => (m.plans || []).includes(p.id)).map((m) => m.name);
  const lim = (n, one, few, many, unl) => n == null ? unl : `${n} ${plural(n, one, few, many)} per day`;
  return [
    lim(p.msgs, 'message', 'messages', 'messages', 'Unlimited messages'),
    mods.length && mods.length === MODELS.length && MODELS.length > 1 ? 'All models: ' + mods.join(', ') : mods.length ? 'Models: ' + mods.join(', ') : 'Basic models',
    p.code == null ? 'Unlimited Python' : `${p.code} Python runs per day`,
    lim(p.sites, 'website', 'websites', 'websites', 'Unlimited websites'),
    ...(BILL.images ? [lim(p.images, 'image', 'images', 'images', 'Unlimited images')] : []),
    ...(BILL.videos ? [p.videos === 0 ? 'No video' : lim(p.videos, 'videos', 'videos', 'videos', 'Unlimited video')] : []),
    p.id === 'pro' || p.id === 'max' || p.tier > 0 ? 'Publications without the Premier badge' : 'Publications with the Premier badge',
    'Web, memory, files and voice',
  ];
}
function openPlans(reason) {
  if (!BILL) { loadBill().then(() => BILL && openPlans(reason)); return; }
  dlgW(true); $('dtitle').textContent = 'Premier plans'; $('modal').classList.add('on');
  const top = Math.max(...BILL.plans.map((x) => x.tier)), pro = BILL.plans.find((x) => x.tier === 1);
  const cards = BILL.plans.map((p) => {
    const cur = p.id === BILL.plan.id, disc = PL.promo && (!PL.promo.plan || PL.promo.plan === p.id) && p.price > 0 ? Math.max(1, Math.round(p.price * (100 - PL.promo.discount) / 100)) : null;
    let btn;
    if (!p.price) btn = `<button class="btn" disabled>${cur ? 'Your plan' : 'Free'}</button>`;
    else if (!BILL.pay) btn = `<button class="btn" disabled>Payments coming soon</button>`;
    else btn = `<button class="btn ${p === pro || cur ? 'pri' : ''}" data-buy="${p.id}">${cur ? 'Renew' : p.tier < BILL.plan.tier ? 'Switch' : 'Pay'} ${rub(disc ?? p.price)}</button>`;
    return `<div class="plan${p === pro ? ' hot' : ''}${cur ? ' cur' : ''}">${p === pro ? '<span class="tag">Popular</span>' : ''}
      <div><h3>${esc(p.name)}${cur ? ' <span class="pc-badge">current</span>' : ''}</h3><p>${esc(p.desc || '')}</p></div>
      <div class="price">${p.price ? (disc != null ? `<s>${p.price}</s>` : '') + rub(disc ?? p.price) + ` <small>/ ${p.days} days</small>` : '0 ₽'}</div>
      <ul>${planFeats(p).map((f) => `<li><svg><use href="#i-check"/></svg><span>${esc(f)}</span></li>`).join('')}</ul>${btn}</div>`;
  }).join('');
  $('dbody').innerHTML = `${reason ? `<div class="reason">${esc(reason)}</div>` : ''}
    ${BILL.plan.until ? `<div class="msgline">Current: <b>${esc(BILL.plan.name)}</b>${BILL.plan.trial ? ' (trial period)' : ''} until ${fmtD(BILL.plan.until)}. Renewing adds days to your current subscription.</div>` : ''}
    ${BILL.methods?.card && BILL.methods?.crypto ? `<div class="paym" role="radiogroup" aria-label="Payment method"><span>Payment method</span><div class="seg"><button type="button" data-paym="card" aria-checked="${payMethod() === 'card'}">Card or SBP</button><button type="button" data-paym="crypto" aria-checked="${payMethod() === 'crypto'}">Cryptocurrency</button></div></div>` : ''}
    <div class="plans">${cards}</div>
    <form class="promo" id="promoF" autocomplete="off"><input id="promoIn" placeholder="Promo code" maxlength="30" value="${esc(PL.promo?.code || '')}"><button class="btn">Apply</button><span class="msgline" id="promoMsg">${PL.promo ? `Discount ${PL.promo.discount}% discount will be applied at checkout` : ''}</span></form>
    <div class="msgline" id="payMsg"></div>
    <p class="pnote">${BILL.pay ? (payMethod() === 'crypto' ? 'Pay in @CryptoBot: USDT, TON, BTC and other coins — ruble prices are converted at the current exchange rate.' : 'Pay by card or via SBP (Platega).') + ' No auto-renewal — your plan lasts for the period you pay for.' : 'Online payments are coming soon. For now, get a plan through <a href="https://t.me/freeb404f" target="_blank" rel="noopener">our Telegram</a>.'} Limits reset at midnight Moscow time.</p>`;
  $('dbody').querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.paym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openPlans(reason); }; });
  $('promoF').onsubmit = async (e) => {
    e.preventDefault(); const code = $('promoIn').value.trim(); if (!code) return;
    const say = (t, c = '') => { $('promoMsg').className = 'msgline ' + c; $('promoMsg').textContent = t; };
    try {
      const j = await memApi('/api/billing/promo', { method: 'POST', body: JSON.stringify({ code }) });
      if (j.gift) { PL.promo = null; BILL = j.billing; renderPlan(); renderTop(); openPlans(); toast(`Promo code activated: ${BILL.plan.name} until ${fmtD(BILL.plan.until)}`); }
      else { PL.promo = j; openPlans(reason); }
    } catch (err) { say(err.message, 'err'); }
  };
}
// paid reset of daily limits: modal with payment method choice (button in the plan card)
function openReset() {
  if (!BILL) { loadBill().then(() => BILL && openReset()); return; }
  if (!BILL.pay) return;
  dlgW(true); $('dtitle').textContent = 'Reset daily limits'; $('modal').classList.add('on');
  const m = BILL.methods || {};
  const opts = [m.card && `<button type="button" data-paym="card" aria-checked="${payMethod() === 'card'}">Card or SBP</button>`, m.crypto && `<button type="button" data-paym="crypto" aria-checked="${payMethod() === 'crypto'}">Cryptocurrency</button>`].filter(Boolean);
  $('dbody').innerHTML = `<div class="msgline">The reset zeros today's counters (Moscow time): messages, Python runs, websites, images and video. It applies right after payment.</div>
    ${opts.length > 1 ? `<div class="paym" role="radiogroup" aria-label="Payment method"><span>Payment method</span><div class="seg">${opts.join('')}</div></div>` : ''}
    <button class="btn pri" id="resetGo" style="width:100%;margin-top:12px">Reset limits — ${rub(BILL.resetPrice ?? 125)}</button>
    <div class="msgline" id="payMsg"></div>
    <p class="pnote">No auto-renewals. Limits reset at midnight Moscow time anyway.</p>`;
  $('dbody').querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.paym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openReset(); }; });
  $('resetGo').onclick = () => buyPlan('reset', $('resetGo'));
}
function payMethod() {
  const m = BILL?.methods || {}; if (!m.card) return m.crypto ? 'crypto' : 'card'; if (!m.crypto) return 'card';
  if (!PL.method) { try { PL.method = localStorage.getItem('premier:paym'); } catch {} }
  return PL.method === 'crypto' ? 'crypto' : 'card';
}
async function buyPlan(id, b) {
  const method = payMethod(), crypto_ = method === 'crypto';
  // счёт Crypto Bot открываем в новой вкладке (Telegram), а здесь ждём оплату; окно открываем сразу, иначе браузер заблокирует
  const w = crypto_ && !/Telegram/i.test(navigator.userAgent) ? window.open('', '_blank') : null;
  b.disabled = true; const t = b.textContent; b.textContent = crypto_ ? 'Creating invoice…' : 'Redirecting to payment…';
  try {
    const j = await memApi('/api/pay/create', { method: 'POST', body: JSON.stringify({ plan: id, method, promo: id === 'reset' ? '' : (PL.promo && (!PL.promo.plan || PL.promo.plan === id) ? PL.promo.code : '') }) });
    if (!crypto_) { location.href = j.url; return; }
    if (w) { w.location.href = j.url; } else { location.href = j.url; return; }
    b.textContent = 'Waiting for payment…'; const pm = $('payMsg'); if (pm) pm.className = 'msgline';
    if (pm) pm.innerHTML = `The invoice is open in Crypto Bot. Cannot see it? <a href="${esc(j.url)}" target="_blank" rel="noopener">Open invoice</a>. ${id === 'reset' ? 'Your daily limits will be reset automatically after payment.' : 'Your plan will activate automatically after payment.'}`;
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
      if (j.status === 'CONFIRMED') { BILL = j.billing; renderPlan(); renderTop(); if ($('modal').classList.contains('on') && ['Premier plans', 'Reset daily limits'].includes($('dtitle').textContent)) $('modal').classList.remove('on'); toast(j.plan === 'reset' ? 'Payment successful! Daily limits reset' : `Payment successful! ${BILL.plan.name} active until ${fmtD(BILL.plan.until)}`); return 'ok'; }
      if (j.status === 'CANCELED') { toast('Payment cancelled or invoice expired'); return 'cancel'; }
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  toast(plan === 'reset' ? 'Payment is still processing — your daily limits will be reset automatically' : 'Payment is still processing — your plan will activate automatically'); return 'wait';
}
// возврат со страницы оплаты
(async () => {
  const q = new URLSearchParams(location.search), st = q.get('pay'), order = q.get('order'); if (!st) return;
  history.replaceState(null, '', '/chat');
  if (st === 'fail') { toast('Payment failed — please try again'); return; }
  toast('Checking payment…');
  await watchPay(order);
})();
