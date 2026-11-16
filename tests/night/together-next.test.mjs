import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../../services/together/server.mjs';
import {createNoticeIdentity,encryptNotice,decryptNotice} from '../../src/night/NoticeCrypto.mjs';
async function fixture(now){
 const server=await createService({now});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(route,user,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:user?{Authorization:`Bearer ${user.id}:${user.token}`}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 return {request,act:(u,b)=>request('/v1/action',u,b),user:()=>request('/v1/register',null,{}).then(r=>r.body),close:()=>new Promise(resolve=>server.close(resolve))};
}
test('detected ads freeze the content timeline and release it without following the ad timeline',async()=>{
 let time=1000;const f=await fixture(()=>time);
 try{
  const a=await f.user(),b=await f.user(),c=await f.user();const room=(await f.act(a,{type:'room-create',url:'https://example.test/video'})).body.room;
  await f.act(a,{type:'friend-request',id:b.id});await f.act(b,{type:'friend-accept',id:a.id});await f.act(a,{type:'room-invite',room:room.id,id:b.id});await f.act(b,{type:'room-join',room:room.id});
  await f.act(a,{type:'room-control',room:room.id,revision:0,position:10,paused:false,rate:1,command:'play'});time=3000;
  assert.equal((await f.act(c,{type:'room-ready',room:room.id,ready:true,ad:true,blocker:'none'})).status,403);
  await f.act(a,{type:'room-ready',room:room.id,ready:true,ad:false,blocker:'enabled'});
  const held=(await f.act(b,{type:'room-ready',room:room.id,ready:true,ad:true,blocker:'none'})).body.room;
  assert.equal(held.readiness.hold.position,12);assert.equal(held.readiness.mismatch,true);
  const ignored=(await f.act(a,{type:'room-state',room:room.id,revision:held.revision,position:90,paused:false,rate:1})).body.room;assert.equal(ignored.position,10);
  time=6000;const resumed=(await f.act(b,{type:'room-ready',room:room.id,ready:true,ad:false,blocker:'none'})).body.room;
  assert.equal(resumed.readiness.hold,null);assert.equal(resumed.position,12);assert.equal(resumed.updatedAt,6000);
  await f.act(a,{type:'room-cast',room:room.id,active:true});
  const cast=(await f.act(b,{type:'room-ready',room:room.id,ready:true,ad:true,blocker:'none'})).body.room;assert.equal(cast.readiness.hold,null);
  assert.equal((await f.act(b,{type:'room-cast',room:room.id,active:true})).status,403);
  const signal={channel:'cast',kind:'description',session:'a'.repeat(32),description:{type:'offer',sdp:'v=0'}};
  assert.equal((await f.act(b,{type:'room-signal',room:room.id,id:a.id,signal})).status,403);
  assert.equal((await f.act(a,{type:'room-signal',room:room.id,id:b.id,signal})).status,200);
 }finally{await f.close();}
});
test('server relays only bounded encrypted notices between confirmed friends and removes acknowledged envelopes',async()=>{
 let time=1000;const f=await fixture(()=>time);
 try{
  const a=await f.user(),b=await f.user(),c=await f.user(),ka=await createNoticeIdentity(),kb=await createNoticeIdentity();
  await f.act(a,{type:'notice-key',publicKey:ka.publicKey});await f.act(b,{type:'notice-key',publicKey:kb.publicKey});
  const envelope=await encryptNotice(ka.privateKey,kb.publicKey,{from:a.id,to:b.id,text:'Пойдём смотреть',at:time});
  assert.equal((await f.act(a,{type:'notice-send',id:b.id,envelope})).status,403);
  await f.act(a,{type:'friend-request',id:b.id});await f.act(b,{type:'friend-accept',id:a.id});
  assert.equal((await f.act(a,{type:'notice-send',id:b.id,envelope})).status,200);
  assert.equal((await f.act(a,{type:'notice-send',id:b.id,envelope})).status,409);
  const received=(await f.request('/v1/state',b)).body;assert.equal(received.notices.length,1);assert.equal(JSON.stringify(received).includes('Пойдём смотреть'),false);
  assert.equal(await decryptNotice(kb.privateKey,received.people[a.id].noticeKey,received.notices[0],b.id),'Пойдём смотреть');
  assert.deepEqual((await f.request('/v1/state',c)).body.notices,[]);
  assert.equal((await f.act(c,{type:'notice-send',id:b.id,envelope})).status,403);
  await f.act(b,{type:'notice-ack',ids:[envelope.id]});assert.deepEqual((await f.request('/v1/state',b)).body.notices,[]);
  const next=await encryptNotice(ka.privateKey,kb.publicKey,{from:a.id,to:b.id,text:'Ещё сообщение',at:time});await f.act(a,{type:'notice-send',id:b.id,envelope:next});time+=86400001;
  assert.deepEqual((await f.request('/v1/state',b)).body.notices,[]);
 }finally{await f.close();}
});
