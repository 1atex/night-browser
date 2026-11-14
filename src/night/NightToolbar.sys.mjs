import { NightMenu } from "resource:///modules/night/NightMenu.sys.mjs";
import { NightAddress } from "resource:///modules/night/NightAddress.sys.mjs";

import { NightWindowControls } from "resource:///modules/night/NightWindowControls.sys.mjs";

const XHTML = "http://www.w3.org/1999/xhtml";

export class NightToolbar {
  #window;
  #root;
  #toolbox;
  #trigger;
  #observer;
  #sizeObserver;
  #timer = null;
  #inside = false;
  #popups = new Set();
  #focus = false;
  #menu;
  #address;
  #windowControls;

  constructor(window) {
    this.#window = window;
    const doc = window.document;
    this.#root = doc.documentElement;
    this.#toolbox = doc.getElementById("navigator-toolbox");
    this.#trigger = doc.createElementNS(XHTML, "button");
    this.#trigger.id = "night-toolbar-trigger";
    this.#trigger.setAttribute("type", "button");
    this.#trigger.setAttribute("aria-label", "Показать панель браузера · Ctrl+L");
    this.#root.append(this.#trigger);
    for (const node of [this.#trigger, this.#toolbox]) {
      node.addEventListener("pointerenter", this);
      node.addEventListener("pointerleave", this);
    }
    for (const type of ["focusin", "focusout", "popupshowing", "popuphidden", "keydown"])
      window.addEventListener(type, this, true);
    this.#observer = new window.MutationObserver(() => this.#update());
    this.#observer.observe(doc.getElementById("urlbar"), {
      attributes: true,
      attributeFilter: ["open", "popover-open", "focused"],
    });
    this.#observer.observe(this.#root, {
      attributes: true,
      attributeFilter: ["inFullscreen", "inDOMFullscreen", "customizing", "night-sidebar-collapsed"],
    });
    this.#sizeObserver = new window.ResizeObserver(() => {
      this.#root.style.setProperty("--night-navigation-height", `${Math.ceil(this.#toolbox.getBoundingClientRect().height)}px`);
    });
    this.#sizeObserver.observe(this.#toolbox);
    Services.prefs.addObserver("night.ui.", this);
    this.#menu = new NightMenu(window, this);
    this.#address = new NightAddress(window);
    this.#windowControls = new NightWindowControls(window);
    this.observe();
  }

  get automatic() {
    return (this.#focus || Services.prefs.getBoolPref("night.ui.toolbar-autohide", false) ||
      (Services.prefs.getStringPref("night.ui.navigation-layout", "sidebar") === "sidebar" && this.#root.hasAttribute("night-sidebar-collapsed"))) &&
      !this.#root.hasAttribute("inFullscreen") &&
      !this.#root.hasAttribute("inDOMFullscreen") &&
      !this.#root.hasAttribute("customizing");
  }

  observe() {
    this.#root.toggleAttribute("night-toolbar-auto", this.automatic);
    this.#root.toggleAttribute("night-sidebar-navigation", Services.prefs.getStringPref("night.ui.navigation-layout", "sidebar") === "sidebar" && !this.automatic && !this.#root.hasAttribute("inFullscreen") && !this.#root.hasAttribute("inDOMFullscreen") && !this.#root.hasAttribute("customizing"));
    this.#window.document.getElementById("nav-bar").overflowable?.setNightWrapped(this.#root.hasAttribute("night-sidebar-navigation"));
    const button = this.#window.document.getElementById("night-autohide-button");
    const enabled = Services.prefs.getBoolPref("night.ui.toolbar-autohide", false);
    button?.toggleAttribute("checked", enabled);
    button?.setAttribute("aria-pressed", String(enabled));
    if (!this.automatic) this.reveal();
    else this.#scheduleHide();
  }

  toggleAutohide() {
    Services.prefs.setBoolPref("night.ui.toolbar-autohide",
      !Services.prefs.getBoolPref("night.ui.toolbar-autohide", false));
    this.#window.gBrowser.selectedBrowser.focus();
    this.#inside = false;
    this.#scheduleHide();
  }

  toggleFocus() {
    this.#focus = !this.#focus;
    this.#root.toggleAttribute("night-focus-mode", this.#focus);
    for (const id of ["night-focus-button", "night-focus-exit"])
      this.#window.document.getElementById(id)?.setAttribute("aria-pressed", String(this.#focus));
    this.#window.gBrowser.selectedBrowser.focus();
    this.#inside = false;
    this.observe();
  }

  reveal() {
    this.#window.clearTimeout(this.#timer);
    this.#timer = null;
    this.#root.setAttribute("night-toolbar-visible", "true");
  }

  #held() {
    const doc = this.#window.document;
    const urlbar = doc.getElementById("urlbar");
    return this.#inside || this.#popups.size > 0 ||
      this.#toolbox.contains(doc.activeElement) ||
      this.#trigger === doc.activeElement ||
      urlbar.hasAttribute("open") || urlbar.hasAttribute("popover-open");
  }

  #scheduleHide() {
    this.#window.clearTimeout(this.#timer);
    this.#timer = this.#window.setTimeout(() => {
      this.#timer = null;
      if (this.automatic && !this.#held())
        this.#root.removeAttribute("night-toolbar-visible");
    }, 220);
  }

  #update() {
    this.#root.toggleAttribute("night-toolbar-auto", this.automatic);
    this.#root.toggleAttribute("night-sidebar-navigation", Services.prefs.getStringPref("night.ui.navigation-layout", "sidebar") === "sidebar" && !this.automatic && !this.#root.hasAttribute("inFullscreen") && !this.#root.hasAttribute("inDOMFullscreen") && !this.#root.hasAttribute("customizing"));
    this.#window.document.getElementById("nav-bar").overflowable?.setNightWrapped(this.#root.hasAttribute("night-sidebar-navigation"));
    if (!this.automatic || this.#held()) this.reveal();
    else this.#scheduleHide();
  }

  handleEvent(event) {
    if (event.type === "pointerenter") {
      this.#inside = true;
      this.reveal();
    } else if (event.type === "pointerleave") {
      this.#inside = false;
      this.#scheduleHide();
    } else if (event.type === "focusin") {
      if (this.#toolbox.contains(event.target) || event.target === this.#trigger)
        this.reveal();
    } else if (event.type === "focusout") {
      this.#scheduleHide();
    } else if (event.type === "popupshowing") {
      if (["panel", "menupopup"].includes(event.target.localName)) {
        this.#popups.add(event.target);
        this.#root.setAttribute("night-toolbar-popup", "true");
        this.reveal();
      }
    } else if (event.type === "popuphidden") {
      this.#popups.delete(event.target);
      this.#root.toggleAttribute("night-toolbar-popup", this.#popups.size > 0);
      this.#scheduleHide();
    } else if (event.type === "keydown") {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["l", "k"].includes(key) ||
          event.altKey && key === "d" || event.key === "F6") this.reveal();
      if (event.altKey && event.shiftKey && key === "f" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFocus();
      }
      if (event.key === "Escape" && this.automatic && this.#toolbox.contains(this.#window.document.activeElement) && !this.#popups.size) {
        this.#window.setTimeout(() => {
          this.#window.gURLBar.view.close();
          this.#window.gBrowser.selectedBrowser.focus();
          this.#inside = false;
          this.#scheduleHide();
        }, 0);
      }
    }
  }

  destroy() {
    this.#menu.destroy();
    this.#address.destroy();
    this.#windowControls.destroy();
    this.#window.clearTimeout(this.#timer);
    this.#observer.disconnect();
    this.#sizeObserver.disconnect();
    Services.prefs.removeObserver("night.ui.", this);
    for (const node of [this.#trigger, this.#toolbox]) {
      node.removeEventListener("pointerenter", this);
      node.removeEventListener("pointerleave", this);
    }
    for (const type of ["focusin", "focusout", "popupshowing", "popuphidden", "keydown"])
      this.#window.removeEventListener(type, this, true);
    this.#trigger.remove();
  }
}
