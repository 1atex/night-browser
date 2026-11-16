import test from 'node:test';
import assert from 'node:assert/strict';
import {communicationState,roomCommand,stateSignature} from '../../src/night/TogetherUIModel.mjs';
import {AudioLevels} from '../../services/together/public/audio-levels.mjs';
const a='a'.repeat(16),b='b'.repeat(16),c='c'.repeat(16);
const state={id:a,people:{[b]:{name:'Друг'}},room:{id:'room',members:[a,b]}};
test('room communication uses the admitted roster and bounded audio controls',()=>{
 const value=communicationState({active:true,microphone:true,peers:[{id:c,volume:.2},{id:b,volume:10,state:'unknown',name:'Spoof'}]},state);
 assert.equal(value.participants.length,1);assert.equal(value.participants[0].id,b);assert.equal(value.participants[0].name,'Друг');assert.equal(value.participants[0].volume,1);
 assert.equal(roomCommand({type:'volume',id:c,volume:.5},value),null);assert.equal(roomCommand({type:'volume',id:b,volume:Infinity},value),null);
 assert.deepEqual(roomCommand({type:'volume',id:b,volume:.3},value),{type:'volume',id:b,volume:.3});assert.equal(communicationState({active:false},state),null);
});
test('playback ticks do not invalidate the structural room UI',()=>{
 const before={...state,serverTime:10,room:{...state.room,revision:1,position:5}},after={...state,serverTime:20,room:{...state.room,revision:2,position:10}};
 assert.equal(stateSignature(before),stateSignature(after));assert.notEqual(stateSignature(before),stateSignature({...after,room:{...after.room,members:[a,b,c]}}));
});
test('participant levels persist locally and restore the previous level after mute',()=>{
 let saved=null;const storage={getItem:()=>saved,setItem:(_,value)=>{saved=value;}},levels=new AudioLevels(storage);
 assert.equal(levels.get(b),1);levels.set(b,.35);assert.equal(levels.toggle(b),0);assert.equal(new AudioLevels(storage).toggle(b),.35);
 assert.throws(()=>levels.set(b,2));assert.throws(()=>levels.set('../other',.5));
});
test('invalid audio storage and storage denial do not break room controls',()=>{
 const storage={getItem:()=>'{"bad":{"level":1,"previous":1}}',setItem:()=>{throw Error('blocked');}},levels=new AudioLevels(storage);
 assert.equal(levels.get(b),1);levels.set(b,.2);assert.equal(levels.get(b),.2);
 const broken=new AudioLevels({getItem:()=>'{'});assert.equal(broken.get(b),1);
});
