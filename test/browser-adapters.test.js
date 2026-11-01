'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Контракт обеих поддерживаемых библиотек без установки Chromium и без сети.
// Настоящий браузер проверяется отдельно: npm run test:browser.
function fixture(kind, failLaunch = false) {
  const stats = { live: 0, peak: 0, contexts: 0, auth: 0, bypass: 0, proxyClosed: 0, launches: 0 };
  const credentials = { username: 'test-user', password: 'test-password' };
  let options, contextOptions;
  const proxy = {
    url: 'http://127.0.0.1:12345', ...credentials,
    close: async () => { if (!proxy.closed) { proxy.closed = true; stats.proxyClosed++; } },
  };
  const makeContext = async (opts) => {
    contextOptions = opts;
    stats.contexts++; stats.live++; stats.peak = Math.max(stats.peak, stats.live);
    let currentUrl;
    const page = {
      authenticate: async (auth) => { assert.deepEqual({ ...auth }, credentials); stats.auth++; },
      setBypassServiceWorker: async (value) => { assert.equal(value, true); stats.bypass++; },
      setUserAgent: async () => {}, setViewport: async () => {},
      setRequestInterception: async () => {}, setDefaultTimeout: () => {}, on: () => {},
      goto: async (url) => {
        currentUrl = url;
        await new Promise((r) => setTimeout(r, 10));
        if (url.endsWith('/fail')) throw new Error('test navigation failure');
        return { status: () => 200 };
      },
      url: () => currentUrl,
      waitForLoadState: async () => {}, waitForNetworkIdle: async () => {},
      evaluate: async () => ({ title: 'Test', text: 'Test page text' }),
    };
    let closed = false;
    return {
      route: async () => {},
      newPage: async () => page,
      close: async () => { if (!closed) { closed = true; stats.live--; } },
    };
  };
  const b = {
    on: (name, handler) => { if (name === 'disconnected') b.disconnected = handler; },
    newContext: makeContext, createBrowserContext: makeContext,
    close: async () => b.disconnected?.(),
  };
  const launch = async (opts) => {
    stats.launches++; options = opts;
    if (failLaunch) throw new Error('No usable sandbox');
    return b;
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'browser.js'), 'utf8');
  const context = vm.createContext({
    module, exports: module.exports, Buffer, URL, console,
    process: { env: { BROWSER_PAGES: '2' } },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 || ms === 5000 ? 0 : ms),
    clearTimeout,
    require(name) {
      if (name === './game-check') return require('../game-check');
      if (name === './browser-proxy') return { createBrowserProxy: async () => proxy };
      if (name === kind) return kind === 'playwright' ? { chromium: { launch } } : { launch };
      throw new Error('Module not available in test: ' + name);
    },
  });
  vm.runInContext(source, context, { filename: 'browser.js' });
  return { browser: module.exports, stats, options: () => options, contextOptions: () => contextOptions };
}

for (const kind of ['puppeteer', 'playwright']) {
  test(`${kind}: авторизация прокси, sandbox, закрытие вкладок и лимит параллелизма`, async (t) => {
    const f = fixture(kind);
    t.after(() => f.browser.close());
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      f.browser.readPage(`https://example.com/${i}`)
    ));
    assert.equal(results.length, 6);
    assert.ok(results.every((r) => r.title === 'Test'));
    assert.equal(f.stats.peak, 2);
    assert.equal(f.stats.live, 0);
    assert.equal(f.stats.launches, 1);
    assert.ok(!f.options().args.includes('--no-sandbox'));
    if (kind === 'puppeteer') {
      assert.equal(f.stats.auth, 6);
      assert.equal(f.stats.bypass, 6);
    } else {
      assert.equal(f.options().chromiumSandbox, true);
      assert.equal(f.options().proxy.username, 'test-user');
      assert.equal(f.contextOptions().serviceWorkers, 'block');
    }
    await assert.rejects(f.browser.readPage('https://example.com/fail'), /test navigation failure/);
    assert.equal(f.stats.live, 0, 'Ошибка навигации не должна оставлять контекст открытым');
    await f.browser.close();
    assert.equal(f.stats.proxyClosed, 1);
  });

  test(`${kind}: ошибка sandbox не запускает небезопасный fallback и закрывает прокси`, async (t) => {
    const f = fixture(kind, true);
    t.after(() => f.browser.close());
    await assert.rejects(f.browser.readPage('https://example.com/'), /небезопасный откат не выполняется/);
    assert.equal(f.stats.launches, 1);
    assert.equal(f.stats.proxyClosed, 1);
    assert.equal(f.stats.contexts, 0);
    assert.ok(!f.options().args.includes('--no-sandbox'));
  });
}