'use strict';
// Machine-readable checks are observations, not a promise that all gameplay is correct.
function isGame(html,messages=[]) {
  const last=[...messages].reverse().find(m=>m?.role==='user'),text=typeof last?.content==='string'?last.content:JSON.stringify(last?.content||'');
  return /(?:3[дd]|three\.?js|webgl|GLTFLoader|WebGLRenderer|__PREMIER_GAME__)/i.test(html) || /(?:first.person|первого лица|3[дd]|webgl|three\.?js)/i.test(text);
}
function report(chk,{game=false,reason=''}={}) {
  const checks=[{id:'page',label:'JavaScript и ресурсы',status:chk?(chk.issues?.length?'failed':'passed'):'unverified',detail:chk?((chk.issues||[]).join('; ')||'Ошибок при проверке не обнаружено'):(reason||'Браузерная проверка не выполнена')}];
  if(game){
    const observed=chk?.game;
    for(const [id,label] of [['render','Отрисовка 3D-сцены'],['models','Загрузка и добавление GLB в сцену'],['controls','Реакция камеры/игрока на WASD']]){
      const x=observed?.[id];checks.push({id,label,status:x?.status||'unverified',detail:x?.detail||'Нет наблюдений для подтверждения'});
    }
  }
  const relevant=checks.filter(x=>x.status!=='not_required');
  const status=relevant.some(x=>x.status==='failed')?'failed':relevant.every(x=>x.status==='passed')?'passed':'unverified';
  return {kind:game?'game':'page',status,checks,at:Date.now()};
}
// Runs BEFORE generated scripts. It observes native WebGL draws; game globals alone cannot produce a pass.
function probe() {
  const contexts=[]; const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=original.call(this,type,...args);
    if(gl && /^(webgl2?|experimental-webgl)$/.test(type) && !contexts.some(x=>x.gl===gl)){
      const item={canvas:this,gl,draws:0,last:0};contexts.push(item);
      for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
        const native=gl[method];if(typeof native!=='function')continue;
        try{gl[method]=function(...a){const out=native.apply(this,a);if((method.includes('Elements')?a[1]:a[2])>0 && gl.getError()===gl.NO_ERROR){item.draws++;item.last=performance.now();}return out;};}catch{}
      }
    } return gl;
  };
  function visible(node){if(!node?.isConnected)return false;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>=16&&r.height>=16&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0;}
  function meshes(root){let n=0;if(!root?.traverse)return n;root.traverse(x=>{if(x.isMesh&&x.visible!==false&&(x.geometry?.attributes?.position?.count||0)>0)n++;});return n;}
  function position(){const game=window.__PREMIER_GAME__,object=game?.player||game?.camera;if(!object?.position)return null;return ['x','y','z'].map(k=>Number(object.position[k])).every(Number.isFinite)?[object.position.x,object.position.y,object.position.z]:null;}
  const api=Object.freeze({snapshot(){
    const g=window.__PREMIER_GAME__,canvas=g?.renderer?.domElement,item=canvas?contexts.find(x=>x.canvas===canvas):contexts.find(x=>visible(x.canvas));
    const roots=Array.isArray(g?.modelRoots)?g.modelRoots:[];
    const attached=roots.filter(root=>{let p=root;for(let i=0;p&&i<100;i++,p=p.parent)if(p===g?.scene)return true;return false;});
    return {context:!!item,visible:!!item&&visible(item.canvas),draws:item?.draws||0,recent:!!item&&performance.now()-item.last<1500,lost:!!item&&item.gl.isContextLost(),sceneMeshes:meshes(g?.scene),modelMeshes:attached.reduce((n,r)=>n+meshes(r),0),roots:attached.length,registered:!!g,position:position()};
  }});
  Object.defineProperty(window,'__PREMIER_PROBE__',{value:api,writable:false,configurable:false});
}
function instrument(html){const script='<script>('+probe.toString()+')();</script>';if(/<head\b[^>]*>/i.test(html))return html.replace(/<head\b[^>]*>/i,m=>m+script);if(/<!doctype[^>]*>/i.test(html))return html.replace(/<!doctype[^>]*>/i,m=>m+script);return script+html;}
async function observe(page,{expectedModels=0,mobile=false,loadedModels=new Set()}={}) {
  const sample=()=>page.evaluate(()=>window.__PREMIER_PROBE__?.snapshot()||null);
  let before=await sample();
  for(let i=0;i<10 && (!before?.draws || (expectedModels && (!before?.modelMeshes || loadedModels.size<expectedModels)));i++) {await new Promise(r=>setTimeout(r,300));before=await sample();}
  const render=before?.context&&before.visible&&before.draws>0&&before.recent&&!before.lost ? {status:'passed',detail:`Наблюдались WebGL draw calls (${before.draws}), видимый canvas, контекст не потерян`} : {status:'failed',detail:'Не подтверждена активная WebGL-отрисовка в видимом canvas'};
  const models=!expectedModels?{status:'not_required',detail:'Внешние GLB в коде не заявлены'}:!before?.registered?{status:'unverified',detail:'Нет window.__PREMIER_GAME__: загрузку и добавление моделей в scene подтвердить нельзя'}:loadedModels.size>=expectedModels&&before.roots>=expectedModels&&before.modelMeshes>0&&render.status==='passed'?{status:'passed',detail:`Получено ${loadedModels.size} GLB; в scene найдено ${before.roots} зарегистрированных корней моделей с геометрией`}:{status:'failed',detail:`Ожидалось ${expectedModels} моделей; получено ${loadedModels.size} GLB; в scene зарегистрировано ${before.roots||0} корней с ${before.modelMeshes||0} meshes`};
  let controls={status:'unverified',detail:mobile?'WASD проверяется на desktop; touch-управление не проверялось':'Нет зарегистрированного camera/player для проверки движения'};
  if(!mobile&&before?.position){
    const compare=(a,b)=>!!a&&!!b&&Math.hypot(...a.map((x,i)=>x-b[i]))>0.0001;
    // Compare movement with a no-input baseline to avoid accepting a continuously moving camera as WASD.
    const p0=before.position;await new Promise(r=>setTimeout(r,400));const p1=(await sample())?.position;
    if(compare(p0,p1))controls={status:'unverified',detail:'Камера движется без ввода; влияние WASD не отделено от автоматического движения'};
    else{
      try{await page.locator?.('canvas').first().click({timeout:1500});}catch{try{await page.click('canvas',{timeout:1500});}catch{}}
      const changedKeys=[];
      for(const key of ['w','a','s','d']){const start=(await sample())?.position;await page.keyboard.down(key);try{await new Promise(r=>setTimeout(r,180));if(compare(start,(await sample())?.position))changedKeys.push(key);}finally{await page.keyboard.up(key);}}
      const end=(await sample())?.position;await new Promise(r=>setTimeout(r,400));const idle=(await sample())?.position;
      controls=changedKeys.length===4&&!compare(end,idle)?{status:'passed',detail:'Камера/игрок изменили позицию при каждой из 4 клавиш WASD на desktop; до ввода и после отпускания положение стабильно. Touch-управление не проверялось'}:{status:'unverified',detail:'Движение от WASD не подтверждено (возможны Pointer Lock, инерция, стартовый экран или другая схема управления)'};
    }
  }
  return {render,models,controls};
}
const NOTE=`\nТЕХНИЧЕСКАЯ ПРОВЕРКА 3D-ИГР: в игре после создания объектов выставь window.__PREMIER_GAME__ = { scene, camera, renderer, modelRoots: [] }; если движется отдельный player Object3D, добавь player. После успешного GLTFLoader.load добавь gltf.scene в scene и тот же объект в modelRoots. Это реальные объекты Three.js, не выдуманные статусы. Показывай ошибки loader.onError. Автотест наблюдает WebGL draws и меняет WASD на desktop; отсутствие диагностики означает «не подтверждено», не успех. Сам ответ «готово» не является проверкой. Не добавляй эту диагностику к обычным сайтам/не-WebGL играм. При точечной правке добавляй диагностические объекты небольшими edits, не переписывай игру целиком.`;
module.exports={isGame,report,instrument,observe,NOTE};
