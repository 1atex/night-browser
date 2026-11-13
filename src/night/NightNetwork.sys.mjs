/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { WebRequest } from "resource://gre/modules/WebRequest.sys.mjs";
import { NetworkUtils } from "resource://devtools/shared/network-observer/NetworkUtils.sys.mjs";
import {
  RequestHistory,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  toByteString,
  validateRequest,
} from "resource:///modules/night/RequestModel.mjs";

const TOPICS = [
  "http-on-before-connect",
  "http-on-examine-response",
  "http-on-stop-request",
];

export class NightNetwork {
  #window;
  #scopeTab = null;
  #scopeId = null;
  #pending = new Map();
  #records = new Map();
  #replays = new Set();
  #redirected = new WeakMap();
  #trackRedirect = () => {};
  #listening = false;
  #intercept = false;
  #notify;
  history = new RequestHistory();

  constructor(window, notify) {
    this.#window = window;
    this.#notify = notify;
  }

  get pending() {
    return [...this.#pending.values()].map((value) => value.record);
  }
  get active() {
    return this.#listening;
  }
  get intercepting() {
    return this.#intercept;
  }

  protectsTab(tab) {
    return (
      tab === this.#scopeTab &&
      (this.#listening || this.#pending.size > 0 || this.#replays.size > 0)
    );
  }

  start(tab, intercept = false) {
    if (!Services.prefs.getBoolPref("night.network.enabled", false)) {
      throw new Error(
        "Experimental network tools are disabled. Enable night.network.enabled in about:config after native validation.",
      );
    }
    const uri = tab.linkedBrowser.currentURI;
    if (!uri.schemeIs("http") && !uri.schemeIs("https"))
      throw new Error("Select a web page first.");
    this.stop();
    this.history.clear();
    this.#records.clear();
    this.#scopeTab = tab;
    this.#scopeId = tab.linkedBrowser.browsingContext.top.id;
    this.#intercept = intercept;
    for (const topic of TOPICS) Services.obs.addObserver(this, topic);
    WebRequest.onBeforeRedirect.addListener(this.#trackRedirect);
    this.#window.gBrowser.tabContainer.addEventListener("TabClose", this);
    this.#listening = true;
    this.#notify();
  }

  handleEvent(event) {
    if (event.target === this.#scopeTab) this.stop();
  }

  observe(subject, topic) {
    let channel,
      scoped = false;
    try {
      if (
        !this.#scopeTab?.isConnected ||
        this.#scopeTab.ownerDocument !== this.#window.document
      ) {
        this.stop();
        return;
      }
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
      if (!channel.URI.schemeIs("http") && !channel.URI.schemeIs("https"))
        return;
      const contextId = NetworkUtils.getChannelBrowsingContextID(channel);
      if (BrowsingContext.get(contextId)?.top.id !== this.#scopeId) return;
      if (
        channel.loadInfo.loadingPrincipal?.isSystemPrincipal ||
        channel.loadInfo.isInDevToolsContext
      )
        return;
      scoped = true;
      const id = String(channel.channelId);
      if (topic === "http-on-before-connect") {
        if (this.#records.has(id)) return;
        const wrapper = ChannelWrapper.get(channel);
        const redirected = this.#redirected.get(wrapper);
        this.#redirected.delete(wrapper);
        if (redirected) this.#applyEdit(channel, redirected);
        const headers = [];
        channel.visitRequestHeaders({
          visitHeader(name, value) {
            headers.push(`${name}: ${value}`);
          },
        });
        const upload = this.#readBody(channel);
        const record = {
          id,
          url: channel.URI.spec,
          method: channel.requestMethod,
          headers: headers.join("\n").slice(0, MAX_BODY_BYTES),
          body: upload.body,
          bodyEditable: upload.editable,
          status: "sent",
          time: Date.now(),
        };
        if (this.#intercept && !redirected) {
          if (this.#pending.size >= 8) {
            channel.cancel(Cr.NS_BINDING_ABORTED);
            record.status = "queue full — cancelled";
          } else {
            channel.suspend();
            record.status = "paused";
            const timer = this.#window.setTimeout(
              () => this.abort(id, "expired — cancelled"),
              60_000,
            );
            this.#pending.set(id, { record, channel, wrapper, timer });
          }
        }
        this.history.add(record);
        this.#records.set(id, record);
        const retained = new Set([
          ...this.history.items.map((item) => item.id),
          ...this.#pending.keys(),
        ]);
        for (const key of this.#records.keys())
          if (!retained.has(key)) this.#records.delete(key);
      } else {
        const record = this.#records.get(id);
        if (!record) return;
        if (topic === "http-on-examine-response")
          record.status = channel.responseStatus;
        else if (this.#pending.has(id)) this.abort(id, "cancelled");
        else if (!Components.isSuccessCode(channel.status))
          record.status = "failed";
      }
      this.#notify();
    } catch (error) {
      if (scoped && this.#intercept && topic === "http-on-before-connect") {
        channel.cancel(Cr.NS_BINDING_ABORTED);
      }
      console.error("Night request observation failed", error);
    }
  }

  #readBody(channel) {
    let stream, seekable, offset;
    try {
      stream = channel.QueryInterface(Ci.nsIUploadChannel).uploadStream;
      if (!stream) return { body: "", editable: true };
      seekable = stream.QueryInterface(Ci.nsISeekableStream);
      offset = seekable.tell();
      seekable.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
      const count = stream.available();
      if (count > MAX_BODY_BYTES) return { body: "", editable: false };
      if (!count) return { body: "", editable: true };
      const raw = NetUtil.readInputStreamToString(stream, count);
      const body = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(raw, (char) => char.charCodeAt(0)),
      );
      return { body, editable: true };
    } catch {
      return { body: "", editable: false };
    } finally {
      if (seekable && offset !== undefined)
        seekable.seek(Ci.nsISeekableStream.NS_SEEK_SET, offset);
    }
  }

  forward(id, input) {
    const held = this.#pending.get(id);
    if (!held) throw new Error("The request is no longer paused.");
    const request = validateRequest(input, held.record.url);
    const { channel } = held;
    try {
      if (request.url !== held.record.url) {
        this.#redirected.set(held.wrapper, request);
        channel.redirectTo(Services.io.newURI(request.url));
      } else {
        this.#applyEdit(channel, request);
      }
      this.#window.clearTimeout(held.timer);
      this.#pending.delete(id);
      held.record.status = "forwarded";
      held.channel.resume();
      this.#notify();
    } catch (error) {
      this.abort(id, "edit failed — cancelled");
      throw error;
    }
  }

  #applyEdit(channel, request) {
    const observersCalled = channel.requestObserversCalled;
    channel.requestObserversCalled = false;
    try {
      channel.requestMethod = request.method;
      if (request.body !== null)
        this.#setBody(channel, request.body, request.method);
    } finally {
      channel.requestObserversCalled = observersCalled;
    }
    const oldHeaders = [];
    channel.visitRequestHeaders({
      visitHeader(name) {
        oldHeaders.push(name);
      },
    });
    for (const name of oldHeaders) {
      if (!/^(host|content-length|transfer-encoding)$/i.test(name))
        channel.setRequestHeader(name, "", false);
    }
    this.#setHeaders(channel, request.headers);
  }

  abort(id, status = "cancelled") {
    const held = this.#pending.get(id);
    if (!held) return;
    this.#pending.delete(id);
    this.#window.clearTimeout(held.timer);
    held.record.status = status;
    try {
      held.channel.cancel(Cr.NS_BINDING_ABORTED);
    } finally {
      try {
        held.channel.resume();
      } catch {}
      this.#notify();
    }
  }

  #setBody(channel, body, method) {
    channel.QueryInterface(Ci.nsIUploadChannel2);
    const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(
      Ci.nsIStringInputStream,
    );
    const bytes = toByteString(body);
    stream.setByteStringData(bytes);
    channel.setRequestHeader("Content-Length", "", false);
    channel.setRequestHeader("Transfer-Encoding", "", false);
    channel.explicitSetUploadStream(stream, null, bytes.length, method);
  }

  #setHeaders(channel, headers) {
    const seen = new Set();
    for (const { name, value } of headers) {
      const lower = name.toLowerCase();
      if (/^(host|content-length|transfer-encoding)$/.test(lower)) continue;
      if (lower === "referer")
        channel.setNewReferrerInfo(value, Ci.nsIReferrerInfo.UNSAFE_URL, true);
      else channel.setRequestHeader(name, value, seen.has(lower));
      seen.add(lower);
    }
  }

  async replay(input, originalURL) {
    if (
      !this.#listening ||
      !this.#scopeTab?.isConnected ||
      this.#scopeTab.ownerDocument !== this.#window.document
    )
      throw new Error("Start capture for a tab first.");
    if (this.#replays.size >= 2)
      throw new Error("Wait for an active replay to finish.");
    const request = validateRequest(input, originalURL);
    if (request.body === null)
      throw new Error(
        "The original body was not captured; this request cannot be replayed.",
      );
    const channel = NetUtil.newChannel({
      uri: Services.io.newURI(request.url),
      loadingPrincipal: this.#scopeTab.linkedBrowser.contentPrincipal,
      securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER,
    }).QueryInterface(Ci.nsIHttpChannel);
    channel.loadFlags |=
      Ci.nsIRequest.LOAD_BYPASS_CACHE |
      Ci.nsIRequest.INHIBIT_CACHING |
      Ci.nsIRequest.LOAD_ANONYMOUS;
    channel.redirectionLimit = 0;
    channel.requestMethod = request.method;
    if (request.body) this.#setBody(channel, request.body, request.method);
    this.#setHeaders(channel, request.headers);
    this.#replays.add(channel);
    const started = Date.now();
    const timer = this.#window.setTimeout(
      () => channel.cancel(Cr.NS_ERROR_NET_TIMEOUT),
      30_000,
    );
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0,
        truncated = false;
      try {
        channel.asyncOpen({
          QueryInterface: ChromeUtils.generateQI([
            "nsIStreamListener",
            "nsIRequestObserver",
          ]),
          onStartRequest() {},
          onDataAvailable(_request, stream, _offset, count) {
            const length = Math.min(count, MAX_RESPONSE_BYTES - size);
            if (length > 0) {
              const raw = NetUtil.readInputStreamToString(stream, length);
              chunks.push(Uint8Array.from(raw, (char) => char.charCodeAt(0)));
              size += length;
            }
            if (length < count) {
              truncated = true;
              channel.cancel(Cr.NS_BINDING_ABORTED);
            }
          },
          onStopRequest: (_request, status) => {
            this.#window.clearTimeout(timer);
            this.#replays.delete(channel);
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.length;
            }
            const headers = [];
            let code = 0;
            try {
              code = channel.responseStatus;
              channel.visitResponseHeaders({
                visitHeader(name, value) {
                  headers.push(`${name}: ${value}`);
                },
              });
            } catch {}
            if (!Components.isSuccessCode(status) && !truncated && !code) {
              reject(new Error(ChromeUtils.getXPCOMErrorName(status)));
              return;
            }
            resolve({
              status: code,
              headers: headers.join("\n"),
              body: new TextDecoder().decode(bytes),
              duration: Date.now() - started,
              truncated,
            });
          },
        });
      } catch (error) {
        this.#window.clearTimeout(timer);
        this.#replays.delete(channel);
        reject(error);
      }
    });
  }

  stop() {
    if (this.#listening) {
      for (const topic of TOPICS) Services.obs.removeObserver(this, topic);
      WebRequest.onBeforeRedirect.removeListener(this.#trackRedirect);
      this.#window.gBrowser.tabContainer.removeEventListener("TabClose", this);
    }
    this.#listening = false;
    this.#intercept = false;
    for (const id of [...this.#pending.keys()]) this.abort(id);
    for (const channel of this.#replays) channel.cancel(Cr.NS_BINDING_ABORTED);
    this.#scopeId = null;
    this.#scopeTab = null;
    this.#redirected = new WeakMap();
    this.#notify();
  }

  destroy() {
    this.stop();
    this.history.clear();
    this.#records.clear();
  }
}
