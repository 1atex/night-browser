/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

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
  constructor(limit = 50) {
    this.limit = limit;
  }
  get items() {
    return [...this.#items];
  }
  add(item) {
    this.#items.unshift(item);
    if (this.#items.length > this.limit) this.#items.length = this.limit;
  }
  clear() {
    this.#items.length = 0;
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
    const a = previous.body.split("\n"),
      b = current.body.split("\n");
    const first = a.findIndex((line, index) => line !== b[index]);
    changes.push(
      `Body differs from line ${(first < 0 ? a.length : first) + 1}.`,
    );
  }
  return changes.join("\n") || "Responses are identical.";
}
