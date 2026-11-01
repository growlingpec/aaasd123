'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { copyApp, seed, startServer, rm } = require('./helpers');
const { PROMO_URL, PROMO_TEXT } = require('../publication');
test('published game UI: protected badge, responsive layout, CTA, owner upsell and paid upgrade', {timeout:60000}, async t => {
  const { chromium }=require('playwright');
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
  const dir=copyApp();seed(dir,{users:[{id:'a1',login:'anna'},{id:'a2',login:'boris',plan:'pro',until:Date.now()+1e10}],sessions:{tf:'a1',tp:'a2'}});
  fs.writeFileSync(dir+'/data/models.json',JSON.stringify([{id:'m1',name:'Demo',modelId:'m',baseUrl:'http://127.0.0.1:1/v1',apiKey:'test'}]));
  const s=await startServer(dir);t.after(async()=>{await browser.close();await s.stop();rm(dir);});
  const game=fs.readFileSync(dir+'/public/demo/snake.html','utf8');
  const publish=async(token,html=game,title='Змейка')=>{const r=await s.req('POST','/api/publish',{token,body:{html,title}});assert.equal(r.status,200,r.text);return r.json;};
  const free=await publish('tf'),paid=await publish('tp');
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(new URL(url).origin===s.base)return route.continue();
    if(url===PROMO_URL)return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Premier</title><h1>Создать свой сайт бесплатно</h1>'});
    return route.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const shots=process.env.PUBLICATION_QA_DIR;if(shots)fs.mkdirSync(shots,{recursive:true});
  async function capture(name,html=game){if(!shots)return;await page.screenshot({path:`${shots}/${name}.png`});
    if(['desktop','mobile','narrow'].includes(name)){
      const snapshot=await page.evaluate(html=>{const clone=document.documentElement.cloneNode(true),f=clone.querySelector('iframe');f.removeAttribute('src');f.setAttribute('srcdoc',html);return '<!doctype html>'+clone.outerHTML;},html);
      fs.writeFileSync(`${shots}/${name}.html`,snapshot);
    }
  }
  await t.test('actual game and badge fit without overlap on three viewports',async()=>{
    for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['narrow',320,740]]){
      await page.setViewportSize({width,height});await page.goto(s.base+free.path);
      const gameFrame=page.frameLocator('#published-site');await gameFrame.locator('#c').waitFor();await page.waitForTimeout(250);
      const badge=page.locator('#premier-promo'),frameBox=await page.locator('#published-site').boundingBox(),badgeBox=await badge.boundingBox();
      assert.ok(frameBox.y+frameBox.height<=badgeBox.y);assert.ok(badgeBox.x>=0&&badgeBox.x+badgeBox.width<=width);assert.ok(badgeBox.y+badgeBox.height<=height);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await badge.getAttribute('href'),PROMO_URL);assert.equal(await badge.getAttribute('aria-label'),PROMO_TEXT);
      assert.equal(await gameFrame.locator('canvas').evaluate(c=>c.width>0&&c.height>0),true);
      await capture(name);
      await gameFrame.locator('canvas').click();await page.keyboard.press('ArrowRight');
      assert.ok(await gameFrame.locator('#demo').evaluate(e=>e.classList.contains('hide')));
      assert.equal(await badge.isVisible(),true);
    }
  });
  await t.test('CTA opens real destination in a new unsandboxed tab without opener',async()=>{
    const popupPromise=context.waitForEvent('page');await page.locator('#premier-promo').click();const popup=await popupPromise;await popup.waitForLoadState();
    assert.equal(popup.url(),PROMO_URL);assert.equal(await popup.evaluate(()=>window.opener===null),true);await popup.close();
  });
  await t.test('site scripts/styles cannot remove the outer badge or escape to parent',async()=>{
    const hostile='<!doctype html><style>*{margin:0}#premier-promo{display:none!important}#cover{position:fixed;inset:0;background:#17151b;z-index:2147483647;color:white;padding:24px}</style><div id="cover">Тест изоляции сайта</div><script>try{parent.document.getElementById("premier-promo").remove();window.guardFailed=true}catch(e){window.guardBlocked=true}</script>';
    const item=await publish('tf',hostile,'Изоляция');await page.goto(s.base+item.path);const child=page.frameLocator('#published-site');
    await child.locator('#cover').waitFor();assert.equal(await child.locator('body').evaluate(()=>window.guardBlocked===true),true);assert.equal(await page.locator('#premier-promo').isVisible(),true);
    assert.ok(!page.url().includes('.html'));await page.goto(s.base+item.path+'.html');assert.equal(page.url(),s.base+item.path);assert.equal(await page.locator('#premier-promo').isVisible(),true);
  });
  await t.test('paid pages preserve original HTML; existing Free link upgrades without republish',async()=>{
    await page.setViewportSize({width:1440,height:900});await page.goto(s.base+paid.path);await page.locator('#c').waitFor();assert.equal(await page.locator('#premier-promo').count(),0);await capture('paid');
    const admin=(await s.req('POST','/api/admin/login',{body:{password:'Test-Admin-Pass-2026'}})).json.token;
    const r=await s.req('POST','/api/admin/users/a1/plan',{headers:{Authorization:'Bearer '+admin},body:{plan:'pro',days:30}});
    assert.equal(r.status,200,r.text);await page.goto(s.base+free.path);await page.locator('#c').waitFor();assert.equal(await page.locator('#premier-promo').count(),0);
    const down=await s.req('POST','/api/admin/users/a1/plan',{headers:{Authorization:'Bearer '+admin},body:{plan:'free'}});assert.equal(down.status,200,down.text);
  });
  await t.test('owner sees upgrade hint and can open plan picker',async()=>{
    await context.addCookies([{name:'premier_session',value:'tf',url:s.base}]);await page.goto(s.base+'/chat');await page.waitForFunction(()=>typeof BILL!=='undefined'&&BILL&&MODELS.length);
    await page.evaluate(({pub,source})=>{
      S.chats=[{id:'publication-chat',title:'Змейка',msgs:[{id:'publication-msg',r:'a',t:'```html\n'+source+'\n```',pubs:{0:pub}}]}];S.cur='publication-chat';render();showArt('publication-msg',0,'preview');
    },{pub:free,source:game});
    await page.waitForSelector('[data-pubupgrade]');assert.match(await page.locator('[data-pubupgrade]').innerText(),/Pro за 390 ₽/);
    await page.locator('[data-pubupgrade]').click();await page.waitForSelector('#modal.on');assert.equal(await page.locator('#dtitle').innerText(),'Тарифы Premier');
    assert.ok((await page.locator('#dbody').innerText()).includes('Публикации без плашки Premier'));
    assert.deepEqual(errors,[]);
  });
});
