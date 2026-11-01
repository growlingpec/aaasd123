// Premier — доступ к интернету: поиск и чтение страниц.
const dns = require('dns').promises;
const net = require('net');
const dnsCb = require('dns'), http = require('http'), https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PROVIDERS = {
  duckduckgo: 'DuckDuckGo (без ключа)',
  bing: 'Bing (без ключа)',
  tavily: 'Tavily',
  brave: 'Brave Search',
  serper: 'Serper (Google)',
  off: 'Выключен',
};

const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const strip = (s) => decode(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

async function search(cfg, query, n = 6) {
  const q = String(query || '').slice(0, 300);
  const t = AbortSignal.timeout(15000);
  if (cfg.provider === 'tavily') {
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', signal: t, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: cfg.key, query: q, max_results: n }) });
    if (!r.ok) throw new Error('Tavily ' + r.status);
    return ((await r.json()).results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  }
  if (cfg.provider === 'brave') {
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?count=' + n + '&q=' + encodeURIComponent(q), { signal: t, headers: { Accept: 'application/json', 'X-Subscription-Token': cfg.key } });
    if (!r.ok) throw new Error('Brave ' + r.status);
    return ((await r.json()).web?.results || []).map((x) => ({ title: strip(x.title), url: x.url, snippet: strip(x.description) }));
  }
  if (cfg.provider === 'serper') {
    const r = await fetch('https://google.serper.dev/search', { method: 'POST', signal: t, headers: { 'Content-Type': 'application/json', 'X-API-KEY': cfg.key }, body: JSON.stringify({ q, num: n }) });
    if (!r.ok) throw new Error('Serper ' + r.status);
    return ((await r.json()).organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet }));
  }
  if (cfg.provider === 'bing') {
    // Bing RSS — без ключа, стабильно с дата-центровых IP (DuckDuckGo их банит)
    const r = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&count=' + n + '&format=rss', { signal: t, headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('Bing ' + r.status);
    const xml = await r.text();
    const cdata = (s) => strip(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const items = xml.split('<item>').slice(1).map((it) => {
      const g = (re) => (it.match(re) || [])[1] || '';
      return { title: cdata(g(/<title>([\s\S]*?)<\/title>/)), url: g(/<link>([\s\S]*?)<\/link>/).trim(), snippet: cdata(g(/<description>([\s\S]*?)<\/description>/)) };
    }).filter((x) => /^https?:/.test(x.url));
    if (!items.length && /captcha|unusual activity/i.test(xml)) throw new Error('Bing временно ограничил запросы');
    return items.slice(0, n);
  }
  // DuckDuckGo HTML — без ключа
  const r = await fetch('https://html.duckduckgo.com/html/', { method: 'POST', signal: t, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: 'q=' + encodeURIComponent(q) + '&kl=ru-ru' });
  if (!r.ok) throw new Error('DuckDuckGo ' + r.status);
  const html = await r.text(), out = [];
  const parts = html.split(/(?=<a[^>]+class="result__a")/).slice(1);
  for (const part of parts) {
    if (out.length >= n) break;
    const m = part.match(/^<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/); if (!m) continue;
    const sn = part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
    let url = decode(m[1]);
    const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    out.push({ title: strip(m[2]), url, snippet: strip(sn?.[1]) });
  }
  if (!out.length && /anomaly|captcha/i.test(html)) throw new Error('DuckDuckGo временно ограничил запросы');
  return out;
}

// запрещённые адреса: локальные, частные, служебные (облачные метаданные 169.254.169.254 и т. п.)
const BLOCK = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, n, 'ipv4');
// ::/96 — старые «совместимые» адреса, 64:ff9b::/96 и 2002::/16 — NAT64 и 6to4 (внутри может быть частный IPv4)
for (const [a, n] of [['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, n, 'ipv6');
function isPrivate(ip) {
  const v = net.isIP(String(ip).replace(/^\[|\]$/g, '').split('%')[0]); if (!v) return true;
  const s = String(ip).replace(/^\[|\]$/g, '').split('%')[0];
  return BLOCK.check(s, v === 4 ? 'ipv4' : 'ipv6'); // IPv4 внутри IPv6 (::ffff:7f00:1 = 127.0.0.1) Node проверяет по правилам IPv4
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('только http/https');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('внутренний адрес');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((x) => x.address);
  if (!ips.length || ips.some(isPrivate)) throw new Error('внутренний адрес');
}
// адрес проверяется в момент соединения, а не заранее — так сайт не подменит IP между проверкой и запросом (DNS rebinding)
function safeLookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dnsCb.lookup(host, { all: true, family: opts.family || 0 }, (e, list) => {
    if (e) return cb(e);
    if (!list.length || list.some((x) => isPrivate(x.address))) return cb(Object.assign(new Error('внутренний адрес'), { code: 'EPRIVATE' }));
    opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}
function safeGet(u, headers, ms) {
  return new Promise((ok, no) => {
    const rq = (u.protocol === 'https:' ? https : http).get(u, { headers, lookup: safeLookup, agent: false }, ok);
    const t = setTimeout(() => rq.destroy(new Error('страница не ответила за ' + ms / 1000 + ' секунд')), ms);
    rq.on('close', () => clearTimeout(t)); rq.on('error', (e) => { clearTimeout(t); no(e); });
  });
}

async function fetchPage(rawUrl, limit = 15000) {
  let u = new URL(String(rawUrl));
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
    const r = await safeGet(u, { 'User-Agent': UA, Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'ru,en;q=0.8' }, 12000);
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.destroy(); u = new URL(r.headers.location, u); continue; }
    if (r.statusCode < 200 || r.statusCode >= 300) { r.destroy(); throw new Error('страница ответила ' + r.statusCode); }
    const type = r.headers['content-type'] || '';
    if (!/text|json|xml/.test(type)) { r.destroy(); throw new Error('это не текстовая страница (' + type.split(';')[0] + ')'); }
    let body = '', size = 0; const dec = new TextDecoder();
    try { for await (const ch of r) { size += ch.length; body += dec.decode(ch, { stream: true }); if (size > 3e6) break; } } finally { r.destroy(); }
    if (!/html/.test(type)) return { url: u.href, title: u.hostname, text: body.slice(0, limit) };
    const title = strip((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) || u.hostname;
    let main = (body.match(/<article[\s\S]*?<\/article>/i) || body.match(/<main[\s\S]*?<\/main>/i) || body.match(/<body[\s\S]*<\/body>/i) || [body])[0];
    main = main.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '\n• ');
    const text = decode(main.replace(/<[^>]+>/g, ' ')).replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
    return { url: u.href, title, text: text.slice(0, limit) + (text.length > limit ? '\n…[обрезано]' : '') };
  }
  throw new Error('слишком много перенаправлений');
}

const TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Поиск в интернете. Используй для свежих новостей, фактов, цен, курсов, погоды, событий после твоей даты обучения или когда не уверен.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Поисковый запрос' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'fetch_page', description: 'Открыть веб-страницу и прочитать её текст. Используй, чтобы изучить найденную страницу подробнее или прочитать ссылку от пользователя.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Полный URL' } }, required: ['url'] } } },
];

const formatResults = (list) => list.length ? list.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet || ''}`).join('\n\n') : 'Ничего не найдено.';

module.exports = { PROVIDERS, search, fetchPage, TOOLS, formatResults, assertPublic, isPrivate, safeLookup };
