'use strict';
// Only self-contained GLB v2. No archives, scripts, login cookies or remote dependencies.
const http = require('http'), https = require('https');
const { resolveTarget } = require('./browser-proxy');
const MAX_BYTES = 20 * 1024 * 1024;
function checkedURL(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Нужен прямой URL .glb');
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || ![80,443].includes(Number(u.port || (u.protocol === 'https:' ? 443 : 80)))) throw new Error('Разрешены http/https без credentials, порты 80/443');
  u.hash = ''; return u;
}
function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((ok,no)=>{
    const stop=()=>{signal.removeEventListener('abort',stop);no(signal.reason || new Error('Загрузка отменена'));};
    signal.addEventListener('abort',stop,{once:true});
    promise.then(ok,no).finally(()=>signal.removeEventListener('abort',stop));
  });
}
async function fetchBinary(raw, { signal, lookup, request } = {}, redirects = 0) {
  signal?.throwIfAborted();
  const u = checkedURL(raw), target = await abortable(resolveTarget(u, lookup), signal);
  signal?.throwIfAborted();
  return new Promise((ok, no) => {
    const get = request || ((url, opts, cb) => (url.protocol === 'https:' ? https : http).get(url, opts, cb));
    const req = get(u, { agent: false, signal, headers: { 'User-Agent': 'Premier-Assets/1.0', Accept: 'model/gltf-binary, application/octet-stream', 'Accept-Encoding': 'identity' },
      lookup: (_host, opts, cb) => cb(null, opts?.all ? [{ address: target.host, family: target.family }] : target.host, target.family) }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.destroy();
        if (!res.headers.location || redirects >= 4) return no(new Error('Слишком много перенаправлений'));
        let next; try { next = new URL(res.headers.location, u); } catch(e) { return no(e); }
        fetchBinary(next.href, { signal, lookup, request }, redirects + 1).then(ok,no); return;
      }
      if (res.statusCode !== 200) { res.destroy(); return no(new Error('Ресурс вернул HTTP ' + res.statusCode)); }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); return no(new Error('Сжатый HTTP-ответ не поддерживается')); }
      if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); return no(new Error('Модель больше 20 МБ')); }
      let size = 0; const chunks = [];
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { no(new Error('Модель больше 20 МБ')); res.destroy(); req.destroy(); } else chunks.push(chunk); });
      res.on('end', () => ok({ data: Buffer.concat(chunks), url: u.href }));
      res.on('error', no); res.on('aborted', () => no(new Error('Загрузка модели оборвалась')));
    });
    req.setTimeout(15000, () => req.destroy(new Error('Таймаут загрузки модели'))); req.on('error', no);
  });
}
function validateGLB(data) {
  if (!Buffer.isBuffer(data) || data.length < 28 || data.length > MAX_BYTES || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) throw new Error('Нужен настоящий GLB v2, не HTML, ZIP или картинка');
  let pos = 12, doc, binSize = 0, chunks = 0;
  while (pos < data.length) {
    if (pos + 8 > data.length) throw new Error('Повреждённый GLB');
    const size = data.readUInt32LE(pos), type = data.readUInt32LE(pos+4); pos += 8;
    if (size % 4 || pos + size > data.length || size === 0) throw new Error('Повреждённый chunk GLB');
    if (chunks === 0 && type === 0x4e4f534a && size <= 2*1024*1024) {
      try { doc = JSON.parse(data.subarray(pos,pos+size).toString('utf8').trim()); } catch { throw new Error('Неверный JSON GLB'); }
    } else if (chunks === 1 && type === 0x004e4942) binSize = size;
    else throw new Error('Неподдерживаемая структура GLB');
    chunks++; pos += size;
  }
  if (!doc || doc.asset?.version !== '2.0' || !Array.isArray(doc.scenes) || !doc.scenes.length) throw new Error('GLB должен содержать сцену glTF 2.0');
  // URI anywhere (including extension fields) must not introduce extra network requests.
  const walk = (v, depth=0) => {
    if (depth > 100) throw new Error('Слишком сложная структура GLB');
    if (!v || typeof v !== 'object') return;
    for (const [k,x] of Object.entries(v)) { if (k.toLowerCase() === 'uri' && (typeof x !== 'string' || !/^data:(?:image\/(?:png|jpeg|webp)|application\/octet-stream);base64,[a-zA-Z0-9+/=]+$/.test(x))) throw new Error('GLB содержит внешние ресурсы; нужен self-contained .glb'); walk(x,depth+1); }
  }; walk(doc);
  for (const list of ['buffers','bufferViews','images','extensionsRequired']) if (doc[list] !== undefined && !Array.isArray(doc[list])) throw new Error('Неверная структура ' + list);
  if ((doc.buffers || []).filter(x=>!x.uri).length > 1) throw new Error('Несколько BIN buffers не поддерживаются');
  for (const b of doc.buffers || []) { if (!b || !Number.isSafeInteger(b.byteLength) || b.byteLength < 0 || (!b.uri && b.byteLength > binSize) || (b.uri && Buffer.from(b.uri.split(',')[1], 'base64').length < b.byteLength)) throw new Error('Неверный размер buffer'); }
  for (const v of doc.bufferViews || []) {
    const b = doc.buffers?.[v.buffer], off = v.byteOffset || 0;
    if (!b || !Number.isSafeInteger(off) || off<0 || !Number.isSafeInteger(v.byteLength) || v.byteLength<0 || off+v.byteLength>b.byteLength) throw new Error('bufferView вне границ');
  }
  return { extensionsRequired: doc.extensionsRequired || [] };
}
async function download(raw, options={}) {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(60000)]);
  const got = await fetchBinary(raw, {...options, signal});
  return { ...got, ...validateGLB(got.data) };
}
module.exports = { MAX_BYTES, checkedURL, fetchBinary, validateGLB, download };
