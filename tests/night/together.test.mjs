import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../../services/together/server.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('friend consent, room authorization, stale command rejection and persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'night-together-'));let server;
 try {
  server=await createService({path:join(dir,'state.json')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let base=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,user,body)=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:user?{Authorization:`Bearer ${user.id}:${user.token}`}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
  const a=(await request('/v1/register',null,{})).body,b=(await request('/v1/register',null,{})).body,c=(await request('/v1/register',null,{})).body;
  const action=async(user,body)=>request('/v1/action',user,body);
  assert.equal((await request('/v1/state',{...a,token:'0'.repeat(64)})).status,401);
  await action(a,{type:'friend-request',id:b.id});
  assert.deepEqual((await request('/v1/state',b)).body.incoming,[a.id]);
  assert.deepEqual((await request('/v1/state',b)).body.friends,[]);
  await action(b,{type:'friend-accept',id:a.id});
  assert.deepEqual((await request('/v1/state',a)).body.friends.map(p=>p.id),[b.id]);
  assert.equal((await action(a,{type:'profile-update',name:'Noon',color:'jade',icon:'☾'})).status,200);
  assert.equal((await request('/v1/state',b)).body.friends[0].name,'Noon');
  assert.equal((await action(a,{type:'profile-update',name:'Bad\nname',color:'jade',icon:'☾'})).status,400);
  assert.equal((await action(a,{type:'room-create',url:'javascript:alert(1)'})).status,400);
  const room=(await action(a,{type:'room-create',url:'https://www.youtube.com/watch?v=fixture'})).body.room;
  assert.equal((await action(c,{type:'room-join',room:room.id})).status,403);
  await action(a,{type:'room-invite',room:room.id,id:b.id});await action(b,{type:'room-join',room:room.id});
  assert.equal((await action(b,{type:'room-state',room:room.id,position:5,paused:false,revision:0})).status,403);
  assert.equal((await action(a,{type:'room-state',room:room.id,position:5,paused:false,revision:0})).status,200);
  assert.equal((await action(a,{type:'room-state',room:room.id,position:7,paused:true,revision:0})).status,409);
  assert.equal((await request('/v1/state',b)).body.room.position,5);
  assert.equal((await action(b,{type:'room-source',room:room.id,url:'https://example.test/video'})).status,403);
  await new Promise(r=>server.close(r));server=await createService({path:join(dir,'state.json')});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await request('/v1/state',b)).body.room.position,5);
  await action(a,{type:'friend-remove',id:b.id});assert.equal((await request('/v1/state',b)).body.room,null);
 } finally {if(server?.listening)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('existing protocol-one identity and friendships survive profile migration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'night-old-profile-'));let server;
 const a='a'.repeat(16),b='b'.repeat(16),token='c'.repeat(64);
 try {
  await writeFile(join(dir,'state.json'),JSON.stringify({users:{[a]:{id:a,token,friends:[b],incoming:[],outgoing:[],invites:[]},[b]:{id:b,token:'d'.repeat(64),friends:[a],incoming:[],outgoing:[],invites:[]}},rooms:{}}));
  server=await createService({path:join(dir,'state.json')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`,headers={Authorization:`Bearer ${a}:${token}`};
  const before=await fetch(url+'/v1/state',{headers}).then(r=>r.json());assert.equal(before.protocol,2);assert.equal(before.friends[0].id,b);
  const after=await fetch(url+'/v1/action',{method:'POST',headers,body:JSON.stringify({type:'profile-update',name:'Noon',color:'sky',icon:'☾'})}).then(r=>r.json());
  assert.equal(after.self.id,a);assert.equal(after.self.name,'Noon');assert.equal(after.friends[0].id,b);assert.equal(JSON.stringify(after).includes(token),false);
 } finally {if(server?.listening)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
