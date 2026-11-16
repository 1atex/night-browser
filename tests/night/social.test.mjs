import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../../services/together/server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('invite approval, shared controls, bounded authenticated signaling and persisted links',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'night-social-'));let server,time=1000;
 try{
  server=await createService({path:join(dir,'state.json'),now:()=>time,iceServers:[]});await new Promise(r=>server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${server.address().port}`;
  const req=async(path,user,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:user?{Authorization:`Bearer ${user.id}:${user.token}`}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const act=(u,body)=>req('/v1/action',u,body),a=(await req('/v1/register',null,{})).body,b=(await req('/v1/register',null,{})).body,c=(await req('/v1/register',null,{})).body;
  const room=(await act(a,{type:'room-create',url:'https://example.test/movie'})).body.room;
  const link=(await act(a,{type:'room-link',room:room.id})).body.room.link,invite=link.split('/').at(-1);assert.match(invite,/^[a-f0-9]{64}$/);
  assert.equal((await act(b,{type:'room-request',invite})).body.room,null);
  assert.equal((await act(c,{type:'room-admit',room:room.id,id:b.id})).status,403);
  const owner=(await req('/v1/state',a)).body;assert.equal(owner.room.requests[0].id,b.id);
  assert.equal((await act(a,{type:'room-admit',room:room.id,id:b.id})).status,200);
  const guest=(await req('/v1/state',b)).body;assert.equal(guest.room.id,room.id);assert.equal(guest.room.link,null);assert.equal(JSON.stringify(guest).includes(invite),false);
  assert.equal((await act(b,{type:'room-control',room:room.id,position:6,paused:true,rate:1,revision:0})).status,200);
  assert.equal((await act(a,{type:'room-state',room:room.id,position:9,paused:false,revision:0})).status,409);
  assert.equal((await req('/v1/state',a)).body.room.paused,true);
  assert.equal((await act(c,{type:'room-control',room:room.id,position:0,paused:true,revision:1})).status,403);
  assert.equal((await act(b,{type:'room-source',room:room.id,url:'https://example.test/other'})).status,403);
  const signal={kind:'description',session:'a'.repeat(32),description:{type:'offer',sdp:'v=0'}};
  assert.equal((await act(c,{type:'room-signal',room:room.id,id:a.id,signal})).status,403);
  assert.equal((await act(b,{type:'room-signal',room:room.id,id:a.id,signal})).status,200);
  const batch=(await req('/v1/signals?after=0',a)).body;assert.equal(batch.items.length,1);assert.equal(batch.items[0].from,b.id);
  assert.equal((await req('/v1/signals?after='+batch.cursor,a)).body.items.length,0);
  assert.equal((await req('/v1/signals?after=0',c)).status,403);
  assert.equal((await act(a,{type:'room-signal',room:room.id,id:b.id,signal:{...signal,description:{type:'offer',sdp:'a'.repeat(66000)}}})).status,400);
  assert.equal((await act(b,{type:'room-kick',room:room.id,id:a.id})).status,403);
  time+=86400001;assert.equal((await act(c,{type:'room-request',invite})).status,404);
  assert.equal((await req('/v1/signals?after=0',a)).body.items.length,0);
  await new Promise(r=>server.close(r));server=await createService({path:join(dir,'state.json'),now:()=>time});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await req('/v1/state',b)).body.room.id,room.id);
  const next=(await act(a,{type:'room-link',room:room.id,rotate:true})).body.room.link;assert.notEqual(next,link);
  assert.equal((await act(a,{type:'room-kick',room:room.id,id:b.id})).status,200);assert.equal((await req('/v1/state',b)).body.room,null);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
test('public landing, invitation privacy, real GitHub counters and cache',async()=>{
 let calls=0;const tag='v0.14.0-preview.1',name='night-browser-0.14.0-preview-windows-x64-setup.exe';
 const server=await createService({releases:async()=>{calls++;return[{tag_name:tag,assets:[{name,download_count:42,browser_download_url:`https://github.com/1atex/night-browser/releases/download/${tag}/${name}`},{name:'night-together-server-0.14.0.zip',download_count:9999,browser_download_url:'https://evil.test'}]}];}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/Night Browser/);
 const invite=await fetch(base+'/join/'+'a'.repeat(64));assert.equal(invite.headers.get('cache-control'),'no-store, no-transform');assert.doesNotMatch(await invite.text(),/token|Bearer/);
 const info=await fetch(base+'/api/releases').then(r=>r.json());assert.equal(info.downloads,42);
 assert.equal((await fetch(base+'/download',{redirect:'manual'})).headers.get('location'),info.installer);assert.equal(calls,1);
 assert.equal((await fetch(base+'/../server.mjs')).status,401);
 }finally{await new Promise(r=>server.close(r));}
});
test('temporary TURN credentials are available only after room admission',async()=>{
 const server=await createService({now:()=>1000000,turnSecret:'fixture-secret',turnURL:'turn:relay.example:3478?transport=udp',iceServers:[]});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const user=await fetch(base+'/v1/register',{method:'POST',body:'{}'}).then(r=>r.json()),headers={Authorization:`Bearer ${user.id}:${user.token}`};
  assert.equal((await fetch(base+'/v1/rtc',{headers})).status,403);
  await fetch(base+'/v1/action',{method:'POST',headers,body:JSON.stringify({type:'room-create',url:'https://example.test/video'})});
  const rtc=await fetch(base+'/v1/rtc',{headers}).then(r=>r.json());assert.equal(rtc.iceServers[0].username,`4600:${user.id}`);assert.equal(rtc.iceServers[0].credential.length,28);assert.equal(JSON.stringify(rtc).includes('fixture-secret'),false);
  assert.equal((await fetch(base+'/v1/rtc')).status,401);
 }finally{await new Promise(r=>server.close(r));}
});
test('GitHub outage keeps a usable download path and does not invent counters',async()=>{
 const server=await createService({releases:async()=>{throw Error('Fixture API outage');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const info=await fetch(base+'/api/releases');assert.equal(info.status,503);assert.equal((await info.json()).downloads,undefined);const link=await fetch(base+'/download',{redirect:'manual'});assert.equal(link.status,302);assert.equal(link.headers.get('location'),'https://github.com/1atex/night-browser/releases');}
 finally{await new Promise(r=>server.close(r));}
});
test('room and invitation assets resist intermediary rewriting without weakening CSP',async()=>{
 const server=await createService();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const path of ['/','/room','/join/'+'a'.repeat(64)]){
  const response=await fetch(base+path),html=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-transform/);
  assert.equal(response.headers.get('content-security-policy').includes('unsafe-inline'),false);
  const scripts=[...html.matchAll(/<script[^>]+>/g)].map(m=>m[0]);assert.ok(scripts.length);assert.ok(scripts.every(s=>s.includes('data-cfasync="false"')&&s.indexOf('data-cfasync')<s.indexOf('src=')));
  assert.ok(scripts.every(s=>s.includes('?v=0.15.1')));
  if(path!=='/')assert.match(response.headers.get('cache-control'),/no-store/);
 }}finally{await new Promise(r=>server.close(r));}
});
