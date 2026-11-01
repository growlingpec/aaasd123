'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),state=require('../public/js/00-artifact-state'),versions=require('../public/js/00-artifact-versions'),check=require('../game-check');
const src=n=>'```html\n<!doctype html><html><body>Game source '+n+'</body></html>\n```';
const msg=(id,n,validation)=>({id,r:'a',t:src(n),...(validation?{validation:{status:validation}}:{})});
test('versions list completed candidates, omit errors/partial replies and preserve source',()=>{
 const c={msgs:[msg('a',1),{...msg('bad',2),err:'error'},{...msg('live',3),live:true},{...msg('cancel',4),cancelled:true},msg('b',5,'failed')]};const list=versions.list(c,state);assert.deepEqual(list.map(x=>x.mid),['a','b']);assert.equal(list[0].source,src(1));
});
test('failed/unverified candidates never replace working basis automatically',()=>{
 const c={msgs:[msg('a',1,'passed'),msg('b',2,'failed'),msg('c',3,'unverified')],artifactRef:{mid:'b',k:0}};assert.equal(state.forChat(c).mid,'a');assert.throws(()=>versions.activate(c,{mid:'b',k:0},state),/не подтверждена/);
 assert.equal(state.resolve(null,[{role:'assistant',content:src(1),validation:{status:'passed'}},{role:'assistant',content:src(2),validation:{status:'failed'}}]).source,src(1));
 versions.activate(c,{mid:'b',k:0},state,{allowUnverified:true});assert.equal(state.forChat(c).mid,'b');assert.equal(c.msgs[1].validation.status,'failed');
});
test('rollback is non-destructive, follows the actual branch parent and survives serialization',()=>{
 const c={msgs:[msg('a',1),msg('b',2),{...msg('branch',3),artifactParent:{mid:'a',k:0}}],artifactRef:{mid:'branch',k:0}};const before=JSON.stringify(c.msgs),previous=versions.previous(c,c.artifactRef,state);assert.equal(previous.mid,'a');versions.activate(c,previous,state);assert.equal(JSON.stringify(c.msgs),before);assert.equal(state.forChat(JSON.parse(JSON.stringify(c))).source,src(1));
});
test('diff has exact additions/removals, multiple files, limits and safe plain text',()=>{
 const a={files:[{path:'index.html',code:'one\n<script>old</script>\nthree'},{path:'old.js',code:'old'}]},b={files:[{path:'index.html',code:'one\n<script>new</script>\nthree'},{path:'new.js',code:'new'}]};const diff=versions.compare(a,b);assert.equal(diff.length,3);assert.deepEqual(diff[0].rows,[{kind:'-',text:'<script>old</script>'},{kind:'+',text:'<script>new</script>'}]);assert.equal(diff[1].type,'removed');assert.equal(diff[2].type,'added');assert.equal(diff[2].removed,0);assert.deepEqual(versions.compare(a,a),[]);
 const large=versions.lineDiff('a\n'.repeat(2000),'b\n'.repeat(2000));assert.equal(large.rows.length,300);assert.ok(large.coarse&&large.truncated);
});
test('game report: unavailable is unverified, partial success never passes, failure overrides',()=>{
 assert.equal(check.report(null,{game:true}).status,'unverified');assert.equal(check.report({issues:[]},{game:true}).status,'unverified');
 const game={render:{status:'passed'},models:{status:'not_required'},controls:{status:'passed'}};assert.equal(check.report({issues:[],game},{game:true}).status,'passed');assert.equal(check.report({issues:['bad'],game},{game:true}).status,'failed');
 assert.equal(check.report({issues:[],game:{...game,controls:{status:'unverified'}}},{game:true}).status,'unverified');assert.equal(check.report({issues:[]}).status,'passed');
});
test('game instrumentation precedes app scripts; classification and original code preserved',()=>{
 const html='<!doctype html><html><head><script>app()</script></head><body></body></html>';const wrapped=check.instrument(html);assert.ok(wrapped.indexOf('__PREMIER_PROBE__')<wrapped.indexOf('app()'));assert.ok(wrapped.endsWith('<body></body></html>'));assert.equal(check.isGame(html,[{role:'user',content:'сделай сайт'}]),false);assert.equal(check.isGame(html,[{role:'user',content:'создай игру от первого лица'}]),true);
});
