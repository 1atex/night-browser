import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHeaders,
  validateRequest,
  toByteString,
  RequestHistory,
  compareResponses,
  MAX_BODY_BYTES,
} from "../../src/zen/night/RequestModel.mjs";

const input = {
  method: "POST",
  url: "https://example.com/api",
  headers: "Content-Type: application/json",
  body: '{"hello":"мир"}',
};

test("keeps repeated headers and colons in header values", () => {
  assert.deepEqual(
    parseHeaders("X-Value: one\r\nX-Value: two\r\nOrigin: https://example.com"),
    [
      { name: "X-Value", value: "one" },
      { name: "X-Value", value: "two" },
      { name: "Origin", value: "https://example.com" },
    ],
  );
});

test("rejects header injection and malformed header names", () => {
  for (const text of [
    "X Test: value",
    "X: a\rb",
    "X: a\0b",
    "missing-colon",
    ": value",
  ])
    assert.throws(() => parseHeaders(text));
});

test("request editing only accepts HTTP URLs and token methods", () => {
  assert.equal(validateRequest(input).method, "POST");
  for (const url of [
    "file:///etc/passwd",
    "chrome://browser/content/",
    "https://name:secret@example.com/",
  ])
    assert.throws(() => validateRequest({ ...input, url }));
  for (const method of ["CONNECT", "GET\r\nInjected: yes", ""])
    assert.throws(() => validateRequest({ ...input, method }));
});

test("captured credentials are not forwarded to a different origin", () => {
  assert.throws(() =>
    validateRequest({ ...input, url: "https://other.example/" }, input.url),
  );
  assert.throws(() =>
    validateRequest({ ...input, url: "http://example.com/api" }, input.url),
  );
  assert.equal(
    validateRequest({ ...input, url: "https://example.com/other" }, input.url)
      .url,
    "https://example.com/other",
  );
});

test("enforces body size in bytes, including multibyte text", () => {
  assert.throws(() =>
    validateRequest({ ...input, body: "я".repeat(MAX_BODY_BYTES) }),
  );
  assert.doesNotThrow(() =>
    validateRequest({ ...input, body: "x".repeat(MAX_BODY_BYTES) }),
  );
  assert.throws(() => validateRequest({ ...input, method: "GET" }));
  assert.equal(validateRequest({ ...input, body: null }).body, null);
});

test("encodes non-ASCII request bodies as UTF-8 bytes", () => {
  const body = "Привет 🌙";
  const bytes = Uint8Array.from(toByteString(body), (char) =>
    char.charCodeAt(0),
  );
  assert.equal(new TextDecoder().decode(bytes), body);
});

test("history is bounded and does not leak its backing array", () => {
  const history = new RequestHistory(2);
  history.add({ id: 1 });
  history.add({ id: 2 });
  history.add({ id: 3 });
  assert.deepEqual(
    history.items.map((item) => item.id),
    [3, 2],
  );
  history.items.pop();
  assert.equal(history.items.length, 2);
  history.clear();
  assert.equal(history.items.length, 0);
});

test("response comparison handles status changes, additions and deletions", () => {
  const previous = { status: 200, headers: "X: 1", body: "one\ntwo" };
  assert.match(
    compareResponses(previous, { ...previous, status: 403 }),
    /200 → 403/,
  );
  assert.match(
    compareResponses(previous, { ...previous, body: "one" }),
    /line 2/,
  );
  assert.match(
    compareResponses(previous, { ...previous, body: "one\ntwo\nthree" }),
    /line 3/,
  );
  assert.equal(
    compareResponses(previous, previous),
    "Responses are identical.",
  );
});
