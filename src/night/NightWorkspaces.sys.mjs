import { SessionStore } from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";

const KEY = "night-workspace";
const STATE = "night-workspaces";
const EVENTS = ["TabOpen", "TabSelect", "SSTabRestored", "SSWindowStateReady"];

export class NightWorkspaces {
  #window;
  #switching = false;
  #last = new Map();
  items = [{ id: "personal", name: "Личное" }, { id: "development", name: "Разработка" }];
  active = "personal";

  constructor(window) {
    this.#window = window;
    this.#restore();
    for (const tab of window.gBrowser.tabs) this.workspaceOf(tab);
    for (const event of EVENTS) window.addEventListener(event, this);
    this.switchTo(this.active);
  }

  #restore() {
    try {
      const state = JSON.parse(SessionStore.getCustomWindowValue(this.#window, STATE));
      if (!Array.isArray(state.items) || !state.items.length || state.items.length > 1000) return;
      if (state.items.some(item => typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim())) return;
      if (new Set(state.items.map(item => item.id)).size !== state.items.length) return;
      this.items = state.items.map(item => ({ id: item.id, name: item.name.slice(0, 40) }));
      this.active = this.items.some(item => item.id === state.active) ? state.active : this.items[0].id;
    } catch {}
  }

  #save() {
    SessionStore.setCustomWindowValue(this.#window, STATE, JSON.stringify({ items: this.items, active: this.active }));
    this.#window.dispatchEvent(new this.#window.CustomEvent("NightWorkspacesChanged"));
  }

  workspaceOf(tab) {
    let id = SessionStore.getCustomTabValue(tab, KEY);
    if (!this.items.some(item => item.id === id)) {
      id = this.active;
      SessionStore.setCustomTabValue(tab, KEY, id);
    }
    return id;
  }

  get tabs() {
    return [...this.#window.gBrowser.tabs].filter(tab => !tab.closing && (tab.pinned || this.workspaceOf(tab) === this.active));
  }

  create(name) {
    name = name.trim().slice(0, 40);
    if (!name) return null;
    if (this.items.length >= 20) throw new Error("Можно создать до 20 рабочих областей.");
    const id = Services.uuid.generateUUID().toString();
    this.items.push({ id, name });
    this.switchTo(id);
    return id;
  }

  rename(name) {
    name = name.trim().slice(0, 40);
    if (!name) return;
    this.items.find(item => item.id === this.active).name = name;
    this.#save();
  }

  remove() {
    if (this.items.length < 2) throw new Error("Нужна хотя бы одна рабочая область.");
    const removed = this.active;
    const target = this.items.find(item => item.id !== removed).id;
    for (const tab of this.#window.gBrowser.tabs) {
      if (this.workspaceOf(tab) === removed) SessionStore.setCustomTabValue(tab, KEY, target);
    }
    this.items = this.items.filter(item => item.id !== removed);
    this.switchTo(target);
  }

  move(tab, id) {
    if (!this.items.some(item => item.id === id) || tab.pinned) return;
    for (const member of tab.splitview?.tabs ?? [tab]) SessionStore.setCustomTabValue(member, KEY, id);
    this.switchTo(this.active);
  }

  newTab(url = "about:newtab") {
    const tab = this.#window.gBrowser.addTrustedTab(url);
    SessionStore.setCustomTabValue(tab, KEY, this.active);
    this.#window.gBrowser.selectedTab = tab;
    if (url === "about:newtab") this.#window.gURLBar.focus();
    return tab;
  }

  switchTo(id) {
    if (this.#switching || !this.items.some(item => item.id === id)) return;
    this.#switching = true;
    const browser = this.#window.gBrowser;
    try {
      const previous = browser.selectedTab;
      if (previous && !previous.pinned && this.workspaceOf(previous) === this.active) this.#last.set(this.active, previous);
      this.active = id;
      const candidates = this.tabs;
      let selected = this.#last.get(id);
      if (!candidates.includes(selected)) selected = candidates.find(tab => !tab.pinned);
      if (!selected && previous?.pinned) selected = previous;
      if (!selected) selected = this.newTab();
      for (const tab of this.tabs) browser.showTab(tab);
      browser.selectedTab = selected;
      for (const tab of browser.tabs) {
        if (!tab.pinned && this.workspaceOf(tab) !== id) browser.hideTab(tab, "night");
      }
      this.#save();
    } finally {
      this.#switching = false;
    }
  }

  handleEvent(event) {
    if (this.#switching) return;
    if (event.type === "SSWindowStateReady") {
      this.#restore();
      this.switchTo(this.active);
    } else if (event.type === "TabSelect") {
      const tab = event.target;
      if (!tab.pinned && this.workspaceOf(tab) !== this.active) {
        this.#last.set(this.workspaceOf(tab), tab);
        this.switchTo(this.workspaceOf(tab));
      }
    } else if (event.type === "TabOpen") {
      this.workspaceOf(event.target);
    } else if (event.type === "SSTabRestored") {
      const tab = event.target;
      if (!tab.pinned && this.workspaceOf(tab) !== this.active) this.#window.gBrowser.hideTab(tab, "night");
    }
  }

  destroy() {
    for (const event of EVENTS) this.#window.removeEventListener(event, this);
  }
}
