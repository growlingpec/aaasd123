'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {copyApp,seed,startServer,rm}=require('./helpers');
test('admin UI: configure public Model ID independently of provider ID', {timeout:60000},async t=>{
 const {chromium}=require('playwright');const dir=copyApp();seed(dir);
 fs.writeFileSync(dir+'/data/models.json',JSON.stringify([
  {id:'111111111111',name:'Claude Opus 5',modelId:'provider/claude-opus-actual',baseUrl:'http://127.0.0.1:1/v1',apiKey:'test-provider-private',plans:['free']},
  {id:'222222222222',name:'Grok 4.7',modelId:'provider/grok-actual',baseUrl:'http://127.0.0.1:1/v1',apiKey:'test-provider-private',plans:['free']}
 ]));
 const s=await startServer(dir);const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 t.after(async()=>{await browser.close();await s.stop();rm(dir);});
 const context=await browser.newContext({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===s.base?route.continue():route.abort());
 await context.addCookies([{name:'premier_session',value:'tok1',url:s.base}]);
 const page=await context.newPage(),errors=[],patternErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/pattern|regular expression/i.test(m.text()))patternErrors.push(m.text());});
 const model=()=>page.locator('.model[data-id="111111111111"]');
 const save=()=>model().locator('[data-meditf] button.pri').click();
 const edit=async()=>{await model().locator('[data-medit]').click();await model().locator('[data-meditf]:visible').waitFor();};
 const noOverflow=async()=>{const m=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,6).map(e=>e.className||e.tagName)}));assert.ok(m.scroll<=m.width,JSON.stringify(m));};
 const shots=process.env.ADMIN_IDS_QA_DIR;if(shots)fs.mkdirSync(shots,{recursive:true});
 await t.test('edit form distinguishes provider ID and public ID, validates and saves',async()=>{
  await page.goto(s.base+'/panelp#models');await page.fill('#pw','Test-Admin-Pass-2026');await page.click('#loginF button');
  await model().waitFor();await edit();
  assert.equal(await model().getByLabel('ID модели у провайдера',{exact:true}).inputValue(),'provider/claude-opus-actual');
  const input=model().getByLabel('Публичный Model ID',{exact:true});assert.equal(await input.inputValue(),'claude-opus-5');
  for(const invalid of ['UPPER','with space','foo/bar','модель','']){await input.fill(invalid);assert.equal(await input.evaluate(el=>el.checkValidity()),false,invalid);}
  for(const valid of ['claude-opus-custom','claude_opus.5','x'.repeat(96)]){await input.fill(valid);assert.equal(await input.evaluate(el=>el.checkValidity()),true,valid);}
  await input.fill('claude-opus-custom');await save();await page.waitForFunction(()=>document.querySelector('.model[data-id="111111111111"] .nm small').textContent.includes('claude-opus-custom'));
  await edit();assert.equal(await input.inputValue(),'claude-opus-custom');assert.ok((await model().textContent()).includes('Прежние ID: claude-opus-5'));
  assert.equal(await model().locator('[name=modelId]').inputValue(),'provider/claude-opus-actual');await noOverflow();
  if(shots)await page.screenshot({path:shots+'/desktop.png',fullPage:true});
 });
 await t.test('duplicate current and historical IDs show an error without losing edits',async()=>{
  const input=model().locator('[name=apiId]');await input.fill('grok-4.7');await save();
  await model().locator('[data-mmsg].err').waitFor();assert.match(await model().locator('[data-mmsg]').textContent(),/уже занят/);
  assert.equal(await input.inputValue(),'grok-4.7');assert.equal(await model().locator('[data-meditf]').isVisible(),true);
  await input.fill('opus-second');await save();await page.waitForFunction(()=>document.querySelector('.model[data-id="111111111111"] .nm small').textContent.includes('opus-second'));
  const second=page.locator('.model[data-id="222222222222"]');await second.locator('[data-medit]').click();await second.locator('[name=apiId]').fill('claude-opus-custom');await second.locator('button.pri').click();await second.locator('[data-mmsg].err').waitFor();assert.match(await second.locator('[data-mmsg]').textContent(),/уже занят/);
 });
 await t.test('mobile editing, persistence and developer dashboard use the saved ID',async()=>{
  await page.setViewportSize({width:390,height:844});await page.reload();await model().waitFor();await edit();await noOverflow();
  assert.equal(await model().locator('[name=apiId]').inputValue(),'opus-second');
  const rect=await model().locator('[name=apiId]').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390);
  if(shots)await page.screenshot({path:shots+'/mobile.png',fullPage:true});
  await page.goto(s.base+'/developers');await page.waitForSelector('[data-api-model="opus-second"]');
  await page.selectOption('#codeModel','opus-second');for(const lang of ['curl','python','javascript']){await page.click('[data-lang="'+lang+'"]');assert.ok((await page.textContent('#apiCode')).includes('opus-second'));}
 });
 await t.test('new-model form accepts an explicit ID or automatic generation',async()=>{
  await page.goto(s.base+'/panelp#models');await model().waitFor();await page.click('#addOpen');
  const form=page.locator('#addF');
  await form.locator('[name=name]').fill('Another Claude');await form.locator('[name=modelId]').fill('provider/new');await form.locator('[name=baseUrl]').fill('http://127.0.0.1:1/v1');await form.locator('[name=apiKey]').fill('test-secret');await form.locator('[name=apiId]').fill('claude-manual');
  await page.click('#addSave');await page.waitForFunction(()=>[...document.querySelectorAll('.nm small')].some(el=>el.textContent.includes('claude-manual')));
  await page.click('#addOpen');await form.locator('[name=name]').fill('Auto Name');await form.locator('[name=modelId]').fill('provider/auto');await form.locator('[name=baseUrl]').fill('http://127.0.0.1:1/v1');await form.locator('[name=apiKey]').fill('test-secret');
  assert.equal(await form.locator('[name=apiId]').inputValue(),'');assert.equal(await form.locator('[name=apiId]').evaluate(el=>el.checkValidity()),true);
  await page.click('#addSave');await page.waitForFunction(()=>[...document.querySelectorAll('.nm small')].some(el=>el.textContent.includes('auto-name')));
  await noOverflow();assert.deepEqual(errors,[]);assert.deepEqual(patternErrors,[]);
 });
});
