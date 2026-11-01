'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { languageOf, languageHeaders } = require('./language');
const PROMO_URL = 'https://eide.pro/';
const PROMO_TEXT = '⚡ Сделано за 1 минуту в Premier — создать свой сайт или игру бесплатно';
const RAW_SANDBOX = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function needsBranding(user, plan) {
  if (!user || !plan || (!plan.until || Number(plan.until) <= Date.now()) || plan.id === 'free' || user.trial === true) return true;
  return !(plan.id === 'pro' || plan.id === 'max' || Number(plan.tier) > 0);
}
function wrapper(id, title, lang = 'ru', src = `/s/${id}.html`) {
  const en = lang === 'en';
  const label = en ? '⚡ Made in 1 minute with Premier — create your own website or game for free' : PROMO_TEXT;
  const published = en ? 'Published website' : 'Опубликованный сайт';
  return `<!doctype html>
<html lang="${en ? 'en' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0c0c0f"><title>${esc(title || (en ? 'Website built with Premier' : 'Сайт на Premier'))}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{height:100vh;height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto;background:#0c0c0f;color:#f4f4f7;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}main{min-width:0;min-height:0;overflow:hidden;background:#fff}iframe{display:block;width:100%;height:100%;border:0}footer{display:flex;justify-content:center;align-items:center;padding:10px 20px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #34343c;background:#101014}#premier-promo{font-size:12px;line-height:1.4}.promo-link{color:#8a94a6;text-decoration:none;transition:color .15s}.promo-link:hover{color:#c9d4e8;text-decoration:underline;text-underline-offset:2px}.promo-link:focus-visible{outline:2px solid #a5c5ff;outline-offset:2px}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><main aria-label="${published}"><iframe id="published-site" src="${src}" title="${esc(title || published)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock" allow="fullscreen 'none'"></iframe></main><footer aria-label="${en ? 'Built with Premier' : 'Создано в Premier'}"><div id="premier-promo" role="note"><a class="promo-link" href="${PROMO_URL}" target="_blank" rel="noopener noreferrer">${en ? 'Made with Premier' : 'Сделано в Premier'}</a></div></footer></body></html>`;
}
// сайты-папки из облачного компьютера (cloud-sites.js): /s/<id>/<файл>
const MIME = { '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json', '.map':'application/json', '.txt':'text/plain; charset=utf-8', '.xml':'application/xml', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.avif':'image/avif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.mp4':'video/mp4', '.webm':'video/webm', '.wasm':'application/wasm', '.pdf':'application/pdf', '.csv':'text/csv; charset=utf-8' };
function createPublicationServer({ dir, users, bill, wmOn }) {
  const match = pathname => /^\/s\/([a-f0-9]{10})(\.html|\/.*)?$/.exec(pathname);
  const policy = (user) => (wmOn ? wmOn() : true) ? (needsBranding(user, bill.planOf(user)) || (user && user.wm === true)) : false;
  async function folderMeta(id) {
    try { const m = JSON.parse(await fs.readFile(path.join(dir, id + '.json'), 'utf8')); return m && m.dir === true ? m : null; } catch { return null; }
  }
  async function serveFolder(req, res, id, rest, meta) {
    res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, { Allow:'GET, HEAD' }); res.end('Method not allowed'); return true; }
    const branded = policy(users.get(meta.uid)), root = path.join(dir, id);
    if (!rest || rest === '.html') {
      if (!branded) { res.writeHead(302, { Location:`/s/${id}/` }); res.end(); return true; }
      languageHeaders(req, res);
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'Permissions-Policy':'fullscreen=()' });
      res.end(req.method === 'HEAD' ? undefined : wrapper(id, meta.title, languageOf(req), `/s/${id}/`)); return true;
    }
    let rel; try { rel = decodeURIComponent(rest.slice(1)); } catch { rel = '\0'; }
    const notFound = () => { res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8', 'Content-Security-Policy':RAW_SANDBOX }); res.end(req.method === 'HEAD' ? undefined : 'Not found'); return true; };
    if (rel.includes('\0') || rel.split('/').some(x => x === '..' || x.startsWith('.'))) return notFound();
    let f = path.join(root, rel), st = await fs.stat(f).catch(() => null);
    if (st?.isDirectory()) {
      if (!rest.endsWith('/')) { res.writeHead(302, { Location:`/s/${id}${rest}/` }); res.end(); return true; }
      f = path.join(f, rel ? 'index.html' : meta.entry || 'index.html'); st = await fs.stat(f).catch(() => null);
    }
    if (!st && !path.extname(rel)) { f = path.join(root, meta.entry || 'index.html'); st = await fs.stat(f).catch(() => null); } // маршруты SPA
    if (!st?.isFile() || !(f === root || f.startsWith(root + path.sep))) return notFound();
    const ext = path.extname(f).toLowerCase(), html = ext === '.html' || ext === '.htm';
    // с плашкой: страница открывается только внутри обёртки Premier (frame-ancestors), прямая ссылка ведёт на обёртку
    if (html && branded && req.headers['sec-fetch-dest'] !== 'iframe') { res.writeHead(302, { Location:`/s/${id}`, Vary:'Sec-Fetch-Dest' }); res.end(); return true; }
    res.writeHead(200, { 'Content-Type':MIME[ext] || 'application/octet-stream', 'Content-Length':st.size, 'Content-Security-Policy':RAW_SANDBOX + (html && branded ? "; frame-ancestors 'self'" : ''), ...(html ? { Vary:'Sec-Fetch-Dest' } : {}) });
    if (req.method === 'HEAD') { res.end(); return true; }
    createReadStream(f).on('error', () => res.destroy()).pipe(res); return true;
  }
  async function serve(req, res, url) {
    const result = match(url.pathname); if (!result) return false;
    const folder = await folderMeta(result[1]);
    if (folder) return serveFolder(req, res, result[1], result[2] || '', folder);
    if (result[2] && result[2] !== '.html' && result[2] !== '/') return false;
    const [,id,extension] = result;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, { Allow:'GET, HEAD' }); res.end('Method not allowed'); return true; }
    // The raw HTML is an iframe resource, never a second public unbranded URL.
    // Browsers set these forbidden request headers themselves. Direct navigation redirects.
    if (extension === '.html' && !(req.headers['sec-fetch-dest'] === 'iframe' && req.headers['sec-fetch-site'] === 'same-origin')) {
      res.writeHead(302, { Location:'/s/'+id, Vary:'Sec-Fetch-Dest, Sec-Fetch-Site' }); res.end(); return true;
    }
    let html;
    try { html = await fs.readFile(path.join(dir,id+'.html')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      res.writeHead(404, { 'Content-Type':'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сайт не найден</title><body style="font:16px/1.6 system-ui;background:#101014;color:#ccc;padding:32px">Сайт не найден или снят с публикации</body></html>'); return true;
    }
    let meta = {};
    try { meta = JSON.parse(await fs.readFile(path.join(dir,id+'.json'),'utf8')); if (!meta || typeof meta !== 'object') meta = {}; } catch {}
    const user = users.get(meta.uid), branded = policy(user);
    if (extension === '.html' || !branded) {
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy':RAW_SANDBOX, ...(extension === '.html' ? { Vary:'Sec-Fetch-Dest, Sec-Fetch-Site' } : {}) });
      res.end(req.method === 'HEAD' ? undefined : html); return true;
    }
    languageHeaders(req, res);
    // Only trusted static markup is in the outer page; user HTML stays in an opaque-origin iframe.
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'Permissions-Policy':'fullscreen=()' });
    res.end(req.method === 'HEAD' ? undefined : wrapper(id,meta.title,languageOf(req))); return true;
  }
  return { match, serve, policy };
}
module.exports = { needsBranding, wrapper, createPublicationServer, PROMO_URL, PROMO_TEXT, RAW_SANDBOX };
