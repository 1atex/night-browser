import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFolders, folderContains, savedTabEntry } from "../../src/night/WorkspaceModel.mjs";

test("invalid folder links cannot hide a subtree behind a cycle or another workspace", () => {
  const folders = normalizeFolders([
    {id: "a", workspace: "work", parentId: "b"},
    {id: "b", workspace: "work", parentId: "a"},
    {id: "c", workspace: "home", parentId: "a"},
    {id: "d", workspace: "work", parentId: "missing"},
    {id: "a", workspace: "work"},
    {id: "outside", workspace: "unknown"},
  ], ["work", "home"]);
  assert.equal(folders.length, 4);
  assert.equal(folders.find(f => f.id === "c").parentId, null);
  assert.equal(folders.find(f => f.id === "d").parentId, null);
  assert.ok(!(folderContains(folders, "a", "b") && folderContains(folders, "b", "a")));
  assert.equal(folderContains(folders, "a", "a"), true);
});

test("uses the current history entry instead of the final visited URL", () => {
  assert.equal(savedTabEntry({entries: [{url: "first"}, {url: "second"}], index: 1}).url, "first");
  assert.equal(savedTabEntry({entries: []}), null);
});
