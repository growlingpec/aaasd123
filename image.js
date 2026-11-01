// Генерация изображений через внешний API. Два формата:
//  images — OpenAI-совместимый POST /images/generations (OpenAI gpt-image-1 / dall-e-3, Together, многие прокси)
//  chat   — POST /chat/completions с modalities: ['image','text'] (OpenRouter: Gemini Flash Image, GPT-Image и др.)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'data');
const DEF = { on: false, mode: 'auto', baseUrl: '', modelId: '', apiKey: '', size: '', extra: '' };
const ASPECT = { square: ['1:1', '1024x1024'], portrait: ['2:3', '1024x1536'], landscape: ['3:2', '1536x1024'], wide: ['16:9', '1536x1024'], tall: ['9:16', '1024x1536'] };

const cfgOf = (st) => ({ ...DEF, ...(st.image || {}) });
const ready = (st) => { const c = cfgOf(st); return !!(c.on && c.baseUrl && c.modelId && c.apiKey); };
const modeOf = (c) => c.mode !== 'auto' ? c.mode
  : /\/chat\/completions\/?$/.test(c.baseUrl) || /openrouter\.ai|generativelanguage\.googleapis/.test(c.baseUrl) ? 'chat' : 'images';
function url(c, mode) {
  const u = c.baseUrl.trim().replace(/\/+$/, '');
  if (/\/(images\/generations|chat\/completions)$/.test(u)) return u;
  return u + (mode === 'chat' ? '/chat/completions' : '/images/generations');
}
const extraOf = (c) => { if (!c.extra || !c.extra.trim()) return {}; try { const j = JSON.parse(c.extra); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { throw new Error('Дополнительные параметры — не JSON'); } };

const TOOL = { type: 'function', function: { name: 'generate_image', description: 'Нарисовать изображение по описанию: картинки, иллюстрации, логотипы, обложки, арт, фотореалистичные сцены. Если пользователь приложил картинку и просит её изменить — use_attached: true.', parameters: { type: 'object', properties: {
  prompt: { type: 'string', description: 'Подробное описание изображения на английском: объект, стиль, композиция, свет, цвета. Текст, который должен быть на картинке, — в кавычках на нужном языке.' },
  aspect: { type: 'string', enum: Object.keys(ASPECT), description: 'Пропорции: square (по умолчанию), portrait, landscape, wide (16:9), tall (9:16)' },
  use_attached: { type: 'boolean', description: 'true — если пользователь правит или дополняет ПРЕДЫДУЩУЮ картинку: приложенную им или нарисованную тобой раньше в этом диалоге («добавь…», «измени…», «пусть скажет…», «другой фон/вид»)' } }, required: ['prompt'] } } };
const NOTE = `\n\nУ тебя есть инструмент generate_image — он рисует картинки.
- Вызывай, когда пользователь просит нарисовать, сгенерировать, создать изображение, логотип, иллюстрацию, обложку и т. п. Для графиков по данным используй Python, а не generate_image.
- Готовая картинка автоматически показывается пользователю под ответом — не вставляй её ссылкой или Markdown-картинкой. Кратко опиши, что получилось, и предложи доработать.
 - Если просят картинку — НЕ пиши сайт, HTML, SVG или код: просто вызови generate_image.
  - Если в диалоге уже есть нарисованная картинка и пользователь уточняет или правит её («а я имел в виду…», «сделай как…», «добавь сюда…», «пусть он скажет/сделает…», «измени вид/фон/позу», «ещё вариант») — это generate_image С use_attached: true: промт описывает результат целиком (что остаётся + что меняется), и система сама возьмёт предыдущую картинку за основу. На такие уточнения кодом не отвечаем. Ты сам картинку не видишь — опирайся на её промт из журнала.
 - Одна картинка — один вызов. Несколько вариантов делай, только если об этом просят (не больше 4).`;
const LIMIT = '\n\nЛИМИТ: генерация изображений на сегодня исчерпана по тарифу пользователя. Если он просит картинку — вежливо скажи об этом и предложи улучшить тариф (кнопка «Тарифы» в левом меню).';

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  return null;
}
async function fetchImg(src, signal) {
  if (/^data:image\//.test(src)) return Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
  if (!/^https:\/\//.test(src)) throw new Error('модель вернула непонятную ссылку на картинку');
  const r = await fetch(src, { signal }); if (!r.ok) throw new Error('не удалось скачать картинку: ' + r.status);
  const b = Buffer.from(await r.arrayBuffer()); if (b.length > 25e6) throw new Error('картинка слишком большая'); return b;
}
async function apiErr(r) {
  let t = await r.text().catch(() => ''); try { const j = JSON.parse(t); t = j.error?.message || j.message || j.error || t; } catch {}
  return new Error(`API картинок ответил ${r.status}: ${String(typeof t === 'string' ? t : JSON.stringify(t)).slice(0, 300)}`);
}
// найти картинку в ответе chat/completions (форматы OpenRouter, Gemini-прокси, markdown-ссылка)
function chatImage(j) {
  const msg = j.choices?.[0]?.message || {};
  for (const im of msg.images || []) { const u = im.image_url?.url || im.url || im.b64_json && 'data:image/png;base64,' + im.b64_json; if (u) return u; }
  if (Array.isArray(msg.content)) for (const p of msg.content) {
    const u = p.image_url?.url || p.url || (p.type === 'image' && (p.data || p.source?.data) && `data:${p.mime_type || p.source?.media_type || 'image/png'};base64,${p.data || p.source.data}`);
    if (u) return u;
    if (p.inline_data?.data) return `data:${p.inline_data.mime_type || 'image/png'};base64,${p.inline_data.data}`;
  }
  if (typeof msg.content === 'string') { const m = msg.content.match(/!\[[^\]]*\]\(([^)\s]+)\)/) || msg.content.match(/(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)/) || msg.content.match(/(https:\/\/\S+\.(?:png|jpe?g|webp))/i); if (m) return m[1]; }
  return null;
}

