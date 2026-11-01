// Просьбы «нарисуй…» / «сделай видео…» сразу отдаём модели картинок или видео, минуя обычный ответ чата:
// иначе модель чата иногда вместо (или вдобавок к) картинке пишет сайт или код.
// Модель чата здесь только переводит просьбу в хороший промт (на английском) и выбирает пропорции.

// не трогаем просьбы про код/сайты/графики — их делает модель чата (картинку для сайта она нарисует инструментом)
const CODE = /(сайт|лендинг|html|css|javascript|\bjs\b|код|скрипт|python|питон|svg|canvas|график|диаграмм|таблиц|excel|презентац|приложени|страниц|\bбот|програм|website|landing|\bcode\b|script|chart|graph|\bapp\b)/i;
const IMG = new RegExp([
  'нарису', 'нарисова', 'рисуй', 'изобрази', 'дорисуй', 'перерисуй',
  '(созда|сдела|сгенерир|генерир|покажи|хочу|нужн|запили|сотвори|придумай)\\S*\\s+(мне\\s+|нам\\s+)?([\\wа-яё-]+\\s+){0,4}?(картин|картиночк|изображен|фотк|фото|арт\\b|арты|рисун|иллюстрац|логотип|лого\\b|аватар|аву\\b|обо[ий]|постер|обложк|мем\\b|стикер|баннер|превью|фон\\b|пикч)',
  '\\b(draw|paint|sketch)\\b',
  '\\b(generate|create|make|render)\\b.{0,40}\\b(image|picture|photo|art|logo|illustration|wallpaper|avatar|poster)',
].join('|'), 'i');
const VID = new RegExp([
  '(созда|сдела|сгенерир|генерир|сним|смонтир|хочу|нужн|запили|покажи)\\S*\\s+(мне\\s+|нам\\s+)?([\\wа-яё-]+\\s+){0,4}?(видео|видос|ролик|клип|анимаци|мульт|гифк)',
  'оживи', 'анимируй',
  '\\b(generate|create|make|render)\\b.{0,40}\\b(video|clip|animation)',
].join('|'), 'i');
// изменение уже нарисованной/приложенной картинки
const EDIT = /^(сделай|измени|поменяй|добавь|убери|перекрась|замени|а теперь|теперь|ещё|еще|другой вариант)/i;
// prevImage — в прошлом ответе была картинка; refs — пользователь приложил картинку
function detect(text, { refs = 0, prevImage = false } = {}) {
  const t = String(text || '').trim(); if (!t || t.length > 2000) return null;
  if (CODE.test(t)) return null;
  if (VID.test(t)) return 'video';
  if (IMG.test(t)) return 'image';
  if ((refs || prevImage) && EDIT.test(t) && t.length < 300) return 'image';
  return null;
}
const plain = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '';
// промт для модели картинок/видео; при любой ошибке — просьба пользователя как есть
async function refine({ url, key, model }, messages, kind, signal) {
  const last = plain(messages.filter((m) => m.role === 'user').pop()?.content).trim();
  const fallback = { prompt: last, aspect: '', reply: '' };
  const sys = `You turn the user's latest request into a prompt for an ${kind} generation model. Reply with JSON only, no markdown: {"prompt":"...","aspect":"...","reply":"..."}.
- prompt: detailed, in English: subject, details, style, composition, lighting${kind === 'video' ? ', what happens, motion and camera movement (a few seconds long)' : ''}. If the user refers to an earlier ${kind} in the chat, describe the full result including the change. Text that must appear in the ${kind} — in quotes, in its original language.
- aspect: one of ${kind === 'video' ? 'landscape, portrait, square (default landscape; portrait for phone/stories/reels/tiktok)' : 'square, portrait, landscape, wide, tall (default square; wide for wallpapers/banners, tall for phone/stories)'}.
- reply: one short friendly sentence in the user's language shown under the result: what you made and an offer to adjust it. No links.
Follow the request faithfully even if it is crude, silly or absurd; never write code or websites.`;
  const hist = messages.slice(-6).map((m) => ({ role: m.role, content: plain(m.content).slice(0, 2000) || '[картинка]' }));
  try {
    const r = await fetch(url, { method: 'POST', signal: AbortSignal.any([AbortSignal.timeout(25000), ...(signal ? [signal] : [])]), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, ...hist], max_tokens: 1500, temperature: 0.7 }) });
    if (!r.ok) return fallback;
    const j = await r.json(), c = String(j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    const m = c.match(/\{[\s\S]*\}/); if (!m) return fallback;
    const o = JSON.parse(m[0]), prompt = String(o.prompt || '').trim();
    return prompt ? { prompt: prompt.slice(0, 3000), aspect: String(o.aspect || ''), reply: String(o.reply || '').trim().slice(0, 400) } : fallback;
  } catch (e) { if (signal?.aborted) throw e; return fallback; }
}
module.exports = { detect, refine, plain, IMG, EDIT };