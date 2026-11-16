import test from 'node:test';
import assert from 'node:assert/strict';
import {importBrowsers,browserImportSource} from '../../src/night/BrowserImportModel.mjs';
test('browser import separates full Gecko profile replacement from supported Chromium data merging',()=>{
 for(const key of ['zen','firefox','librewolf','floorp','waterfox'])assert.equal(browserImportSource(key).mode,'profile');
 for(const key of ['chrome','chromium-edge','brave','vivaldi','chromium','opera','opera-gx'])assert.equal(browserImportSource(key).mode,'native');
 assert.throws(()=>browserImportSource('../profile'));assert.equal(new Set(importBrowsers.map(item=>item[0])).size,importBrowsers.length);
});
