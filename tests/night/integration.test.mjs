import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = new URL("../../src/zen/night/", import.meta.url);
const files = (await readdir(source)).filter((name) => name.endsWith(".mjs"));

test("Night modules are syntactically valid and included in the native build", async () => {
  const manifest = await readFile(new URL("moz.build", source), "utf8");
  for (const name of files) {
    const file = new URL(name, source);
    const result = spawnSync(
      process.execPath,
      ["--check", fileURLToPath(file)],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.ok(
      manifest.includes(`"${name}"`),
      `${name} is missing from moz.build`,
    );
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

test("native startup and stylesheet packaging include Night", async () => {
  const read = (path) =>
    readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  assert.match(await read("src/zen/moz.build"), /"night"/);
  assert.match(
    await read("src/zen/common/ZenPreloadedScripts.js"),
    /NightBrowser\.sys\.mjs/,
  );
  assert.match(
    await read("src/browser/base/content/zen-assets.jar.inc.mn"),
    /night\/jar\.inc\.mn/,
  );
  assert.match(
    await read("src/browser/base/content/zen-assets.inc.xhtml"),
    /night\/night\.css/,
  );
});
