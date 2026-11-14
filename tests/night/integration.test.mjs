import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = new URL("../../src/night/", import.meta.url);
const files = (await readdir(source)).filter((name) => name.endsWith(".mjs"));

test("Night modules are syntactically valid with complete module imports", async () => {
  for (const name of files) {
    const file = new URL(name, source);
    const result = spawnSync(
      process.execPath,
      ["--check", fileURLToPath(file)],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(
      /resource:\/\/\/modules\/night\/([^"']+)/g,
    ))
      assert.ok(
        files.includes(match[1]),
        `${name} imports missing module ${match[1]}`,
      );
  }
});

test("packaging accepts Firefox and injects Night startup", async () => {
  const packager = await readFile(new URL("../../scripts/preview/package.py", import.meta.url), "utf8");
  assert.match(packager, /src\/night/);
  assert.match(packager, /night\/bootstrap.js/);
  const pin = JSON.parse(await readFile(new URL("../../scripts/preview/runtime.json", import.meta.url), "utf8"));
  assert.equal(pin.product, "Mozilla Firefox");
  assert.ok(pin.windows_x64.url.startsWith("https://archive.mozilla.org/pub/firefox/"));
});
