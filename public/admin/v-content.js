// Раздел «Объявления»: баннер в чате (с расписанием, аудиторией и предпросмотром) и режим технических работ.
'use strict';
(() => {
  const LEVELS = [['info', 'Инфо'], ['warn', 'Важно'], ['success', 'Хорошая новость'], ['promo', 'Акция']];
  const local = (t) => (t ? new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const fromLocal = (v) => (v ? new Date(v).getTime() : null);

  R.content = async () => {
    const el = $('view');
    const [a, m] = await Promise.all([api('/api/admin/announce'), api('/api/admin/maintenance')]);
    if (!el.isConnected) return;
    const ed = can('content.edit'), dis = ed ? '' : ' disabled';
    const status = () => { const now = Date.now(); return !a.on ? ['', 'Выключено'] : a.from && a.from > now ? ['warn', 'Запланировано на ' + dtt(a.from)] : a.until && a.until < now ? ['', 'Срок показа истёк'] : ['ok', 'Показывается сейчас' + (a.until ? ' · до ' + dtt(a.until) : '')]; };
    el.innerHTML = `<div class="grid g2">
      <form class="card" id="anF" style="margin:0" autocomplete="off">
        <div class="chead"><div><h2>${I('megaphone')}Объявление в чате</h2><div class="sub" id="anSt"></div></div><label class="switch"><input type="checkbox" name="on"${a.on ? ' checked' : ''}${dis}><i></i></label></div>
        <div class="field"><span>Предпросмотр</span><div id="anPrev"></div></div>
        <label class="field"><span>Текст</span><textarea name="text" rows="3" maxlength="500" placeholder="Например: Скидка 20% на Pro до воскресенья по промокоду OCT20"${dis}>${esc(a.text)}</textarea></label>
        <label class="field"><span>Текст для английской версии <span class="dim">(необязательно)</span></span><textarea name="textEn" rows="2" maxlength="500" placeholder="Если пусто — показываем русский текст"${dis}>${esc(a.textEn)}</textarea></label>
        <div class="field"><span>Вид</span><div class="seg" id="anLvl">${LEVELS.map(([k, t]) => `<button type="button" data-l="${k}" class="${a.level === k ? 'on' : ''}"${dis}>${t}</button>`).join('')}</div></div>
        <div class="grid g2" style="gap:0 12px"><label class="field"><span>Ссылка <span class="dim">(необязательно)</span></span><input name="link" value="${esc(a.link)}" placeholder="/chat?pay=1 или https://…"${dis}></label><label class="field"><span>Текст ссылки</span><input name="linkText" value="${esc(a.linkText)}" maxlength="40" placeholder="Подробнее"${dis}></label></div>
        <div class="grid g2" style="gap:0 12px"><label class="field"><span>Показывать с</span><input type="datetime-local" name="from" value="${local(a.from)}"${dis}></label><label class="field"><span>Показывать до</span><input type="datetime-local" name="until" value="${local(a.until)}"${dis}></label></div>
        <label class="field"><span>Кому</span><select name="audience"${dis}><option value="all"${a.audience === 'all' ? ' selected' : ''}>Всем</option><option value="users"${a.audience === 'users' ? ' selected' : ''}>Только вошедшим</option><option value="guests"${a.audience === 'guests' ? ' selected' : ''}>Только гостям</option></select></label>
        <div class="field"><span>Тарифы <span class="dim">(ничего не выбрано — все)</span></span><div class="chips" id="anPlans">${a.planList.map((p) => `<button type="button" class="chip${a.plans.includes(p.id) ? ' on' : ''}" data-p="${p.id}"${dis}>${I('check')}${esc(p.name)}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" name="dismissible"${a.dismissible ? ' checked' : ''}${dis}>Можно закрыть крестиком (до нового текста)</label>
        <div class="msg" id="anMsg"></div>
        ${ed ? '<div class="btns"><button class="btn pri">Сохранить</button></div>' : ''}
      </form>
      <form class="card" id="mtF" style="margin:0" autocomplete="off">
        <div class="chead"><div><h2>${I('alert')}Технические работы</h2><div class="sub">${m.on ? `<span class="warn-t">Включены${m.since ? ' ' + ago(m.since) : ''}</span>${m.until ? ' · до ' + dtt(m.until) : ''}` : 'Выключены'}</div></div><label class="switch"><input type="checkbox" name="on"${m.on ? ' checked' : ''}${dis}><i></i></label></div>
        <div class="note warn mb">Пока режим включён, новые сообщения в чате не отправляются — пользователь видит ваш текст. Вход, история чатов и оплата продолжают работать.</div>
        <label class="field"><span>Текст для пользователей</span><textarea name="text" rows="3" maxlength="300" placeholder="Идут технические работы. Попробуйте через 15 минут."${dis}>${esc(m.text)}</textarea></label>
        <label class="field"><span>Для английской версии <span class="dim">(необязательно)</span></span><textarea name="textEn" rows="2" maxlength="300"${dis}>${esc(m.textEn)}</textarea></label>
        <label class="field"><span>Выключить автоматически</span><input type="datetime-local" name="until" value="${local(m.until)}"${dis}><small>Пусто — пока не выключите вручную</small></label>
        <label class="check"><input type="checkbox" name="api"${m.api ? ' checked' : ''}${dis}>Остановить и API для разработчиков (/v1)</label>
        <div class="msg" id="mtMsg"></div>
        ${ed ? '<div class="btns"><button class="btn pri">Сохранить</button></div>' : ''}
      </form></div>`;
    const f = $('anF');
    let level = a.level;
    const preview = () => {
      const text = f.elements.text.value.trim(), link = f.elements.link.value.trim();
      $('anPrev').innerHTML = text ? `<div class="preview-banner ${level}">${I(level === 'warn' ? 'alert' : level === 'promo' ? 'gift' : level === 'success' ? 'check' : 'info')}<span class="grow">${esc(text)}${link ? ` <a href="#" onclick="return false">${esc(f.elements.linkText.value.trim() || 'Подробнее')} →</a>` : ''}</span>${f.elements.dismissible.checked ? I('x') : ''}</div>` : '<div class="note">Напишите текст — здесь появится баннер, как его увидят пользователи</div>';
      const s = status(); $('anSt').innerHTML = `<span class="${s[0] ? s[0] + '-t' : ''}">${esc(s[1])}</span>`;
    };
    f.oninput = preview; preview();
    $('anLvl').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b || b.disabled) return; level = b.dataset.l; qsa('#anLvl button').forEach((x) => x.classList.toggle('on', x === b)); preview(); };
    $('anPlans').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) b.classList.toggle('on'); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { on: f.elements.on.checked, text: f.elements.text.value, textEn: f.elements.textEn.value, level, link: f.elements.link.value, linkText: f.elements.linkText.value, from: fromLocal(f.elements.from.value), until: fromLocal(f.elements.until.value), audience: f.elements.audience.value, plans: qsa('#anPlans .chip.on').map((x) => x.dataset.p), dismissible: f.elements.dismissible.checked };
      try { Object.assign(a, await busy(f.querySelector('.btn.pri'), () => post('/api/admin/announce', body))); say('anMsg', body.on ? 'Сохранено — пользователи увидят баннер при следующем открытии чата' : 'Сохранено — баннер скрыт', 'ok'); preview(); refreshBadges(); } catch (er) { say('anMsg', er.message, 'err'); }
    };
    const g = $('mtF');
    g.onsubmit = async (e) => {
      e.preventDefault();
      const body = { on: g.elements.on.checked, text: g.elements.text.value, textEn: g.elements.textEn.value, api: g.elements.api.checked, until: fromLocal(g.elements.until.value) };
      if (body.on && !m.on && !(await confirmBox('Включить технические работы?', 'Пользователи не смогут отправлять сообщения в чат, пока режим включён.', { ok: 'Включить', danger: true }))) return;
      try { await busy(g.querySelector('.btn.pri'), () => post('/api/admin/maintenance', body)); toast(body.on ? 'Режим техработ включён' : 'Режим техработ выключен', 'ok'); refreshBadges(); R.content(); } catch (er) { say('mtMsg', er.message, 'err'); }
    };
  };
})();
