import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../../services/together/server.mjs';
import {watchIntent, roomTarget} from '../../src/night/WatchModel.mjs';
import {timelinePosition} from '../../services/together/timeline.mjs';

test('seeking survives a subsequent play/rate event without turning the jump into an old position report',()=>{
 const sample={position:90,paused:false,rate:1},extra={baseControlRevision:2,sourceRevision:1,commandId:'a'.repeat(32),seekSerial:4};
 const seek=watchIntent(null,sample,{...extra,event:'seeked'});
 const next=watchIntent(seek,{...sample,position:90.1},{...extra,event:'play',commandId:'b'.repeat(32)});
 assert.equal(next.seek,true);assert.equal(next.seekSerial,4);assert.equal(next.commandId,seek.commandId);assert.equal(next.baseControlRevision,2);
});

test('the server clock progresses without trusting the owner playback sample and clamps to content duration',()=>{
 const room={position:10,paused:false,rate:1,updatedAt:1000,duration:100};
 assert.equal(timelinePosition(room,91000),100);assert.equal(timelinePosition({...room,paused:true},91000),10);
 assert.equal(roomTarget({...room,controlRevision:4,sourceRevision:2},2000).controlRevision,4);
});

test('a shared skip is committed once, old samples cannot roll it back, and stale commands cannot replay after a source change',async()=>{
 let time=1000;const server=await createService({now:()=>time});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,user,body)=>{const response=await fetch(endpoint+path,{method:body?'POST':'GET',headers:user?{Authorization:`Bearer ${user.id}:${user.token}`}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,...await response.json()};};
 const act=(user,body)=>call('/v1/action',user,body);
 try{
  const a=await call('/v1/register',null,{}),b=await call('/v1/register',null,{});
  const room=(await act(a,{type:'room-create',url:'https://example.test/episode',authority:'server'})).room;
  await act(a,{type:'friend-request',id:b.id});await act(b,{type:'friend-accept',id:a.id});await act(a,{type:'room-invite',room:room.id,id:b.id});await act(b,{type:'room-join',room:room.id});
  const control=(id,base,position,command='seek',sourceRevision=0)=>({type:'room-control',room:room.id,commandId:id.repeat(32),sourceRevision,baseControlRevision:base,position,paused:false,rate:1,command});
  assert.equal((await act(a,control('a',0,0,'play'))).status,200);time=3000;
  const report=await act(a,{type:'room-state',room:room.id,revision:1,position:0,paused:true,rate:1});assert.equal(report.room.position,2);assert.equal(report.room.paused,false);
  const skip=control('b',1,90);const skipped=await act(b,skip);assert.equal(skipped.room.position,90);const rev=skipped.room.revision;
  time=5000;const stale=await act(a,{type:'room-state',room:room.id,revision:rev,position:2,paused:false,rate:1});assert.equal(stale.room.position,92);
  const duplicate=await act(b,skip);assert.equal(duplicate.room.position,92);assert.equal(duplicate.room.revision,rev);
  assert.equal((await act(a,control('c',1,2))).status,409);
  const changed=await act(a,{type:'room-source',room:room.id,url:'https://example.test/episode-2'});assert.equal(changed.room.sourceRevision,1);assert.equal(changed.room.duration,null);
  assert.equal((await act(b,control('d',changed.room.controlRevision,90,'seek',0))).status,409);
  const ad=await act(b,{type:'room-ready',room:room.id,ready:true,ad:true,blocker:'none'});assert.ok(ad.room.readiness.hold);
  assert.equal((await act(a,control('e',ad.room.controlRevision,90,'seek',1))).status,409);
  time+=3000;const ready=await act(b,{type:'room-ready',room:room.id,ready:true,ad:false,blocker:'none'});assert.equal(ready.room.position,0);assert.equal(ready.room.readiness.hold,null);
 }finally{await new Promise(resolve=>server.close(resolve));}
});


test('starting a room from a playing video preserves its position; casting does not reset the server clock',async()=>{
 let time=1000;const server=await createService({now:()=>time});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,user,body)=>{const response=await fetch(base+path,{method:'POST',headers:user?{Authorization:`Bearer ${user.id}:${user.token}`}:{},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 try{const user=await call('/v1/register',null,{});const state=await call('/v1/action',user,{type:'room-create',url:'https://example.test/watch',authority:'server',position:42,paused:false,rate:1,duration:1500});assert.equal(state.room.position,42);time+=5000;const cast=await call('/v1/action',user,{type:'room-cast',room:state.room.id,active:true});assert.equal(cast.room.position,47);assert.equal(cast.room.paused,false);}finally{await new Promise(resolve=>server.close(resolve));}
});
