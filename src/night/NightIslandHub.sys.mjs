import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import {SessionStore} from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";
import {PlacesUtils} from "resource://gre/modules/PlacesUtils.sys.mjs";
import {setTimeout, clearTimeout} from "resource://gre/modules/Timer.sys.mjs";
import {HUB_CAPABILITIES, cleanText, findTabs, validHubCommand, webURL} from "resource:///modules/night/IslandHub.mjs";

const EVENTS = ["TabAttrModified", "TabClose", "TabOpen", "TabSelect", "SSTabRestored", "NightWorkspacesChanged"];

export const NightIslandHub = {
  bridge: null,
  windows: new Map(),
  ids: new WeakMap(),
  query: null,
  ticket: 0,
  timer: null,
  lastActivity: "",
  requests: new Map(),
  init(bridge) { this.bridge = bridge; },
  enabled(name) { return Services.prefs.getBoolPref(`night.island.${name}`, false); },
  attach(window) {
    if (this.windows.has(window) || PrivateBrowsingUtils.isWindowPrivate(window)) return;
    const menu = window.document.getElementById("contentAreaContextMenu");
    const item = window.document.createXULElement("menuitem");
    item.id = "night-island-save";
    item.setAttribute("label", "Сохранить в Карман Island");
    let offered = null;
    const showing = () => {
      const context = window.gContextMenu, tab = window.gBrowser.selectedTab;
      offered = null;
      if (context && this.enabled("pocket")) {
        const source = webURL(tab.linkedBrowser.currentURI.spec);
        offered = {kind: "link", title: tab.label, url: source, source, text: ""};
        if (context.isContentSelected) offered = {...offered, kind: "text", text: context.selectionInfo?.fullText ?? ""};
        else if (context.onLink) offered = {...offered, url: context.linkURL, title: context.linkTextStr || context.linkURL};
        else if (context.onImage) offered = {...offered, kind: "image", url: context.mediaURL};
      }
      item.hidden = !offered;
      item.disabled = !this.bridge.ready || !this.bridge.capabilities.has("pocket");
    };
    item.addEventListener("command", () => {
      const value = offered;
      if (!value) return;
      this.bridge.savePocket(value).then(() => window.gNightBrowser?.shell.notify("Сохранено в Карман Island"))
        .catch(error => window.gNightBrowser?.shell.notify(error.message));
    });
    menu?.append(item);
    menu?.addEventListener("popupshowing", showing);
    const changed = () => this.schedule();
    for (const event of EVENTS) window.addEventListener(event, changed);
    this.windows.set(window, {item, menu, showing, changed});
    window.addEventListener("unload", () => this.detach(window), {once: true});
    this.schedule();
  },
  detach(window) {
    const binding = this.windows.get(window);
    if (!binding) return;
    for (const event of EVENTS) window.removeEventListener(event, binding.changed);
    binding.menu?.removeEventListener("popupshowing", binding.showing);
    binding.item.remove();
    this.windows.delete(window);
    this.schedule();
  },
  id(tab) {
    if (!this.ids.has(tab)) this.ids.set(tab, Services.uuid.generateUUID().toString());
    return this.ids.get(tab);
  },
  tabs() {
    const result = [];
    for (const window of this.windows.keys()) {
      if (window.closed || PrivateBrowsingUtils.isWindowPrivate(window) || !window.gNightBrowser) continue;
      const spaces = window.gNightBrowser.shell.workspaces;
      for (const tab of window.gBrowser.tabs) {
        if (tab.closing) continue;
        const url = tab.linkedBrowser.currentURI.spec;
        const names = [], visited = new Set();
        let folder = spaces.folderOf(tab);
        while (folder && !visited.has(folder)) {
          visited.add(folder);
          const item = spaces.folders.find(item => item.id === folder);
          if (!item) break;
          names.unshift(item.name); folder = item.parentId;
        }
        names.unshift(tab.pinned ? "Избранное" : spaces.items.find(item => item.id === spaces.workspaceOf(tab))?.name ?? "");
        const sharing = tab.linkedBrowser._sharingState?.webRTC ?? {};
        const activity = [tab.hasAttribute("soundplaying") ? "audio" : "", tab.hasAttribute("muted") ? "muted" : "",
          sharing.camera ? "camera" : "", sharing.microphone ? "microphone" : "", sharing.screen ? "screen" : ""].filter(Boolean);
        result.push({window, tab, id: this.id(tab), title: cleanText(tab.label, 160), path: cleanText(names.join(" / "), 160),
          url, host: (() => {try {return new URL(url).host;} catch {return "";}})(),
          sleeping: tab.hasAttribute("pending") || tab.hasAttribute("discarded"), activity,
          selected: window.gBrowser.selectedTab === tab, accessed: tab.lastAccessed || 0});
      }
    }
    return result;
  },
  publicTab(item, icon = "") {
    return {id: item.id, title: item.title, path: item.path, host: cleanText(item.host, 160), sleeping: item.sleeping, activity: item.activity, icon};
  },
  async icon(item) {
    try {
      let source = item.tab.getAttribute("image") || SessionStore.getCustomTabValue(item.tab, "night-favicon");
      if (!source?.startsWith("data:image/")) {
        const cached = await PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(item.url), 16);
        source = cached?.dataURI?.spec ?? "";
      }
      if (!source || source.length > 100000 || item.window.closed) return "";
      const img = new item.window.Image(); img.src = source;
      await img.decode();
      const canvas = item.window.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = canvas.height = 16;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 16, 16);
      const bytes = ctx.getImageData(0, 0, 16, 16).data;
      for (let i = 0; i < bytes.length; i += 4) {
        const red = bytes[i], alpha = bytes[i + 3] / 255;
        bytes[i] = Math.round(bytes[i + 2] * alpha); bytes[i + 1] = Math.round(bytes[i + 1] * alpha); bytes[i + 2] = Math.round(red * alpha);
      }
      return btoa(String.fromCharCode(...bytes));
    } catch { return ""; }
  },
  schedule() {
    if (!this.bridge?.ready || this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; this.activity(); if (this.query && this.enabled("tabs")) this.search(this.query); }, 350);
  },
  connected() {
    this.lastActivity = "";
    this.bridge.send(JSON.stringify({v: 1, type: "features", ...Object.fromEntries(HUB_CAPABILITIES.map(name => [name, this.enabled(name)]))}));
    this.activity();
  },
  reset() {
    clearTimeout(this.timer); this.timer = null;
    this.query = null; this.ticket++; this.requests.clear(); this.lastActivity = "";
  },
  async search(message) {
    this.query = message;
    const ticket = ++this.ticket;
    const found = this.enabled("tabs") ? findTabs(this.tabs(), message.query) : [];
    const items = await Promise.all(found.map(async item => this.publicTab(item, await this.icon(item))));
    if (ticket !== this.ticket || !this.bridge.ready) return;
    this.bridge.send(JSON.stringify({v: 1, type: "tabs", request: message.request, items}));
  },
  activity() {
    if (!this.bridge.ready || !this.bridge.capabilities.has("activity")) return;
    const tabs = this.enabled("activity") ? this.tabs().filter(item => item.activity.length).slice(0, 8).map(item => this.publicTab(item)) : [];
    const requests = [], alive = new Set();
    if (this.enabled("requests")) for (const window of this.windows.keys()) {
      if (window.closed || PrivateBrowsingUtils.isWindowPrivate(window)) continue;
      for (const record of window.gNightBrowser?.islandRequests ?? []) {
        let entry = [...this.requests].find(([, value]) => value.window === window && value.record === record);
        if (!entry) { entry = [Services.uuid.generateUUID().toString(), {window, record}]; this.requests.set(...entry); }
        alive.add(entry[0]);
        requests.push({id: entry[0], method: cleanText(record.method, 20), host: cleanText(new URL(record.url).host, 160)});
      }
    }
    for (const id of this.requests.keys()) if (!alive.has(id)) this.requests.delete(id);
    const text = JSON.stringify({v: 1, type: "activity", tabs, requests: requests.slice(0, 8)});
    if (text === this.lastActivity) return;
    this.lastActivity = text; this.bridge.send(text);
  },
  command(message) {
    if (!validHubCommand(message)) return false;
    if (message.type === "tab-query-end") { this.query = null; this.ticket++; return true; }
    if (message.type === "tab-query") { this.search(message).catch(console.error); return true; }
    let ok = false;
    try {
      if (message.type === "tab-action" && (this.enabled("tabs") || this.enabled("activity"))) {
        const item = this.tabs().find(item => item.id === message.id);
        if (item) {
          if (message.action === "focus") {
            const spaces = item.window.gNightBrowser.shell.workspaces;
            spaces.switchTo(spaces.workspaceOf(item.tab), item.tab);
            item.window.restore(); item.window.focus();
            ok = true;
          } else if (this.enabled("activity") && !item.sleeping && (item.activity.includes("audio") || item.activity.includes("muted"))) {
            item.tab.toggleMuteAudio(); ok = true;
          }
        }
      } else if (message.type === "request-action" && this.enabled("requests")) {
        const entry = this.requests.get(message.id);
        if (entry && !entry.window.closed) ok = entry.window.gNightBrowser?.islandRequestAction(entry.record.id, message.action) ?? false;
      } else if (message.type === "open-link" && this.enabled("pocket")) {
        const window = [...this.windows.keys()].find(window => !window.closed && !PrivateBrowsingUtils.isWindowPrivate(window));
        if (window) { window.openTrustedLinkIn(webURL(message.url), "tab"); window.restore(); window.focus(); ok = true; }
      }
    } catch (error) { console.error(error); }
    this.bridge.send(JSON.stringify({v: 1, type: "result", request: message.request, ok}));
    this.schedule();
    return true;
  },
};
