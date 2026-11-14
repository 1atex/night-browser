const XHTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";

export class NightWindowControls {
  #window;
  #host;
  #maximize;

  constructor(window) {
    this.#window = window;
    if (Services.appinfo.OS !== "WINNT") return;
    const doc = window.document;
    this.#host = doc.createElementNS(XHTML, "div");
    this.#host.id = "night-window-controls";
    this.#host.setAttribute("role", "group");
    this.#host.setAttribute("aria-label", "Управление окном");
    const buttons = doc.createElementNS(XHTML, "div");
    buttons.className = "night-caption-buttons";
    for (const [name, label, path] of [
      ["minimize", "Свернуть", "M3 8h10"],
      ["maximize", "Развернуть", "M3.5 3.5h9v9h-9z"],
      ["close", "Закрыть окно", "m4 4 8 8M12 4l-8 8"],
    ]) {
      const button = doc.createElementNS(XHTML, "button");
      button.type = "button";
      button.dataset.action = name;
      button.setAttribute("aria-label", label);
      button.title = label;
      const icon = doc.createElementNS(SVG, "svg");
      icon.setAttribute("viewBox", "0 0 16 16");
      icon.setAttribute("aria-hidden", "true");
      const shape = doc.createElementNS(SVG, "path");
      shape.setAttribute("d", path);
      icon.append(shape);
      button.append(icon);
      button.addEventListener("click", () => {
        const action = name === "maximize" && this.#isMaximized() ? "restore" : name;
        doc.getElementById(`cmd_${action}Window`).doCommand();
      });
      buttons.append(button);
      if (name === "maximize") this.#maximize = button;
    }
    this.#host.append(buttons);
    doc.documentElement.append(this.#host);
    Services.prefs.addObserver("night.ui.window-controls-autohide", this);
    window.addEventListener("sizemodechange", this);
    this.observe();
    this.handleEvent();
  }

  #isMaximized() {
    return this.#window.windowState === this.#window.STATE_MAXIMIZED;
  }

  handleEvent() {
    const maximized = this.#isMaximized();
    const label = maximized ? "Свернуть в окно" : "Развернуть";
    this.#maximize.setAttribute("aria-label", label);
    this.#maximize.title = label;
    this.#maximize.querySelector("path").setAttribute("d", maximized ? "M3.5 5.5h7v7h-7zM5.5 3.5h7v7" : "M3.5 3.5h9v9h-9z");
  }

  observe() {
    this.#host?.toggleAttribute("data-autohide", Services.prefs.getBoolPref("night.ui.window-controls-autohide", true));
  }

  destroy() {
    if (!this.#host) return;
    Services.prefs.removeObserver("night.ui.window-controls-autohide", this);
    this.#window.removeEventListener("sizemodechange", this);
    this.#host.remove();
  }
}
