'use strict';
// Отдельный smoke-тест: npm run test:browser.
// Требует настоящий Chromium и Puppeteer/Playwright, но не внешний интернет.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const gateway = require('../browser-proxy');

test('настоящий Chromium: чтение, скриншот, самопроверка, блокировка SSRF и закрытие', { timeout: 60000 }, async (t) => {
  let localHits = 0, siteHits = 0;
  const site = http.createServer((req, res) => {
    siteHits++;
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/' }); return res.end();
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Smoke</title><main>Тестовая страница для проверки браузера Premier</main>');
  });
  const privateSite = http.createServer((req, res) => { localHits++; res.end('private'); });
  await Promise.all([
    new Promise((r) => site.listen(0, '127.0.0.1', r)),
    new Promise((r) => privateSite.listen(0, '127.0.0.1', r)),
  ]);
  const original = gateway.createBrowserProxy;
  // Подменяем только транспорт тестового публичного домена; проверка IP остаётся.
  gateway.createBrowserProxy = () => original({
    lookup: async (host) => host === 'premier-smoke.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }],
    connect: (options) => {
      assert.equal(options.host, '93.184.216.34');
      return net.createConnection({ host: '127.0.0.1', port: site.address().port });
    },
  });
  // browser.js запоминает createBrowserProxy при загрузке.
  const browser = require('../browser');
  gateway.createBrowserProxy = original;
  t.after(async () => {
    await browser.close();
    await Promise.all([site, privateSite].map((s) => new Promise((r) => s.close(r))));
  });
  assert.equal(browser.available(), true, 'Установите Puppeteer или Playwright');
  const result = await browser.readPage('http://premier-smoke.example/');
  assert.equal(result.title, 'Smoke');
  assert.match(result.text, /Тестовая страница/);
  const shot = await browser.viewPage('http://premier-smoke.example/');
  assert.ok(Buffer.from(shot.image, 'base64').length > 1000);
  await assert.rejects(browser.readPage('http://premier-smoke.example/redirect'));
  await assert.rejects(browser.readPage(`http://127.0.0.1:${privateSite.address().port}/`));
  const checked = await browser.checkHtml(
    `<!doctype html><meta name="viewport" content="width=device-width"><main>Проверка локальных сетевых запросов из созданного сайта</main>` +
    `<img src="http://127.0.0.1:${privateSite.address().port}/secret">`, false
  );
  assert.ok(checked.issues.some((issue) => /Не загрузился ресурс|Битая картинка/.test(issue)));
  assert.equal(localHits, 0, 'Chromium не должен обращаться к внутреннему серверу');
  assert.ok(siteHits >= 3, 'Публичная тестовая страница должна открываться через прокси');
});