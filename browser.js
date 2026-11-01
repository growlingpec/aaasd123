// Premier — встроенный браузер (Chromium). Нужен puppeteer или playwright: npm install
// Если библиотеки нет — функции недоступны, сайт работает как раньше.
const { createBrowserProxy } = require('./browser-proxy');
const gameCheck = require('./game-check');

let lib = null, kind = '';
for (const n of ['puppeteer', 'playwright', 'playwright-core']) {
  try { lib = require(n); kind = n.startsWith('playwright') ? 'playwright' : 'puppeteer'; break; } catch {}
}
const EXEC = process.env.CHROMIUM_PATH || undefined;
function launchArgs(proxyUrl, noSandbox = process.env.BROWSER_NO_SANDBOX === '1') {
  return [
    '--disable-dev-shm-usage', '--disable-extensions', '--mute-audio', '--no-first-run',
    `--proxy-server=${proxyUrl}`, '--proxy-bypass-list=<-loopback>',
    '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    // Имена сайтов разрешает только прокси; прямые DNS-запросы Chromium запрещены.
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ...(noSandbox ? ['--no-sandbox'] : []),
  ];
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const MAX_PAGES = Math.min(8, Math.max(1, Math.floor(Number(process.env.BROWSER_PAGES) || 2)));
let browser = null, launching = null, idle = null, active = 0, lastError = '';
const waiters = [];

const available = () => !!lib;
const info = () => ({ installed: !!lib, lib: lib ? kind : '', error: lastError, sandbox: process.env.BROWSER_NO_SANDBOX !== '1', network: 'pinned-ip-proxy' });

async function getBrowser() {
  if (browser) return browser;
  if (!launching) {
    launching = (async () => {
      const proxy = await createBrowserProxy();
      try {
        if (process.env.BROWSER_NO_SANDBOX === '1')
          console.warn('Premier: sandbox Chromium отключён явно. Не используйте этот режим без отдельной изоляции браузера.');
        const args = launchArgs(proxy.url);
        const b = kind === 'playwright'
          ? await lib.chromium.launch({
            executablePath: EXEC, args, chromiumSandbox: process.env.BROWSER_NO_SANDBOX !== '1',
            proxy: { server: proxy.url, username: proxy.username, password: proxy.password },
          })
          : await lib.launch({ executablePath: EXEC, headless: true, args });
        b._premierProxy = proxy;
        browser = b; lastError = '';
        b.on('disconnected', () => {
          if (browser === b) browser = null;
          proxy.close().catch(() => {});
        });
        return b;
      } catch (e) {
        await proxy.close();
        throw e;
      }
    })()
      .catch((e) => {
        lastError = e.message.split('\n')[0];
        throw new Error('Браузер не запустился: ' + lastError + '. Проверьте CHROMIUM_PATH и поддержку sandbox ОС; небезопасный откат не выполняется.');
      })
      .finally(() => { launching = null; });
  }
  return launching;
}
// браузер закрывается после 3 минут простоя, чтобы не держать память
function touch() { clearTimeout(idle); idle = setTimeout(() => { if (!active && browser) { browser.close().catch(() => {}); browser = null; } }, 180000); }

function allowed(url) {
  if (/^(data|blob|about):/i.test(url)) return true;
  let u; try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  // Проверку DNS/IP выполняет прокси непосредственно перед соединением.
  return !u.username && !u.password &&
    !/^(localhost|.*\.localhost|.*\.local|.*\.internal)\.?$/i.test(u.hostname);
}

// открывает изолированную вкладку, отдаёт её в fn и всегда закрывает
async function withPage(fn, { width = 1280, height = 800, mobile = false, assetResolver = null } = {}) {
  if (!lib) throw new Error('Браузер не установлен на сервере');
  if (active >= MAX_PAGES) await new Promise((r) => waiters.push(r));
  else active++;
  // Ожидающей задаче слот передаётся в finally, без окна для нового запроса.
  clearTimeout(idle);
  let ctx = null, page = null, watchdogTimer;
  try {
    const b = await getBrowser();
    if (kind === 'playwright') {
      ctx = await b.newContext({ viewport: { width, height }, userAgent: UA, locale: 'ru-RU', acceptDownloads: false, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await ctx.route('**/*', async (r) => {
        const file = assetResolver?.(r.request().url());
        if (file) return r.fulfill({ status: 200, ...file });
        return (await allowed(r.request().url())) ? r.continue() : r.abort();
      });
      page = await ctx.newPage();
    } else {
      ctx = b.createBrowserContext ? await b.createBrowserContext() : await b.createIncognitoBrowserContext();
      page = await ctx.newPage();
      await page.authenticate({ username: b._premierProxy.username, password: b._premierProxy.password });
      await page.setBypassServiceWorker(true);
      await page.setUserAgent(UA); await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
      await page.setRequestInterception(true);
      page.on('request', async (r) => { try {
        const file = assetResolver?.(r.url());
        if (file) await r.respond({ status: 200, ...file });
        else (await allowed(r.url())) ? await r.continue() : await r.abort();
      } catch { try { await r.abort(); } catch {} } });
    }
    page.setDefaultTimeout?.(20000);
    // Создаём таймер непосредственно перед race: долгий запуск браузера не
    // оставляет отклонённый Promise без обработчика.
    const watchdog = new Promise((_, no) => {
      watchdogTimer = setTimeout(() => no(new Error('браузер не уложился в 40 секунд')), 40000);
    });
    return await Promise.race([fn(page), watchdog]);
  } finally {
    clearTimeout(watchdogTimer);
    if (ctx) await ctx.close().catch(() => {}); else if (page) await page.close().catch(() => {});
    const w = waiters.shift(); if (w) w(); else active--;
    touch();
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(page, url) {
  const u = new URL(String(url)); if (!/^https?:$/.test(u.protocol) || !(await allowed(u.href))) throw new Error('внутренний или запрещённый адрес');
  const r = await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
  if (!(await allowed(page.url()))) throw new Error('перенаправление на внутренний адрес');
  if (r && r.status() >= 400) throw new Error('страница ответила ' + r.status());
  await Promise.race([page.waitForLoadState ? page.waitForLoadState('networkidle').catch(() => {}) : page.waitForNetworkIdle?.({ idleTime: 500 }).catch(() => {}), sleep(4000)]);
}
const shot = async (page, full = false) => Buffer.from(await page.screenshot({ type: 'jpeg', quality: 70, fullPage: full })).toString('base64');

// прочитать страницу целиком, с тем, что подгружают скрипты
async function readPage(url, limit = 15000) {
  return withPage(async (page) => {
    await open(page, url);
    const r = await page.evaluate(() => {
      document.querySelectorAll('script,style,noscript,svg,iframe,template').forEach((e) => e.remove());
      const main = document.querySelector('article') || document.querySelector('main') || document.body;
      return { title: document.title, text: (main?.innerText || '').replace(/\n{3,}/g, '\n\n').trim() };
    });
    return { url: page.url(), title: r.title || new URL(page.url()).hostname, text: r.text.slice(0, limit) + (r.text.length > limit ? '\n…[обрезано]' : '') };
  });
}
// скриншот страницы (для моделей, которые видят картинки)
async function viewPage(url) {
  return withPage(async (page) => { await open(page, url); return { url: page.url(), title: await page.title(), image: await shot(page) }; });
}
// проверка сайта, который написала модель: ошибки JS, битые ресурсы, вёрстка на телефоне
async function checkHtml(html, withShots, { assetResolver = null, game = false, expectedModels = 0 } = {}) {
  const run = (mobile) => withPage(async (page) => {
    const errors = [], failed = [], loadedModels = new Set(), modelBodies = [];
    page.on('response', (response) => {
      const url = response.url();
      if (response.status() >= 400 && !/favicon/i.test(url)) failed.push('HTTP '+response.status()+' '+url);
      if (!game || !/\/a\/[a-f0-9]{32}\/model\.glb(?:$|[?#])/.test(url)) return;
      modelBodies.push((async()=>{try{
        if(response.status()<200||response.status()>=300)return;
        const body=await (response.body ? response.body() : response.buffer());
        if(body.length>=12 && body.readUInt32LE(0)===0x46546c67 && body.readUInt32LE(4)===2 && body.readUInt32LE(8)===body.length)loadedModels.add(url.split(/[?#]/)[0]);
      }catch{}})());
    });
    page.on('pageerror', (e) => errors.push(String(e.message || e).split('\n')[0]));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text().split('\n')[0]); });
    page.on('requestfailed', (r) => { if (!/favicon/i.test(r.url())) failed.push(r.url()); });
    await page.setContent(game ? gameCheck.instrument(html) : html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await Promise.race([page.waitForLoadState ? page.waitForLoadState('networkidle').catch(() => {}) : page.waitForNetworkIdle?.({ idleTime: 500 }).catch(() => {}), sleep(5000)]);
    await sleep(600);
    const gameResult = game ? await gameCheck.observe(page, { expectedModels, mobile, loadedModels }) : null;
    await Promise.allSettled(modelBodies);
    const m = await page.evaluate(() => {
      const de = document.documentElement, W = Math.min(innerWidth, screen.width || innerWidth);
      const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 4 && getComputedStyle(e).position !== 'fixed'; })
        .slice(0, 3).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''));
      return { overflow: de.scrollWidth > W + 4 && getComputedStyle(document.body).overflowX !== 'hidden' ? wide : null, broken: [...document.images].filter((i) => i.complete && i.src && !i.naturalWidth).map((i) => i.src.slice(0, 120)).slice(0, 5), text: (document.body?.innerText || '').trim().length };
    });
    return { errors: [...new Set(errors)].slice(0, 6), failed: [...new Set(failed)].slice(0, 5), ...m, game: gameResult, image: withShots ? await shot(page) : null };
  }, { ...(mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), assetResolver });
  const [d, mo] = [await run(false), await run(true)];
  const issues = [];
  for (const e of new Set([...d.errors, ...mo.errors])) issues.push('Ошибка JavaScript: ' + e);
  for (const u of new Set([...d.failed, ...mo.failed])) issues.push('Не загрузился ресурс: ' + u);
  for (const u of new Set([...d.broken, ...mo.broken])) issues.push('Битая картинка: ' + u);
  if (mo.overflow) issues.push('На телефоне (ширина 390px) страница шире экрана — появляется горизонтальная прокрутка' + (mo.overflow.length ? '. Вылезают элементы: ' + mo.overflow.join(', ') : ''));
  if (!game && d.text < 20) issues.push('Страница почти пустая — текст не отображается');
  if (game) {
    for (const [size,result] of [["Desktop",d.game],["Mobile",mo.game]]) for (const key of ["render","models"]) if(result?.[key]?.status==='failed') issues.push(size+": "+result[key].detail);
  }
  return { issues, game: game ? { ...d.game, mobile: mo.game } : null, shots: withShots ? [d.image, mo.image] : [] };
}

async function close() {
  clearTimeout(idle);
  if (launching) await launching.catch(() => {});
  const b = browser; browser = null;
  if (b) {
    try { await b.close(); }
    finally { await b._premierProxy.close(); }
  }
}

module.exports = { available, info, readPage, viewPage, checkHtml, close, launchArgs, allowed };
