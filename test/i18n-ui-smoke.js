'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {copyApp,seed,startServer,rm}=require('./helpers');
test('RU/EN UI: navigation, dialogs, drafts, untouched user content and mobile layouts',{timeout:90000},async t=>{
 const {chromium}=require('playwright');const dir=copyApp();seed(dir,{users:[{id:'u1',login:'anna',name:'Анна',created:'2026-01-01',plan:'pro',until:Date.now()+864e5}],chats:{u1:{state:{projects:[{id:'p1',name:'Мой проект'}],chats:[{id:'saved',title:'Копировать',msgs:[{id:'u',r:'u',t:'Новый чат'},{id:'a',r:'a',t:'Сохранить — это текст ответа, а не кнопка.'}]}]}}}});
 fs.writeFileSync(dir+'/data/models.json',JSON.stringify([{id:'111111111111',name:'Kimi K3',modelId:'provider/private',baseUrl:'http://127.0.0.1:1/v1',apiKey:'provider-private',plans:['free','pro','max'],weight:1}]));
 const s=await startServer(dir),browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 t.after(async()=>{await browser.close();await s.stop();rm(dir);});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
 await context.route('**/*',r=>new URL(r.request().url()).origin===s.base?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const shots=process.env.I18N_QA_DIR;if(shots)fs.mkdirSync(shots,{recursive:true});
 const capture=async name=>{if(shots){await page.evaluate(()=>{scrollTo(0,0);const toast=document.getElementById('toast');if(toast)toast.hidden=true;});await page.screenshot({path:shots+'/'+name+'.png',fullPage:false});}};
 const noOverflow=async()=>{const x=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(x.scroll<=x.width,JSON.stringify(x));};
 const lang=async value=>{await page.locator('[data-language="'+value+'"]').click();await page.waitForFunction(v=>document.documentElement.lang===v,value);};
 await t.test('default Russian, English switch, metadata, prices and persistence',async()=>{
  await page.goto(s.base+'/');assert.equal(await page.locator('html').getAttribute('lang'),'ru');await lang('en');
  await page.waitForSelector('#tiers .tier');assert.match(await page.textContent('h1'),/Top AI models in one place/);assert.match(await page.title(),/learning, coding and websites/);
  assert.match(await page.textContent('#tiers'),/390 ₽/);assert.match(await page.textContent('#trialLine'),/3 days of Pro free/);assert.ok(!(await page.locator('body').innerText()).match(/[А-Яа-яЁё]/));
  assert.equal(await page.evaluate(()=>localStorage.getItem('premier:language')),'en');assert.equal(await page.locator('[data-language=en]').getAttribute('aria-current'),'true');await noOverflow();await capture('landing-en-desktop');
  await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'en');
 });
 await t.test('English landing fits mobile 390 and 320 px with an accessible switch',async()=>{
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await noOverflow();await capture('landing-en-'+width);for(const l of ['ru','en'])assert.equal(await page.locator('[data-language='+l+']').isVisible(),true);}
  await page.setViewportSize({width:1440,height:1000});
 });
 await t.test('English login, OAuth status and privacy policy retain the selected language',async()=>{
  await page.goto(s.base+'/login');assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.match(await page.textContent('h1'),/Sign in to Premier/);assert.match(await page.textContent('#err'),/Sign-in is not configured/);assert.ok(!(await page.locator('body').innerText()).match(/[А-Яа-яЁё]/));await noOverflow();await capture('login-en');
  await page.goto(s.base+'/privacy');assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.match(await page.textContent('h1'),/Privacy policy/);assert.ok(!(await page.locator('body').innerText()).match(/[А-Яа-яЁё]/));
 });
 await context.addCookies([{name:'premier_session',value:'tok1',url:s.base}]);
 await t.test('chat uses English UI without translating saved names, messages or model IDs',async()=>{
  await page.goto(s.base+'/chat');await page.waitForFunction(()=>typeof BILL!=='undefined'&&BILL&&MODELS.length&&S.chats.some(c=>c.id==='saved'));
  await page.evaluate(()=>{S.cur='saved';render();});
  assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('#q').getAttribute('placeholder'),'Ask anything');assert.match(await page.textContent('#newChat'),/New chat/);
  assert.match(await page.textContent('#projects'),/Мой проект/);assert.match(await page.textContent('#meName'),/Анна/);assert.match(await page.textContent('#col'),/Новый чат/);assert.match(await page.textContent('#col'),/Сохранить — это текст ответа, а не кнопка/);
  assert.equal(await page.evaluate(()=>MODELS[0].id),'111111111111');await noOverflow();await capture('chat-en');
 });
 await t.test('plan and account dialogs are English and do not silently lose edits',async()=>{
  await page.click('#pcUp');assert.equal(await page.textContent('#dtitle'),'Premier plans');assert.match(await page.textContent('#dbody'),/300 messages per day/);assert.match(await page.textContent('#dbody'),/50 Python runs per day/);assert.ok(!(await page.textContent('#dbody')).match(/[А-Яа-яЁё]/));
  await page.click('#dclose');await page.click('#meBtn');assert.equal(await page.textContent('#dtitle'),'Account settings');assert.match(await page.textContent('#dbody'),/Profile/);
  await page.click('[data-acc=security]');assert.match(await page.textContent('#dbody'),/Type “delete” to confirm/);await page.click('#dclose');
 });
 await t.test('composer draft and saved chat survive EN → RU → EN',async()=>{
  await page.fill('#q','Мой черновик: Скопировано');await lang('ru');await page.waitForFunction(()=>typeof MODELS!=='undefined'&&MODELS.length);assert.equal(await page.inputValue('#q'),'Мой черновик: Скопировано');assert.match(await page.textContent('#newChat'),/Новый чат/);
  await lang('en');await page.waitForFunction(()=>typeof MODELS!=='undefined'&&MODELS.length);assert.equal(await page.inputValue('#q'),'Мой черновик: Скопировано');assert.ok(await page.evaluate(()=>S.chats.some(c=>c.id==='saved')));
  await page.setViewportSize({width:390,height:844});await noOverflow();await capture('chat-en-mobile');await page.setViewportSize({width:1440,height:1000});
 });
 await t.test('developer models, copied ID, localized examples and key dialogs',async()=>{
  await page.goto(s.base+'/developers');await page.waitForSelector('[data-api-model="kimi-k3"]');assert.match(await page.textContent('h1'),/Your models. Your applications./);assert.match(await page.textContent('#apiCode'),/Hello!/);await page.locator('[data-api-model]').first().click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'kimi-k3');
  await page.locator('.page-heading [data-create-key]').click();assert.equal(await page.textContent('#createTitle'),'New API key');await page.fill('#apiKeyName','Сохранить');await page.click('#apiCreateKey');await page.waitForSelector('#secretDialog[open]');assert.equal(await page.textContent('#secretTitle'),'Key created');const key=await page.inputValue('#apiSecretValue');
  // Language switch must never discard a once-only secret.
  await page.locator('[data-language=ru]').evaluate(el=>el.click());assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.inputValue('#apiSecretValue'),key);await page.click('#apiHideSecret');assert.match(await page.textContent('#apiKeysList'),/Сохранить/);
  await page.locator('[data-api-revoke]').first().click();assert.equal(await page.textContent('#revokeTitle'),'Revoke key?');await page.click('#confirmRevoke');await page.waitForFunction(()=>!document.querySelector('#revokeDialog').open);assert.match(await page.textContent('#toast'),/Key revoked/);
  await noOverflow();await capture('developers-en');await page.setViewportSize({width:390,height:844});await noOverflow();await capture('developers-en-mobile');
 });
 await t.test('switching back to Russian is persistent on a different page',async()=>{
  await lang('ru');await page.waitForSelector('[data-api-model="kimi-k3"]');assert.match(await page.textContent('h1'),/Ваши модели/);await page.goto(s.base+'/');assert.equal(await page.locator('html').getAttribute('lang'),'ru');assert.match(await page.textContent('h1'),/Топовые нейросети/);assert.deepEqual(errors,[]);
 });
});