// сгенерировать; refs — data:-URL картинок пользователя (для chat-формата)
async function generate(st, { prompt, aspect, refs = [] }, signal) {
  const c = cfgOf(st), mode = modeOf(c), a = ASPECT[aspect] || ASPECT.square, extra = extraOf(c);
  prompt = String(prompt || '').trim().slice(0, 4000); if (!prompt) throw new Error('пустое описание');
  const sig = AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]);
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey, 'HTTP-Referer': process.env.PUBLIC_URL || 'https://premier', 'X-Title': 'Premier' };
  let src, text = '';
  if (mode === 'chat') {
    const content = refs.length ? [{ type: 'text', text: prompt }, ...refs.slice(0, 3).map((u) => ({ type: 'image_url', image_url: { url: u } }))] : prompt;
    const body = { model: c.modelId, messages: [{ role: 'user', content }], modalities: ['image', 'text'], image_config: { aspect_ratio: a[0] }, ...extra };
    const r = await fetch(url(c, mode), { method: 'POST', headers, body: JSON.stringify(body), signal: sig });
    if (!r.ok) throw await apiErr(r);
    const j = await r.json(); src = chatImage(j);
    const mc = j.choices?.[0]?.message?.content; text = typeof mc === 'string' ? mc : '';
    if (!src) throw new Error('модель не вернула картинку' + (text ? ': ' + text.slice(0, 200) : ' — проверьте, что это модель для изображений'));
  } else {
    // Tier-размеры (1K/2K/3K/4K) уходят вместе с ratio; точные пиксели — как раньше (OpenAI/Flux).
    const tier = /^[1-4]K$/i.test(String(c.size || '').trim()) ? String(c.size).trim().toUpperCase() : '';
    const body = tier
      ? { model: c.modelId, prompt, n: 1, size: tier, ratio: a[0], ...extra }
      : { model: c.modelId, prompt, n: 1, ...(c.size === 'none' ? {} : { size: c.size || a[1] }), ...extra };
    // img2img: приложенные картинки пользователя (data:-URL). OpenAI — top-level image, остальные хабy — extra_body.image.
    if (refs.length) { const r3 = refs.slice(0, 3); if (/openai\.com/i.test(c.baseUrl)) body.image = r3; else body.extra_body = { ...(body.extra_body || {}), image: r3 }; }
    let r = await fetch(url(c, mode), { method: 'POST', headers, body: JSON.stringify(body), signal: sig });
    // провайдер не знает размер/пропорцию — повторяем упрощённым запросом
    if (!r.ok && r.status === 400) {
      const e = await apiErr(r);
      if (tier && /ratio/i.test(e.message)) { delete body.ratio; r = await fetch(url(c, mode), { method: 'POST', headers, body: JSON.stringify(body), signal: sig }); }
      else if (!tier && body.size && !c.size && /size/i.test(e.message)) { delete body.size; r = await fetch(url(c, mode), { method: 'POST', headers, body: JSON.stringify(body), signal: sig }); }
      else throw e;
    }
    if (!r.ok) throw await apiErr(r);
    const j = await r.json(), d = j.data?.[0] || j.images?.[0] || j.output?.[0] || {};
    src = d.b64_json ? 'data:image/png;base64,' + d.b64_json : d.url || (typeof d === 'string' ? d : null);
    text = d.revised_prompt || '';
    if (!src) throw new Error('API не вернул картинку');
  }
  const buf = await fetchImg(src, sig), ext = sniff(buf);
  if (!ext) throw new Error('ответ API — не картинка');
  if (refs.length) console.log('img2img: refs=' + refs.length + ' out=' + ext + ' size=' + buf.length);
  return { buf, ext, text };
}
// картинка, нарисованная раньше в этом чате (клиент шлёт её url в history.gens) — в data:-URL для img2img
function refFromSaved(uid, url) {
  const m = String(url || '').match(/^\/api\/files\/([a-f0-9]{16})\/(image\.(?:png|jpe?g|webp|gif))$/i);
  if (!m) return null;
  try {
    const buf = fs.readFileSync(path.join(ROOT, 'files', uid, m[1], m[2]));
    if (buf.length > 8 * 1024 * 1024) return null;
    const ext = sniff(buf); if (!ext) return null;
    return 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + buf.toString('base64');
  } catch { return null; }
}
// сохранить в файлы пользователя (тот же склад, что у Python: /api/files/<fid>/<name>)
function save(uid, buf, ext) {
  const fid = crypto.randomBytes(8).toString('hex'), dir = path.join(ROOT, 'files', uid, fid), name = 'image.' + ext;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), buf);
  return { name, size: buf.length, url: `/api/files/${fid}/${name}`, image: true };
}
const adminView = (st) => { const c = cfgOf(st); return { ...c, apiKey: c.apiKey ? c.apiKey.slice(0, 4) + '••••' + c.apiKey.slice(-4) : '', hasKey: !!c.apiKey, effMode: c.baseUrl ? modeOf(c) : '' }; };
function update(st, b) {
  const c = cfgOf(st);
  if (typeof b.on === 'boolean') c.on = b.on;
  if (['auto', 'images', 'chat'].includes(b.mode)) c.mode = b.mode;
  if (typeof b.baseUrl === 'string') { const u = b.baseUrl.trim(); if (u) { try { if (!/^https?:$/.test(new URL(u).protocol)) throw 0; } catch { throw new Error('Некорректный URL API'); } } c.baseUrl = u; }
  if (typeof b.modelId === 'string') c.modelId = b.modelId.trim().slice(0, 200);
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) c.apiKey = b.apiKey.trim();
  if (typeof b.size === 'string') { const v = b.size.trim(); c.size = /^[1-4]k$/i.test(v) ? v.toUpperCase() : (/^(|none|auto|\d{3,4}x\d{3,4})$/.test(v) ? v : c.size); }
  if (typeof b.extra === 'string') { c.extra = b.extra.trim().slice(0, 2000); extraOf(c); }
  st.image = c; return c;
}
module.exports = { TOOL, NOTE, LIMIT, ready, generate, save, adminView, update, cfgOf, sniff, refFromSaved };
