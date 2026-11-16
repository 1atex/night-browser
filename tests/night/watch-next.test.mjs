import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackCorrection,rememberVideo} from '../../src/night/WatchModel.mjs';
import {createNoticeIdentity,encryptNotice,decryptNotice,noticeFingerprint} from '../../src/night/NoticeCrypto.mjs';
const sample={position:10,paused:false,rate:1};
test('drift converges smoothly within five percent and restores nominal speed',()=>{
 assert.equal(playbackCorrection(sample,{...sample,position:12}).rate,1.05);
 assert.equal(playbackCorrection(sample,{...sample,position:8}).rate,.95);
 assert.equal(playbackCorrection(sample,{...sample,position:10.05}).rate,1);
 assert.equal(playbackCorrection(sample,{...sample,position:12,rate:2}).rate,2.1);
 assert.equal(playbackCorrection(sample,{...sample,position:10.5}).seek,false);
 assert.equal(playbackCorrection(sample,{...sample,position:10.5,forceSeek:true}).seek,true);
 assert.equal(playbackCorrection(sample,{...sample,position:20}).seek,true);
 assert.equal(playbackCorrection(sample,{...sample,position:10.4,paused:true}).seek,true);
});
test('watch history is bounded and canonicalizes the same video without keeping duplicates',()=>{
 let records=[];for(let i=0;i<70;i++)records=rememberVideo(records,{url:`https://example.test/${i}`,position:i,at:i});assert.equal(records.length,50);
 records=rememberVideo(records,{url:'https://youtu.be/video',position:20});records=rememberVideo(records,{url:'https://youtube.com/watch?v=video&t=2',position:30});assert.equal(records.filter(r=>r.url.includes('video')).length,1);assert.equal(records[0].position,30);
 assert.equal(rememberVideo(records,{url:'file:///secret',position:0}).length,50);
});
test('notifications authenticate identities and metadata and cannot be decrypted by another friend',async()=>{
 const a=await createNoticeIdentity(),b=await createNoticeIdentity(),c=await createNoticeIdentity(),from='a'.repeat(16),to='b'.repeat(16);
 const encrypted=await encryptNotice(a.privateKey,b.publicKey,{from,to,text:'Присоединяйся!'});
 assert.equal(JSON.stringify(encrypted).includes('Присоединяйся'),false);
 assert.equal(await decryptNotice(b.privateKey,a.publicKey,encrypted,to),'Присоединяйся!');
 await assert.rejects(()=>decryptNotice(c.privateKey,a.publicKey,encrypted,to));
 for(const change of [{from:'c'.repeat(16)},{id:'0'.repeat(32)},{at:encrypted.at+1},{to:'c'.repeat(16)},{ciphertext:encrypted.ciphertext.slice(0,-3)+'abc'}])await assert.rejects(()=>decryptNotice(b.privateKey,a.publicKey,{...encrypted,...change},to));
 assert.notEqual((await encryptNotice(a.privateKey,b.publicKey,{from,to,text:'Присоединяйся!'})).nonce,encrypted.nonce);
 assert.match(await noticeFingerprint(a.publicKey),/^[a-f0-9]{64}$/);
});
