export class NightWindowControls {
  #window;
  #host;
  #container;
  #parent;
  #next;

  constructor(window) {
    this.#window = window;
    if (Services.appinfo.OS !== "WINNT") return;
    const doc = window.document;
    this.#container = doc.querySelector("#nav-bar > .titlebar-buttonbox-container");
    if (!this.#container) return;
    this.#parent = this.#container.parentNode;
    this.#next = this.#container.nextSibling;
    this.#host = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    this.#host.id = "night-window-controls";
    this.#host.setAttribute("aria-label", "Управление окном");
    this.#host.append(this.#container);
    doc.documentElement.append(this.#host);
    Services.prefs.addObserver("night.ui.window-controls-autohide", this);
    this.observe();
  }

  observe() {
    this.#host?.toggleAttribute("data-autohide", Services.prefs.getBoolPref("night.ui.window-controls-autohide", true));
  }

  destroy() {
    if (!this.#host) return;
    Services.prefs.removeObserver("night.ui.window-controls-autohide", this);
    this.#parent.insertBefore(this.#container, this.#next);
    this.#host.remove();
  }
}
