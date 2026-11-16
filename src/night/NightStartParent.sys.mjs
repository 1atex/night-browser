import {NightSuggestions} from "resource:///modules/night/NightSuggestions.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import {SearchService} from "moz-src:///toolkit/components/search/SearchService.sys.mjs";
import {NightIsland} from "resource:///modules/night/NightIsland.sys.mjs";
import {NightHome} from "resource:///modules/night/NightHome.sys.mjs";

const PREFS = ["night.ui.palette", "night.island.appearance", "night.ui.animations"];
const TOPICS = ["night-island-appearance", "browser-search-engine-modified"];

export class NightStartParent extends JSWindowActorParent {
  #observing = false;
  #ready = false;
  #suggestions = null;
  #home = null;
  #observer = { observe: () => this.observe() };

  receiveMessage(message) {
    const browser = this.browsingContext.top.embedderElement;
    const window = browser?.ownerDocument.defaultView;
    const active = window?.gBrowser?.selectedBrowser === browser;
    if (message.name === "NightStart:Visible") {
      const visible = active && message.data?.visible === true;
      this.#setObserving(visible);
      this.#home?.setVisible(visible);
      if (visible) this.observe();
      if (!message.data?.visible) this.#suggestions?.cancel();
      return;
    }
    if (["NightStart:Widgets", "NightStart:HomeAction", "NightStart:Shortcuts", "NightStart:Gradient"].includes(message.name)) {
      this.#home?.receive(message.name, message.data); return;
    }
    if (message.name === "NightStart:Cancel") { this.#suggestions?.cancel(); return; }
    if (message.name === "NightStart:Suggest") {
      const {text, serial} = message.data ?? {};
      if (!active || typeof text !== "string" || !text.trim() || text.length > 1024 || !Number.isSafeInteger(serial)) return;
      this.#suggestions ??= new NightSuggestions();
      this.#suggestions.query(text, {isPrivate: PrivateBrowsingUtils.isWindowPrivate(window), userContextId: Number(browser.getAttribute("usercontextid")) || 0}, items => {
        if (window?.gBrowser?.selectedBrowser === browser) this.sendAsyncMessage("NightStart:Suggestions", {serial, items});
      });
      return;
    }
    if (message.name === "NightStart:Pick") {
      const item = this.#suggestions?.get(message.data?.id);
      if (!active || !item) return;
      this.#suggestions.cancel();
      if (item.kind === "search") {
        const engine = SearchService.getEngineByName(item.engine) ?? SearchService.defaultEngine;
        const submission = engine?.getSubmission(item.value, null, "homepage");
        if (submission) window.openTrustedLinkIn(submission.uri.spec, "current", {postData: submission.postData});
      } else if (/^https?:/.test(item.value)) {
        const target = item.kind === "tab" && [...window.gBrowser.tabs].find(tab => tab !== window.gBrowser.selectedTab && tab.linkedBrowser.currentURI.spec === item.value && tab.userContextId === window.gBrowser.selectedTab.userContextId);
        if (target) window.gNightBrowser.shell.workspaces.switchTo(window.gNightBrowser.shell.workspaces.workspaceOf(target), target);
        else window.openTrustedLinkIn(item.value, "current");
      }
      return;
    }
    if (message.name === "NightStart:Search") {
      this.#suggestions?.cancel();
      const query = message.data?.query;
      if (window?.gBrowser?.selectedBrowser !== browser || typeof query !== "string" || !query.trim() || query.length > 4096) return;
      window.gURLBar.value = query.trim();
      window.gURLBar.handleCommand();
      return;
    }
    if (message.name !== "NightStart:Ready") return;
    this.#setObserving(active);
    if (active) this.observe();
    this.#home ??= new NightHome(this);
    this.#home.setVisible(active);
    this.#ready = true;
    this.focusInput();
  }

  #setObserving(value) {
    if (value === this.#observing) return;
    this.#observing = value;
    for (const pref of PREFS) Services.prefs[value ? "addObserver" : "removeObserver"](pref, this.#observer);
    for (const topic of TOPICS) Services.obs[value ? "addObserver" : "removeObserver"](this.#observer, topic);
  }

  focusInput() {
    const browser = this.browsingContext.top.embedderElement, window = browser?.ownerDocument.defaultView;
    if (!this.#ready || window?.gBrowser?.selectedBrowser !== browser) return;
    const focused = window.document.activeElement;
    if (window.gURLBar.focused && window.gURLBar.value && !["about:newtab", "about:home"].includes(window.gURLBar.value)) return;
    if (focused && focused !== browser && !window.gURLBar.contains(focused) &&
        !focused.closest?.("#night-sidebar, #tabbrowser-tabs, #PanelUI-popup, #night-main-menu")) return;
    window.gURLBar.view.close();
    browser.focus();
    this.sendAsyncMessage("NightStart:Focus");
  }

  async observe() {
    try {
      this.sendAsyncMessage("NightStart:Appearance", {
        palette: Services.prefs.getStringPref("night.ui.palette", "night"),
        appearance: NightIsland.sharedAppearance,
        motion: Services.prefs.getBoolPref("night.ui.animations", true),
      });
      await SearchService.init();
      if (this.#observing) this.sendAsyncMessage("NightStart:SearchEngine", {engine: SearchService.defaultEngine?.name ?? ""});
    } catch (error) {
      if (this.#observing) console.error(error);
    }
  }

  didDestroy() {
    this.#home?.destroy();
    this.#home = null;
    this.#suggestions?.cancel();
    this.#suggestions = null;
    this.#setObserving(false);
  }
}
