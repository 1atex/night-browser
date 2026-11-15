import test from "node:test";
import assert from "node:assert/strict";
import {homeWidgets, HOME_WIDGETS} from "../../src/night/HomeModel.mjs";

test("home layout accepts only known widgets and preserves an intentionally empty page", () => {
  assert.deepEqual(homeWidgets(null), HOME_WIDGETS);
  assert.deepEqual(homeWidgets([]), []);
  assert.deepEqual(homeWidgets(["tabs", "clock", "tabs", "<script>", null]), ["tabs", "clock"]);
});
