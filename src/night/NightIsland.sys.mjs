import { Downloads } from "resource://gre/modules/Downloads.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { MAX_DOWNLOADS, MAX_FRAME, downloadItem, allowedActions, validCommand } from "resource:///modules/night/IslandDownloads.mjs";

import {HUB_CAPABILITIES, pocketItem, validHubCommand} from "resource:///modules/night/IslandHub.mjs";
import {NightIslandHub} from "resource:///modules/night/NightIslandHub.sys.mjs";

import {validAppearance} from "resource:///modules/night/IslandAppearance.mjs";

export const NightIsland = {
  initialized: false,
  enabled: false,
  status: "disabled",
  reason: "",
  errorCode: 0,
  list: null,
  entries: new Map(),
  ids: new WeakMap(),
  seen: new Set(),
  worker: null,
  transports: new Set(),
  port: null,
  timer: null,
  retry: null,
  generation: 0,
  retryDelay: 1000,
  ready: false,
  capabilities: new Set(),
  appearance: null,
  lastOpen: 0,
  lastSnapshot: "",
  connectionTimer: null,
  featureKey: "",
  pocketPending: new Map(),
  hub: NightIslandHub,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    NightIslandHub.init(this);
    Services.prefs.addObserver("night.island.", this);
    Services.obs.addObserver(this, "quit-application-granted");
    this.observe();
  },

  observe(_subject, topic) {
    if (topic === "quit-application-granted") {
      this.stop();
      return;
    }
    const featureKey = ["downloads", ...HUB_CAPABILITIES].map(name => Services.prefs.getBoolPref(`night.island.${name}`, false)).join(",");
    const enabled = Services.appinfo.OS === "WINNT" && featureKey.includes("true");
    if (enabled === this.enabled && featureKey === this.featureKey) return;
    this.featureKey = featureKey;
    this.stop();
    if (enabled) this.start().catch(error => { console.error(error); this.setStatus("unavailable"); });
  },

  setStatus(status, reason = "", errorCode = 0) {
    if (this.status === status && this.reason === reason && this.errorCode === errorCode) return;
    this.status = status;
    this.reason = reason;
    this.errorCode = errorCode;
    Services.obs.notifyObservers(null, "night-island-status", status);
  },

  async start() {
    this.enabled = true;
    this.setStatus("connecting");
    const generation = this.generation;
    if (!Services.prefs.getBoolPref("night.island.downloads", false)) { this.connect(); return; }
    const list = await Downloads.getList(Downloads.PUBLIC);
    if (!this.enabled || generation !== this.generation) return;
    this.list = list;
    await list.addView(this);
    if (this.enabled && generation === this.generation) this.connect();
  },

  onDownloadAdded(download) {
    if (!this.enabled || download.source.isPrivate || download.stopped && !download.hasPartialData) return;
    this.track(download);
  },
  onDownloadChanged(download) {
    if (!this.enabled || download.source.isPrivate) return;
    if (!this.ids.has(download) && download.stopped) return;
    this.track(download);
  },
  onDownloadRemoved(download) {
    this.entries.delete(this.ids.get(download));
    this.schedule();
  },

  track(download) {
    let id = this.ids.get(download);
    if (!id) { id = Services.uuid.generateUUID().toString(); this.ids.set(download, id); }
    this.entries.set(id, download);
    while (this.entries.size > MAX_DOWNLOADS) {
      const completed = [...this.entries].find(([, value]) => value.stopped && !value.hasPartialData);
      this.entries.delete(completed?.[0] ?? this.entries.keys().next().value);
    }
    this.schedule();
  },

  schedule() {
    if (!this.enabled || this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; this.snapshot(); }, 500);
  },

  snapshot() {
    if (!this.ready) return;
    const items = [...this.entries].map(([id, value]) => downloadItem(id, value)).filter(Boolean);
    const text = JSON.stringify({v: 1, type: "downloads", items});
    if (text === this.lastSnapshot) return;
    this.lastSnapshot = text;
    Services.obs.notifyObservers(null, "night-island-downloads");
    this.send(text);
  },

  connect() {
    if (!this.enabled || this.worker) return;
    const {ctypes} = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const {libc, win32} = ChromeUtils.importESModule("resource://gre/modules/subprocess/subprocess_win.sys.mjs");
    const port = libc.CreateIoCompletionPort(win32.INVALID_HANDLE_VALUE, win32.NULL_HANDLE_VALUE, 0, 1);
    if (port.isNull()) { this.disconnected("completion-port", ctypes.winLastError); return; }
    this.native = {ctypes, libc, win32};
    this.port = port;
    const worker = new ChromeWorker("chrome://browser/content/night/island-pipe.js");
    this.worker = worker;
    this.transports.add(worker);
    let released = false;
    const release = () => { if (!released) { released = true; this.transports.delete(worker); libc.CloseHandle(port); } };
    worker.onmessage = event => {
      const message = event.data;
      if (message.type === "closed") {
        release();
        if (this.worker === worker) {
          this.worker = null; this.port = null; this.disconnected(message.reason, message.code);
        }
        return;
      }
      if (this.worker !== worker) return;
      if (message.type === "connected") {
        this.send(JSON.stringify({v: 1, type: "hello", capabilities: ["downloads", "show-downloads", "appearance", ...HUB_CAPABILITIES]}));
      } else if (message.type === "frame") {
        try { this.receive(JSON.parse(message.text)); } catch { this.disconnected("protocol"); }
      }
    };
    worker.onerror = event => {
      event.preventDefault(); worker.terminate(); release();
      if (this.worker === worker) { this.worker = null; this.port = null; this.disconnected("worker-error"); }
    };
    this.post({type: "init", port: String(ctypes.cast(port, ctypes.uintptr_t).value)});
    this.connectionTimer = setTimeout(() => { if (!this.ready) this.disconnected("handshake-timeout"); }, 5000);
  },

  post(message) {
    if (!this.worker) return;
    const {libc, win32} = this.native;
    this.worker.postMessage(message);
    libc.PostQueuedCompletionStatus(this.port, 0, 1, win32.OVERLAPPED.ptr(0));
  },

  send(text, activate = false) {
    if (new TextEncoder().encode(text).length >= MAX_FRAME) return;
    this.post({type: "send", text: text + "\n", activate});
  },

  openPanel(panel) {
    if (!["browser", "pocket"].includes(panel) || !this.ready || !this.capabilities.has(panel === "browser" ? "tabs" : "pocket")) return false;
    this.send(JSON.stringify({v: 1, type: "show", panel}), true);
    return true;
  },

  savePocket(input) {
    const item = pocketItem(input);
    if (!item || !this.ready || !this.hub.enabled("pocket") || !this.capabilities.has("pocket")) return Promise.reject(new Error("Включи Карман в настройках интеграции и подключи Island."));
    if (this.pocketPending.size >= 8) return Promise.reject(new Error("Дождись сохранения предыдущих материалов."));
    const request = Services.uuid.generateUUID().toString().slice(1, -1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pocketPending.delete(request); reject(new Error("Island не подтвердил сохранение. Проверь Карман.")); }, 8000);
      this.pocketPending.set(request, {resolve, reject, timer});
      this.send(JSON.stringify({v: 1, type: "pocket", request, item: {...item, id: request}}), true);
    });
  },

  openDownloads() {
    if (!this.ready || !this.capabilities.has("show-downloads")) return false;
    if (Date.now() - this.lastOpen >= 500) {
      this.lastOpen = Date.now();
      this.send(JSON.stringify({v: 1, type: "show", panel: "downloads"}), true);
    }
    return true;
  },

  get sharedAppearance() {
    return this.enabled && Services.prefs.getBoolPref("night.island.appearance", true) ? this.appearance : null;
  },

  receive(message) {
    if (!this.ready) {
      if (message.v !== 1 || message.type !== "hello" || !message.capabilities?.includes("downloads")) {
        this.disconnected("protocol"); return;
      }
      clearTimeout(this.connectionTimer);
      this.ready = true;
      this.capabilities = new Set(message.capabilities);
      this.retryDelay = 1000;
      this.lastSnapshot = "";
      this.seen.clear();
      this.setStatus("connected");
      this.snapshot();
      if (HUB_CAPABILITIES.some(name => this.capabilities.has(name))) this.hub.connected();
      return;
    }
    if (this.capabilities.has("appearance") && validAppearance(message)) {
      if (JSON.stringify(this.appearance) !== JSON.stringify(message)) {
        this.appearance = message;
        Services.obs.notifyObservers(null, "night-island-appearance");
      }
      return;
    }
    if (message.v === 1 && message.type === "pocket-result" && typeof message.ok === "boolean") {
      const pending = this.pocketPending.get(message.request);
      if (pending) {
        this.pocketPending.delete(message.request); clearTimeout(pending.timer);
        if (message.ok) pending.resolve(); else pending.reject(new Error("Не удалось сохранить материал в Island."));
      }
      return;
    }
    if (validHubCommand(message)) {
      if (this.seen.has(message.request)) return;
      this.seen.add(message.request);
      if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
      this.hub.command(message);
      return;
    }
    if (!validCommand(message) || this.seen.has(message.request)) return;
    this.seen.add(message.request);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    const download = this.entries.get(message.id);
    const generation = this.generation, worker = this.worker;
    const reply = ok => { if (this.enabled && generation === this.generation && worker === this.worker) this.send(JSON.stringify({v: 1, type: "result", request: message.request, ok})); };
    if (!download || !allowedActions(download).includes(message.action)) { reply(false); return; }
    (async () => {
      if (message.action === "pause") await download.cancel();
      if (message.action === "resume") {
        download.start().catch(() => this.schedule());
      }
      if (message.action === "cancel") {
        await download.cancel();
        await download.removePartialData();
      }
      if (message.action === "reveal") {
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(download.target.path);
        file.reveal();
      }
      if (this.enabled && generation === this.generation && worker === this.worker) {
        this.track(download);
        this.snapshot();
      }
      reply(true);
    })().catch(() => reply(false));
  },

  closeTransport() {
    this.hub.reset();
    for (const pending of this.pocketPending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Связь с Island прервалась. Проверь, сохранён ли материал.")); }
    this.pocketPending.clear();
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    this.ready = false;
    this.capabilities.clear();
    if (this.worker) {
      this.post({type: "close"});
      this.worker = null;
    }
    this.port = null;
  },

  retryNow() {
    if (!this.enabled || this.ready) return;
    clearTimeout(this.retry);
    this.retry = null;
    this.closeTransport();
    this.retryDelay = 1000;
    this.setStatus("connecting");
    this.connect();
  },

  disconnected(reason = "connection-closed", code = 0) {
    this.closeTransport();
    if (!this.enabled) return;
    this.setStatus(["not-running", "connection-closed"].includes(reason) ? "waiting" : "unavailable", reason, code);
    if (this.retry !== null) return;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, this.retryDelay);
    this.retryDelay = Math.min(30000, this.retryDelay * 2);
  },

  stop() {
    this.enabled = false;
    this.generation++;
    clearTimeout(this.timer); clearTimeout(this.retry);
    this.timer = this.retry = null;
    this.list?.removeView(this);
    this.list = null;
    this.entries.clear(); this.ids = new WeakMap(); this.seen.clear();
    this.closeTransport();
    this.appearance = null;
    this.setStatus("disabled");
    Services.obs.notifyObservers(null, "night-island-appearance");
  },
};
