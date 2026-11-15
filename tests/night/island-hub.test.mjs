import test from "node:test";
import assert from "node:assert/strict";
import {pocketItem, webURL, findTabs, validHubCommand} from "../../src/night/IslandHub.mjs";

test("Pocket keeps only bounded explicit material and ordinary web sources", () => {
  const item = pocketItem({kind:"text",title:"Example\u0000 title",text:"я".repeat(5000),source:"https://example.com/path#part",url:""});
  assert.equal([...item.text].length, 4096);
  assert.equal(item.source, "https://example.com/path#part");
  assert.equal(item.title, "Example  title");
  for (const url of ["javascript:alert(1)","file:///secret","https://user:pass@example.com", "https://example.com/"+"x".repeat(2100)]) {
    assert.equal(webURL(url), ""); assert.equal(pocketItem({kind:"link",url}), null);
  }
  assert.equal(pocketItem({kind:"text",text:"   "}), null);
});

test("tab search matches title, URL and folder together without prioritizing unloaded pages", () => {
  const items = [{id:"a",title:"Censys",url:"https://search.censys.io",path:"Работа / Research",selected:false,accessed:2,sleeping:true},
    {id:"b",title:"Censys",url:"https://search.censys.io",path:"Личное",selected:true,accessed:1,sleeping:false}];
  assert.deepEqual(findTabs(items,"censys research").map(t=>t.id),["a"]);
  assert.deepEqual(findTabs(items,"CENSYS").map(t=>t.id),["b","a"]);
  assert.equal(items[0].sleeping,true);
});

test("hub commands cannot run arbitrary actions or open executable URLs", () => {
  const base={v:1,request:"hub-1",id:"{tab-1}"};
  assert.ok(validHubCommand({...base,type:"tab-query",query:"censys"}));
  assert.ok(validHubCommand({...base,type:"tab-query-end"}));
  assert.ok(validHubCommand({...base,type:"tab-action",action:"focus"}));
  assert.ok(validHubCommand({...base,type:"request-action",action:"forward"}));
  assert.ok(validHubCommand({...base,type:"open-link",url:"https://example.com"}));
  assert.equal(validHubCommand({...base,type:"open-link",url:"file:///a.exe"}),false);
  assert.equal(validHubCommand({...base,type:"tab-action",action:"execute"}),false);
  assert.equal(validHubCommand({...base,type:"request-action",action:"replay"}),false);
  assert.equal(validHubCommand({...base,type:"tab-query",query:"x".repeat(129)}),false);
});
