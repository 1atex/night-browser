import test from 'node:test';
import assert from 'node:assert/strict';
import {validAvatar,friendAvatarURL} from '../../src/night/AvatarModel.mjs';
import {profileMetadata} from '../../src/night/ProfileModel.mjs';
import {createService} from '../../services/together/server.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('avatars allow only bounded raster PNG data and keep profile metadata isolated',()=>{
 assert.ok(validAvatar(png));for(const value of ['data:image/svg+xml,<svg/>','https://example.test/picture.png',png+'a'.repeat(17000),null])assert.equal(validAvatar(value),false);
 const oversized=Buffer.from(png.slice(22),'base64');oversized.writeUInt32BE(8192,16);assert.equal(validAvatar('data:image/png;base64,'+oversized.toString('base64')),false);
 assert.equal(profileMetadata({name:'Фото',avatar:png},'default').avatar,png);assert.equal(profileMetadata({name:'Фото',avatar:'javascript:alert(1)'},'default').avatar,undefined);
 assert.equal(friendAvatarURL('https://example.test','//other.test/avatar.png'),null);
});
test('authenticated avatar uploads expose small image URLs instead of image data in room state',async()=>{
 const service=await createService();await new Promise(r=>service.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+service.address().port;
 try{const user=await fetch(base+'/v1/register',{method:'POST',body:'{}'}).then(r=>r.json()),headers={Authorization:`Bearer ${user.id}:${user.token}`};
 const upload=avatar=>fetch(base+'/v1/action',{method:'POST',headers,body:JSON.stringify({type:'profile-avatar',avatar})});
 assert.equal((await upload('data:image/svg+xml,<svg/>')).status,400);const state=await upload(png).then(r=>r.json());assert.match(state.self.avatar,/^\/avatars\/[a-f0-9]{16}\/[a-f0-9]{64}\.png$/);assert.equal(JSON.stringify(state).includes('base64'),false);
 const image=await fetch(base+state.self.avatar);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),Buffer.from(png.slice(22),'base64'));
 assert.equal((await fetch(base+'/v1/action',{method:'POST',body:JSON.stringify({type:'profile-avatar',avatar:png})})).status,401);
 await upload(null);assert.equal((await fetch(base+state.self.avatar)).status,404);
 }finally{await new Promise(r=>service.close(r));}
});
