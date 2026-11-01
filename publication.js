'use strict';
const fs = require('node:fs/promises');
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
function wrapper(id, title, lang = 'ru') {
  const en = lang === 'en';
  const label = en ? '⚡ Made in 1 minute with Premier — create your own website or game for free' : PROMO_TEXT;
  const published = en ? 'Published website' : 'Опубликованный сайт';
  return `<!doctype html>
<html lang="${en ? 'en' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0c0c0f"><title>${esc(title || (en ? 'Website built with Premier' : 'Сайт на Premier'))}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{height:100vh;height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto;background:#0c0c0f;color:#f4f4f7;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}main{min-width:0;min-height:0;overflow:hidden;background:#fff}iframe{display:block;width:100%;height:100%;border:0}footer{display:flex;justify-content:center;align-items:center;padding:10px 20px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #34343c;background:#101014}#premier-promo{font-size:12px;line-height:1.4}.promo-link{color:#8a94a6;text-decoration:none;transition:color .15s}.promo-link:hover{color:#c9d4e8;text-decoration:underline;text-underline-offset:2px}.promo-link:focus-visible{outline:2px solid #a5c5ff;outline-offset:2px}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><main aria-label="${published}"><iframe id="published-site" src="/s/${id}.html" title="${esc(title || published)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock" allow="fullscreen 'none'"></iframe></main><footer aria-label="${en ? 'Built with Premier' : 'Создано в Premier'}"><div id="premier-promo" role="note"><a class="promo-link" href="${PROMO_URL}" target="_blank" rel="noopener noreferrer">${en ? 'Made with Premier' : 'Сделано в Premier'}</a></div></footer></body></html>`;
}
function createPublicationServer({ dir, users, bill, wmOn }) {
  const match = pathname => /^\/s\/([a-f0-9]{10})(\.html|\/)?$/.exec(pathname);
  const policy = (user) => (wmOn ? wmOn() : true) ? (needsBranding(user, bill.planOf(user)) || (user && user.wm === true)) : false;
  async function serve(req, res, url) {
    const result = match(url.pathname); if (!result) return false;
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
