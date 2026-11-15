import test from 'node:test';
import assert from 'node:assert/strict';
import {watchURL,mediaSample,roomTarget} from '../../src/night/WatchModel.mjs';
test('watch binding accepts only web sources and identifies the same YouTube video after redirects',()=>{
 assert.equal(watchURL('javascript:alert(1)'),null);assert.equal(watchURL('https://user:secret@example.test/'),null);
 assert.equal(watchURL('https://youtu.be/abc'),watchURL('https://www.youtube.com/watch?v=abc&t=30'));
 assert.notEqual(watchURL('https://youtube.com/watch?v=abc'),watchURL('https://youtube.com/watch?v=def'));
 assert.equal(watchURL('https://example.test/a#t=5'),'https://example.test/a');
});
test('playback projection accounts for server elapsed time, rate, pause and buffering',()=>{
 const room={position:10,paused:false,rate:1.5,updatedAt:1000};
 assert.equal(roomTarget(room,3000,100).position,13.15);
 assert.equal(roomTarget({...room,paused:true},3000).position,10);
 assert.equal(roomTarget({...room,buffering:true},3000).position,10);
 assert.equal(mediaSample({...room,rate:100}),null);assert.equal(mediaSample({...room,position:NaN}),null);
 assert.equal(roomTarget(room,900).position,10);
});
