import {NightSuggestions} from "resource:///modules/night/NightSuggestions.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import {SearchService} from "moz-src:///toolkit/components/search/SearchService.sys.mjs";
import {NightIsland} from "resource:///modules/night/NightIsland.sys.mjs";

const PREFS = ["night.ui.palette", "night.island.appearance", "night.ui.animations"];
const TOPICS = ["night-island-appearance", "browser-search-engine-modified"];

export class NightStartParent extends JSWindowActorParent {
  #observing = false;
  #suggestions = null;
  #observer = { observe: () => this.observe() };

  receiveMessage(message) {
    const browser = this.browsingContext.top.embedderElement;
    const window = browser?.ownerDocument.defaultView;
    const active = window?.gBrowser?.selectedBrowser === browser;
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
    if (!this.#observing) {
      for (const pref of PREFS) Services.prefs.addObserver(pref, this.#observer);
      for (const topic of TOPICS) Services.obs.addObserver(this.#observer, topic);
      this.#observing = true;
    }
    this.observe();
    const focused = window?.document.activeElement;
    if (window?.gBrowser?.selectedBrowser === browser && !window.gURLBar.value &&
        (!focused || focused === browser || focused === window.gURLBar.inputField || focused.id === "night-new-tab")) {
      browser.focus();
      this.sendAsyncMessage("NightStart:Focus");
    }
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
    this.#suggestions?.cancel();
    this.#suggestions = null;
    if (!this.#observing) return;
    this.#observing = false;
    for (const pref of PREFS) Services.prefs.removeObserver(pref, this.#observer);
    for (const topic of TOPICS) Services.obs.removeObserver(this.#observer, topic);
  }
}
