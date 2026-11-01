'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { copyApp, seed, startServer, rm } = require('./helpers');
test('Developer dashboard: responsive UI, keys, code samples, errors and accessibility', { timeout: 60000 }, async t => {
  const { chromium } = require('playwright');
  const dir = copyApp(); seed(dir, { users: [{ id: 'u1', login: 'anna', name: 'Анна', plan: 'pro', until: Date.now() + 864e5 }] });
  const models = [
    { id: 'premier-chat', name: 'Premier Chat', vision: false, weight: 1 },
    { id: 'premier-vision', name: 'Premier Vision', vision: true, weight: 2 },
    { id: 'premier-reason', name: 'Premier Reason', vision: false, weight: 3 },
    { id: 'premier-code', name: 'Premier Code', vision: false, weight: 2 },
  ].map((m, i) => ({ ...m, id: String(i + 1).padStart(12, '0'), modelId: 'private', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'private' }));
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify(models));
  const s = await startServer(dir);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await s.stop(); rm(dir); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addCookies([{ name: 'premier_session', value: 'tok1', url: s.base }]);
  await context.route('**/*', route => new URL(route.request().url()).origin === s.base ? route.continue() : route.abort());
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  const shots = process.env.API_QA_DIR;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  async function capture(name, fullPage = false) {
    if (!shots) return;
    await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
    await page.screenshot({ path: `${shots}/${name}.png`, fullPage });
    if (['desktop', 'mobile'].includes(name)) {
      const css = fs.readFileSync(dir + '/public/developers.css', 'utf8');
      const html = await page.evaluate(css => { const clone = document.documentElement.cloneNode(true); clone.querySelectorAll('select').forEach((sel) => { const current = document.getElementById(sel.id); [...sel.options].forEach(o => { o.selected = o.value === current.value; if (o.selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); }); }); clone.querySelectorAll('script,link[rel="stylesheet"]').forEach(e => e.remove()); const style = document.createElement('style'); style.textContent = css; clone.querySelector('head').append(style); clone.querySelector('#apiBaseUrl').setAttribute('value', document.querySelector('#apiBaseUrl').value.replace(location.origin, 'https://premier.example')); return '<!doctype html>' + clone.outerHTML; }, css);
      fs.writeFileSync(`${shots}/${name}.html`, html.replaceAll(s.base, 'https://premier.example'));
    }
  }
  const noOverflow = async () => { const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert.ok(metrics.scroll <= metrics.width, JSON.stringify(metrics)); };
  await t.test('private route and chat settings entry', async () => {
    assert.equal((await s.req('GET', '/developers')).status, 302);
    assert.equal((await s.req('GET', '/developers.html')).status, 302);
    await page.goto(s.base + '/chat'); await page.waitForFunction(() => typeof ME !== 'undefined' && ME && MODELS.length);
    await page.click('#meBtn'); await page.click('[data-acc="api"]'); await page.waitForURL('**/developers');
    await page.waitForSelector('#apiKeysList [data-create-key]'); assert.equal(await page.inputValue('#apiBaseUrl'), s.base + '/v1');
    await noOverflow(); await capture('empty', true);
  });
  await t.test('create modal and once-only secret', async () => {
    await page.locator('.page-heading [data-create-key]').click(); await page.waitForSelector('#createDialog[open]');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'apiKeyName');
    await capture('create');
    await page.fill('#apiKeyName', 'Telegram-бот'); await page.click('#apiCreateKey'); await page.waitForSelector('#secretDialog[open]');
    const key = await page.inputValue('#apiSecretValue'); assert.match(key, /^sk-premier-/);
    await page.click('#apiCopySecret'); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), key);
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(key));
    assert.ok(!(await page.textContent('#apiCode')).includes(key));
    // Preview must not contain even a test key.
    if (shots) { await page.evaluate(() => { document.querySelector('#apiSecretValue').value = 'sk-premier-••••••••••••••••••••••••••••••••••••'; }); await capture('secret'); }
    await page.click('#apiHideSecret'); assert.equal(await page.inputValue('#apiSecretValue'), '');
    assert.equal(await page.locator('.key-row').count(), 1);
  });
  await t.test('safe names, populated desktop and copy controls', async () => {
    await page.locator('.page-heading [data-create-key]').click(); await page.fill('#apiKeyName', 'Backend · production'); await page.click('#apiCreateKey'); await page.waitForSelector('#secretDialog[open]'); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#secretDialog').open && !document.querySelector('#apiSecretValue').value);
    assert.equal(await page.inputValue('#apiSecretValue'), '');
    await page.locator('.page-heading [data-create-key]').click(); await page.fill('#apiKeyName', '<img src=x onerror=bad()>'); await page.click('#apiCreateKey'); await page.waitForSelector('#secretDialog[open]'); await page.click('#apiHideSecret');
    assert.equal(await page.locator('#apiKeysList img').count(), 0);
    await page.locator('.key-row').filter({ hasText: '<img src=x onerror=bad()>' }).locator('[data-api-revoke]').click(); await page.click('#confirmRevoke'); await page.waitForFunction(() => !document.querySelector('#revokeDialog').open);
    await page.locator('[data-api-model]').first().click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'premier-chat');
    await page.click('#apiCopyBase'); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), s.base + '/v1');
    await page.evaluate(() => window.scrollTo(0, 0)); await capture('desktop', true); await noOverflow();
  });
  await t.test('three languages, model selection, keyboard tabs and exact copy', async () => {
    await page.selectOption('#codeModel', 'premier-vision');
    for (const lang of ['python', 'javascript', 'curl']) {
      await page.click(`[data-lang="${lang}"]`); const text = await page.textContent('#apiCode'); assert.ok(text.includes('premier-vision')); assert.ok(text.includes(s.base + '/v1')); assert.ok(text.includes('PREMIER_API_KEY'));
      await page.click('#copyCode'); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
    }
    await page.locator('[data-lang="curl"]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('[data-lang="python"]').getAttribute('aria-selected'), 'true');
    await page.click('[data-lang="curl"]');
  });
  await t.test('mobile 390px, dialogs and revoke confirmation', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await noOverflow(); await capture('mobile', true);
    await page.locator('.page-heading [data-create-key]').click(); await page.waitForSelector('#createDialog[open]'); await noOverflow(); await capture('create-mobile'); await page.keyboard.press('Escape');
    await page.locator('[data-api-revoke]').first().click(); await page.waitForSelector('#revokeDialog[open]'); await noOverflow(); await capture('revoke-mobile');
    await page.click('#confirmRevoke'); await page.waitForFunction(() => !document.querySelector('#revokeDialog').open); assert.equal(await page.locator('.key-row').count(), 1);
    await page.reload(); await page.waitForSelector('.key-row'); assert.equal(await page.inputValue('#apiSecretValue'), ''); await noOverflow();
  });
  await t.test('empty model catalog remains usable', async () => {
    await context.route('**/api/account/api-keys', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ base_url: s.base + '/v1', keys: [], models: [] }) }));
    await page.goto(s.base + '/developers'); await page.waitForSelector('#apiModelList .empty-state');
    assert.equal(await page.locator('#codeModel').isDisabled(), true); assert.equal(await page.locator('#copyCode').isDisabled(), true);
    await noOverflow(); await capture('empty-models-mobile', true);
    await context.unroute('**/api/account/api-keys');
  });
  await t.test('load failure and retry', async () => {
    await context.route('**/api/account/api-keys', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Не удалось загрузить кабинет. Попробуйте ещё раз.' }) }));
    await page.goto(s.base + '/developers'); await page.waitForSelector('#pageError:not([hidden])'); await page.evaluate(() => window.scrollTo(0,0)); await noOverflow(); await capture('error-mobile', true);
    await context.unroute('**/api/account/api-keys'); await page.click('#reloadPage'); await page.waitForSelector('.key-row'); assert.equal(await page.locator('#pageError').isVisible(), false);
    assert.deepEqual(errors, []);
  });
});
