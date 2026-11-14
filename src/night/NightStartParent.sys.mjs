import {SearchService} from "moz-src:///toolkit/components/search/SearchService.sys.mjs";
import {NightIsland} from "resource:///modules/night/NightIsland.sys.mjs";

const PREFS = ["night.ui.palette", "night.island.appearance"];
const TOPICS = ["night-island-appearance", "browser-search-engine-modified"];

export class NightStartParent extends JSWindowActorParent {
  #observing = false;
  #observer = { observe: () => this.observe() };

  receiveMessage(message) {
    const browser = this.browsingContext.top.embedderElement;
    const window = browser?.ownerDocument.defaultView;
    if (message.name === "NightStart:Search") {
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
      });
      await SearchService.init();
      if (this.#observing) this.sendAsyncMessage("NightStart:SearchEngine", {engine: SearchService.defaultEngine?.name ?? ""});
    } catch (error) {
      if (this.#observing) console.error(error);
    }
  }

  didDestroy() {
    if (!this.#observing) return;
    this.#observing = false;
    for (const pref of PREFS) Services.prefs.removeObserver(pref, this.#observer);
    for (const topic of TOPICS) Services.obs.removeObserver(this.#observer, topic);
  }
}
