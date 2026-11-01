'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const {copyApp,seed,startServer,rm}=require('./helpers');
function unzip(b){const out={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const n=b.readUInt16LE(p+26),x=b.readUInt16LE(p+28),len=b.readUInt32LE(p+18),method=b.readUInt16LE(p+8),name=b.subarray(p+30,p+30+n).toString(),body=b.subarray(p+30+n+x,p+30+n+x+len);out[name]=method===8?zlib.inflateRawSync(body):body;p+=30+n+x+len;}return out;}
test('Chromium: opaque preview fetches GLB, ZIP contains exact binary and credentials-free HTML', {timeout:30000},async(t)=>{
 const {chromium}=require('playwright'),dir=copyApp();seed(dir);
 const id='b'.repeat(32),data=Buffer.from([0x67,0x6c,0x54,0x46,255,128,0,1,200,100]),sha=require('crypto').createHash('sha256').update(data).digest('hex');
 const asset={id,uid:'u1',name:'Test Tree',size:data.length,sha256:sha,ref:`asset://${id}/model.glb`,path:`/a/${id}/model.glb`,license:'CC0',licenseVerified:false,sourceUrl:'https://example.com/tree',extensionsRequired:[]};
 fs.mkdirSync(dir+'/data/assets/'+id,{recursive:true});fs.writeFileSync(dir+'/data/assets/'+id+'/model.glb',data);
 fs.writeFileSync(dir+'/preload.cjs',`require('./db').kv.set('asset:${id}',${JSON.stringify(asset)});`);
 fs.writeFileSync(dir+'/data/models.json',JSON.stringify([{id:'m1',name:'UI Assets',modelId:'mock',baseUrl:'http://127.0.0.1:1',apiKey:'test'}]));
 const s=await startServer(dir,{NODE_OPTIONS:'--require ./preload.cjs'}),b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,chromiumSandbox:true});t.after(async()=>{await b.close();await s.stop();rm(dir);});
 const ctx=await b.newContext(),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await ctx.addCookies([{name:'premier_session',value:'tok1',url:s.base}]);
 const source='```html\n<!doctype html><html><head><title>Test Game</title></head><body><main>Game with asset download</main><script>fetch("'+asset.ref+'").then(r=>r.arrayBuffer()).then(b=>document.querySelector("main").textContent="MODEL:"+b.byteLength).catch(e=>document.querySelector("main").textContent=e.message);</script></body></html>\n```';
 await ctx.route('**/api/chat',route=>route.fulfill({status:200,contentType:'application/x-ndjson',body:[{asset},{t:source},{diag:{artifactMode:'create',outcome:'complete'}}].map(JSON.stringify).join('\n')+'\n'}));
 await page.goto(s.base+'/chat');await page.waitForFunction(()=>MODELS.length>0);await page.evaluate(()=>send('создай 3д игру'));await page.waitForFunction(()=>!busy && !cur().msgs.at(-1).live);
 // Depending on normal follow-preview preference, explicitly open the completed artifact.
 await page.evaluate(()=>showArt(cur().msgs.at(-1).id,0,'preview'));const frame=page.frameLocator('#pFrame');await frame.locator('main').filter({hasText:'MODEL:'+data.length}).waitFor();
 assert.ok(await page.evaluate(()=>document.querySelector('#pFrame').getAttribute('sandbox').includes('allow-scripts')&&!document.querySelector('#pFrame').getAttribute('sandbox').includes('allow-same-origin')));
 assert.ok(await page.evaluate(()=>cur().msgs.at(-1).assets[0].ref.includes('asset://')));
 const downloaded=page.waitForEvent('download');await page.locator('[data-zip]').filter({hasText:'3D-моделями'}).click();const d=await downloaded;const files=unzip(fs.readFileSync(await d.path()));const binaryName=Object.keys(files).find(x=>x.endsWith('/model.glb'));assert.deepEqual(files[binaryName],data);const htmlName=Object.keys(files).find(x=>x.endsWith('/index.html'));assert.match(files[htmlName].toString(),new RegExp(`assets/${id}/model\\.glb`));assert.ok(!files[htmlName].toString().includes('asset://'));assert.ok(Object.keys(files).some(x=>x.endsWith('/credits.json')));
 assert.deepEqual(errors,[]);
});
test('Chromium selfcheck: virtual owned assets are fulfilled without opening localhost', {timeout:30000},async(t)=>{
 const browser=require('../browser');t.after(()=>browser.close());let hits=0;
 const html='<!doctype html><html><body><main>Model assets sandbox test page</main><script>fetch("https://premier-assets.invalid/a/'+'c'.repeat(32)+'/model.glb").then(r=>r.arrayBuffer()).then(b=>{if(b.byteLength!==4)throw new Error("bad model");}).catch(e=>console.error("ASSET:"+e.message));</script></body></html>';
 const result=await browser.checkHtml(html,false,{assetResolver:url=>{if(url.startsWith('https://premier-assets.invalid/a/')){hits++;return {contentType:'model/gltf-binary',body:Buffer.from([0,255,128,1]),headers:{'access-control-allow-origin':'*'}};}return null;}});
 assert.ok(hits>=2);assert.ok(!result.issues.some(x=>/ASSET:|Не загрузился ресурс/.test(x)),result.issues.join('\n'));await assert.rejects(browser.readPage('http://127.0.0.1/secret'));
});
