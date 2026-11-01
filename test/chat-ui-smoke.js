'use strict';
// Отдельная проверка настоящего UI: npm run test:ui.
// Нужны Playwright и Chromium; внешние запросы блокируются.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const { copyApp, seed, startServer, rm } = require('./helpers');

test('чат в Chromium: retry/reset, превью и завершение ошибки после reasoning', { timeout: 30000 }, async (t) => {
  const { chromium } = require('playwright');
  const dir = copyApp(); seed(dir);
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([{ id: 'm1', name: 'UI Mock', modelId: 'mock', baseUrl: 'http://127.0.0.1:1', apiKey: 'test' }]));
  const s = await startServer(dir);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, chromiumSandbox: true });
  t.after(async () => { await b.close(); await s.stop(); rm(dir); });
  const context = await b.newContext();
  await context.addCookies([{ name: 'premier_session', value: 'tok1', url: s.base }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let mode = 'repair';
  const html = '```html\n<!doctype html><html><head><title>UI Game</title></head><body>Готовая интерактивная сцена</body></html>\n```';
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== s.base) return route.abort();
    if (url.pathname !== '/api/chat') return route.continue();
    const events = mode === 'repair'
      ? [{ r: 'Planning' }, { t: '```html\n<html><body>unfinished' }, { s: 'repair', q: 'Повтор' }, { reset: true }, { t: html }, { diag: { repairs: 1, outcome: 'complete' } }]
      : [{ r: 'Planning without a final answer' }, { e: 'Модель не завершила запрос за 180 с.' }, { diag: { outcome: 'timeout' } }];
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: events.map((e) => JSON.stringify(e)).join('\n') + '\n' });
  });
  await page.goto(s.base + '/chat');
  await page.waitForFunction(() => MODELS.length > 0);
  await page.evaluate(() => send('создай 3д поле от первого лица'));
  await page.waitForFunction(() => S.chats[0]?.msgs.some((m) => m.r === 'a' && !m.live && m.diag?.outcome === 'complete'));
  const completed = await page.evaluate(() => S.chats[0].msgs.findLast((m) => m.r === 'a'));
  assert.equal(completed.t, html);
  assert.equal(completed.err, undefined);
  assert.equal(completed.diag.repairs, 1);
  assert.equal(await page.locator('.art').count(), 1);
  await page.locator('.art').click();
  await page.waitForFunction(() => document.querySelector('#pFrame')?.srcdoc.includes('Готовая интерактивная сцена'));
  mode = 'timeout';
  await page.evaluate(() => send('продолжи'));
  await page.waitForFunction(() => S.chats[0]?.msgs.findLast((m) => m.r === 'a')?.live === false);
  const failed = await page.evaluate(() => S.chats[0].msgs.findLast((m) => m.r === 'a'));
  assert.match(failed.err, /не завершила запрос/);
  assert.equal(failed.diag.outcome, 'timeout');
  assert.equal(failed.thinking, false);
  assert.equal(await page.evaluate(() => busy === null), true);
  assert.deepEqual(errors, []);
});