'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('http'),fs=require('fs'),vm=require('vm'),zlib=require('zlib');
const dl=require('../asset-download'), shared=require('../public/js/00-model-assets');
const {copyApp,seed,startServer,rm}=require('./helpers');
function fixture(doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],extras:{title:'Test model'}}){
 const json=Buffer.from(JSON.stringify(doc)), padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]), b=Buffer.alloc(20+padded.length);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(padded.length,12);b.writeUInt32LE(0x4e4f534a,16);padded.copy(b,20);return b;
}
function unzip(b){const files={};let off=0;while(b.readUInt32LE(off)===0x04034b50){const method=b.readUInt16LE(off+8),size=b.readUInt32LE(off+18),n=b.readUInt16LE(off+26),x=b.readUInt16LE(off+28),name=b.subarray(off+30,off+30+n).toString(),start=off+30+n+x;files[name]=method===8?zlib.inflateRawSync(b.subarray(start,start+size)):b.subarray(start,start+size);off=start+size;}return files;}
test('GLB magic/version/length, no ZIP or remote dependency',()=>{
 assert.deepEqual(dl.validateGLB(fixture()),{extensionsRequired:[]});
 for(const b of [Buffer.from('<html>Not a model</html>'),Buffer.alloc(100),fixture().subarray(0,28)])assert.throws(()=>dl.validateGLB(b));
 const version=fixture();version.writeUInt32LE(1,4);assert.throws(()=>dl.validateGLB(version));
 assert.throws(()=>dl.validateGLB(fixture({asset:{version:'2.0'},scenes:[{}],buffers:[{uri:'https://evil.example/b.bin',byteLength:10}]})),/внешние/);
 assert.throws(()=>dl.validateGLB(fixture({asset:{version:'2.0'},scenes:[{}],buffers:[{byteLength:10}]})),/buffer/);
 assert.throws(()=>dl.validateGLB(fixture({asset:{version:'2.0'},scenes:[{}],extensions:{evil:{uri:'file:///secret'}}})),/внешние/);
});
test('asset URL validation: no credentials / protocols / unusual ports',()=>{
 for(const url of ['file:///tmp/a.glb','ftp://example.com/a','https://a:b@example.com/a','http://example.com:123/a'])assert.throws(()=>dl.checkedURL(url));
 assert.equal(dl.checkedURL('https://example.com/a#x').href,'https://example.com/a');
});
test('DNS pinning, rebinding resistance, redirects and limits',async(t)=>{
 const calls=[];let handler=(req,res)=>res.end(fixture());const site=http.createServer((req,res)=>handler(req,res));await new Promise(r=>site.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>site.close(r)));
 const options={lookup:async()=>[{address:'93.184.216.34',family:4}],request:(u,o,cb)=>{
  calls.push(u.href);o.lookup(u.hostname,{all:true},(e,ips)=>{assert.equal(e,null);assert.equal(ips[0].address,'93.184.216.34');});
  return http.get({hostname:'127.0.0.1',port:site.address().port,path:u.pathname,signal:o.signal},cb);
 }};
 assert.deepEqual((await dl.download('https://public.example/a.glb',options)).data,fixture());
 await assert.rejects(dl.download('https://public.example/a.glb',{...options,lookup:async()=>[{address:'127.0.0.1',family:4}]}),/Внутренний/);
 await assert.rejects(dl.download('https://public.example/a.glb',{...options,lookup:async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.2',family:4}]}),/Внутренний/);
 const before=calls.length;handler=(req,res)=>{res.writeHead(302,{Location:'http://169.254.169.254/latest/meta-data'});res.end();};await assert.rejects(dl.download('https://public.example/a.glb',options),/Внутренний/);assert.equal(calls.length,before+1);
 handler=(req,res)=>{res.writeHead(200,{'Content-Length':String(dl.MAX_BYTES+1)});res.end();};await assert.rejects(dl.download('https://public.example/a.glb',options),/20 МБ/);
 handler=(req,res)=>{res.writeHead(200,{'Content-Encoding':'gzip'});res.end('x');};await assert.rejects(dl.download('https://public.example/a.glb',options),/Сжатый/);
 handler=(req,res)=>{res.writeHead(302,{Location:'/again'});res.end();};await assert.rejects(dl.download('https://public.example/a.glb',options),/перенаправлений/);
 handler=(req,res)=>res.end('<!doctype html>login');await assert.rejects(dl.download('https://public.example/a.glb',options),/GLB v2/);
 const ac=new AbortController();setTimeout(()=>ac.abort(new Error('stop')),20);await assert.rejects(dl.download('https://public.example/a.glb',{...options,lookup:()=>new Promise(()=>{}),signal:ac.signal}),/stop/);
});
test('archives: real binary bytes, relative assets and credits; missing resource aborts export',async()=>{
 const id='a'.repeat(32),ref=`asset://${id}/model.glb`, data=fixture(),m={size:data.length,license:'CC0',name:'Test',sourceUrl:'https://example.com/model',sha256:require('crypto').createHash('sha256').update(data).digest('hex')};
 const fetcher=async(url)=>({ok:true,json:async()=>m,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});
 const entries=await shared.entries([{name:'game/index.html',code:`loader.load('${ref}')`}],'game',fetcher);
 assert.equal(entries[0].code,`loader.load('assets/${id}/model.glb')`);assert.deepEqual(Buffer.from(entries[1].data),data);assert.match(entries[2].code,/CC0/);
 assert.deepEqual(shared.ids('/a/'+id+'/model.glb'),[id]);assert.equal(shared.rewrite('https://app.example/a/'+id+'/model.glb','https://premier-assets.invalid'),'https://premier-assets.invalid/a/'+id+'/model.glb');
 const modular=await shared.entries([{name:'game/index.html',code:'main'}, {name:'game/js/main.js',code:ref}],'game',fetcher);assert.equal(modular[1].code,'assets/'+id+'/model.glb');
 assert.equal(shared.local(ref,'game/pages/field.html','game'),`../assets/${id}/model.glb`);
 assert.equal(shared.rewrite(ref,'https://app.example'),`https://app.example/a/${id}/model.glb`);
 await assert.rejects(shared.entries([{name:'game/index.html',code:ref}],'game',async()=>({ok:false})),/недоступна/);
 const context={TextEncoder,Uint8Array,Uint32Array,DataView,ArrayBuffer,Blob,Response,CompressionStream,Date,URL,document:{},console};vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../public/js/03-archives.js'),'utf8'),context);
 const zip=Buffer.from(await(await context.makeZip(entries)).arrayBuffer());assert.deepEqual(unzip(zip)[`game/assets/${id}/model.glb`],data);
 const tgz=await context.makeTgz(entries);let tar=Buffer.from(await tgz.arrayBuffer());if(tgz.type==='application/gzip')tar=zlib.gunzipSync(tar);let off=0,found=false;while(off+512<=tar.length){const name=tar.subarray(off,off+100).toString().replace(/\0.*$/s,''),size=parseInt(tar.subarray(off+124,off+136).toString(),8)||0;if(name===`game/assets/${id}/model.glb`){assert.deepEqual(tar.subarray(off+512,off+512+size),data);found=true;}off+=512+Math.ceil(size/512)*512;}assert.ok(found);
});
test('HTTP chat tool -> storage -> public CORS preview -> owner manifest -> publish',async(t)=>{
 const dir=copyApp();seed(dir,{users:[{id:'u1',login:'anna',plan:'max',until:Date.now()+1e10},{id:'u2',login:'bob'}],sessions:{tok1:'u1',tok2:'u2'}});
 const data=fixture();fs.writeFileSync(dir+'/fixture.glb',data);
 // Only the transport in this test application is replaced. Production cannot opt out of SSRF validation.
 fs.writeFileSync(dir+'/preload.cjs',`const net=require('./asset-download');net.download=async()=>({data:require('fs').readFileSync(__dirname+'/fixture.glb'),extensionsRequired:[]});`);
 let requests=0, mode='ok', record;
 const mock=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  const input=JSON.parse(body);requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});
  const tool=input.messages.findLast(m=>m.role==='tool');let delta;
  if(!tool){assert.ok(input.tools.some(t=>t.function.name==='download_asset'));delta={tool_calls:[{index:0,id:'asset_call',type:'function',function:{name:'download_asset',arguments:JSON.stringify({url:'https://models.example/tree.glb',name:'Tree',license:mode==='bad'?'':'CC0',sourceUrl:'https://models.example/tree?secret=x'})}}]};}
  else if(mode==='bad')delta={content:'Не удалось скачать модель.'};
  else{record=JSON.parse(tool.content.slice(tool.content.indexOf('{')));if(mode==='edit')delta={content:JSON.stringify({edits:[{path:'index.html',old:'const treeModel = null;',new:'const treeModel = '+JSON.stringify(record.ref)+';'}]})};else delta={content:'```html\n<!doctype html><html><head><title>Model game</title></head><body>Game with a downloaded model<script>fetch("'+record.ref+'").then(r=>r.arrayBuffer()).then(b=>document.body.dataset.modelBytes=b.byteLength);</script></body></html>\n```'};}
  res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:delta.tool_calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n');
 });});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 fs.writeFileSync(dir+'/data/models.json',JSON.stringify([{id:'m1',name:'Asset Mock',modelId:'mock',baseUrl:`http://127.0.0.1:${mock.address().port}`,apiKey:'test'}]));
 fs.writeFileSync(dir+'/data/settings.json',JSON.stringify({browser:false,selfcheck:false,code:false,provider:'off'}));
 const s=await startServer(dir,{NODE_OPTIONS:'--require ./preload.cjs'});t.after(async()=>{await s.stop();await new Promise(r=>mock.close(r));rm(dir);});
 const call=()=>s.req('POST','/api/chat',{token:'tok1',body:{model:'m1',messages:[{role:'user',content:'создай 3д игру с реальной моделью дерева'}]}});
 const r=await call();assert.equal(r.status,200,r.text);const events=r.text.trim().split('\n').map(JSON.parse);assert.ok(!events.some(e=>e.e),r.text);const asset=events.find(e=>e.asset)?.asset;assert.ok(asset);assert.equal(asset.uid,undefined);assert.equal(asset.sourceUrl,'https://models.example/tree');assert.equal(requests,2);
 const binary=await fetch(s.base+asset.path);assert.equal(binary.headers.get('access-control-allow-origin'),'*');assert.deepEqual(Buffer.from(await binary.arrayBuffer()),data);
 assert.equal((await s.req('GET','/api/assets/'+asset.id)).status,401);assert.equal((await s.req('GET','/api/assets/'+asset.id,{token:'tok2'})).status,404);assert.equal((await s.req('GET','/api/assets/'+asset.id,{token:'tok1'})).json.sha256,asset.sha256);
 assert.equal((await s.req('GET',`/a/${asset.id}/../fixture.glb`)).status,404);
 const source=events.filter(e=>e.t).map(e=>e.t).join(''),html=require('../public/js/00-artifact-state').latest(source).files[0].code;
 const pub=await s.req('POST','/api/publish',{token:'tok1',body:{html,title:'Model'}});assert.equal(pub.status,200,pub.text);assert.ok((await s.req('GET',pub.json.path)).text.includes(s.base+asset.path));
 mode='edit';const base='```html\n<!doctype html><html><head><title>Existing game</title></head><body><main>Existing landscape, terrain and WASD controls should remain unchanged.</main><script>const terrainSeed=123; const cameraSpeed=5; const treeModel = null; /* '+('preserve terrain and controls; '.repeat(40))+' */</script></body></html>\n```';
 const edit=await s.req('POST','/api/chat',{token:'tok1',body:{model:'m1',messages:[{role:'user',content:'добавь реальную 3д модель дерева'}],currentArtifact:{source:base}}});
 const ee=edit.text.trim().split('\n').map(JSON.parse);assert.ok(!ee.some(e=>e.e),edit.text);assert.equal(ee.find(e=>e.diag).diag.artifactMode,'edit');assert.ok(ee.some(e=>e.asset));assert.equal(ee.find(e=>e.diag).diag.editCount,1);const edited=ee.filter(e=>e.t).map(e=>e.t).join('');assert.ok(edited.includes('terrainSeed=123'));assert.ok(edited.includes('cameraSpeed=5'));assert.ok(edited.includes('asset://'));
 mode='bad';const fail=await call();assert.ok(!fail.text.includes('"asset":'));assert.match(fail.text,/лицензи/);
});
test('asset storage quotas, concurrency, cleanup and owner-only browser resolver',async(t)=>{
 const dir=copyApp();const net=require(dir+'/asset-download'),store=require(dir+'/db'),assets=require(dir+'/assets');
 store.users.put({id:'u1',login:'anna'});store.users.put({id:'u2',login:'bob'});
 t.after(()=>{store.db.close();rm(dir);});net.download=async()=>({data:fixture(),extensionsRequired:[]});
 const args={url:'https://models.example/a.glb',license:'CC0'};
 const a=await assets.download('u1',args);assert.ok(fs.existsSync(dir+'/data/assets/'+a.id+'/model.glb'));
 const resolver=assets.resolver('u1',a.ref);assert.deepEqual(resolver('https://premier-assets.invalid'+a.path).body,fixture());
 assert.equal(resolver('http://127.0.0.1'+a.path),null);assert.equal(assets.resolver('u2',a.ref)('https://premier-assets.invalid'+a.path),null);
 assert.equal(assets.manifest('u2',a.id),null);assert.ok(assets.manifest('u1',a.id));
 const day=new Date().toISOString().slice(0,10);store.kv.set('asset-attempt:u1',{day,n:20});await assert.rejects(assets.download('u1',args),/20 попыток/);
 store.kv.del('asset-attempt:u1');let release;net.download=()=>new Promise(r=>release=r);const pending=assets.download('u1',args);await assert.rejects(assets.download('u1',args),/уже выполняется/);release({data:fixture(),extensionsRequired:[]});await pending;
 assets.removeUser('u1');assert.equal(assets.get(a.id),null);assert.ok(!fs.existsSync(dir+'/data/assets/'+a.id));assert.equal(assets.list('u1').length,0);
 net.download=async()=>{throw new Error('network fail');};await assert.rejects(assets.download('u1',args),/network fail/);assert.equal(assets.list('u1').length,0);
 net.download=async()=>({data:fixture(),extensionsRequired:[]});const after=await assets.download('u1',args);assert.ok(after.id);
 assets.removeUser('u1');for(let i=0;i<50;i++)store.kv.set('asset:'+i.toString(16).padStart(32,'0'),{id:i.toString(16).padStart(32,'0'),uid:'u1',size:1});await assert.rejects(assets.download('u1',args),/50 файлов/);
});
