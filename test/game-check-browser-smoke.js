'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function html({draw=true,hook=true,move=true,autonomous=false}={}){return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0}canvas{width:100%;height:200px}</style></head><body><canvas width="200" height="200"></canvas><script>
const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl');if(!gl)throw new Error('No WebGL context');
function shader(type,code){const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);return s;}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 pos;void main(){gl_Position=vec4(pos,0.,1.);}'));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;void main(){gl_FragColor=vec4(0.,1.,0.,1.);}'));gl.linkProgram(program);gl.useProgram(program);
const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,0,1]),gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
const camera={position:{x:0,y:0,z:0}},scene={traverse(fn){fn({isMesh:true,visible:true,geometry:{attributes:{position:{count:3}}}})}},renderer={domElement:canvas};const keys=new Set();addEventListener('keydown',e=>keys.add(e.key));addEventListener('keyup',e=>keys.delete(e.key));
${hook?'window.__PREMIER_GAME__={scene,camera,renderer,modelRoots:[]};':''}
function tick(){${move?"if(keys.has('w'))camera.position.z-=0.1;if(keys.has('s'))camera.position.z+=0.1;if(keys.has('a'))camera.position.x-=0.1;if(keys.has('d'))camera.position.x+=0.1;":''}${autonomous?'camera.position.z-=0.01;':''}${draw?'gl.drawArrays(gl.TRIANGLES,0,3);':''}requestAnimationFrame(tick);}tick();</script></body></html>`;}
test('real Chromium: native WebGL draws and WASD, no false pass for static canvas or automatic motion',{timeout:60000},async(t)=>{
 const browser=require('../browser'),check=require('../game-check');t.after(()=>browser.close());
 const ok=await browser.checkHtml(html(),false,{game:true});assert.equal(ok.game.render.status,'passed',JSON.stringify(ok));assert.equal(ok.game.controls.status,'passed',JSON.stringify(ok));assert.equal(check.report(ok,{game:true}).status,'passed');
 const staticCanvas=await browser.checkHtml(html({draw:false}),false,{game:true});assert.equal(staticCanvas.game.render.status,'failed');assert.equal(check.report(staticCanvas,{game:true}).status,'failed');
 const noHook=await browser.checkHtml(html({hook:false}),false,{game:true});assert.equal(noHook.game.controls.status,'unverified');assert.equal(check.report(noHook,{game:true}).status,'unverified');
 const auto=await browser.checkHtml(html({autonomous:true}),false,{game:true});assert.equal(auto.game.controls.status,'unverified');
 // A tiny valid GLB is downloaded and its vertex buffer actually drives WebGL draws.
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}]};
 const text=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),vertices=Buffer.alloc(36);[-1,-1,0,1,-1,0,0,1,0].forEach((x,i)=>vertices.writeFloatLE(x,i*4));
 const data=Buffer.alloc(28+json.length+vertices.length);data.writeUInt32LE(0x46546c67,0);data.writeUInt32LE(2,4);data.writeUInt32LE(data.length,8);data.writeUInt32LE(json.length,12);data.writeUInt32LE(0x4e4f534a,16);json.copy(data,20);const offset=20+json.length;data.writeUInt32LE(vertices.length,offset);data.writeUInt32LE(0x004e4942,offset+4);vertices.copy(data,offset+8);
 require('../asset-download').validateGLB(data);
 const url='https://premier-assets.invalid/a/'+'d'.repeat(32)+'/model.glb';
 const loader=`fetch('${url}').then(r=>r.arrayBuffer()).then(b=>{const view=new DataView(b),len=view.getUint32(12,true),start=28+len;const positions=new Float32Array(b,start,9);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,positions,gl.STATIC_DRAW);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,12,0);const root={parent:scene,traverse(fn){fn({isMesh:true,visible:true,geometry:{attributes:{position:{count:3}}}})}};window.__PREMIER_GAME__.modelRoots.push(root);}).catch(e=>console.error(e.message));`;
 const loaded=await browser.checkHtml(html().replace('function tick(){',loader+'function tick(){'),false,{game:true,expectedModels:1,assetResolver:u=>u===url?{contentType:'model/gltf-binary',body:data,headers:{'access-control-allow-origin':'*'}}:null});
 assert.equal(loaded.game.models.status,'passed',JSON.stringify(loaded));assert.equal(check.report(loaded,{game:true}).status,'passed');

 const unloaded=await browser.checkHtml(html(),false,{game:true,expectedModels:1});assert.equal(unloaded.game.models.status,'failed');
});
