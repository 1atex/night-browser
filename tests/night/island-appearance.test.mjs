import test from "node:test";
import assert from "node:assert/strict";
import {validAppearance, appearanceStyles, applyIslandAppearance} from "../../src/night/IslandAppearance.mjs";

const appearance = {v:1,type:"appearance",panel:[12,20,30],accent:[160,180,255],motion:false};

test("shared appearance accepts only bounded numeric colors and a motion flag", () => {
  assert.equal(validAppearance(appearance), true);
  for (const change of [{v:2},{panel:[0,0]},{panel:[0,0,256]},{accent:[0,0,"red"]},{accent:[0,NaN,0]},{motion:1}]) {
    assert.equal(appearanceStyles({...appearance,...change}), null);
  }
  assert.equal(appearanceStyles(appearance)["color-scheme"], "dark");
  assert.equal(appearanceStyles({...appearance,panel:[240,240,240]})["color-scheme"], "light");
  assert.equal(appearanceStyles({...appearance,accent:[20,20,20]})["--night-on-accent"], "#ffffff");
  assert.equal(appearanceStyles({...appearance,accent:[240,240,240]})["--night-on-accent"], "#000000");
});

test("unchanged appearance does not rewrite styles; disabling restores the browser palette", () => {
  const styles = new Map(), attrs = new Map();
  let mutations = 0;
  const root = {
    style: {
      getPropertyValue: key => styles.get(key) ?? "",
      setProperty: (key,value) => {styles.set(key,value);mutations++;},
      removeProperty: key => {styles.delete(key);mutations++;},
    },
    getAttribute: key => attrs.get(key) ?? null,
    setAttribute: (key,value) => {attrs.set(key,value);mutations++;},
    removeAttribute: key => {if(attrs.delete(key))mutations++;},
  };
  applyIslandAppearance(root, appearance);
  assert.equal(attrs.get("data-island-motion"), "false");
  const before = mutations;
  applyIslandAppearance(root, {...appearance});
  assert.equal(mutations, before);
  applyIslandAppearance(root, null);
  assert.equal(styles.size, 0);
  assert.equal(attrs.size, 0);
});
