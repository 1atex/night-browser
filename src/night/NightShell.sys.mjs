import { NightWorkspaces } from "resource:///modules/night/NightWorkspaces.sys.mjs";

const XHTML = "http://www.w3.org/1999/xhtml";
const EVENTS = [
  "TabOpen",
  "TabClose",
  "TabSelect",
  "TabAttrModified",
  "TabMove",
  "TabPinned",
  "TabUnpinned",
  "TabShow",
  "TabHide",
  "TabBrowserDiscarded",
  "SSTabRestored",
  "SplitViewCreated",
  "SplitViewRemoved",
  "NightWorkspacesChanged",
];

export class NightShell {
  #window;
  #owner;
  #sidebar;
  #list;
  #pins;
  #selector;
  #status;
  #menu;
  #filter;
  #frame = null;
  #dragged = null;
  #rows = new Map();
  workspaces;

  constructor(window, owner) {
    this.#window = window;
    this.#owner = owner;
    this.workspaces = new NightWorkspaces(window);
    this.#build();
    Services.prefs.addObserver("night.ui.", this);
    this.observe();
    for (const event of EVENTS) window.addEventListener(event, this);
    window.addEventListener("keydown", this, true);
    window.addEventListener("click", this);
    this.render();
  }

  #element(tag, text = "", attrs = {}) {
    const element = this.#window.document.createElementNS(XHTML, tag);
    element.textContent = text;
    for (const [key, value] of Object.entries(attrs))
      element.setAttribute(key, value);
    return element;
  }

  #button(text, title, action, attrs = {}) {
    const button = this.#element("button", text, {
      type: "button",
      title,
      "aria-label": title,
      ...attrs,
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      try {
        action(event);
      } catch (error) {
        this.#status.textContent = error.message;
      }
    });
    return button;
  }

  #prompt(title, current, callback) {
    const value = { value: current };
    if (Services.prompt.prompt(this.#window, "Night", title, value, null, {}))
      callback(value.value);
  }

  #build() {
    const doc = this.#window.document;
    this.#sidebar = this.#element("aside", "", {
      id: "night-sidebar",
      "aria-label": "Вкладки Night",
    });
    const brand = this.#element("header", "", { class: "night-brand" });
    brand.append(
      this.#element("span", "◒", {
        class: "night-mark",
        "aria-hidden": "true",
      }),
      this.#element("strong", "night"),
      this.#element("span", "", { class: "night-wordmark" }),
    );
    const workspace = this.#element("div", "", {
      class: "night-workspace-row",
    });
    this.#selector = this.#element("select", "", {
      id: "night-workspace-select",
      "aria-label": "Рабочая область",
    });
    this.#selector.addEventListener("change", () =>
      this.workspaces.switchTo(this.#selector.value),
    );
    workspace.append(
      this.#selector,
      this.#button(
        "+",
        "Создать рабочую область",
        () =>
          this.#prompt("Название рабочей области", "", (name) =>
            this.workspaces.create(name),
          ),
        { id: "night-add-workspace" },
      ),
      this.#button("···", "Настройки рабочей области", (event) =>
        this.#workspaceMenu(event.currentTarget),
      ),
    );
    this.#filter = this.#element("input", "", {
      id: "night-tab-search",
      type: "search",
      placeholder: "Найти вкладку  ·  Alt+P",
      "aria-label": "Найти вкладку",
    });
    this.#filter.addEventListener("input", () => this.render());
    this.#pins = this.#element("div", "", {
      id: "night-pinned-tabs",
      "aria-label": "Закреплённые сайты",
    });
    this.#list = this.#element("div", "", {
      id: "night-tab-list",
      role: "tablist",
      "aria-orientation": "vertical",
      "aria-label": "Вкладки рабочей области",
    });
    this.#list.addEventListener("keydown", (event) => {
      const buttons = [...this.#list.querySelectorAll(".night-tab-main")];
      const index = buttons.indexOf(event.target);
      if (index < 0) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }
    });
    const newTab = this.#button(
      "+  Новая вкладка",
      "Новая вкладка · Ctrl+T",
      () => this.workspaces.newTab(),
      { id: "night-new-tab" },
    );
    const footer = this.#element("footer");
    const actions = this.#element("div", "", { class: "night-footer-actions" });
    actions.append(
      this.#button("◫", "Разделить экран · Alt+S", () => this.split(), {
        id: "night-split-button",
      }),
      this.#button(
        "⌘",
        "Запросы · Repeater и перехват",
        () => this.#owner.toggle("network"),
        { id: "night-network-button" },
      ),
      this.#button(
        "◇",
        "Память и настройки Night",
        () => this.#owner.toggle("memory"),
        { id: "night-tools-button" },
      ),
      this.#button(
        "⚙",
        "Настройки браузера",
        () => this.#owner.openSettings("appearance"),
        { id: "night-settings-button" },
      ),
    );
    this.#status = this.#element("button", "", {
      type: "button",
      id: "night-memory-status",
    });
    this.#status.addEventListener("click", () => this.#owner.toggle("memory"));
    footer.append(actions, this.#status);
    this.#sidebar.append(
      brand,
      this.#filter,
      this.#pins,
      newTab,
      this.#list,
      workspace,
      footer,
    );
    doc.getElementById("browser").prepend(this.#sidebar);
    const toggle = doc.createXULElement("toolbarbutton");
    toggle.id = "night-sidebar-toggle";
    toggle.className = "toolbarbutton-1";
    toggle.setAttribute("label", "◧");
    toggle.setAttribute("tooltiptext", "Боковая панель · Alt+B");
    toggle.addEventListener("command", () => this.toggleSidebar());
    doc.getElementById("nav-bar-customization-target").prepend(toggle);
  }

  observe() {
    const root = this.#window.document.documentElement;
    const palette = Services.prefs.getStringPref(
      "night.ui.palette",
      "graphite",
    );
    root.setAttribute(
      "night-palette",
      ["graphite", "midnight", "mist"].includes(palette) ? palette : "graphite",
    );
    root.setAttribute(
      "night-density",
      Services.prefs.getStringPref("night.ui.density", "comfortable"),
    );
    root.toggleAttribute(
      "night-motion",
      Services.prefs.getBoolPref("night.ui.animations", true),
    );
    root.style.setProperty(
      "--night-sidebar-width",
      `${Math.max(196, Math.min(280, Services.prefs.getIntPref("night.ui.sidebar-width", 232)))}px`,
    );
  }

  toggleSidebar() {
    const root = this.#window.document.documentElement;
    root.toggleAttribute("night-sidebar-collapsed");
  }

  #showMenu(anchor, actions) {
    this.#menu?.remove();
    this.#menu = this.#element("div", "", {
      id: "night-context-menu",
      role: "menu",
    });
    for (const [label, action] of actions)
      this.#menu.append(
        this.#button(
          label,
          label,
          () => {
            this.#menu?.remove();
            this.#menu = null;
            action();
          },
          { role: "menuitem" },
        ),
      );
    this.#sidebar.append(this.#menu);
    const rect = anchor.getBoundingClientRect();
    this.#menu.style.top = `${Math.min(rect.bottom, this.#window.innerHeight - this.#menu.offsetHeight - 12)}px`;
    this.#menu.style.left = `${Math.min(rect.left, this.#window.innerWidth - this.#menu.offsetWidth - 12)}px`;
    this.#menu.querySelector("button")?.focus();
  }

  #workspaceMenu(anchor) {
    this.#showMenu(anchor, [
      [
        "Переименовать",
        () =>
          this.#prompt(
            "Название рабочей области",
            this.workspaces.items.find(
              (item) => item.id === this.workspaces.active,
            ).name,
            (name) => this.workspaces.rename(name),
          ),
      ],
      ["Удалить область, сохранить вкладки", () => this.workspaces.remove()],
    ]);
  }

  #tabMenu(tab, anchor) {
    const browser = this.#window.gBrowser;
    const items = [
      [
        tab.pinned ? "Открепить" : "Закрепить для всех областей",
        () => (tab.pinned ? browser.unpinTab(tab) : browser.pinTab(tab)),
      ],
      [
        this.#owner.memory.isProtected(tab)
          ? "Разрешить выгрузку"
          : "Не выгружать эту вкладку",
        () => {
          this.#owner.memory.protect(tab, !this.#owner.memory.isProtected(tab));
          this.render();
        },
      ],
      ["Открыть рядом с текущей", () => this.split(tab)],
      ["Дублировать", () => this.#window.duplicateTabIn(tab, "tab")],
      [
        tab.muted ? "Включить звук" : "Выключить звук",
        () => tab.toggleMuteAudio(),
      ],
    ];
    if (!tab.pinned)
      for (const item of this.workspaces.items) {
        if (item.id !== this.workspaces.active)
          items.push([
            `В область «${item.name}»`,
            () => this.workspaces.move(tab, item.id),
          ]);
      }
    items.push(["Закрыть", () => browser.removeTab(tab, { animate: false })]);
    this.#showMenu(anchor, items);
  }

  split(other = null) {
    const browser = this.#window.gBrowser;
    const current = browser.selectedTab;
    if (current.splitview && !other) {
      current.splitview.unsplitTabs();
      this.render();
      return;
    }
    if (current.pinned)
      throw new Error("Для разделения экрана сначала открепи текущую вкладку.");
    if (!other || other === current)
      other = this.workspaces.tabs.find(
        (tab) => tab !== current && !tab.pinned && !tab.splitview,
      );
    if (!other) other = this.workspaces.newTab();
    if (other.pinned)
      throw new Error("Для разделения экрана сначала открепи вторую вкладку.");
    current.splitview?.unsplitTabs();
    other.splitview?.unsplitTabs();
    browser.addTabSplitView([current, other]);
    browser.selectedTab = other;
    browser.selectedTab = current;
    this.render();
  }

  #row(tab) {
    const browser = this.#window.gBrowser;
    const row = this.#element("div", "", {
      class: "night-tab",
      draggable: "true",
    });
    const main = this.#button(
      "",
      tab.label,
      () => {
        browser.selectedTab = tab;
      },
      { class: "night-tab-main", role: "tab" },
    );
    const icon = this.#element("span", "", {
      class: "night-tab-icon",
      "aria-hidden": "true",
    });
    const title = this.#element("span", "", { class: "night-tab-title" });
    const state = this.#element("span", "", {
      class: "night-tab-state",
      "aria-hidden": "true",
    });
    main.append(icon, title, state);
    const close = this.#button(
      "×",
      "Закрыть вкладку",
      () => browser.removeTab(tab, { animate: false }),
      { class: "night-tab-close" },
    );
    row.append(main, close);
    row.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        browser.removeTab(tab, { animate: false });
      }
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.#tabMenu(tab, main);
    });
    row.addEventListener("dragstart", (event) => {
      this.#dragged = tab;
      event.dataTransfer.setData("text/x-night-tab", "tab");
      event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (event) => {
      if (this.#dragged && this.#dragged !== tab) {
        event.preventDefault();
        row.setAttribute("data-drag-over", "true");
      }
    });
    row.addEventListener("dragleave", () =>
      row.removeAttribute("data-drag-over"),
    );
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.removeAttribute("data-drag-over");
      if (this.#dragged && this.#dragged.pinned === tab.pinned)
        browser.moveTabTo(this.#dragged, { tabIndex: tab.index });
      this.#dragged = null;
    });
    row.addEventListener("dragend", () => {
      this.#dragged = null;
    });
    return { row, main, icon, title, state, close };
  }

  render() {
    const browser = this.#window.gBrowser;
    const query = this.#filter.value.trim().toLocaleLowerCase();
    if (
      JSON.stringify(this.workspaces.items) !== this.#selector.dataset.items
    ) {
      this.#selector.replaceChildren(
        ...this.workspaces.items.map((item) =>
          this.#element("option", item.name, { value: item.id }),
        ),
      );
      this.#selector.dataset.items = JSON.stringify(this.workspaces.items);
    }
    this.#selector.value = this.workspaces.active;
    const tabs = this.workspaces.tabs;
    for (const [tab, parts] of this.#rows)
      if (!browser.tabs.includes(tab) || tab.closing) {
        parts.row.remove();
        this.#rows.delete(tab);
      }
    const pins = [],
      normal = [];
    for (const tab of tabs) {
      if (
        query &&
        !`${tab.label} ${tab.linkedBrowser.currentURI.spec}`
          .toLocaleLowerCase()
          .includes(query)
      )
        continue;
      let parts = this.#rows.get(tab);
      if (!parts) {
        parts = this.#row(tab);
        this.#rows.set(tab, parts);
      }
      const { row, main, icon, title, state, close } = parts;
      row.toggleAttribute("data-selected", tab.selected);
      row.toggleAttribute("data-split", !!tab.splitview);
      row.toggleAttribute("data-sleeping", tab.hasAttribute("pending"));
      row.toggleAttribute("data-pinned", tab.pinned);
      main.setAttribute("aria-selected", String(tab.selected));
      main.title =
        tab.label + (tab.hasAttribute("pending") ? " · выгружена" : "");
      main.setAttribute("aria-label", main.title);
      title.textContent = tab.label === "New Tab" ? "Новая вкладка" : tab.label;
      const image = tab.hasAttribute("busy") ? "" : tab.getAttribute("image");
      if (
        image &&
        /^(data:image\/|https?:|page-icon:|moz-anno:favicon:)/.test(image)
      ) {
        if (icon.dataset.image !== image) {
          icon.replaceChildren(
            this.#element("img", "", {
              src: image,
              alt: "",
              width: "16",
              height: "16",
            }),
          );
          icon.dataset.image = image;
        }
      } else {
        delete icon.dataset.image;
        icon.textContent = tab.hasAttribute("busy")
          ? "◌"
          : tab.pinned
            ? (tab.label || "N").slice(0, 1).toUpperCase()
            : "◈";
      }
      state.textContent = tab.soundPlaying
        ? "♪"
        : this.#owner.memory.isProtected(tab)
          ? "◇"
          : tab.hasAttribute("pending")
            ? "z"
            : tab.splitview
              ? "◫"
              : "";
      close.hidden = tab.pinned;
      (tab.pinned ? pins : normal).push(row);
    }
    this.#syncChildren(this.#pins, pins);
    this.#syncChildren(this.#list, normal);
    const all = [...browser.tabs].filter((tab) => !tab.closing);
    const sleeping = all.filter((tab) => tab.hasAttribute("pending")).length;
    this.#status.textContent = `${all.length - sleeping} активных · ${sleeping} спят`;
    this.#window.document
      .getElementById("night-split-button")
      .setAttribute("aria-pressed", String(!!browser.selectedTab.splitview));
  }

  #syncChildren(parent, children) {
    const wanted = new Set(children);
    for (const child of [...parent.children])
      if (!wanted.has(child)) child.remove();
    children.forEach((child, index) => {
      if (parent.children[index] !== child)
        parent.insertBefore(child, parent.children[index] ?? null);
    });
  }

  handleEvent(event) {
    if (event.type === "click") {
      if (this.#menu && !this.#menu.contains(event.target)) {
        this.#menu.remove();
        this.#menu = null;
      }
      return;
    }
    if (event.type === "keydown") {
      if (event.key === "Escape") {
        this.#menu?.remove();
        this.#menu = null;
        this.#filter.value = "";
        this.render();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (!["p", "b", "s"].includes(key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "p") {
        this.#window.document.documentElement.removeAttribute(
          "night-sidebar-collapsed",
        );
        this.#filter.focus();
      }
      if (key === "b") this.toggleSidebar();
      if (key === "s") {
        try {
          this.split();
        } catch (error) {
          this.#status.textContent = error.message;
        }
      }
      return;
    }
    if (this.#frame === null)
      this.#frame = this.#window.requestAnimationFrame(() => {
        this.#frame = null;
        this.render();
      });
  }

  destroy() {
    for (const event of EVENTS) this.#window.removeEventListener(event, this);
    this.#window.removeEventListener("keydown", this, true);
    this.#window.removeEventListener("click", this);
    if (this.#frame !== null) this.#window.cancelAnimationFrame(this.#frame);
    Services.prefs.removeObserver("night.ui.", this);
    this.workspaces.destroy();
    this.#sidebar.remove();
    this.#window.document.getElementById("night-sidebar-toggle")?.remove();
  }
}

function windowOpen(window, url) {
  window.openTrustedLinkIn(url, "tab");
}
