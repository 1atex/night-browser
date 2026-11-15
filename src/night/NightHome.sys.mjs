import {homeWidgets} from "resource:///modules/night/HomeModel.mjs";
import {NightIsland} from "resource:///modules/night/NightIsland.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";

const EVENTS = ["TabClose", "TabOpen", "TabAttrModified", "TabSelect", "SSTabRestored", "NightWorkspacesChanged"];
const TOPICS = ["night-island-status", "night-island-downloads"];

export class NightHome {
  #actor;
  #window;
  #listening = false;
  #timer = null;
  #tabs = new Map();
  #previous = "";
  constructor(actor) {
    this.#actor = actor;
    this.#window = actor.browsingContext.top.embedderElement?.ownerDocument.defaultView;
  }
  get active() { return this.#window?.gBrowser?.selectedBrowser === this.#actor.browsingContext.top.embedderElement; }
  setVisible(visible) {
    visible = visible && this.active;
    if (visible === this.#listening) { if (visible) this.update(); return; }
    this.#listening = visible;
    for (const event of EVENTS) this.#window?.[visible ? "addEventListener" : "removeEventListener"](event, this);
    for (const topic of TOPICS) Services.obs[visible ? "addObserver" : "removeObserver"](this, topic);
    Services.prefs[visible ? "addObserver" : "removeObserver"]("night.home.widgets", this);
    Services.prefs[visible ? "addObserver" : "removeObserver"]("night.island.", this);
    if (visible) this.update();
    else {
      this.#window?.clearTimeout(this.#timer); this.#timer = null;
      this.#tabs.clear(); this.#previous = "";
    }
  }
  handleEvent() { this.observe(); }
  observe() {
    if (this.#timer !== null) return;
    this.#timer = this.#window.setTimeout(() => { this.#timer = null; this.update(); }, 120);
  }
  update() {
    if (!this.active || !this.#listening) { this.setVisible(false); return; }
    const window = this.#window, spaces = window.gNightBrowser?.shell.workspaces;
    let enabled;
    try { enabled = homeWidgets(JSON.parse(Services.prefs.getStringPref("night.home.widgets", "null"))); } catch { enabled = homeWidgets(null); }
    const isPrivate = PrivateBrowsingUtils.isWindowPrivate(window);
    this.#tabs.clear();
    let tabs = [], loaded = 0, sleeping = 0;
    if (enabled.includes("tabs") && spaces) {
      const items = spaces.tabs.filter(tab => !/^about:(newtab|home|blank)$/.test(tab.linkedBrowser.currentURI.spec));
      for (const tab of items) tab.hasAttribute("pending") ? sleeping++ : loaded++;
      tabs = items.sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, 3).map(tab => {
        const id = tab.linkedPanel; this.#tabs.set(id, tab);
        return {id, title: tab.label.slice(0, 120), sleeping: tab.hasAttribute("pending")};
      });
    }
    const data = {enabled, tabs, loaded, sleeping, workspace: spaces?.items.find(item => item.id === spaces.active)?.name ?? "Вкладки",
      island: enabled.includes("island") ? {private: isPrivate, connected: !isPrivate && NightIsland.ready,
        status: isPrivate ? "Недоступен в приватном окне" : NightIsland.ready ? "Подключён" : NightIsland.status === "disabled" ? "Интеграция выключена" : "Ожидаем подключение",
        pocket: !isPrivate && NightIsland.ready && NightIsland.hub.enabled("pocket") && NightIsland.capabilities.has("pocket"),
        tabs: !isPrivate && NightIsland.ready && NightIsland.hub.enabled("tabs") && NightIsland.capabilities.has("tabs"),
        downloads: !isPrivate && NightIsland.ready && Services.prefs.getBoolPref("night.island.downloads", false) && NightIsland.capabilities.has("show-downloads")} : null};
    const key = JSON.stringify(data);
    if (key !== this.#previous) { this.#previous = key; this.#actor.sendAsyncMessage("NightStart:Home", data); }
  }
  receive(name, data) {
    if (!this.active) return;
    if (name === "NightStart:Widgets") {
      if (Array.isArray(data?.enabled) && data.enabled.length <= 4) Services.prefs.setStringPref("night.home.widgets", JSON.stringify(homeWidgets(data.enabled)));
    } else if (name === "NightStart:HomeAction") {
      const window = this.#window, spaces = window.gNightBrowser?.shell.workspaces;
      if (data?.action === "tab") {
        const tab = this.#tabs.get(data.id);
        if (tab?.isConnected && !tab.closing) spaces.switchTo(spaces.workspaceOf(tab), tab);
      } else if (data?.action === "memory") window.openPreferences("memory");
      else if (data?.action === "integrations") window.openPreferences("integrations");
      else if (!PrivateBrowsingUtils.isWindowPrivate(window)) {
        if (["browser", "pocket"].includes(data?.action)) {
          const capability = data.action === "browser" ? "tabs" : "pocket";
          if (NightIsland.hub.enabled(capability)) NightIsland.openPanel(data.action);
        } else if (data?.action === "downloads" && Services.prefs.getBoolPref("night.island.downloads", false)) NightIsland.openDownloads();
      }
    }
  }
  destroy() { this.setVisible(false); this.#tabs.clear(); this.#actor = null; this.#window = null; }
}
