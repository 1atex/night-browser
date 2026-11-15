import test from "node:test";
import assert from "node:assert/strict";
import {PROFILE_ID, profileName, profileMetadata} from "../../src/night/ProfileModel.mjs";

test("profile identities cannot address arbitrary folders", () => {
  for (const id of ["../profile", "default/../other", "C:\\Users\\test", "", "DEFAULT", "a".repeat(31), "a".repeat(32) + "\n"])
    assert.equal(PROFILE_ID.test(id), false, id);
  assert.equal(PROFILE_ID.test("default"), true);
  assert.equal(PROFILE_ID.test("a0".repeat(16)), true);
});

test("profile metadata retains Unicode names and rejects empty or control characters", () => {
  assert.equal(profileName("  Работа 👋  "), "Работа 👋");
  for (const name of [null, 42, " ", "x".repeat(41), "a\nb", "a\0b"])
    assert.throws(() => profileName(name));
  assert.deepEqual(profileMetadata({name: "Работа", id: "../other"}, "default"), {id: "default", name: "Работа"});
  assert.deepEqual(profileMetadata({name: ""}, "default"), {id: "default", name: "Личный"});
  assert.throws(() => profileMetadata({}, "../../other"));
});
