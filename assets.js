'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),store=require('./db'),net=require('./asset-download');
const ROOT=path.join(__dirname,'data','assets'), active=new Set(); let running=0;
const valid=id=>typeof id==='string' && /^[a-f0-9]{32}$/.test(id);
function get(id) { return valid(id) ? store.kv.get('asset:'+id,null) : null; }
function list(uid) { return store.kv.keys('asset:').map(k=>store.kv.get(k,null)).filter(x=>x?.uid===uid); }
function publicRecord(m) { if(!m)return null; const {uid,...r}=m;return r; }
function manifest(uid,id) { const m=get(id); return m?.uid===uid ? publicRecord(m) : null; }
function bytes(id) { if(!get(id))return null;try{return fs.readFileSync(path.join(ROOT,id,'model.glb'));}catch{return null;} }
async function download(uid,args,signal) {
  net.checkedURL(args.url);
  if(typeof args.license!=='string' || !args.license.trim() || args.license.length>500) throw new Error('Укажи лицензию из источника; не выдумывай разрешение на использование');
  for(const k of ['name','attribution','sourceUrl']) if(args[k]!==undefined && (typeof args[k]!=='string'||args[k].length>2000))throw new Error('Некорректное поле '+k);
  const source = args.sourceUrl ? net.checkedURL(args.sourceUrl) : net.checkedURL(args.url); source.search='';source.hash='';
  if(active.has(uid)||running>=2)throw new Error('Загрузка 3D-ресурса уже выполняется; попробуй позже');
  const owned=list(uid); if(owned.length>=50 || owned.reduce((s,x)=>s+x.size,0)>=100*1024*1024)throw new Error('Лимит 3D-ресурсов: 50 файлов / 100 МБ');
  const day=new Date().toISOString().slice(0,10), key='asset-attempt:'+uid, count=store.kv.get(key,{day,n:0});
  const n=count.day===day?count.n:0; if(n>=20)throw new Error('Лимит 20 попыток загрузки моделей в день');store.kv.set(key,{day,n:n+1});
  active.add(uid);running++;
  try {
    const got=await net.download(args.url,{signal}); signal?.throwIfAborted();
    if(owned.reduce((s,x)=>s+x.size,0)+got.data.length>100*1024*1024) throw new Error('Лимит хранения моделей: 100 МБ');
    // The account may have been deleted while the remote request was in flight.
    if(!store.users.get(uid)) throw new Error('Аккаунт больше не существует');
    const id=crypto.randomBytes(16).toString('hex'), dir=path.join(ROOT,id);
    const m={id,uid,name:(args.name||'3D-модель').slice(0,120),size:got.data.length,sha256:crypto.createHash('sha256').update(got.data).digest('hex'),ref:`asset://${id}/model.glb`,path:`/a/${id}/model.glb`,sourceUrl:source.href,license:args.license.trim(),attribution:(args.attribution||'').slice(0,2000),licenseVerified:false,extensionsRequired:got.extensionsRequired,at:Date.now()};
    try{fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'model.glb'),got.data,{mode:0o600,flag:'wx'});store.kv.set('asset:'+id,m);}catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
    return publicRecord(m);
  }finally{active.delete(uid);running--;}
}
function removeUser(uid){for(const m of list(uid)){store.kv.del('asset:'+m.id);fs.rmSync(path.join(ROOT,m.id),{recursive:true,force:true});}store.kv.del('asset-attempt:'+uid);}
function serve(req,res,pathname) {
  const hit=pathname.match(/^\/a\/([a-f0-9]{32})\/model\.glb$/);if(!hit)return false;
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cross-Origin-Resource-Policy','cross-origin');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS'});res.end();return true;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return true;}
  const m=get(hit[1]);if(!m||!fs.existsSync(path.join(ROOT,m.id,'model.glb'))){res.writeHead(404);res.end();return true;}
  res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':m.size,'Cache-Control':'public, max-age=86400','Content-Disposition':'inline; filename="model.glb"'});
  if(req.method==='HEAD')res.end();else{const stream=fs.createReadStream(path.join(ROOT,m.id,'model.glb'));stream.on('error',()=>res.destroy());stream.pipe(res);}return true;
}
function resolver(uid,html){const ids=new Set(require('./public/js/00-model-assets').ids(html).filter(id=>get(id)?.uid===uid));let total=0;const cache=new Map();return url=>{
  let u;try{u=new URL(url);}catch{return null;}const m=u.pathname.match(/^\/a\/([a-f0-9]{32})\/model\.glb$/);
  if(u.origin!=='https://premier-assets.invalid'||!m||!ids.has(m[1]))return null;
  if(!cache.has(m[1])){const b=bytes(m[1]);total+=b?.length||0;if(!b||total>100*1024*1024)return null;cache.set(m[1],b);}
  return {contentType:'model/gltf-binary',body:cache.get(m[1]),headers:{'access-control-allow-origin':'*'}};
};}
const TOOL={type:'function',function:{name:'download_asset',description:'Download a real self-contained GLB v2 model from a direct public HTTP(S) URL (max 20 MB). No ZIP, web pages, credentials or external textures. License must be checked at source; declaration is recorded, not independently verified.',parameters:{type:'object',properties:{url:{type:'string'},name:{type:'string'},license:{type:'string'},attribution:{type:'string'},sourceUrl:{type:'string'}},required:['url','license']}}};
const NOTE=`\n3D-ресурсы: download_asset скачивает настоящий self-contained .glb. Не выдавай картинку за игру. Если пользователь просит реальную модель, найди прямой URL и условия лицензии (веб-поиск, если доступен), либо попроси ссылку. Не выдумывай лицензию, URL или успех загрузки. После успеха используй ТОЧНЫЙ ref asset://.../model.glb как строку для GLTFLoader.load. Интерфейс заменит ref рабочим URL, ZIP включит бинарный файл. Загружай модель в текущую игру, не создавай её заново. Добавляй attribution/источник. Для extensionsRequired подключай соответствующий decoder (например DRACO), либо выбирай несжатую модель; CDN loader версии должен совпадать с Three.js. Обрабатывай onError и показывай ошибку пользователю. Модели по непредсказуемым ссылкам доступны без входа: не загружай приватные файлы. Если прямого файла/лицензии нет, объясни ограничение, не имитируй загрузку.`;
module.exports={get,list,publicRecord,manifest,bytes,download,removeUser,serve,resolver,TOOL,NOTE};
