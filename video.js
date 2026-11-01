// Генерация видео через внешний API. Видео делается долго (от 30 секунд до нескольких минут), поэтому
// все форматы работают как «задача»: создать → опрашивать статус → скачать готовый файл.
//  openai    — OpenAI Sora: POST /videos, GET /videos/{id}, GET /videos/{id}/content
//  fal       — fal.ai (Kling, Veo, Wan, Hailuo, LTX…): POST https://queue.fal.run/<модель>, status_url, response_url
//  replicate — Replicate: POST /models/<владелец>/<модель>/predictions, опрос urls.get
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'data');
const DEF = { on: false, mode: 'auto', baseUrl: '', modelId: '', apiKey: '', seconds: '', extra: '' };
const ASPECT = { landscape: ['16:9', '1280x720'], portrait: ['9:16', '720x1280'], square: ['1:1', '1024x1024'] };

const cfgOf = (st) => ({ ...DEF, ...(st.video || {}) });
const ready = (st) => { const c = cfgOf(st); return !!(c.on && c.modelId && c.apiKey && (c.baseUrl || modeOf(c) !== 'openai')); };
const modeOf = (c) => c.mode !== 'auto' ? c.mode : /fal\.(run|ai)/.test(c.baseUrl) ? 'fal' : /replicate\.com/.test(c.baseUrl) ? 'replicate' : 'openai';
const base = (c) => String(c.baseUrl || '').trim().replace(/\/+$/, '');
const extraOf = (c) => { if (!c.extra || !c.extra.trim()) return {}; try { const j = JSON.parse(c.extra); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { throw new Error('Дополнительные параметры видео — не JSON'); } };

const TOOL = { type: 'function', function: { name: 'generate_video', description: 'Сделать короткое видео (ролик) по описанию. Если пользователь приложил картинку и просит её оживить/анимировать — use_attached: true.', parameters: { type: 'object', properties: {
  prompt: { type: 'string', description: 'Подробное описание ролика на английском: что в кадре, что происходит, движение камеры, стиль, свет.' },
  aspect: { type: 'string', enum: Object.keys(ASPECT), description: 'landscape 16:9 (по умолчанию), portrait 9:16 (для телефона, сторис), square 1:1' },
  use_attached: { type: 'boolean', description: 'Оживить картинку, которую приложил пользователь' } }, required: ['prompt'] } } };
const NOTE = `\n\nУ тебя есть инструмент generate_video — он делает короткие видео (несколько секунд). Вызывай, когда просят видео, ролик, клип, анимацию, «оживить» картинку. Готовое видео показывается пользователю само — не вставляй ссылку. Делается долго (до нескольких минут) — одно видео за раз.`;
const LIMIT = '\n\nЛИМИТ: генерация видео на сегодня недоступна по тарифу пользователя. Если он просит видео — вежливо скажи об этом и предложи улучшить тариф (кнопка «Тарифы» в левом меню). Не пытайся сделать видео кодом или сайтом.';

async function apiErr(r, what = 'API видео') {
  let t = await r.text().catch(() => ''); try { const j = JSON.parse(t); t = j.error?.message || j.detail?.[0]?.msg || j.detail || j.message || j.error || t; } catch {}
  return new Error(`${what} ответил ${r.status}: ${String(typeof t === 'string' ? t : JSON.stringify(t)).slice(0, 300)}`);
}
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('остановлено')); }, { once: true }); });
const dataUrlBlob = (u) => { const m = /^data:([^;]+);base64,(.*)$/.exec(u || ''); return m ? new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }) : null; };
function sniff(buf) {
  if (buf.slice(4, 8).toString() === 'ftyp') return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  return null;
}
async function download(src, headers, signal) {
  if (!/^https?:\/\//.test(String(src || ''))) throw new Error('API не вернул ссылку на видео');
  const r = await fetch(src, { headers, signal }); if (!r.ok) throw await apiErr(r, 'Скачивание видео');
  const b = Buffer.from(await r.arrayBuffer()); if (b.length > 300e6) throw new Error('видео слишком большое'); return b;
}
// найти ссылку на видео в ответе любого формата
function findUrl(o) {
  if (!o) return null; if (typeof o === 'string') return /^https?:\/\//.test(o) ? o : null;
  if (Array.isArray(o)) { for (const x of o) { const u = findUrl(x); if (u) return u; } return null; }
  for (const k of ['video', 'videos', 'output', 'url', 'video_url', 'result']) if (o[k]) { const u = findUrl(o[k]); if (u) return u; }
  return null;
}

// prog(p) — сообщить прогресс 0–100 (если API его даёт); refs — data:-URL картинок пользователя
async function generate(st, { prompt, aspect, refs = [] }, signal, prog = () => {}) {
  const c = cfgOf(st), mode = modeOf(c), a = ASPECT[aspect] || ASPECT.landscape, extra = extraOf(c), secs = String(c.seconds || '').trim();
  prompt = String(prompt || '').trim().slice(0, 4000); if (!prompt) throw new Error('пустое описание');
  const sig = AbortSignal.any([AbortSignal.timeout(15 * 60e3), ...(signal ? [signal] : [])]);
  const t0 = Date.now(), soft = () => prog(Math.min(95, Math.round((Date.now() - t0) / 1800))); // когда API не сообщает прогресс — примерный

  if (mode === 'openai') {
    const H = { Authorization: 'Bearer ' + c.apiKey }, B = base(c) || 'https://api.openai.com/v1';
    const fd = new FormData(); fd.append('model', c.modelId); fd.append('prompt', prompt); fd.append('size', a[1]); if (secs) fd.append('seconds', secs);
    for (const [k, v] of Object.entries(extra)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    const img = refs[0] && dataUrlBlob(refs[0]); if (img) fd.append('input_reference', img, 'reference.' + (img.type.split('/')[1] || 'png'));
    let r = await fetch(B + '/videos', { method: 'POST', headers: H, body: fd, signal: sig }); if (!r.ok) throw await apiErr(r);
    let j = await r.json(); const id = j.id; if (!id) throw new Error('API не вернул id задачи');
    while (!['completed', 'succeeded', 'failed', 'cancelled', 'expired'].includes(j.status)) {
      await sleep(5000, sig); r = await fetch(B + '/videos/' + id, { headers: H, signal: sig }); if (!r.ok) throw await apiErr(r); j = await r.json();
      Number.isFinite(j.progress) ? prog(Math.round(j.progress)) : soft();
    }
    if (j.status !== 'completed' && j.status !== 'succeeded') throw new Error('видео не получилось: ' + (j.error?.message || j.status));
    const buf = await download(B + '/videos/' + id + '/content', H, sig); return { buf, ext: sniff(buf) || 'mp4' };
  }
  if (mode === 'fal') {
    const H = { Authorization: 'Key ' + c.apiKey, 'Content-Type': 'application/json' }, B = (base(c) || 'https://queue.fal.run').replace(/fal\.ai\/?$/, 'fal.run');
    const input = { prompt, aspect_ratio: a[0], ...(secs ? { duration: secs } : {}), ...(refs[0] ? { image_url: refs[0] } : {}), ...extra };
    let r = await fetch(B + '/' + c.modelId.replace(/^\/+/, ''), { method: 'POST', headers: H, body: JSON.stringify(input), signal: sig }); if (!r.ok) throw await apiErr(r);
    let j = await r.json(); if (findUrl(j)) { const buf = await download(findUrl(j), {}, sig); return { buf, ext: sniff(buf) || 'mp4' }; }
    const stUrl = j.status_url, resUrl = j.response_url; if (!stUrl || !resUrl) throw new Error('API не вернул адрес задачи');
    for (;;) {
      await sleep(4000, sig); r = await fetch(stUrl, { headers: H, signal: sig }); if (!r.ok) throw await apiErr(r); j = await r.json(); soft();
      if (j.status === 'COMPLETED') break; if (j.status === 'FAILED' || j.status === 'ERROR' || j.error) throw new Error('видео не получилось: ' + (j.error || j.status));
    }
    r = await fetch(resUrl, { headers: H, signal: sig }); if (!r.ok) throw await apiErr(r); j = await r.json();
    const u = findUrl(j); if (!u) throw new Error('в ответе нет видео'); const buf = await download(u, {}, sig); return { buf, ext: sniff(buf) || 'mp4' };
  }
  if (mode === 'replicate') {
    const H = { Authorization: 'Bearer ' + c.apiKey, 'Content-Type': 'application/json' }, B = base(c) || 'https://api.replicate.com/v1';
    const input = { prompt, aspect_ratio: a[0], ...(secs ? { duration: Number(secs) || secs } : {}), ...(refs[0] ? { image: refs[0] } : {}), ...extra };
    const [own, ver] = c.modelId.split(':'), endpoint = ver ? B + '/predictions' : B + '/models/' + own + '/predictions';
    let r = await fetch(endpoint, { method: 'POST', headers: H, body: JSON.stringify(ver ? { version: ver, input } : { input }), signal: sig }); if (!r.ok) throw await apiErr(r);
    let j = await r.json();
    while (!['succeeded', 'failed', 'canceled'].includes(j.status)) {
      await sleep(4000, sig); r = await fetch(j.urls?.get || B + '/predictions/' + j.id, { headers: H, signal: sig }); if (!r.ok) throw await apiErr(r); j = await r.json(); soft();
    }
    if (j.status !== 'succeeded') throw new Error('видео не получилось: ' + (j.error || j.status));
    const u = findUrl(j.output); if (!u) throw new Error('в ответе нет видео'); const buf = await download(u, {}, sig); return { buf, ext: sniff(buf) || 'mp4' };
  }
  throw new Error('неизвестный формат API видео');
}
function save(uid, buf, ext) {
  const fid = crypto.randomBytes(8).toString('hex'), dir = path.join(ROOT, 'files', uid, fid), name = 'video.' + ext;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), buf);
  return { name, size: buf.length, url: `/api/files/${fid}/${name}`, video: true };
}
const adminView = (st) => { const c = cfgOf(st); return { ...c, apiKey: c.apiKey ? c.apiKey.slice(0, 4) + '••••' + c.apiKey.slice(-4) : '', hasKey: !!c.apiKey, effMode: c.modelId ? modeOf(c) : '' }; };
function update(st, b) {
  const c = cfgOf(st);
  if (typeof b.on === 'boolean') c.on = b.on;
  if (['auto', 'openai', 'fal', 'replicate'].includes(b.mode)) c.mode = b.mode;
  if (typeof b.baseUrl === 'string') { const u = b.baseUrl.trim(); if (u) { try { if (!/^https?:$/.test(new URL(u).protocol)) throw 0; } catch { throw new Error('Некорректный URL API'); } } c.baseUrl = u; }
  if (typeof b.modelId === 'string') c.modelId = b.modelId.trim().slice(0, 200);
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) c.apiKey = b.apiKey.trim();
  if (typeof b.seconds === 'string') c.seconds = /^\d{0,2}s?$/.test(b.seconds.trim()) ? b.seconds.trim() : c.seconds;
  if (typeof b.extra === 'string') { c.extra = b.extra.trim().slice(0, 2000); extraOf(c); }
  st.video = c; return c;
}
module.exports = { TOOL, NOTE, LIMIT, ready, generate, save, adminView, update, cfgOf, modeOf };