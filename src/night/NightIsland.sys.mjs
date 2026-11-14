import { Downloads } from "resource://gre/modules/Downloads.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { MAX_DOWNLOADS, MAX_FRAME, downloadItem, allowedActions, validCommand } from "resource:///modules/night/IslandDownloads.mjs";

export const NightIsland = {
  initialized: false,
  enabled: false,
  status: "disabled",
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
  lastSnapshot: "",
  connectionTimer: null,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    Services.prefs.addObserver("night.island.downloads", this);
    Services.obs.addObserver(this, "quit-application-granted");
    this.observe();
  },

  observe(_subject, topic) {
    if (topic === "quit-application-granted") {
      this.stop();
      return;
    }
    const enabled = Services.appinfo.OS === "WINNT" && Services.prefs.getBoolPref("night.island.downloads", false);
    if (enabled === this.enabled) return;
    this.stop();
    if (enabled) this.start().catch(error => { console.error(error); this.setStatus("unavailable"); });
  },

  setStatus(status) {
    this.status = status;
    Services.obs.notifyObservers(null, "night-island-status", status);
  },

  async start() {
    this.enabled = true;
    this.setStatus("connecting");
    const generation = this.generation;
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
    this.send(text);
  },

  connect() {
    if (!this.enabled || this.worker) return;
    const {ctypes} = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const {libc, win32} = ChromeUtils.importESModule("resource://gre/modules/subprocess/subprocess_win.sys.mjs");
    const port = libc.CreateIoCompletionPort(win32.INVALID_HANDLE_VALUE, win32.NULL_HANDLE_VALUE, 0, 1);
    if (port.isNull()) { this.disconnected(); return; }
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
          this.worker = null; this.port = null; this.disconnected();
        }
        return;
      }
      if (this.worker !== worker) return;
      if (message.type === "connected") {
        this.send(JSON.stringify({v: 1, type: "hello", capabilities: ["downloads"]}));
      } else if (message.type === "frame") {
        try { this.receive(JSON.parse(message.text)); } catch { this.disconnected(); }
      }
    };
    worker.onerror = event => {
      event.preventDefault(); worker.terminate(); release();
      if (this.worker === worker) { this.worker = null; this.port = null; this.disconnected(); }
    };
    this.post({type: "init", port: String(ctypes.cast(port, ctypes.uintptr_t).value)});
    this.connectionTimer = setTimeout(() => { if (!this.ready) this.disconnected(); }, 5000);
  },

  post(message) {
    if (!this.worker) return;
    const {libc, win32} = this.native;
    this.worker.postMessage(message);
    libc.PostQueuedCompletionStatus(this.port, 0, 1, win32.OVERLAPPED.ptr(0));
  },

  send(text) {
    if (new TextEncoder().encode(text).length >= MAX_FRAME) return;
    this.post({type: "send", text: text + "\n"});
  },

  receive(message) {
    if (!this.ready) {
      if (message.v !== 1 || message.type !== "hello" || !message.capabilities?.includes("downloads")) {
        this.disconnected(); return;
      }
      clearTimeout(this.connectionTimer);
      this.ready = true;
      this.retryDelay = 1000;
      this.lastSnapshot = "";
      this.seen.clear();
      this.setStatus("connected");
      this.snapshot();
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
      reply(true);
      if (this.enabled && generation === this.generation) this.track(download);
    })().catch(() => reply(false));
  },

  closeTransport() {
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    this.ready = false;
    if (this.worker) {
      this.post({type: "close"});
      this.worker = null;
    }
    this.port = null;
  },

  disconnected() {
    this.closeTransport();
    if (!this.enabled) return;
    this.setStatus("waiting");
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
    this.setStatus("disabled");
  },
};
