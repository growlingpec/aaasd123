'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), http=require('node:http');
const { copyApp,seed,startServer,rm }=require('./helpers');
const {setApiId,ensureApiIds,findModel}=require('../model-ids');
test('manual IDs validate, preserve all former IDs and reserve them for their model',()=>{
 const models=[{id:'111111111111',name:'Claude Opus 5'},{id:'222222222222',name:'Grok 4.7'}];ensureApiIds(models);
 const first=models[0];setApiId(models,first,' opus-5 ');setApiId(models,first,'claude-premium');
 assert.deepEqual(first.apiAliases,['claude-opus-5','opus-5']);
 for(const id of ['111111111111','claude-opus-5','opus-5','claude-premium'])assert.equal(findModel(models,id),first);
 assert.throws(()=>setApiId(models,models[1],'opus-5'),e=>e.status===409);
 setApiId(models,first,'claude-opus-5');assert.deepEqual(first.apiAliases,['opus-5','claude-premium']);
 setApiId(models,first,'111111111111');assert.ok(!first.apiAliases.includes(first.id));
 models.push({id:'333333333333',name:'opus-5'});ensureApiIds(models);assert.equal(models[2].apiId,'opus-5-2');
 assert.equal(ensureApiIds(models),false);
 for(const v of ['',null,2,{},'GPT-5','модель','a/b','a b','<img>','-start','.start','a'.repeat(97)])assert.throws(()=>setApiId(models,first,v),e=>e.status===400);
 for(const v of ['gpt-5.1','claude_opus-5','a','a'.repeat(96)]){setApiId(models,first,v);assert.equal(first.apiId,v);}
});
test('admin Model ID: authorization, create/edit, collisions, aliases and provider mapping', {timeout:30000},async t=>{
 const upstream=[];
 const provider=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const b=JSON.parse(raw);upstream.push(b);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]}));});});
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 const dir=copyApp();seed(dir);let s=await startServer(dir);
 t.after(async()=>{await s.stop();provider.closeAllConnections();await new Promise(r=>provider.close(r));rm(dir);});
 const admin=(await s.req('POST','/api/admin/login',{body:{password:'Test-Admin-Pass-2026'}})).json.token;
 const headers={Authorization:'Bearer '+admin};
 const create=body=>s.req('POST','/api/admin/models',{headers,body:{name:'Claude Opus 5',modelId:'provider/claude-actual',baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,apiKey:'provider-private',plans:['free'],...body}});
 const list=async()=>(await s.req('GET','/api/admin/models',{headers})).json;
 let model;
 await t.test('only admin may create/edit a public ID',async()=>{
  assert.equal((await s.req('POST','/api/admin/models',{token:'tok1',body:{apiId:'owned'}})).status,401);
  assert.equal((await s.req('PATCH','/api/admin/models/111111111111',{token:'tok1',body:{apiId:'owned'}})).status,401);
 });
 await t.test('explicit and automatic creation and whitespace normalization',async()=>{
  const r=await create({apiId:' claude-opus-custom '});assert.equal(r.status,200,r.text);model=r.json;assert.equal(model.apiId,'claude-opus-custom');
  assert.equal((await create({name:'Other',apiId:''})).json.apiId,'other');
  assert.equal((await create({name:'Auto Model'})).json.apiId,'auto-model');
  assert.equal((await list()).find(m=>m.id===model.id).apiId,model.apiId);
 });
 const patch=body=>s.req('PATCH','/api/admin/models/'+model.id,{headers,body});
 await t.test('format and collision failures cannot modify any model fields',async()=>{
  const before=await list();
  for(const apiId of ['',null,123,{},'Invalid','модель','with space','foo/bar','<img src=x>','a'.repeat(97)]){
   assert.equal((await patch({apiId,name:'Should not persist'})).status,400);
   if(apiId !== '') assert.equal((await create({apiId})).status,400);
  }
  const other=before.find(m=>m.id!==model.id);
  for(const apiId of [other.apiId,other.id]){
   assert.equal((await patch({apiId,name:'Should not persist'})).status,409);
   assert.equal((await create({apiId})).status,409);
  }
  assert.deepEqual(await list(),before);
 });
 await t.test('changes update catalog and dashboard while every old ID still routes correctly',async()=>{
  assert.equal((await patch({apiId:'opus-v2'})).status,200);
  const r=await patch({apiId:'opus-v3'});assert.equal(r.status,200);assert.deepEqual(r.json.apiAliases,['claude-opus-custom','opus-v2']);
  const key=(await s.req('POST','/api/account/api-keys',{token:'tok1',body:{name:'test',expires_days:30}})).json.key;
  const auth={Authorization:'Bearer '+key};
  const dashboard=await s.req('GET','/api/account/api-keys',{token:'tok1'});assert.equal(dashboard.json.models[0].id,'opus-v3');
  for(const id of ['opus-v3','opus-v2','claude-opus-custom',model.id]){
   const found=await s.req('GET','/v1/models/'+id,{headers:auth});assert.equal(found.status,200);assert.equal(found.json.id,'opus-v3');
   const completion=await s.req('POST','/v1/chat/completions',{headers:auth,body:{model:id,messages:[{role:'user',content:'Hi'}]}});
   assert.equal(completion.status,200,completion.text);assert.equal(completion.json.model,'opus-v3');assert.equal(upstream.at(-1).model,'provider/claude-actual');
  }
  const other=(await list())[1];assert.equal((await s.req('PATCH','/api/admin/models/'+other.id,{headers,body:{apiId:'opus-v2'}})).status,409);
  assert.equal((await create({apiId:'claude-opus-custom'})).status,409);
  // New automatic names cannot steal a historical alias either.
  assert.equal((await create({name:'opus-v2'})).json.apiId,'opus-v2-2');
 });
 await t.test('rename, omitted ID, reverting to an old alias and restart preserve identity',async()=>{
  assert.equal((await patch({name:'Renamed'})).json.apiId,'opus-v3');
  const r=await patch({apiId:'claude-opus-custom'});assert.equal(r.status,200);assert.deepEqual(r.json.apiAliases,['opus-v2','opus-v3']);
  await s.stop();s=await startServer(dir);
  // Admin tokens are session-local; authenticate again after restart.
  const token=(await s.req('POST','/api/admin/login',{body:{password:'Test-Admin-Pass-2026'}})).json.token;
  const persisted=(await s.req('GET','/api/admin/models',{headers:{Authorization:'Bearer '+token}})).json.find(m=>m.id===model.id);
  assert.equal(persisted.apiId,'claude-opus-custom');assert.deepEqual(persisted.apiAliases,['opus-v2','opus-v3']);assert.equal(persisted.modelId,'provider/claude-actual');
 });
});
