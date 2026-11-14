import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as model from "../../src/night/RequestModel.mjs";

const source = (
  await readFile(
    new URL("../../src/night/NightNetwork.sys.mjs", import.meta.url),
    "utf8",
  )
)
  .replace(/\r\n/g, "\n")
  .replace(/^import[\s\S]*?from "[^"]+";\n/gm, "")
  .replace(
    "export class NightNetwork",
    "globalThis.NightNetwork = class NightNetwork",
  );

function setup(enabled = true) {
  const observers = new Set(),
    timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    ...model,
    console,
    URL,
    TextDecoder,
    Uint8Array,
    NetUtil: {},
    WebRequest: { onBeforeRedirect: { addListener() {}, removeListener() {} } },
    NetworkUtils: {
      getChannelBrowsingContextID: (channel) => channel.contextId,
    },
    BrowsingContext: { get: (id) => ({ top: { id } }) },
    ChannelWrapper: { get: (channel) => channel },
    Services: {
      prefs: { getBoolPref: () => enabled },
      obs: {
        addObserver: (_owner, topic) => observers.add(topic),
        removeObserver: (_owner, topic) => observers.delete(topic),
      },
      io: { newURI: (url) => url },
    },
    Components: { isSuccessCode: (status) => status === 0 },
    Ci: { nsIHttpChannel: {}, nsIUploadChannel: {}, nsIUploadChannel2: {} },
    Cr: { NS_BINDING_ABORTED: 1 },
    Cc: {
      "@mozilla.org/io/string-input-stream;1": {
        createInstance: () => ({
          setByteStringData(data) {
            this.data = data;
          },
        }),
      },
    },
  });
  vm.runInContext(source, context);
  const window = {
    document: {},
    setTimeout: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    gBrowser: {
      tabContainer: { addEventListener() {}, removeEventListener() {} },
    },
  };
  const tab = {
    isConnected: true,
    ownerDocument: window.document,
    linkedBrowser: {
      currentURI: { schemeIs: (scheme) => scheme === "https" },
      browsingContext: { top: { id: 42 } },
    },
  };
  const service = new context.NightNetwork(window, () => {});
  return { service, tab, observers, timers };
}

function channel(id, contextId = 42) {
  const result = {
    channelId: id,
    contextId,
    requestMethod: "POST",
    requestObserversCalled: true,
    loadInfo: { loadingPrincipal: { isSystemPrincipal: false } },
    URI: {
      spec: "https://example.com/api",
      schemeIs: (scheme) => scheme === "https",
    },
    headers: new Map([["X-Test", "before"]]),
    status: 0,
    QueryInterface() {
      return this;
    },
    visitRequestHeaders(visitor) {
      for (const [key, value] of this.headers) visitor.visitHeader(key, value);
    },
    setRequestHeader(name, value) {
      this.headers.set(name, value);
    },
    suspend() {
      this.suspended = true;
    },
    resume() {
      this.suspended = false;
    },
    cancel() {
      this.cancelled = true;
    },
    explicitSetUploadStream(stream, _type, length) {
      this.body = stream.data;
      this.headers.set("Content-Length", String(length));
    },
  };
  return result;
}

test("disabled tools install no observers", () => {
  const { service, tab, observers } = setup(false);
  assert.throws(() => service.start(tab, true));
  assert.equal(observers.size, 0);
});

test("capture only touches the selected top-level context", () => {
  const { service, tab } = setup();
  service.start(tab, true);
  const unrelated = channel(1, 99),
    selected = channel(2);
  service.observe(unrelated, "http-on-before-connect");
  assert.equal(unrelated.suspended, undefined);
  assert.equal(service.history.items.length, 0);
  service.observe(selected, "http-on-before-connect");
  assert.equal(selected.suspended, true);
  assert.equal(service.protectsTab(tab), true);
  assert.equal(service.pending.length, 1);
  service.destroy();
});

test("chrome-internal requests are never captured", () => {
  const { service, tab } = setup();
  service.start(tab, true);
  const internal = channel(1);
  internal.loadInfo.loadingPrincipal.isSystemPrincipal = true;
  service.observe(internal, "http-on-before-connect");
  assert.equal(service.history.items.length, 0);
  service.destroy();
});

test("moving the captured tab to another window ends capture", () => {
  const { service, tab, observers } = setup();
  service.start(tab, true);
  tab.ownerDocument = {};
  const request = channel(1);
  service.observe(request, "http-on-before-connect");
  assert.equal(service.active, false);
  assert.equal(observers.size, 0);
  assert.equal(request.suspended, undefined);
});

test("starting a new capture clears the previous tab's history", () => {
  const { service, tab } = setup();
  service.start(tab, true);
  const request = channel(1);
  service.observe(request, "http-on-before-connect");
  service.start(tab, false);
  assert.equal(request.cancelled, true);
  assert.equal(service.history.items.length, 0);
  assert.equal(service.pending.length, 0);
  service.destroy();
});

test("forward edits the channel, restores observer state and resumes exactly the held request", () => {
  const { service, tab, timers } = setup();
  service.start(tab, true);
  const request = channel(1);
  service.observe(request, "http-on-before-connect");
  service.forward("1", {
    method: "PUT",
    url: request.URI.spec,
    headers: "X-Test: after",
    body: "изменено",
  });
  assert.equal(request.requestMethod, "PUT");
  assert.equal(request.body, model.toByteString("изменено"));
  assert.equal(request.headers.get("Content-Length"), "16");
  assert.equal(request.headers.get("X-Test"), "after");
  assert.equal(request.requestObserversCalled, true);
  assert.equal(request.suspended, false);
  assert.equal(service.pending.length, 0);
  assert.equal(timers.size, 0);
  service.destroy();
});

test("invalid edits do not release a paused request", () => {
  const { service, tab } = setup();
  service.start(tab, true);
  const request = channel(1);
  service.observe(request, "http-on-before-connect");
  assert.throws(() =>
    service.forward("1", {
      method: "GET",
      url: "https://other.example",
      headers: "",
      body: "",
    }),
  );
  assert.equal(request.suspended, true);
  assert.equal(request.cancelled, undefined);
  service.destroy();
  assert.equal(request.cancelled, true);
});

test("closing capture cancels held traffic and removes observers and timers", () => {
  const { service, tab, observers, timers } = setup();
  service.start(tab, true);
  const request = channel(1);
  service.observe(request, "http-on-before-connect");
  service.stop();
  assert.equal(request.cancelled, true);
  assert.equal(request.suspended, false);
  assert.equal(service.pending.length, 0);
  assert.equal(observers.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(service.protectsTab(tab), false);
});

test("a full interception queue cancels extra requests rather than leaking them through", () => {
  const { service, tab } = setup();
  service.start(tab, true);
  for (let id = 0; id < 8; id++)
    service.observe(channel(id), "http-on-before-connect");
  const overflow = channel(8);
  service.observe(overflow, "http-on-before-connect");
  assert.equal(service.pending.length, 8);
  assert.equal(overflow.cancelled, true);
  service.destroy();
});

test("an expired decision cancels the request instead of sending it", () => {
  const { service, tab, timers } = setup();
  service.start(tab, true);
  const request = channel(1);
  service.observe(request, "http-on-before-connect");
  [...timers.values()][0]();
  assert.equal(request.cancelled, true);
  assert.equal(request.suspended, false);
  assert.equal(service.pending.length, 0);
  service.destroy();
});
