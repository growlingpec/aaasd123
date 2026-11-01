'use strict';
// Реальный клиент Chromium; модель подменена NDJSON на границе /api/chat.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const { copyApp, seed, startServer, rm } = require('./helpers');

test('UI: закрепление, длинный чат, выбор старой версии, обновление превью и ошибка', { timeout: 30000 }, async (t) => {
  const { chromium } = require('playwright');
  const dir = copyApp(); seed(dir);
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([{ id: 'm1', name: 'Artifact UI', modelId: 'mock', baseUrl: 'http://127.0.0.1:1', apiKey: 'test' }]));
  const s = await startServer(dir);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, chromiumSandbox: true });
  t.after(async () => { await b.close(); await s.stop(); rm(dir); });
  const context = await b.newContext();
  await context.addCookies([{ name: 'premier_session', value: 'tok1', url: s.base }]);
  const page = await context.newPage(), errors = [], bodies = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const original = '```html\n<!doctype html><html><head><title>Поле</title></head><body><script>const cameraSpeed=5; const grassDensity=100;</script>Поле</body></html>\n```';
  const improved = original.replace('grassDensity=100', 'grassDensity=500');
  const selectedEdit = original.replace('grassDensity=100', 'grassDensity=750');
  let mode = 'create';
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== s.base) return route.abort();
    if (url.pathname !== '/api/chat') return route.continue();
    bodies.push(route.request().postDataJSON());
    const events = mode === 'create' ? [{ t: original }, { diag: { artifactMode: 'create', outcome: 'complete' } }]
      : mode === 'edit' ? [{ s: 'edit', q: 'Поле' }, { reset: true }, { t: improved }, { diag: { artifactMode: 'edit', editCount: 1, outcome: 'complete' } }]
      : mode === 'selected' ? [{ reset: true }, { t: selectedEdit }, { diag: { artifactMode: 'edit', editCount: 1, outcome: 'complete' } }]
      : mode === 'fail' ? [{ e: 'Правки не применены; исходная версия сохранена.' }, { diag: { artifactMode: 'edit', outcome: 'edit_rejected' } }]
      : [{ t: 'Четыре.' }, { diag: { artifactMode: null, outcome: 'complete' } }];
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: events.map((e) => JSON.stringify(e)).join('\n') + '\n' });
  });
  const sendAndWait = async (text) => {
    await page.evaluate((text) => send(text), text);
    await page.waitForFunction(() => !busy && S.chats.find((c) => c.id === S.cur)?.msgs.at(-1)?.live === false);
  };
  await page.goto(s.base + '/chat'); await page.waitForFunction(() => MODELS.length > 0);
  await sendAndWait('создай 3д поле от первого лица');
  assert.equal(bodies[0].currentArtifact, undefined);
  assert.equal(await page.evaluate(() => PremierArtifact.forChat(cur()).source), original);
  // Переписка без новых HTML не должна вытеснять закреплённую версию.
  await page.evaluate(() => {
    const c = cur();
    for (let i = 0; i < 45; i++) c.msgs.push({ id: 'filler-' + i, r: i % 2 ? 'a' : 'u', t: 'Разговор ' + i });
    save();
  });
  await page.reload(); await page.waitForFunction(() => MODELS.length > 0);
  mode = 'edit'; await sendAndWait('доработай траву');
  assert.equal(bodies.at(-1).currentArtifact.source, original);
  assert.equal(bodies.at(-1).messages.length, 40);
  assert.ok(!bodies.at(-1).messages.some((m) => m.content === original), 'Старый код не в истории: он передан отдельно');
  assert.equal(await page.evaluate(() => PremierArtifact.forChat(cur()).source), improved);
  await page.waitForFunction(() => document.querySelector('#pFrame').srcdoc.includes('grassDensity=500'));
  assert.ok(await page.evaluate(() => document.querySelector('#pFrame').srcdoc.includes('cameraSpeed=5')));
  // Выбор предыдущей карточки закрепляет именно её, не последний ответ.
  await page.locator('.art').first().click();
  assert.equal(await page.evaluate(() => PremierArtifact.forChat(cur()).source), original);
  mode = 'selected'; await sendAndWait('улучши траву');
  assert.equal(bodies.at(-1).currentArtifact.source, original);
  assert.equal(await page.evaluate(() => PremierArtifact.forChat(cur()).source), selectedEdit);
  mode = 'fail'; await sendAndWait('измени траву');
  assert.equal(await page.evaluate(() => PremierArtifact.forChat(cur()).source), selectedEdit);
  assert.match(await page.evaluate(() => cur().msgs.at(-1).err), /не применены/);
  mode = 'general';
  await page.evaluate(() => { S.cur = null; S.proj = null; });
  await sendAndWait('сколько будет два плюс два');
  assert.equal(bodies.at(-1).currentArtifact, undefined, 'Новый чат не должен отправлять код другого чата');
  assert.deepEqual(errors, []);
});