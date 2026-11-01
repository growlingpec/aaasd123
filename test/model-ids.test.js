'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http');
const { ensureApiIds, publicId, findModel, slug } = require('../model-ids');
const { copyApp, seed, startServer, rm } = require('./helpers');
const names = ['Kimi K3','Grok 4.7','Qwen 3.8 Max','Gemini 3.8 Flash High','Glm 5.3','Gpt 6.1 Sol','Gpt 6 Astra'];
const ids = ['kimi-k3','grok-4.7','qwen-3.8-max','gemini-3.8-flash-high','glm-5.3','gpt-6.1-sol','gpt-6-astra'];
const legacy = ['658fcd787485','122ad81ae0c8','b88789fe24a5','3f86ea602202','9e4e9884e237','4039e8e3c4b2','8f5c1493b52b'];
test('public model IDs: readable, stable, unique and legacy-compatible', () => {
  const models = names.map((name, i) => ({ name, id:legacy[i] }));
  assert.equal(ensureApiIds(models), true); assert.deepEqual(models.map(publicId), ids);
  assert.equal(ensureApiIds(models), false);
  models[0].name = 'New marketing name'; models.reverse(); assert.equal(ensureApiIds(models), false);
  assert.equal(findModel(models,'kimi-k3').id,legacy[0]); assert.equal(findModel(models,legacy[0]).apiId,'kimi-k3');
  models.push({ id:'aaaaaaaaaaaa', name:'Grok 4.7' }); ensureApiIds(models); assert.equal(models.at(-1).apiId,'grok-4.7-2');
  models.push({ id:'bbbbbbbbbbbb', name:'Grok 4.7' }); ensureApiIds(models); assert.equal(models.at(-1).apiId,'grok-4.7-3');
  const reserved = [{ id:'cccccccccccc', name:'grok-4.7' },{ id:'grok-4.7', name:'Legacy' }]; ensureApiIds(reserved);
  assert.equal(reserved[0].apiId,'grok-4.7-2'); assert.equal(reserved[1].apiId,'grok-4.7');
  const unsafe = [{ id:'dddddddddddd', name:'<script>bad()</script>' },{ id:'eeeeeeeeeeee', name:'✨' },{ id:'ffffffffffff', name:'✨' }];
  ensureApiIds(unsafe); assert.equal(unsafe[1].apiId,'model'); assert.equal(unsafe[2].apiId,'model-2');
  assert.ok(unsafe.every(m => /^[a-z0-9][a-z0-9.-]*$/.test(m.apiId))); assert.equal(slug('Быстрая модель'), 'bystraya-model');
});
test('API aliases: migration, dashboard, inference, access checks and restart', { timeout:30000 }, async t => {
  const received=[];
  const provider=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    const b=JSON.parse(raw);received.push(b);
    if(b.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    else {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{index:0,message:{role:'assistant',content:'OK'},finish_reason:'stop'}]}));}
  });});
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  const dir=copyApp();seed(dir);
  const models=names.map((name,i)=>({name,id:legacy[i],modelId:'private-'+i,baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,apiKey:'private-key',plans:['free'],weight:1,vision:true}));
  models.push({ ...models[0],id:'aabbccddeeff',name:'Paid Only',plans:['pro'] });
  fs.writeFileSync(dir+'/data/models.json',JSON.stringify(models));
  let s=await startServer(dir);
  t.after(async()=>{await s.stop();provider.closeAllConnections();await new Promise(r=>provider.close(r));rm(dir);});
  const key=(await s.req('POST','/api/account/api-keys',{token:'tok1',body:{name:'test',expires_days:30}})).json.key;
  const headers={Authorization:'Bearer '+key};
  const infer=(id,stream=false)=>s.req('POST','/v1/chat/completions',{headers,body:{model:id,stream,messages:[{role:'user',content:'Hi'}]}});
  await t.test('dashboard and API catalog expose the same readable IDs; chat keeps internal IDs',async()=>{
    const dashboard=await s.req('GET','/api/account/api-keys',{token:'tok1'});
    assert.deepEqual(dashboard.json.models.map(m=>m.id),ids);
    const catalog=await s.req('GET','/v1/models',{headers});assert.deepEqual(catalog.json.data.map(m=>m.id),ids);
    assert.ok(!/private-|baseUrl|apiKey/.test(catalog.text));
    const chat=await s.req('GET','/api/models',{token:'tok1'});assert.deepEqual(chat.json.slice(0,7).map(m=>m.id),legacy);
    for(let i=0;i<ids.length;i++)for(const id of [ids[i],legacy[i]]){
      const r=await s.req('GET','/v1/models/'+id,{headers});assert.equal(r.status,200);assert.equal(r.json.id,ids[i]);
    }
  });
  await t.test('new and old IDs route to unchanged private provider ID, including streaming',async()=>{
    for(const id of [ids[0],legacy[0]]){const r=await infer(id);assert.equal(r.status,200,r.text);assert.equal(r.json.model,ids[0]);assert.equal(received.at(-1).model,'private-0');}
    for(const id of [ids[1],legacy[1]]){const r=await infer(id,true);assert.equal(r.status,200);assert.match(r.text,/"model":"grok-4.7"/);assert.equal(received.at(-1).model,'private-1');}
  });
  await t.test('paid models and unknown aliases cannot bypass restrictions',async()=>{
    for(const id of ['paid-only','aabbccddeeff']){assert.equal((await infer(id)).status,403);assert.equal((await s.req('GET','/v1/models/'+id,{headers})).status,404);}
    assert.equal((await infer('not-a-model')).status,404);
  });
  await t.test('new models receive unique readable IDs immediately on save',async()=>{
    const admin=(await s.req('POST','/api/admin/login',{body:{password:'Test-Admin-Pass-2026'}})).json.token;
    const r=await s.req('POST','/api/admin/models',{headers:{Authorization:'Bearer '+admin},body:{name:'Grok 4.7',modelId:'second-provider',baseUrl:'http://127.0.0.1:1/v1',apiKey:'second-secret',plans:['free']}});
    assert.equal(r.status,200,r.text);
    const item=(await s.req('GET','/v1/models/grok-4.7-2',{headers}));assert.equal(item.status,200);assert.equal(item.json.id,'grok-4.7-2');
    assert.equal((await s.req('GET','/v1/models/'+r.json.id,{headers})).json.id,'grok-4.7-2');
  });
  await t.test('rename, reordering and server restart preserve the saved public ID',async()=>{
    const admin=(await s.req('POST','/api/admin/login',{body:{password:'Test-Admin-Pass-2026'}})).json.token;
    assert.equal((await s.req('PATCH','/api/admin/models/'+legacy[0],{headers:{Authorization:'Bearer '+admin},body:{name:'Completely renamed'}})).status,200);
    assert.equal((await s.req('POST','/api/admin/models/order',{headers:{Authorization:'Bearer '+admin},body:{ids:[...legacy].reverse()}})).status,200);
    await s.stop(); s=await startServer(dir);
    const r=await s.req('GET','/v1/models/kimi-k3',{headers});assert.equal(r.status,200);assert.equal(r.json.name,'Completely renamed');assert.equal(r.json.id,'kimi-k3');
    assert.equal((await infer(legacy[0])).status,200);
    const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(dir+'/data/premier.db');
    const saved=JSON.parse(db.prepare('SELECT v FROM kv WHERE k = ?').get('models').v);db.close();assert.equal(saved.find(m=>m.id===legacy[0]).apiId,'kimi-k3');
  });
});
