import { SessionStore } from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";
import { validIcon } from "resource:///modules/night/WorkspaceModel.mjs";

const ICONS = "chrome://browser/content/night/icons/";

export class NightAddress {
  #window;
  #icon;
  #source = "";

  constructor(window) {
    this.#window = window;
    const doc = window.document;
    this.#icon = doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
    this.#icon.id = "night-address-icon";
    this.#icon.alt = "";
    this.#icon.setAttribute("aria-hidden", "true");
    this.#icon.addEventListener("error", this);
    const input = doc.querySelector("#urlbar .urlbar-input-box");
    input.before(this.#icon);
    for (const event of ["TabSelect", "TabAttrModified", "SSTabRestored"])
      window.gBrowser.tabContainer.addEventListener(event, this);
    this.update();
  }

  handleEvent(event) {
    if (event.type === "error") {
      if (this.#icon.getAttribute("src") !== ICONS + "globe.svg")
        this.#icon.src = ICONS + "globe.svg";
    } else if (event.type === "TabSelect" || event.target === this.#window.gBrowser.selectedTab) {
      this.update();
    }
  }

  update() {
    const tab = this.#window.gBrowser.selectedTab;
    const url = tab.linkedBrowser.currentURI.spec;
    const saved = [tab.getAttribute("image"), SessionStore.getCustomTabValue(tab, "night-favicon")].find(validIcon);
    const source = saved ||
      (url.startsWith("about:preferences") ? ICONS + "settings.svg" :
       ["about:newtab", "about:home", "about:blank"].includes(url) ? ICONS + "search.svg" :
       /^https?:/.test(url) ? "page-icon:" + url : ICONS + "globe.svg");
    if (source !== this.#source) {
      this.#source = source;
      this.#icon.src = source;
    }
  }

  destroy() {
    for (const event of ["TabSelect", "TabAttrModified", "SSTabRestored"])
      this.#window.gBrowser.tabContainer.removeEventListener(event, this);
    this.#icon.removeEventListener("error", this);
    this.#icon.remove();
  }
}
