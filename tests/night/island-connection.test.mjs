import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source = readFileSync(new URL("../../src/night/NightIsland.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export const NightIsland =", "globalThis.NightIsland =");

function setup() {
  const notifications = [], timers = new Map();
  let sequence = 0;
  const context = vm.createContext({
    Services: {obs: {notifyObservers: (...args) => notifications.push(args)}},
    setTimeout: (fn, delay) => { timers.set(++sequence, {fn, delay}); return sequence; },
    clearTimeout: id => timers.delete(id),
    TextEncoder, MAX_FRAME: 32768,
  });
  vm.runInContext(source, context);
  const island = context.NightIsland;
  island.enabled = true;
  return {island, notifications, timers};
}

test("connection diagnostics update even when the connection status stays unavailable", () => {
  const {island, notifications, timers} = setup();
  island.disconnected("peer-name");
  assert.equal(island.status, "unavailable");
  assert.equal(island.reason, "peer-name");
  assert.equal(timers.size, 1);
  island.disconnected("access-denied", 5);
  assert.equal(notifications.length, 2);
  assert.equal(island.reason, "access-denied");
  assert.equal(island.errorCode, 5);
  assert.equal(timers.size, 1);
  island.disconnected("access-denied", 5);
  assert.equal(notifications.length, 2);
  island.receive({v: 1, type: "hello", capabilities: ["downloads"]});
  assert.equal(island.status, "connected");
  assert.equal(island.reason, "");
  assert.equal(island.errorCode, 0);
  island.stop();
  assert.equal(island.status, "disabled");
  assert.equal(timers.size, 0);
});

test("retry clears stale errors and cancellation prevents a scheduled reconnect", () => {
  const {island, timers} = setup();
  let connects = 0;
  island.connect = () => connects++;
  island.disconnected("not-running", 2);
  assert.equal(island.status, "waiting");
  assert.equal([...timers.values()][0].delay, 1000);
  island.retryNow();
  assert.equal(connects, 1);
  assert.equal(timers.size, 0);
  assert.equal(island.status, "connecting");
  assert.equal(island.reason, "");
  assert.equal(island.errorCode, 0);
  island.disconnected("handshake-timeout");
  assert.equal(timers.size, 1);
  island.stop();
  island.retryNow();
  assert.equal(timers.size, 0);
  assert.equal(connects, 1);
});
