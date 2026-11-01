'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { copyApp, seed, startServer, rm } = require('./helpers');
test('pricing: explicit Pro flagships, real plan membership, mobile and dynamic prices', { timeout: 30000 }, async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const dir = copyApp(); seed(dir);
  const flagships = ['GPT 6.1 Sol', 'Grok 4.7', 'Qwen 3.8 Max', 'GLM 5.3'];
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([
    { id: 'free-model', name: 'Базовая модель', plans: ['free', 'pro', 'max'] },
    ...flagships.map((name,i) => ({ id: 'flagship-'+i, name, plans: ['pro','max'] }))
  ]));
  const s = await startServer(dir);
  t.after(async () => { await browser.close(); await s.stop(); rm(dir); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === s.base ? route.continue() : route.abort());
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(s.base); await page.waitForSelector('.flagship-list');
  const pro = page.locator('.tier').filter({ has: page.locator('h3', { hasText: /^Pro$/ }) });
  assert.equal(await pro.locator('.flagship-feature>div>strong').innerText(), 'Доступ к флагманам:');
  assert.deepEqual(await pro.locator('.flagship-list li strong').allTextContents(), flagships);
  assert.match(await pro.locator('.pr2').innerText(), /390 ₽/);
  assert.match(await pro.innerText(), /300 сообщений в день/);
  assert.match(await pro.innerText(), /50 запусков Python в день/);
  assert.match(await pro.innerText(), /30 сайтов в день/);
  assert.ok(!(await pro.innerText()).includes('Все модели'));
  const free = page.locator('.tier').filter({ has: page.locator('h3', { hasText: /^Free$/ }) });
  assert.match(await free.innerText(), /Модели: Базовая модель/);
  assert.ok(!(await free.innerText()).includes('GPT 6.1 Sol'));
  const out = process.env.PRICING_QA_DIR;
  if (out) fs.mkdirSync(out, { recursive: true });
  for (const [name,width,height] of [['desktop',1440,1100],['mobile',390,844],['narrow',320,740]]) {
    await page.setViewportSize({ width,height }); await pro.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name+': horizontal overflow');
    for (const row of await pro.locator('.flagship-list li').all()) { const r = await row.boundingBox(); assert.ok(r.x >= 0 && r.x+r.width<=width); }
    if (out) {
      const target = name === 'desktop' ? page.locator('.tiers') : pro;
      await target.screenshot({ path: `${out}/${name}-pricing.png` });
      const fragment = await target.evaluate(el=>el.outerHTML);
      const css = await page.locator('style').first().textContent();
      const symbols = await page.locator('body>svg').first().evaluate(el=>el.outerHTML);
      fs.writeFileSync(`${out}/${name}.html`, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тариф Pro · Premier</title><style>${css}\nhtml{scroll-behavior:auto}body{padding:32px 20px}.tiers{max-width:1120px;margin:0 auto}.tier{max-width:100%}.rv{opacity:1!important;transform:none!important}@media(max-width:600px){body{padding:20px 16px}.tier{margin:0 auto;max-width:460px}}</style><body>${symbols}${fragment}</body></html>`);
    }
  }
  // Prices remain server controlled, regardless of the fixed marketing names.
  const plans = (await s.req('GET','/api/plans')).json;
  plans.plans.find(p=>p.id==='pro').price=590;
  await context.route('**/api/plans', route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(plans)}));
  await page.reload(); await page.waitForSelector('.flagship-list'); assert.match(await pro.locator('.pr2').innerText(), /590 ₽/);
  assert.deepEqual(errors, []);
});
