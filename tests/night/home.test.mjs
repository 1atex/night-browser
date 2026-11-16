import test from "node:test";
import assert from "node:assert/strict";
import {homeWidgets, DEFAULT_HOME_WIDGETS, homeLinks, homeGradient} from "../../src/night/HomeModel.mjs";

test("home layout accepts only known widgets and preserves an intentionally empty page", () => {
  assert.deepEqual(homeWidgets(null), DEFAULT_HOME_WIDGETS);
  assert.deepEqual(homeWidgets([]), []);
  assert.deepEqual(homeWidgets(["tabs", "clock", "tabs", "<script>", null]), ["tabs", "clock"]);
});


test("personal shortcuts reject active URLs, credentials and duplicates and stay bounded", () => {
  assert.deepEqual(homeLinks(null), []);
  assert.deepEqual(homeLinks([{name:"  Docs  ",url:"https://example.com"},{name:"Duplicate",url:"https://example.com/"},{name:"Bad",url:"javascript:alert(1)"},{name:"Bad",url:"https://user:pass@example.com"}]), [{name:"Docs",url:"https://example.com/"}]);
  assert.equal(homeLinks(Array.from({length:20},(_,i)=>({name:`Link ${i}`,url:`https://example.com/${i}`}))).length,12);
});

test("home gradients accept only bounded static colors and known presets", () => {
  assert.equal(homeGradient(null).preset,"none");
  assert.deepEqual(homeGradient({preset:"custom",first:"#AABBCC",second:"url(https://example.com)",intensity:100}),{preset:"custom",first:"#aabbcc",second:"#282035",intensity:35});
  assert.equal(homeGradient({preset:"__proto__"}).preset,"none");
  assert.equal(homeGradient({preset:"dusk",first:"#ffffff",intensity:-2}).first,"#5264ba");
  assert.equal(homeGradient({preset:"dusk",intensity:-2}).intensity,0);
});
