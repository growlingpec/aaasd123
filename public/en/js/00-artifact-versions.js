(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PremierVersions=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function list(chat,artifact){const out=[];for(const m of chat?.msgs||[]){if(m.r!=='a'||m.live||m.err||m.cancelled)continue;artifact.extract(m.t).forEach((a,k)=>{if(a.valid)out.push({mid:m.id,k,title:a.title,source:a.source,files:a.files,validation:m.validation||null,parent:m.artifactParent||null});});}return out;}
  const same=(a,b)=>!!a&&!!b&&a.mid===b.mid&&a.k===b.k;
  function previous(chat,ref,artifact){const versions=list(chat,artifact),i=versions.findIndex(v=>same(v,ref));if(i<0)return null;const parent=versions[i].parent;if(parent){const p=versions.find(v=>same(v,parent));if(p&&!same(p,ref))return p;}return versions[i-1]||null;}
  function lineDiff(oldText,newText,limit=300){
    const a=oldText?String(oldText).split('\n'):[],b=newText?String(newText).split('\n'):[];let prefix=0,suffix=0;
    while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
    while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
    const A=a.slice(prefix,a.length-suffix),B=b.slice(prefix,b.length-suffix),rows=[];let added=0,removed=0,truncated=false;
    const push=(kind,text)=>{if(kind==='+')added++;if(kind==='-')removed++;if(rows.length<limit)rows.push({kind,text});else truncated=true;};
    if(A.length*B.length<=200000&&A.length<1000&&B.length<1000){
      const dp=Array.from({length:A.length+1},()=>new Uint16Array(B.length+1));
      for(let i=A.length-1;i>=0;i--)for(let j=B.length-1;j>=0;j--)dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
      let i=0,j=0;while(i<A.length||j<B.length){if(i<A.length&&j<B.length&&A[i]===B[j]){push(' ',A[i]);i++;j++;}else if(j<B.length&&(i===A.length||dp[i][j+1]>dp[i+1][j]))push('+',B[j++]);else push('-',A[i++]);}
    }else{for(const x of A)push('-',x);for(const x of B)push('+',x);}
    return {rows,added,removed,truncated,start:prefix+1,coarse:A.length*B.length>200000||A.length>=1000||B.length>=1000};
  }
  function compare(before,after){const old=new Map((before?.files||[]).map(f=>[f.path,f.code])),now=new Map((after?.files||[]).map(f=>[f.path,f.code]));const files=[];
    for(const path of new Set([...old.keys(),...now.keys()])){if(old.get(path)===now.get(path))continue;files.push({path,...lineDiff(old.get(path)||'',now.get(path)||''),type:!old.has(path)?'added':!now.has(path)?'removed':'changed'});}
    return files;
  }
  function activate(chat,ref,artifact,{allowUnverified=false}={}){
    const version=list(chat,artifact).find(v=>same(v,ref));if(!version)throw new Error('Version unavailable');
    if(version.validation&&version.validation.status!=='passed'&&!allowUnverified)throw new Error('This version has not been verified to work');
    chat.artifactRef={mid:version.mid,k:version.k,...(allowUnverified?{acceptedUnverified:true}:{})};return version;
  }
  return {list,same,previous,lineDiff,compare,activate};
});
