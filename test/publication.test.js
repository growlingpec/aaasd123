'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { needsBranding, PROMO_URL, PROMO_TEXT } = require('../publication');
const { copyApp, seed, startServer, rm } = require('./helpers');

test('publication branding: Free, trial, expired and active paid plans', () => {
  const pro = { id:'pro', tier:1, until:Date.now()+86400000 };
  assert.equal(needsBranding({}, {id:'free',tier:0,until:null}),true);
  assert.equal(needsBranding(null,pro),true);
  assert.equal(needsBranding({}, {...pro,until:null}),true);
  assert.equal(needsBranding({}, {...pro,until:Date.now()-1000}),true);
  assert.equal(needsBranding({trial:true},pro),true);
  assert.equal(needsBranding({},pro),false);
  assert.equal(needsBranding({}, {...pro,id:'max',tier:2}),false);
  assert.equal(needsBranding({}, {...pro,id:'custom',tier:1}),false);
  assert.equal(PROMO_URL,'https://ide.kgpix.bond/');
});

test('published pages: server policy, isolated iframe, upgrades and legacy sites', async t => {
  const dir = copyApp(); seed(dir, { users: [
    {id:'free',login:'free'}, {id:'paid',login:'paid',plan:'pro',until:Date.now()+1e10},
    {id:'trial',login:'trial',plan:'pro',until:Date.now()+1e10,trial:true},
    {id:'max',login:'max',plan:'max',until:Date.now()+1e10},
    {id:'expired',login:'expired',plan:'pro',until:Date.now()-1000}
  ],sessions:{tf:'free',tp:'paid',tt:'trial',tm:'max',te:'expired'} });
  const s = await startServer(dir); t.after(async()=>{ await s.stop(); rm(dir); });
  const html = '<!doctype html><html><body><h1>ORIGINAL-PUBLISHED-CONTENT</h1><script>window.gameReady=true;</script></body></html>';
  const title = '</title><script>window.titleInjected=true</script>';
  const published={};
  const publish = (token,extra={}) => s.req('POST','/api/publish',{token,body:{html,title,...extra}});
  await t.test('free cannot turn branding off in request; private key stays private', async()=>{
    const r=await publish('tf',{branding:false,plan:'pro',trial:false}); assert.equal(r.status,200,r.text); assert.equal(r.json.branding,true); published.free=r.json;
    const page=await s.req('GET',r.json.path); assert.equal(page.status,200); assert.ok(page.text.includes(PROMO_TEXT));
    assert.ok(page.text.includes('href="https://ide.kgpix.bond/"')); assert.ok(page.text.includes('id="published-site"'));
    assert.ok(!page.text.includes('ORIGINAL-PUBLISHED-CONTENT')); assert.ok(!page.text.includes(r.json.key));
    assert.ok(!page.text.includes('<script>window.titleInjected')); assert.ok(page.text.includes('&lt;/title&gt;'));
    assert.match(page.headers.get('content-security-policy'),/script-src 'none'/); assert.match(page.headers.get('cache-control'),/no-store/);
    assert.equal((await s.req('GET','/api/billing',{token:'tf'})).json.publicationBranding,true);
  });
  await t.test('paid owner has original HTML without footer, regardless of viewer plan', async()=>{
    for(const [name,token] of [['paid','tp'],['max','tm']]) {
      const r=await publish(token); assert.equal(r.status,200); published[name]=r.json; assert.equal(r.json.branding,false);
      const page=await s.req('GET',r.json.path,{token:'tf'}); assert.equal(page.text,html); assert.ok(!page.text.includes('premier-promo'));
      assert.match(page.headers.get('content-security-policy'),/^sandbox /);
    }
    assert.equal((await s.req('GET','/api/billing',{token:'tp'})).json.publicationBranding,false);
    assert.ok((await s.req('GET',published.free.path,{token:'tp'})).text.includes('premier-promo'));
  });
  await t.test('trial and expired Pro keep branding', async()=>{
    for(const token of ['tt','te']) {const r=await publish(token); assert.equal(r.json.branding,true); assert.ok((await s.req('GET',r.json.path)).text.includes('premier-promo'));}
  });
  await t.test('direct raw URL cannot be used as an unbranded browser link', async()=>{
    const raw=published.free.path+'.html';
    for(const headers of [{},{'Sec-Fetch-Dest':'document','Sec-Fetch-Site':'none'},{'Sec-Fetch-Dest':'iframe','Sec-Fetch-Site':'cross-site'}]) {
      const r=await s.req('GET',raw,{headers}); assert.equal(r.status,302); assert.equal(r.headers.get('location'),published.free.path);
    }
    const r=await s.req('GET',raw,{headers:{'Sec-Fetch-Dest':'iframe','Sec-Fetch-Site':'same-origin'}});
    assert.equal(r.status,200); assert.equal(r.text,html); assert.match(r.headers.get('content-security-policy'),/^sandbox /);
    assert.equal(r.headers.get('vary'),'Sec-Fetch-Dest, Sec-Fetch-Site'); assert.ok(!r.text.includes('premier-promo'));
  });
  await t.test('upgrade and downgrade change existing link without modifying HTML', async()=>{
    const admin=(await s.req('POST','/api/admin/login',{body:{password:'Test-Admin-Pass-2026'}})).json.token;
    // IDs in the admin route are hex; use direct SQLite to simulate a completed billing change.
    const {DatabaseSync}=require('node:sqlite');
    function update(patch){const db=new DatabaseSync(dir+'/data/premier.db'); const row=db.prepare('SELECT data FROM users WHERE id=?').get('free');const u=JSON.parse(row.data);Object.assign(u,patch);db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(u),'free');db.close();}
    update({plan:'pro',until:Date.now()+1e10,trial:false});
    let page=await s.req('GET',published.free.path); assert.equal(page.text,html);
    assert.equal((await s.req('GET','/api/billing',{token:'tf'})).json.publicationBranding,false);
    update({until:Date.now()-1000}); page=await s.req('GET',published.free.path); assert.ok(page.text.includes('premier-promo'));
    assert.equal(fs.readFileSync(dir+'/data/sites/'+published.free.id+'.html','utf8'),html);
    assert.ok(admin);
  });
  await t.test('legacy/unknown owner defaults to branding; no migration required', async()=>{
    const id='aaaaaaaaaa';fs.writeFileSync(dir+'/data/sites/'+id+'.html',html);
    const r=await s.req('GET','/s/'+id); assert.equal(r.status,200); assert.ok(r.text.includes('premier-promo'));
    fs.writeFileSync(dir+'/data/sites/'+id+'.json','{bad-json'); assert.equal((await s.req('GET','/s/'+id)).status,200);
  });
  await t.test('HEAD, missing site, method and unpublish remain correct', async()=>{
    const head=await s.req('HEAD',published.free.path);assert.equal(head.status,200);assert.equal(head.text,'');
    assert.equal((await s.req('GET','/s/bbbbbbbbbb')).status,404);
    assert.equal((await s.req('POST',published.free.path,{body:{}})).status,405);
    assert.equal((await s.req('DELETE','/api/publish/'+published.free.id,{body:{key:'wrong'}})).status,403);
    assert.equal((await s.req('DELETE','/api/publish/'+published.free.id,{body:{key:published.free.key}})).status,200);
    assert.equal((await s.req('GET',published.free.path)).status,404);
  });
});
