/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_HISTORY_BYTES = 512 * 1024;

export function parseHeaders(text) {
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    throw new Error("Headers exceed 64 KiB.");
  if (!text.trim()) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (
        colon < 1 ||
        !TOKEN.test(name) ||
        /[\x00-\x08\x0a-\x1f\x7f]/.test(value)
      ) {
        throw new Error(`Invalid header: ${name || line}`);
      }
      return { name, value };
    });
}

export function validateRequest(
  { method, url, headers, body },
  originalURL = null,
) {
  method = method.trim().toUpperCase();
  if (!TOKEN.test(method) || method === "CONNECT")
    throw new Error("Unsupported HTTP method.");
  const parsed = new URL(url);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Use an HTTP(S) URL without embedded credentials.");
  }
  if (originalURL && parsed.origin !== new URL(originalURL).origin) {
    throw new Error(
      "Changing a captured request's origin is not supported in this preview.",
    );
  }
  const parsedHeaders = parseHeaders(headers);
  if (body !== null && new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    throw new Error("Request body exceeds 64 KiB.");
  if (["GET", "HEAD"].includes(method) && body)
    throw new Error(
      "GET and HEAD requests cannot have a body in this preview.",
    );
  return { method, url: parsed.href, headers: parsedHeaders, body };
}

export function toByteString(text) {
  const bytes = new TextEncoder().encode(text);
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return result;
}

export class RequestHistory {
  #items = [];
  #bytes = 0;
  constructor(limit = 50, byteLimit = MAX_HISTORY_BYTES) {
    this.limit = limit;
    this.byteLimit = byteLimit;
  }
  get items() {
    return this.#items.map(entry => entry.item);
  }
  get retainedBytes() { return this.#bytes; }
  add(item) {
    const bytes = [item.url, item.method, item.headers, item.body].reduce((total, text) => total + (typeof text === "string" ? text.length * 2 : 0), 0);
    if (bytes > this.byteLimit) return;
    this.#items.unshift({item, bytes});
    this.#bytes += bytes;
    while (this.#items.length > this.limit || this.#bytes > this.byteLimit) this.#bytes -= this.#items.pop().bytes;
  }
  clear() {
    this.#items.length = 0;
    this.#bytes = 0;
  }
}

export function compareResponses(previous, current) {
  if (!previous) return "First response.";
  const changes = [];
  if (previous.status !== current.status)
    changes.push(`Status: ${previous.status} → ${current.status}`);
  if (previous.headers !== current.headers)
    changes.push("Response headers changed.");
  if (previous.body !== current.body) {
    const a = previous.body, b = current.body;
    let index = 0, line = 1;
    while (index < a.length && index < b.length && a.charCodeAt(index) === b.charCodeAt(index)) {
      if (a.charCodeAt(index) === 10) line++;
      index++;
    }
    if ((index === a.length && b.charCodeAt(index) === 10) || (index === b.length && a.charCodeAt(index) === 10)) line++;
    changes.push(
      `Body differs from line ${line}.`,
    );
  }
  return changes.join("\n") || "Responses are identical.";
}
