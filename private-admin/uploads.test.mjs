import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upload } from './uploads.mjs';
import dashboard from './dashboard.mjs';
import vm from 'node:vm';

function fixture(game, origin='https://admin.example') {
  const writes=[];
  const request=new Request('https://admin.example/upload'+(game===undefined?'':'?game='+encodeURIComponent(game)),
    {method:'PUT',headers:{Origin:origin,'Content-Length':'64'},body:new Uint8Array(64)});
  const env={DLL_BUCKET:{put:async(key,body)=>writes.push({key,bytes:new Uint8Array(await new Response(body).arrayBuffer())})}};
  return {request,env,writes};
}
test('Fallout upload goes to its own object instead of replacing CS2',async()=>{
  const f=fixture('fallout76');const response=await upload(f.request,f.env);
  assert.equal(response.status,200);assert.deepEqual(f.writes.map(x=>x.key),['Fallout76ESP.dll']);assert.equal(f.writes[0].bytes.length,64);
});
test('legacy and explicit CS2 uploads retain their original object',async()=>{
  for(const game of [undefined,'cs2']){const f=fixture(game);assert.equal((await upload(f.request,f.env)).status,200);assert.equal(f.writes[0].key,'ZestHub.dll');}
});
test('unknown games and cross-origin uploads never write storage',async()=>{
  for(const game of ['', '../ZestHub.dll','constructor','__proto__','unknown']){
    const f=fixture(game);assert.equal((await upload(f.request,f.env)).status,400);assert.equal(f.writes.length,0);
  }
  const f=fixture('fallout76','https://elsewhere.example');assert.equal((await upload(f.request,f.env)).status,403);assert.equal(f.writes.length,0);
});
test('dashboard exposes both upload targets and sends the selected ID',()=>{
  assert.match(dashboard,/id="dll-game"/);assert.match(dashboard,/value="cs2"/);assert.match(dashboard,/value="fallout76"/);
  assert.match(dashboard,/\/upload\?game=/);
});
test('dashboard upload handler sends Fallout selection and restores controls',async()=>{
  const script=dashboard.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script); // Check the entire rendered browser script parses.
  const button={disabled:false};const select={value:'fallout76',selectedIndex:1,options:[{text:'Counter-Strike 2'},{text:'Fallout 76'}],disabled:false};
  const nodes={file:{files:[new Blob([new Uint8Array(64)])]},'dll-game':select,status:{textContent:''},upload:{}};
  const requests=[];
  const context=vm.createContext({$:id=>nodes[id],encodeURIComponent,fetch:async(url,options)=>{requests.push({url,options});return {ok:true};}});
  vm.runInContext(script.split('\n').find(line=>line.startsWith("$('upload').onsubmit=")),context);
  await nodes.upload.onsubmit({preventDefault(){},currentTarget:{querySelector:()=>button}});
  assert.equal(requests[0].url,'/upload?game=fallout76');assert.equal(requests[0].options.method,'PUT');
  assert.equal(nodes.status.textContent,'Fallout 76 DLL uploaded.');assert.equal(select.disabled,false);assert.equal(button.disabled,false);
});
