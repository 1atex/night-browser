import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

test("new-tab clock sleeps in the background and resumes at the correct minute", () => {
  let now = new Date("2026-11-14T12:34:45Z").getTime(), sequence = 0;
  const timers = new Map(), events = new Map(), nodes = {clock: {}, date: {}};
  const document = {hidden: false, getElementById: id => nodes[id], addEventListener: (type, fn) => events.set(type, fn)};
  class Clock extends Date { constructor() { super(now); } }
  vm.runInNewContext(readFileSync(new URL("../../src/night/start.js", import.meta.url), "utf8"), {
    document, window: {addEventListener: (type, fn) => events.set(type, fn)}, Date: Clock, Intl,
    setTimeout: (fn, delay) => { timers.set(++sequence, {fn, delay}); return sequence; },
    clearTimeout: id => timers.delete(id),
  });
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 15000);
  const before = nodes.clock.textContent;
  document.hidden = true;
  events.get("visibilitychange")();
  assert.equal(timers.size, 0);
  now += 180000;
  assert.equal(nodes.clock.textContent, before);
  document.hidden = false;
  events.get("visibilitychange")();
  assert.notEqual(nodes.clock.textContent, before);
  assert.equal(timers.size, 1);
  events.get("pagehide")();
  assert.equal(timers.size, 0);
  events.get("pageshow")();
  assert.equal(timers.size, 1);
});
