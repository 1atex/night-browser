import test from 'node:test';
import assert from 'node:assert/strict';
import {MicrophoneSession} from '../../services/together/public/microphone.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const media=()=>{const track={readyState:'live',stop(){this.readyState='ended';}};return {track,getTracks:()=>[track]};};
test('leaving before microphone permission resolves stops the late stream',async()=>{
 const capture=new MicrophoneSession(),request=deferred(),stream=media(),result=capture.start(()=>request.promise);
 capture.stop();request.resolve(stream);assert.equal(await result,null);assert.equal(stream.track.readyState,'ended');assert.equal(capture.stream,null);
});
test('double activation does not acquire a second microphone',async()=>{
 const capture=new MicrophoneSession(),request=deferred(),stream=media();let acquisitions=0;
 const acquire=()=>{acquisitions++;return request.promise;},result=capture.start(acquire);
 assert.equal(await capture.start(acquire),null);assert.equal(acquisitions,1);request.resolve(stream);assert.equal(await result,stream);capture.stop();assert.equal(stream.track.readyState,'ended');
});
test('an old permission result cannot replace or stop a newly acquired stream',async()=>{
 const capture=new MicrophoneSession(),old=deferred(),first=media(),second=media(),pending=capture.start(()=>old.promise);
 capture.stop();assert.equal(await capture.start(async()=>second),second);old.resolve(first);
 assert.equal(await pending,null);assert.equal(first.track.readyState,'ended');assert.equal(capture.stream,second);assert.equal(second.track.readyState,'live');capture.stop();assert.equal(second.track.readyState,'ended');
});
