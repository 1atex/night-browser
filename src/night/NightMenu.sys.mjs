const XHTML = "http://www.w3.org/1999/xhtml";

export class NightMenu {
  #window;
  #toolbar;
  #button;
  #panel;
  #zoom;
  #autohide;

  constructor(window, toolbar) {
    this.#window = window;
    this.#toolbar = toolbar;
    const doc = window.document;
    this.#button = doc.createXULElement("toolbarbutton");
    this.#button.id = "night-menu-button";
    this.#button.className = "toolbarbutton-1";
    this.#button.setAttribute("label", "Меню");
    this.#button.setAttribute("tooltiptext", "Меню");
    this.#button.setAttribute("aria-haspopup", "dialog");
    this.#button.setAttribute("aria-controls", "night-main-menu");
    this.#button.setAttribute("aria-expanded", "false");
    this.#button.setAttribute("tabindex", "0");
    this.#button.addEventListener("command", () => this.toggle());
    doc.getElementById("PanelUI-button").append(this.#button);
    this.#panel = doc.createXULElement("panel");
    this.#panel.id = "night-main-menu";
    this.#panel.setAttribute("type", "arrow");
    this.#panel.setAttribute("role", "dialog");
    this.#panel.setAttribute("aria-label", "Меню браузера");
    this.#panel.setAttribute("noautofocus", "true");
    this.#panel.setAttribute("norestorefocus", "true");
    this.#panel.setAttribute("consumeoutsideclicks", "false");
    const body = this.#element("div", "", { class: "night-menu-body" });
    const windows = this.#element("div", "", { class: "night-menu-windows" });
    windows.append(
      this.#action("window", "Новое окно", "", () => this.#command("cmd_newNavigator")),
      this.#action("private", "Приватное", "", () => this.#command("Tools:PrivateBrowsing")),
    );
    const library = this.#element("div", "", { class: "night-menu-group" });
    library.append(
      this.#action("history", "История", "Ctrl+Shift+H", () => window.PlacesCommandHook.showPlacesOrganizer("History")),
      this.#action("bookmark", "Закладки", "Ctrl+Shift+O", () => window.PlacesCommandHook.showPlacesOrganizer("AllBookmarks")),
      this.#action("download", "Загрузки", "Ctrl+J", () => this.#command("Tools:Downloads")),
      this.#action("extensions", "Расширения", "Ctrl+Shift+A", () => this.#command("Tools:Addons")),
    );
    const zoom = this.#element("div", "", { class: "night-menu-zoom" });
    this.#zoom = this.#action("", "100%", "", () => this.#zoomBy("cmd_fullZoomReset"), false);
    this.#zoom.id = "night-menu-zoom-reset";
    this.#zoom.setAttribute("title", "Сбросить масштаб · Ctrl+0");
    zoom.append(
      this.#element("span", "Масштаб"),
      this.#action("minus", "", "", () => this.#zoomBy("cmd_fullZoomReduce"), false, "Уменьшить масштаб"),
      this.#zoom,
      this.#action("plus", "", "", () => this.#zoomBy("cmd_fullZoomEnlarge"), false, "Увеличить масштаб"),
    );
    const page = this.#element("div", "", { class: "night-menu-group" });
    page.append(
      this.#action("search", "Найти на странице", "Ctrl+F", () => this.#command("cmd_find")),
      this.#action("print", "Печать", "Ctrl+P", () => this.#command("cmd_print")),
      this.#action("code", "Инструменты разработчика", "F12", () => {
        const { DevToolsShim } = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
        DevToolsShim.showToolboxForTab(window.gBrowser.selectedTab);
      }),
    );
    const layout = this.#element("div", "", { class: "night-menu-group" });
    this.#autohide = this.#action("toolbar", "Скрывать верхнюю панель", "", () => toolbar.toggleAutohide());
    this.#autohide.setAttribute("role", "switch");
    layout.append(
      this.#autohide,
      this.#action("focus", "Только сайт", "Alt+Shift+F", () => toolbar.toggleFocus()),
      this.#action("settings", "Настройки", "", () => window.gNightBrowser.openSettings("appearance")),
    );
    const footer = this.#element("div", "", { class: "night-menu-footer" });
    footer.append(
      this.#action("", "О браузере", "", () => window.gNightBrowser.openSettings("about")),
      this.#action("", "Выход", "", () => this.#command("cmd_quitApplication")),
    );
    body.append(windows, library, zoom, page, layout, footer);
    this.#panel.append(body);
    doc.getElementById("mainPopupSet").append(this.#panel);
    this.#panel.addEventListener("popupshown", this);
    this.#panel.addEventListener("popuphidden", this);
    window.addEventListener("keydown", this, true);
    window.addEventListener("FullZoomChange", this);
    window.addEventListener("FullZoomReset", this);
  }

  #element(tag, text, attributes = {}) {
    const node = this.#window.document.createElementNS(XHTML, tag);
    node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  #action(icon, label, shortcut, action, close = true, accessibleLabel = label) {
    const button = this.#element("button", "", { type: "button", "aria-label": accessibleLabel });
    if (icon) {
      const image = this.#element("span", "", { class: "night-menu-icon", "aria-hidden": "true" });
      image.style.setProperty("--menu-icon", `url("chrome://browser/content/night/icons/${icon}.svg")`);
      button.append(image);
    }
    if (label) button.append(this.#element("span", label, { class: "night-menu-label" }));
    if (shortcut) button.append(this.#element("kbd", shortcut));
    button.addEventListener("click", () => {
      if (close) this.#panel.hidePopup();
      action();
    });
    return button;
  }

  #command(id) {
    this.#window.document.getElementById(id).doCommand();
  }

  #zoomBy(command) {
    this.#command(command);
    this.#update();
  }

  #update() {
    const zoom = Math.round(this.#window.ZoomManager.zoom * 100);
    this.#zoom.querySelector(".night-menu-label").textContent = `${zoom}%`;
    this.#zoom.setAttribute("aria-label", `Масштаб ${zoom}%, сбросить`);
    this.#autohide.setAttribute("aria-checked", String(Services.prefs.getBoolPref("night.ui.toolbar-autohide", false)));
  }

  toggle() {
    if (["open", "showing"].includes(this.#panel.state)) {
      this.#panel.hidePopup();
      return;
    }
    this.#toolbar.reveal();
    this.#update();
    this.#panel.openPopup(this.#button, "bottomright topright", 0, 7);
  }

  handleEvent(event) {
    if (event.type === "popupshown") {
      this.#button.setAttribute("open", "true");
      this.#button.setAttribute("aria-expanded", "true");
      this.#panel.querySelector("button").focus();
    } else if (event.type === "popuphidden") {
      this.#button.removeAttribute("open");
      this.#button.setAttribute("aria-expanded", "false");
    } else if (event.type === "keydown") {
      if (this.#panel.state !== "open" || !this.#panel.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.#panel.hidePopup();
        this.#button.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const buttons = [...this.#panel.querySelectorAll("button:not(:disabled)")];
      const current = buttons.indexOf(this.#window.document.activeElement);
      const direction = event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey ? -1 : 1;
      const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + direction + buttons.length) % buttons.length;
      buttons[index].focus();
    } else {
      this.#update();
    }
  }

  destroy() {
    this.#window.removeEventListener("keydown", this, true);
    this.#window.removeEventListener("FullZoomChange", this);
    this.#window.removeEventListener("FullZoomReset", this);
    this.#panel.remove();
    this.#button.remove();
  }
}
