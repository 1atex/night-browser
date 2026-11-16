import { SessionStore } from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";
import { validIcon } from "resource:///modules/night/WorkspaceModel.mjs";
import {internalPage} from "resource:///modules/night/InternalPages.mjs";

const ICONS = "chrome://browser/content/night/icons/";

export class NightAddress {
  #window;
  #icon;
  #source = "";
  #bar;
  #label;
  #animation = null;
  #closing = false;
  #timer = null;
  #actions;
  #popup;

  #motion() {
    return Services.prefs.getBoolPref("night.ui.animations", true) && !this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      this.#window.document.documentElement.getAttribute("data-island-motion") !== "false";
  }

  #expand() {
    this.#window.clearTimeout(this.#timer);
    this.#bar.setAttribute("night-address-editing", "true");
    if (!this.#window.document.documentElement.hasAttribute("night-sidebar-navigation")) return;
    if (this.#bar.hasAttribute("night-address-expanded") && !this.#closing) return;
    this.#closing = false;
    this.#animation?.cancel();
    const rect = this.#window.document.getElementById("urlbar-container").getBoundingClientRect();
    const left = Math.max(8, rect.left), top = rect.top;
    const width = Math.min(640, this.#window.innerWidth - left - 16);
    this.#bar.style.setProperty("--night-address-left", `${left}px`);
    this.#bar.style.setProperty("--night-address-top", `${top}px`);
    this.#bar.style.setProperty("--night-address-width", `${width}px`);
    this.#bar.style.setProperty("--night-address-rest-width", `${rect.width}px`);
    this.#bar.setAttribute("night-address-expanded", "true");
    if (this.#motion()) this.#animation = this.#bar.animate([{width: `${rect.width}px`, opacity: .9}, {width: `${width}px`, opacity: 1}], {duration: 170, easing: "cubic-bezier(.2,.8,.2,1)"});
  }

  #collapse() {
    this.#window.clearTimeout(this.#timer);
    if (this.#closing) return;
    this.#animation?.cancel();
    const finish = () => {
      this.#closing = false;
      this.#bar.removeAttribute("night-address-editing");
      this.#bar.removeAttribute("night-address-expanded");
    };
    if (!this.#bar.hasAttribute("night-address-expanded") || !this.#motion()) { finish(); return; }
    this.#closing = true;
    const width = this.#bar.getBoundingClientRect().width;
    this.#animation = this.#bar.animate([{width: `${width}px`}, {width: this.#bar.style.getPropertyValue("--night-address-rest-width")}], {duration: 140, easing: "cubic-bezier(.4,0,.2,1)"});
    this.#animation.onfinish = finish;
  }

  constructor(window) {
    this.#window = window;
    const doc = window.document;
    this.#icon = doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
    this.#icon.id = "night-address-icon";
    this.#icon.alt = "";
    this.#icon.setAttribute("aria-hidden", "true");
    this.#icon.addEventListener("error", this);
    this.#bar = doc.getElementById("urlbar");
    for (const type of ["pointerdown", "input", "focusin", "focusout"]) this.#bar.addEventListener(type, this);
    window.addEventListener("keydown", this, true);
    const input = doc.querySelector("#urlbar .urlbar-input-box");
    this.#label = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    this.#label.id = "night-address-page";
    this.#label.setAttribute("aria-hidden", "true");
    input.before(this.#icon, this.#label);
    this.#actions = doc.createXULElement("toolbarbutton");
    this.#actions.id = "night-page-actions";
    this.#actions.className = "urlbar-icon";
    this.#actions.setAttribute("tooltiptext", "Действия со страницей");
    this.#actions.setAttribute("aria-label", "Действия со страницей");
    this.#actions.setAttribute("aria-haspopup", "dialog");
    this.#actions.addEventListener("command", () => this.#showActions());
    doc.getElementById("page-action-buttons").append(this.#actions);
    this.#popup = doc.createXULElement("panel");
    this.#popup.id = "night-page-menu";
    this.#popup.setAttribute("type", "arrow");
    this.#popup.setAttribute("role", "dialog");
    this.#popup.setAttribute("aria-label", "Действия со страницей");
    doc.getElementById("mainPopupSet").append(this.#popup);
    this.#popup.addEventListener("popuphidden", () => {
      this.#actions.setAttribute("aria-expanded", "false");
      this.#popup.replaceChildren();
    });
    for (const event of ["TabSelect", "TabAttrModified", "SSTabRestored"])
      window.gBrowser.tabContainer.addEventListener(event, this);
    this.update();
  }

  handleEvent(event) {
    if (event.type === "keydown") {
      const key = event.key.toLowerCase();
      if (((event.ctrlKey || event.metaKey) && ["l", "k"].includes(key)) ||
          (event.altKey && key === "d") || event.key === "F6") {
        this.#bar.setAttribute("night-address-editing", "true");
        this.#timer = this.#window.setTimeout(() => { if (this.#window.gURLBar.focused) this.#expand(); }, 0);
      }
      if (event.key === "Escape" && !event.isComposing && this.#bar.contains(this.#window.document.activeElement)) {
        event.preventDefault(); event.stopPropagation();
        this.#window.gURLBar.handleRevert();
        this.#window.gURLBar.view.close();
        this.#window.gBrowser.selectedBrowser.focus();
        this.#collapse();
      }
    } else if (event.type === "focusin") {
      if (this.#bar.hasAttribute("night-address-editing")) this.#expand();
    } else if (["pointerdown", "input"].includes(event.type)) {
      if (event.target.closest?.("#night-page-actions")) return;
      this.#expand();
    } else if (event.type === "focusout") {
      if (!this.#bar.contains(event.relatedTarget)) {
        this.#timer = this.#window.setTimeout(() => {
          if (!this.#bar.contains(this.#window.document.activeElement)) this.#collapse();
        }, 0);
      }
    } else if (event.type === "error") {
      if (this.#icon.getAttribute("src") !== ICONS + "globe.svg")
        this.#icon.src = ICONS + "globe.svg";
    } else if (event.type === "TabSelect" || event.target === this.#window.gBrowser.selectedTab) {
      if (event.type === "TabSelect") this.#collapse();
      this.update();
    }
  }

  #showActions() {
    if (this.#popup.state !== "closed") { this.#popup.hidePopup(); return; }
    const w = this.#window, doc = w.document;
    const body = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    body.className = "night-menu-body";
    const add = (label, action) => {
      const button = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      button.type = "button"; button.textContent = label;
      button.addEventListener("click", event => { this.#popup.hidePopup(); action(event); });
      body.append(button);
    };
    add("Разрешения сайта", event => {
      w.gPermissionPanel.setAnchor(this.#actions, "bottomright topright");
      w.gPermissionPanel.openPopup(event);
      doc.getElementById("permission-popup")?.addEventListener("popuphidden", () => w.gPermissionPanel.setAnchor(null, "bottomleft topleft"), {once: true});
    });
    add(doc.getElementById("star-button").hasAttribute("starred") ? "Изменить закладку" : "Добавить в закладки", () => w.PlacesCommandHook.bookmarkPage());
    const zoom = Math.round(w.ZoomManager.zoom * 100);
    add(`Масштаб ${zoom}% · сбросить`, () => doc.getElementById("cmd_fullZoomReset").doCommand());
    add("Информация о странице", () => w.BrowserCommands.pageInfo());
    this.#popup.replaceChildren(body);
    this.#actions.setAttribute("aria-expanded", "true");
    this.#popup.openPopup(this.#actions, "bottomright topright");
  }

  update() {
    const tab = this.#window.gBrowser.selectedTab;
    const url = tab.linkedBrowser.currentURI.spec;
    const internal = internalPage(url);
    const page = url === "chrome://browser/content/night/welcome.xhtml" ? "Первый запуск" : internal?.[0] ?? "";
    if (this.#label.textContent !== page) this.#label.textContent = page;
    this.#bar.toggleAttribute("night-internal-page", !!page);
    const saved = [tab.getAttribute("image"), SessionStore.getCustomTabValue(tab, "night-favicon")].find(validIcon);
    const source = internal ? ICONS + internal[1] + ".svg" : saved ||
      (url.startsWith("about:preferences") ? ICONS + "settings.svg" :
       ["about:newtab", "about:home", "about:blank"].includes(url) ? ICONS + "search.svg" :
       /^https?:/.test(url) ? "page-icon:" + url : ICONS + "globe.svg");
    if (source !== this.#source) {
      this.#source = source;
      this.#icon.src = source;
    }
  }

  destroy() {
    this.#window.clearTimeout(this.#timer);
    this.#animation?.cancel();
    this.#bar.removeAttribute("night-address-expanded");
    for (const event of ["TabSelect", "TabAttrModified", "SSTabRestored"])
      this.#window.gBrowser.tabContainer.removeEventListener(event, this);
    for (const type of ["pointerdown", "input", "focusin", "focusout"]) this.#bar.removeEventListener(type, this);
    this.#window.removeEventListener("keydown", this, true);
    this.#icon.removeEventListener("error", this);
    this.#icon.remove();
    this.#label.remove();
    this.#popup.remove();
    this.#actions.remove();
    this.#bar.removeAttribute("night-internal-page");
  }
}
