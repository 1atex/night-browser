import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSiteRules,
  matchesSite,
  unloadDecision,
} from "../../src/night/MemoryPolicy.mjs";

const settings = {
  enabled: true,
  idleMinutes: 10,
  excludedSites: ["youtube.com"],
};
const now = 1_000_000;
const tab = { url: "https://example.com/", remote: true, lastUsed: 0 };

test("unloads an old inactive web page but keeps recently used tabs", () => {
  assert.equal(unloadDecision(tab, settings, now), "unload");
  assert.equal(
    unloadDecision({ ...tab, lastUsed: now - 59_000 }, settings, now),
    "recent",
  );
});

for (const [flag, reason] of Object.entries({
  selected: "visible",
  visibleInSplit: "visible",
  pending: "unavailable",
  closing: "unavailable",
  protected: "protected",
  intercepted: "protected",
  media: "media",
  pictureInPicture: "media",
  sharing: "media",
  loading: "loading",
  private: "private",
})) {
  test(`preserves ${flag} tabs even when old`, () => {
    assert.equal(
      unloadDecision({ ...tab, [flag]: true }, settings, now),
      reason,
    );
  });
}

test("does not unload internal pages or tabs without a valid inactivity timestamp", () => {
  assert.equal(
    unloadDecision({ ...tab, url: "about:config" }, settings, now),
    "internal",
  );
  assert.equal(
    unloadDecision({ ...tab, lastUsed: undefined }, settings, now),
    "recent",
  );
  assert.equal(
    unloadDecision({ ...tab, lastUsed: now + 1 }, settings, now),
    "recent",
  );
});

test("matches a site and subdomains without allowing suffix lookalikes", () => {
  assert.equal(
    matchesSite("https://music.youtube.com/watch?v=1", settings.excludedSites),
    true,
  );
  assert.equal(
    matchesSite("https://youtube.com.evil.example/", settings.excludedSites),
    false,
  );
  assert.equal(
    matchesSite("https://notyoutube.com/", settings.excludedSites),
    false,
  );
  assert.equal(
    matchesSite(
      "https://example.com/?next=youtube.com",
      settings.excludedSites,
    ),
    false,
  );
  assert.equal(
    unloadDecision({ ...tab, url: "https://youtube.com/" }, settings, now),
    "site-exception",
  );
});

test("normalizes case, wildcard, IDN and repeated site exclusions", () => {
  assert.deepEqual(
    parseSiteRules("YouTube.com\n*.youtube.com, https://example.com/"),
    ["youtube.com", "example.com"],
  );
  assert.equal(
    matchesSite("https://пример.рф", parseSiteRules("пример.рф")),
    true,
  );
});

test("rejects ambiguous site exclusions rather than silently discarding them", () => {
  for (const rule of [
    "example.com/path",
    "https://user:pass@example.com",
    "file:///tmp",
    "example.com:4430",
    "[broken",
  ])
    assert.throws(() => parseSiteRules(rule));
});

test("disabled or invalid timer settings cannot unload tabs", () => {
  assert.equal(
    unloadDecision(tab, { ...settings, enabled: false }, now),
    "disabled",
  );
  for (const idleMinutes of [0, -1, NaN, Infinity])
    assert.equal(
      unloadDecision(tab, { ...settings, idleMinutes }, now),
      "disabled",
    );
});
