import { SessionStore } from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";

import { normalizeFolders, folderContains } from "resource:///modules/night/WorkspaceModel.mjs";

const KEY = "night-workspace";
const STATE = "night-workspaces";
const EVENTS = ["TabOpen", "TabSelect", "SSTabRestored", "SSWindowStateReady"];

export class NightWorkspaces {
  #window;
  #switching = false;
  #last = new Map();
  items = [{ id: "personal", name: "Личное" }, { id: "development", name: "Разработка" }];
  active = "personal";
  folders = [];

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
      this.folders = normalizeFolders(state.folders, this.items.map(item => item.id));
      this.active = this.items.some(item => item.id === state.active) ? state.active : this.items[0].id;
    } catch {}
  }

  #save() {
    SessionStore.setCustomWindowValue(this.#window, STATE, JSON.stringify({ items: this.items, active: this.active, folders: this.folders, layoutVersion: 2 }));
    this.#window.dispatchEvent(new this.#window.CustomEvent("NightWorkspacesChanged"));
  }

  workspaceOf(tab) {
    let id = SessionStore.getCustomTabValue(tab, KEY);
    if (!id) {
      id = this.active;
      SessionStore.setCustomTabValue(tab, KEY, id);
    }
    return id;
  }

  get tabs() {
    return [...this.#window.gBrowser.tabs].filter(tab => !tab.closing && (tab.pinned || this.workspaceOf(tab) === this.active));
  }

  adoptLayout(layout) {
    for (const item of layout.items) if (!this.items.some(existing => existing.id === item.id)) this.items.push(item);
    const incoming = new Set(layout.folders.map(folder => folder.id));
    this.folders = normalizeFolders([...this.folders.filter(folder => !incoming.has(folder.id)), ...layout.folders], this.items.map(item => item.id));
    this.#save();
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
    for (const folder of this.folders) if (folder.workspace === removed) folder.workspace = target;
    this.items = this.items.filter(item => item.id !== removed);
    this.switchTo(target);
  }

  folderOf(tab) {
    const id = SessionStore.getCustomTabValue(tab, "night-folder");
    return this.folders.find(folder => folder.id === id && folder.workspace === this.workspaceOf(tab))?.id ?? null;
  }

  isPinned(tab) {
    return tab.pinned || !!this.folderOf(tab) || SessionStore.getCustomTabValue(tab, "night-pinned") === "true";
  }

  position(node) {
    if (typeof node === "string") return this.folders.find(folder => folder.id === node)?.position ?? 0;
    const value = SessionStore.getCustomTabValue(node, "night-order");
    return value && Number.isFinite(Number(value)) ? Number(value) : node.index * 1024;
  }

  children(parentId = null, workspace = this.active) {
    return [
      ...this.folders.filter(folder => folder.workspace === workspace && folder.parentId === parentId).map(folder => folder.id),
      ...this.#window.gBrowser.tabs.filter(tab => !tab.closing && !tab.pinned && this.workspaceOf(tab) === workspace && this.folderOf(tab) === parentId),
    ].sort((a, b) => this.position(a) - this.position(b));
  }

  setPinned(tab, mode) {
    const browser = this.#window.gBrowser;
    if (mode === "global") {
      SessionStore.deleteCustomTabValue(tab, "night-folder");
      SessionStore.deleteCustomTabValue(tab, "night-pinned");
      browser.pinTab(tab);
    } else {
      if (tab.pinned) browser.unpinTab(tab);
      SessionStore.setCustomTabValue(tab, KEY, this.active);
      SessionStore.deleteCustomTabValue(tab, "night-folder");
      if (mode === "workspace") SessionStore.setCustomTabValue(tab, "night-pinned", "true");
      else SessionStore.deleteCustomTabValue(tab, "night-pinned");
    }
    this.switchTo(this.active);
  }

  createFolder(name, parentId = null) {
    name = name.trim().slice(0, 100);
    if (!name) return null;
    const parent = this.folders.find(folder => folder.id === parentId && folder.workspace === this.active);
    const id = Services.uuid.generateUUID().toString();
    this.folders.push({ id, name, workspace: this.active, parentId: parent?.id ?? null, collapsed: false,
      position: Math.max(0, ...this.children(parent?.id ?? null).map(node => this.position(node))) + 1024, icon: "" });
    this.#save();
    return id;
  }

  renameFolder(id, name) {
    const folder = this.folders.find(item => item.id === id);
    if (folder && name.trim()) { folder.name = name.trim().slice(0, 100); this.#save(); }
  }

  toggleFolder(id) {
    const folder = this.folders.find(item => item.id === id);
    if (folder) { folder.collapsed = !folder.collapsed; this.#save(); }
  }

  removeFolder(id) {
    const folder = this.folders.find(item => item.id === id);
    if (!folder) return;
    for (const child of this.folders) if (child.parentId === id) child.parentId = folder.parentId;
    for (const tab of this.#window.gBrowser.tabs)
      if (this.folderOf(tab) === id) {
        if (folder.parentId) SessionStore.setCustomTabValue(tab, "night-folder", folder.parentId);
        else SessionStore.deleteCustomTabValue(tab, "night-folder");
      }
    this.folders = this.folders.filter(item => item.id !== id);
    this.#save();
  }

  move(node, workspace, parentId = null, before = null) {
    if (before === node || !this.items.some(item => item.id === workspace)) return;
    const parent = this.folders.find(folder => folder.id === parentId && folder.workspace === workspace);
    if (parentId && !parent) return;
    if (typeof node === "string") {
      const folder = this.folders.find(item => item.id === node);
      if (!folder || folderContains(this.folders, node, parentId)) return;
      const descendants = new Set(this.folders.filter(item => folderContains(this.folders, node, item.id)).map(item => item.id));
      for (const tab of this.#window.gBrowser.tabs)
        if (descendants.has(this.folderOf(tab))) SessionStore.setCustomTabValue(tab, KEY, workspace);
      for (const child of this.folders) if (descendants.has(child.id)) child.workspace = workspace;
      folder.parentId = parentId;
    } else {
      if (!this.#window.gBrowser.tabs.includes(node) || node.closing) return;
      if (node.pinned) this.#window.gBrowser.unpinTab(node);
      for (const member of node.splitview?.tabs ?? [node]) {
        SessionStore.setCustomTabValue(member, KEY, workspace);
        if (parentId) {
          SessionStore.setCustomTabValue(member, "night-folder", parentId);
          SessionStore.setCustomTabValue(member, "night-pinned", "true");
        } else SessionStore.deleteCustomTabValue(member, "night-folder");
      }
      if (before && typeof before !== "string" && before !== node)
        this.#window.gBrowser.moveTabTo(node, { tabIndex: before.index });
    }
    const siblings = this.children(parentId, workspace).filter(item => item !== node);
    const index = siblings.indexOf(before);
    siblings.splice(index < 0 ? siblings.length : index, 0, node);
    siblings.forEach((item, i) => {
      if (typeof item === "string") this.folders.find(folder => folder.id === item).position = i * 1024;
      else SessionStore.setCustomTabValue(item, "night-order", String(i * 1024));
    });
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
