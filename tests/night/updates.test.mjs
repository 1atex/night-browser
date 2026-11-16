import test from 'node:test';
import assert from 'node:assert/strict';
import {newerVersion,releaseUpdate,checksumFor} from '../../src/night/UpdateModel.mjs';
const release=(version,number=1)=>{const tag=`v${version}-preview.${number}`,prefix=`https://github.com/1atex/night-browser/releases/download/${tag}/`;return {tag_name:tag,assets:[{name:`night-browser-${version}-preview-windows-x64-setup.exe`,browser_download_url:prefix+`night-browser-${version}-preview-windows-x64-setup.exe`},{name:'SHA256SUMS.txt',browser_download_url:prefix+'SHA256SUMS.txt'}]};};
test('updater refuses older, malformed and foreign release assets',()=>{
 assert.equal(newerVersion('0.13.0','0.12.0'),true);assert.equal(newerVersion('0.9.0','0.12.0'),false);
 assert.equal(releaseUpdate([release('0.12.0')],'0.13.0'),null);
 const foreign=release('0.14.0');foreign.assets[0].browser_download_url='https://example.test/setup.exe';
 assert.equal(releaseUpdate([foreign],'0.13.0'),null);
 assert.equal(releaseUpdate([release('0.14.0')],'0.13.0').version,'0.14.0');
 assert.equal(releaseUpdate([release('0.13.0',2)],'0.13.0').tag,'v0.13.0-preview.2');
 assert.equal(releaseUpdate([release('0.13.0',3)],'0.13.0',3),null);
 assert.equal(checksumFor('a'.repeat(64)+'  setup.exe','setup.exe'),'a'.repeat(64));
 assert.throws(()=>checksumFor('a'.repeat(64)+'  other.exe','setup.exe'));
});
