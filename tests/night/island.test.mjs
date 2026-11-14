import test from "node:test";
import assert from "node:assert/strict";
import { downloadItem, allowedActions, validCommand, validSnapshot } from "../../src/night/IslandDownloads.mjs";

const item = () => ({source: {isPrivate: false, url: "https://private.example/secret"}, tryToKeepPartialData: true, target: {partFilePath: "archive.zip.part", path: "C:\\Users\\Name\\Downloads\\archive.zip"}, stopped: false, currentBytes: 12, hasProgress: true, totalBytes: 20});

test("download metadata excludes source URLs and paths", () => {
  const result = downloadItem("id", item());
  assert.deepEqual(result, {id: "id", name: "archive.zip", state: "active", current: 12, total: 20, actions: ["pause", "cancel"]});
  assert.equal(downloadItem("id", {...item(), source: {isPrivate: true}}), null);
  assert.equal(validSnapshot({v: 1, type: "downloads", items: [result]}), true);
});

test("download commands follow terminal and paused states", () => {
  assert.deepEqual(allowedActions({...item(), stopped: true, canceled: true, hasPartialData: true}), ["resume", "cancel"]);
  assert.deepEqual(allowedActions({...item(), stopped: true, canceled: true, hasPartialData: false}), []);
  assert.deepEqual(allowedActions({...item(), stopped: true, succeeded: true}), ["reveal"]);
  assert.deepEqual(allowedActions({...item(), stopped: true, error: {}}), ["resume", "cancel"]);
});

test("non-resumable downloads cannot be offered a destructive pause", () => {
  assert.deepEqual(allowedActions({...item(), tryToKeepPartialData: false}), ["cancel"]);
  assert.deepEqual(allowedActions({...item(), target: {path: "archive.zip"}}), ["cancel"]);
});

test("commands are versioned and bounded", () => {
  const command = {v: 1, type: "command", id: "id", request: "r1", action: "pause"};
  assert.equal(validCommand(command), true);
  for (const change of [{v: 2}, {action: "open"}, {id: "x".repeat(65)}, {request: null}]) assert.equal(validCommand({...command, ...change}), false);
  assert.equal(validSnapshot({v: 1, type: "downloads", items: Array(33).fill(downloadItem("id", item()))}), false);
});
