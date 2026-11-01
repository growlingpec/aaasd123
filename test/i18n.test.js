'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {copyApp,seed,startServer,rm}=require('./helpers');
const {languageOf,localizeResponse}=require('../language');
test('language whitelist and localization never rewrite user data',()=>{
 const req=(url='/',cookie='')=>({url,headers:{cookie}});
 assert.equal(languageOf(req()),'ru');assert.equal(languageOf(req('/?lang=en')),'en');assert.equal(languageOf(req('/?lang=xx','premier_lang=en')),'en');assert.equal(languageOf(req('/','premier_lang=ru')),'ru');assert.equal(languageOf(req('/?lang=../../en')),'ru');
 const data={name:'Новый чат',messages:[{content:'Копировать'}],apiId:'kimi-k3',key:'sk-test',error:'Ключ не найден'};
 const out=localizeResponse(req('/api/account/api-keys','premier_lang=en'),data);assert.equal(out.error,'Key not found');for(const k of ['name','messages','apiId','key'])assert.deepEqual(out[k],data[k]);
 const array=[{name:'Модель'}];assert.equal(localizeResponse(req('/api/models','premier_lang=en'),array),array);
});
test('bilingual HTML routes, language cookie, errors and original content',async t=>{
 const dir=copyApp();seed(dir,{users:[{id:'u1',login:'anna'},{id:'u2',login:'delete-me'}],sessions:{tok1:'u1',tok2:'u2'},chats:{u1:{state:{chats:[{id:'saved',title:'Новый чат',msgs:[{id:'m1',r:'u',t:'Копировать'}]}],projects:[],cur:'saved'}}}});
 fs.writeFileSync(dir+'/data/models.json',JSON.stringify([{id:'111111111111',name:'Русское имя модели',modelId:'private/provider',baseUrl:'http://127.0.0.1:1/v1',apiKey:'private-key',plans:['free']} ]));
 const s=await startServer(dir);t.after(async()=>{await s.stop();rm(dir);});
 await t.test('Russian default and English pages have accurate lang and no mixed cache',async()=>{
  for(const page of ['/','/index.html','/privacy.html','/login']){
   const ru=await s.req('GET',page);assert.equal(ru.status,200);assert.match(ru.text,/<html lang="ru">/);
   const en=await s.req('GET',page+'?lang=en');assert.equal(en.status,200);assert.match(en.text,/<html lang="en">/);assert.equal(en.headers.get('content-language'),'en');assert.match(en.headers.get('vary'),/Cookie/);assert.match(en.headers.get('cache-control'),/no-store/);assert.match(en.headers.get('set-cookie'),/premier_lang=en/);
   assert.match(en.text,/data-language="ru"/);assert.match(en.text,/data-language="en"/);
  }
  assert.match((await s.req('GET','/',{headers:{Cookie:'premier_lang=en'}})).text,/Top AI models in one place/);
  assert.match((await s.req('GET','/?lang=invalid')).text,/<html lang="ru">/);
 });
 await t.test('chat and developers remain protected; English assets load only UI code',async()=>{
  for(const page of ['/chat?lang=en','/developers?lang=en'])assert.equal((await s.req('GET',page)).status,302);
  for(const page of ['/chat','/developers']){const r=await s.req('GET',page+'?lang=en',{token:'tok1'});assert.equal(r.status,200);assert.match(r.text,/<html lang="en">/);assert.ok(!r.text.includes('private/provider'));}
  assert.match((await s.req('GET','/chat?lang=en',{token:'tok1'})).text,/\/en\/js\/14-start.js/);
  for(const name of ['developers.js','js/04-render.js','js/10-account.js','js/13-billing.js','js/14-start.js'])assert.equal((await s.req('GET','/en/'+name)).status,200);
  assert.equal((await s.req('GET','/en/chat.html')).headers.get('location'),'/chat?lang=en');
 });
 await t.test('English publication badge does not translate the user website',async()=>{
  const pub=await s.req('POST','/api/publish',{token:'tok1',body:{title:'Сайт пользователя',html:'<!doctype html><title>Новый чат</title><p>Сохранить</p>'}});
  assert.equal(pub.status,200,pub.text);
  const pathname=pub.json.path;
  const r=await s.req('GET',pathname,{headers:{Cookie:'premier_lang=en'}});assert.match(r.text,/<html lang="en">/);assert.match(r.text,/Made in 1 minute with Premier/);assert.match(r.text,/Сайт пользователя/);
  const raw=await s.req('GET',pathname+'.html',{headers:{'Sec-Fetch-Dest':'iframe','Sec-Fetch-Site':'same-origin',Cookie:'premier_lang=en'}});assert.match(raw.text,/<p>Сохранить<\/p>/);assert.ok(!raw.text.includes('Made in 1 minute'));
 });
 await t.test('English UI errors and English deletion confirmation are supported',async()=>{
  const headers={Cookie:'premier_session=tok2; premier_lang=en'};
  const invalid=await s.req('POST','/api/account/api-keys',{headers,body:{name:''}});assert.equal(invalid.status,400);assert.equal(invalid.json.error,'Key name: 1–60 characters');
  const wrong=await s.req('DELETE','/api/account',{headers,body:{confirm:'wrong'}});assert.equal(wrong.status,400);assert.equal(wrong.json.error,'Type “delete”');
  assert.equal((await s.req('DELETE','/api/account',{headers,body:{confirm:'delete'}})).status,200);
 });
 await t.test('model names, IDs and chat messages are unchanged across languages',async()=>{
  const headers={Cookie:'premier_session=tok1; premier_lang=en'};
  const models=await s.req('GET','/api/models',{headers});assert.ok(Array.isArray(models.json));assert.equal(models.json[0].name,'Русское имя модели');assert.equal(models.json[0].id,'111111111111');
  const api=await s.req('GET','/api/account/api-keys',{headers});assert.equal(api.json.models[0].name,'Русское имя модели');
  const sync=await s.req('GET','/api/sync?since=0',{headers});assert.ok(sync.text.includes('Копировать'));assert.ok(sync.text.includes('Новый чат'));
  const ru=await s.req('GET','/api/plans');const en=await s.req('GET','/api/plans',{headers});assert.equal(en.json.plans[0].price,ru.json.plans[0].price);
  assert.equal(en.json.plans[0].desc,'To get started'); // User/admin data is translated only for cataloged stock descriptions.
 });
});
