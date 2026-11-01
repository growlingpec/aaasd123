(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PremierAssets=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const pattern=()=>/(?:asset:\/\/|(?:https?:\/\/[^/\s"'<>`]+)?\/a\/)([a-f0-9]{32})\/model\.glb/g;
  function ids(text){return [...new Set([...String(text||'').matchAll(pattern())].map(m=>m[1]))];}
  function rewrite(text,origin){return String(text||'').replace(pattern(),(_,id)=>`${origin}/a/${id}/model.glb`);}
  function relative(from,to){const a=from.split('/').slice(0,-1),b=to.split('/');while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}return '../'.repeat(a.length)+b.join('/');}
  function local(text,name,root){return String(text||'').replace(pattern(),(_,id)=>relative(name,`${root}/assets/${id}/model.glb`));}
  async function entries(files,root,fetcher=fetch){
    const all=[...new Set(files.flatMap(f=>ids(f.code)))];if(all.length>50)throw new Error('Too many models');
    const extra=[];let total=0;
    for(const id of all){
      const r=await fetcher('/api/assets/'+id);if(!r.ok)throw new Error('Model unavailable to its owner: '+id.slice(0,8));const m=await r.json();
      const b=await fetcher('/a/'+id+'/model.glb');if(!b.ok)throw new Error('Could not download the model');
      const data=new Uint8Array(await b.arrayBuffer());total+=data.length;if(data.length!==m.size||total>100*1024*1024)throw new Error('Invalid model size');
      if(globalThis.crypto?.subtle){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==m.sha256)throw new Error('Model is damaged');}
      extra.push({name:`${root}/assets/${id}/model.glb`,data},{name:`${root}/assets/${id}/credits.json`,code:JSON.stringify({name:m.name,sourceUrl:m.sourceUrl,license:m.license,attribution:m.attribution,licenseVerified:false,extensionsRequired:m.extensionsRequired},null,2)});
    }
    // GLTFLoader.load(url) resolves relative to the document, not the JS file.
    const entry=files.filter(f=>/\.html?$/i.test(f.name)).sort((a,b)=>Number(/(?:^|\/)index\.html?$/i.test(b.name))-Number(/(?:^|\/)index\.html?$/i.test(a.name))||a.name.length-b.name.length)[0];
    return files.map(f=>({...f,code:local(f.code,/\.html?$/i.test(f.name)?f.name:(entry?.name||f.name),root)})).concat(extra);
  }
  return {ids,rewrite,relative,local,entries};
});
