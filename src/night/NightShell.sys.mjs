import { NightWorkspaces } from "resource:///modules/night/NightWorkspaces.sys.mjs";
import { NightToolbar } from "resource:///modules/night/NightToolbar.sys.mjs";

import { SessionStore } from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";
import { validIcon } from "resource:///modules/night/WorkspaceModel.mjs";

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
  #tree;
  #folders = new Map();
  #folderVersion = null;
  #resize = null;
  #selector;
  #status;
  #menu;
  #filter;
  #empty;
  #frame = null;
  #dragged = null;
  #rows = new Map();
  #renderedWorkspace = null;
  workspaces;
  toolbar;

  constructor(window, owner) {
    this.#window = window;
    this.#owner = owner;
    this.workspaces = new NightWorkspaces(window);
    this.#build();
    this.toolbar = new NightToolbar(window);
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
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await action(event);
      } catch (error) {
        this.#report(error.message);
      }
    });
    return button;
  }

  #report(message) {
    this.#status.textContent = message;
    this.#status.setAttribute("data-message", "true");
  }

  #prompt(title, current, callback) {
    const value = { value: current };
    if (Services.prompt.prompt(this.#window, "Рабочие области", title, value, null, {}))
      callback(value.value);
  }

  #build() {
    const doc = this.#window.document;
    this.#sidebar = this.#element("aside", "", {
      id: "night-sidebar",
      "aria-label": "Вкладки",
    });
    const heading = this.#element("header", "", { class: "night-sidebar-header" });
    heading.append(

      this.#button("Новая вкладка", "Новая вкладка · Ctrl+T", () => this.workspaces.newTab(), {
        id: "night-new-tab",
      }),
      this.#button("", "Только сайт · Alt+Shift+F", () => this.toolbar.toggleFocus(), {
        id: "night-focus-button",
        "aria-pressed": "false",
      }),
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
      "aria-label": "Избранное во всех пространствах",
    });
    this.#tree = this.#element("div", "", {id: "night-folder-tree", "aria-label": "Папки и закрепления пространства"});
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
    this.#empty = this.#element("div", "", { id: "night-tab-empty", hidden: "" });
    this.#empty.append(
      this.#element("p", "Вкладки не найдены"),
      this.#button("Сбросить поиск", "Сбросить поиск", () => {
        this.#filter.value = "";
        this.#filter.focus();
        this.render();
      }),
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
        "Управление памятью",
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
      title: "Управление памятью",
    });
    this.#status.setAttribute("aria-live", "polite");
    this.#status.addEventListener("click", () => {this.#status.removeAttribute("data-message"); this.#owner.toggle("memory");});
    footer.append(actions, this.#status);
    if (!Services.prefs.getBoolPref("night.import.completed", false))
      footer.append(
        this.#button(
          "Импорт из Zen",
          "Импортировать данные Zen",
          () => this.#owner.openSettings("import"),
          { id: "night-import-button" },
        ),
      );
    const scroll = this.#element("div", "", {id: "night-tabs-scroll"});
    scroll.append(this.#pins, workspace, this.#tree, heading, this.#empty, this.#list);
    this.#sidebar.append(this.#filter, scroll, footer);
    const resize = this.#element("div", "", {id: "night-sidebar-resizer", role: "separator", tabindex: "0", "aria-orientation": "vertical", "aria-label": "Ширина боковой панели", "aria-valuemin": "240", "aria-valuemax": "420"});
    const setWidth = value => Services.prefs.setIntPref("night.ui.sidebar-width", Math.max(240, Math.min(420, Math.round(value))));
    resize.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      resize.setPointerCapture(event.pointerId);
      this.#resize = event.pointerId;
      doc.documentElement.setAttribute("night-resizing", "true");
    });
    resize.addEventListener("pointermove", event => {
      if (this.#resize === event.pointerId) setWidth(event.clientX - this.#sidebar.getBoundingClientRect().left);
    });
    resize.addEventListener("lostpointercapture", () => {this.#resize = null; doc.documentElement.removeAttribute("night-resizing");});
    resize.addEventListener("pointerup", event => {if (resize.hasPointerCapture(event.pointerId)) resize.releasePointerCapture(event.pointerId);});
    resize.addEventListener("keydown", event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const width = Services.prefs.getIntPref("night.ui.sidebar-width", 320);
        setWidth(event.key === "Home" ? 240 : event.key === "End" ? 420 : width + (event.key === "ArrowRight" ? 8 : -8));
      }
    });
    this.#sidebar.append(resize);
    this.#dropTarget(this.#tree, () => this.workspaces.move(this.#dragged, this.workspaces.active));
    this.#dropTarget(this.#list, () => {
      if (typeof this.#dragged !== "string") this.workspaces.setPinned(this.#dragged, "none");
      this.workspaces.move(this.#dragged, this.workspaces.active);
    });
    this.#dropTarget(this.#pins, () => {
      if (typeof this.#dragged !== "string") this.workspaces.setPinned(this.#dragged, "global");
    });
    workspace.addEventListener("dragenter", () => {
      if (!this.#dragged || doc.getElementById("night-workspace-drop")) return;
      const targets = this.#element("div", "", {id: "night-workspace-drop"});
      for (const item of this.workspaces.items) {
        const target = this.#button(item.name, `Перенести в «${item.name}»`, () => {});
        this.#dropTarget(target, () => this.workspaces.move(this.#dragged, item.id));
        targets.append(target);
      }
      workspace.after(targets);
    });
    doc.getElementById("browser").prepend(this.#sidebar);
    const toggle = doc.createXULElement("toolbarbutton");
    toggle.id = "night-sidebar-toggle";
    toggle.className = "toolbarbutton-1";
    toggle.setAttribute("label", "◧");
    toggle.setAttribute("tooltiptext", "Боковая панель · Alt+B");
    toggle.addEventListener("command", () => this.toggleSidebar());
    doc.getElementById("nav-bar-customization-target").prepend(toggle);
    const autohide = doc.createXULElement("toolbarbutton");
    autohide.id = "night-autohide-button";
    autohide.className = "toolbarbutton-1";
    autohide.setAttribute("tooltiptext", "Автоматически скрывать верхнюю панель");
    autohide.setAttribute("aria-label", "Автоматически скрывать верхнюю панель");
    autohide.addEventListener("command", () => this.toolbar.toggleAutohide());
    doc.getElementById("nav-bar-customization-target").append(autohide);
    const focusExit = doc.createXULElement("toolbarbutton");
    focusExit.id = "night-focus-exit";
    focusExit.className = "toolbarbutton-1";
    focusExit.setAttribute("tooltiptext", "Вернуть интерфейс · Alt+Shift+F");
    focusExit.setAttribute("aria-label", "Вернуть интерфейс · Alt+Shift+F");
    focusExit.addEventListener("command", () => this.toolbar.toggleFocus());
    doc.getElementById("nav-bar-customization-target").prepend(focusExit);
  }

  observe() {
    const root = this.#window.document.documentElement;
    const palette = Services.prefs.getStringPref(
      "night.ui.palette",
      "graphite",
    );
    root.setAttribute(
      "night-palette",
      ["night", "graphite", "midnight", "mist"].includes(palette) ? palette : "night",
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
      `${Math.max(240, Math.min(420, Services.prefs.getIntPref("night.ui.sidebar-width", 320)))}px`,
    );
    root.toggleAttribute("night-show-search", Services.prefs.getBoolPref("night.ui.show-tab-search", false));
    root.toggleAttribute("night-show-memory", Services.prefs.getBoolPref("night.ui.show-memory-status", false));
    root.toggleAttribute("night-show-tools", Services.prefs.getBoolPref("night.ui.show-tools", true));
    this.#window.document.getElementById("night-sidebar-resizer")?.setAttribute("aria-valuenow", String(Services.prefs.getIntPref("night.ui.sidebar-width", 320)));
  }

  toggleSidebar() {
    const root = this.#window.document.documentElement;
    root.toggleAttribute("night-sidebar-collapsed");
    this.toolbar.observe();
    if (!root.hasAttribute("night-sidebar-collapsed"))
      this.#animate(
        this.#sidebar,
        [
          { opacity: 0, transform: "translateX(-14px)" },
          { opacity: 1, transform: "none" },
        ],
        190,
      );
  }

  #animate(node, frames, duration = 170) {
    if (
      !this.#window.document.documentElement.hasAttribute("night-motion") ||
      this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return null;
    return node.animate(frames, {
      duration,
      easing: "cubic-bezier(.34,1.45,.64,1)",
    });
  }

  #isSaved(tab) {
    return this.workspaces.isPinned(tab) || !!this.workspaces.folderOf(tab);
  }

  async #closeTab(tab, remove = false) {
    if (!remove && this.#isSaved(tab)) {
      try {
        const unloaded = await this.#owner.memory.deactivate(tab);
        this.render();
        if (!unloaded) this.#report("Страница осталась открытой: выгрузка отменена или активен перехват запросов");
      } catch (error) { this.#report(error.message); }
      return;
    }
    const row = this.#rows.get(tab)?.row;
    if (row?.hasAttribute("data-closing")) return;
    row?.setAttribute("data-closing", "true");
    const animation =
      row &&
      this.#animate(
        row,
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "translateX(10px) scale(.98)" },
        ],
        115,
      );
    if (animation) await animation.finished.catch(() => {});
    if (!tab.closing) this.#window.gBrowser.removeTab(tab, { animate: false });
    row?.removeAttribute("data-closing");
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
            return action();
          },
          { role: "menuitem" },
        ),
      );
    this.#sidebar.append(this.#menu);
    const rect = anchor.getBoundingClientRect();
    this.#menu.style.top = `${Math.min(rect.bottom, this.#window.innerHeight - this.#menu.offsetHeight - 12)}px`;
    this.#menu.style.left = `${Math.min(rect.left, this.#window.innerWidth - this.#menu.offsetWidth - 12)}px`;
    this.#menu.querySelector("button")?.focus();
    this.#animate(
      this.#menu,
      [
        { opacity: 0, transform: "translateY(-5px) scale(.97)" },
        { opacity: 1, transform: "none" },
      ],
      150,
    );
  }

  #workspaceMenu(anchor) {
    this.#showMenu(anchor, [
      ["Новая папка", () => this.#prompt("Название папки", "", name => this.workspaces.createFolder(name))],
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
        this.workspaces.isPinned(tab) ? "Открепить" : "Закрепить в пространстве",
        () => this.workspaces.setPinned(tab, this.workspaces.isPinned(tab) ? "none" : "workspace"),
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
      ["В избранное всех пространств", () => this.workspaces.setPinned(tab, "global")],
      [this.#isSaved(tab) ? "Отправить в сон" : "Выгрузить сейчас", async () => {
        const unloaded = await (this.#isSaved(tab) ? this.#owner.memory.deactivate(tab) : this.#owner.memory.unload(tab));
        this.render();
        if (!unloaded) this.#report("Вкладка защищена, уже выгружена или страница не разрешила выгрузку");
      }],
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
    if (this.#isSaved(tab)) {
      items.push([this.workspaces.folderOf(tab) ? "Удалить из папки" : "Удалить закреплённую вкладку", () => this.#closeTab(tab, true)]);
    } else items.push(["Закрыть", () => this.#closeTab(tab)]);
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
      () => this.#closeTab(tab),
      { class: "night-tab-close" },
    );
    row.append(main, close);
    row.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.#closeTab(tab);
      }
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.#tabMenu(tab, main);
    });
    this.#draggable(row, tab);
    this.#dropTarget(row, () => {
      if (this.#dragged === tab) return;
      if (tab.pinned && typeof this.#dragged !== "string") {
        this.workspaces.setPinned(this.#dragged, "global");
        browser.moveTabTo(this.#dragged, {tabIndex: tab.index});
      } else {
        if (typeof this.#dragged !== "string" && !this.workspaces.folderOf(tab))
          this.workspaces.setPinned(this.#dragged, this.workspaces.isPinned(tab) ? "workspace" : "none");
        this.workspaces.move(this.#dragged, this.workspaces.workspaceOf(tab), this.workspaces.folderOf(tab), tab);
      }
    });
    return { row, main, icon, title, state, close };
  }

  #draggable(row, node) {
    row.draggable = true;
    row.addEventListener("dragstart", event => {
      this.#dragged = node;
      event.stopPropagation();
      event.dataTransfer.setData("text/x-night-node", "move");
      event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => this.#endDrag());
  }

  #endDrag() {
    this.#dragged = null;
    this.#window.document.getElementById("night-workspace-drop")?.remove();
    for (const node of this.#sidebar.querySelectorAll("[data-drag-over]")) node.removeAttribute("data-drag-over");
  }

  #dropTarget(node, action) {
    node.addEventListener("dragover", event => {
      if (!this.#dragged) return;
      event.preventDefault(); event.stopPropagation();
      node.setAttribute("data-drag-over", "true");
      event.dataTransfer.dropEffect = "move";
    });
    node.addEventListener("dragleave", event => {
      if (!node.contains(event.relatedTarget)) node.removeAttribute("data-drag-over");
    });
    node.addEventListener("drop", event => {
      if (!this.#dragged) return;
      event.preventDefault(); event.stopPropagation();
      try { action(event); } finally {this.#endDrag(); this.render();}
    });
  }

  #folder(folder) {
    let parts = this.#folders.get(folder.id);
    if (!parts) {
      const row = this.#element("section", "", {class: "night-folder", "data-folder": folder.id});
      const main = this.#button("", folder.name, () => this.workspaces.toggleFolder(folder.id), {class: "night-folder-main"});
      const chevron = this.#element("span", "›", {class: "night-folder-chevron", "aria-hidden": "true"});
      const icon = this.#element("span", "", {class: "night-folder-icon", "aria-hidden": "true"});
      const title = this.#element("span", "", {class: "night-tab-title"});
      const children = this.#element("div", "", {class: "night-folder-children"});
      children.id = `night-folder-${this.#folders.size}-${Date.now()}`;
      main.setAttribute("aria-controls", children.id);
      main.append(chevron, icon, title); row.append(main, children);
      this.#draggable(main, folder.id);
      this.#dropTarget(main, event => {
        const before = event.clientY > 0 && event.clientY - main.getBoundingClientRect().top < 10;
        this.workspaces.move(this.#dragged, folder.workspace, before ? folder.parentId : folder.id, before ? folder.id : null);
      });
      main.addEventListener("contextmenu", event => {
        event.preventDefault();
        this.#showMenu(main, [
          ["Новая папка внутри", () => this.#prompt("Название папки", "", name => this.workspaces.createFolder(name, folder.id))],
          ["Переименовать", () => this.#prompt("Название папки", folder.name, name => this.workspaces.renameFolder(folder.id, name))],
          ["На уровень выше", () => this.workspaces.move(folder.id, folder.workspace, this.workspaces.folders.find(item => item.id === folder.parentId)?.parentId ?? null)],
          ...this.workspaces.items.filter(item => item.id !== folder.workspace).map(item => [`В пространство «${item.name}»`, () => this.workspaces.move(folder.id, item.id)]),
          ["Удалить папку, сохранить вкладки", () => this.workspaces.removeFolder(folder.id)],
        ]);
      });
      parts = {row, main, title, children}; this.#folders.set(folder.id, parts);
    }
    parts.title.textContent = folder.name;
    parts.main.title = folder.name;
    parts.main.setAttribute("aria-label", folder.name);
    parts.main.setAttribute("aria-expanded", String(!folder.collapsed || !!this.#filter.value));
    parts.children.hidden = folder.collapsed && !this.#filter.value;
    return parts;
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
      const uri = tab.linkedBrowser.currentURI.spec;
      const internal = /^about:(home|newtab|preferences|blank)(?:[?#]|$)/.exec(uri);
      const label = internal
        ? internal[1] === "preferences" ? "Настройки" : "Новая вкладка"
        : SessionStore.getCustomTabValue(tab, "night-title") || (tab.label === "New Tab" ? "Новая вкладка" : tab.label);
      if (
        query &&
        !`${label} ${uri}`
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
      row.toggleAttribute("data-loading", tab.hasAttribute("busy"));
      row.toggleAttribute("data-selected", tab.selected);
      row.toggleAttribute("data-split", !!tab.splitview);
      row.toggleAttribute("data-sleeping", tab.hasAttribute("pending"));
      row.toggleAttribute("data-pinned", tab.pinned);
      main.setAttribute("aria-selected", String(tab.selected));
      main.title =
        label + (tab.hasAttribute("pending") ? " · выгружена" : "");
      main.setAttribute("aria-label", main.title);
      title.textContent = label;
      const live = tab.getAttribute("image");
      if (validIcon(live) && SessionStore.getCustomTabValue(tab, "night-favicon") !== live)
        SessionStore.setCustomTabValue(tab, "night-favicon", live);
      const image = internal
        ? `chrome://browser/content/night/icons/${internal[1] === "preferences" ? "settings" : "newtab"}.svg`
        : validIcon(live) ? live : SessionStore.getCustomTabValue(tab, "night-favicon");
      const fallback = /^https?:/.test(uri) ? `page-icon:${uri}` : "chrome://browser/content/night/icons/globe.svg";
      const source = validIcon(image) ? image : fallback;
      if (icon.dataset.image !== source) {
        const favicon = this.#element("img", "", {src: source, alt: "", width: "16", height: "16", referrerpolicy: "no-referrer"});
        favicon.addEventListener("error", () => { favicon.src = fallback; }, {once: true});
        icon.replaceChildren(favicon);
        icon.dataset.image = source;
      }
      state.textContent = tab.hasAttribute("pending")
        ? "Спит"
        : tab.soundPlaying
        ? "♪"
        : this.#owner.memory.isProtected(tab)
          ? "◇"
          : tab.splitview
              ? "◫"
              : "";
      const saved = this.#isSaved(tab);
      close.hidden = tab.pinned || (saved && tab.hasAttribute("pending"));
      close.title = saved ? "Отправить в сон" : "Закрыть вкладку";
      close.setAttribute("aria-label", close.title);
      if (tab.pinned) pins.push(row);
      else normal.push(tab);
    }
    this.#syncChildren(this.#pins, pins);
    const visible = new Set(normal);
    const folders = new Map(this.workspaces.folders.map(folder => [folder.id, folder]));
    if (this.#folderVersion !== this.workspaces.folders) {
      for (const parts of this.#folders.values()) parts.row.remove();
      this.#folders.clear();
      this.#folderVersion = this.workspaces.folders;
    }
    for (const [id, parts] of this.#folders) if (!folders.has(id)) {parts.row.remove(); this.#folders.delete(id);}
    const buildTree = parent => this.workspaces.children(parent).flatMap(node => {
      if (typeof node !== "string") return visible.has(node) && this.workspaces.isPinned(node) ? [this.#rows.get(node).row] : [];
      const folder = folders.get(node), parts = this.#folder(folder), children = buildTree(node);
      this.#syncChildren(parts.children, children);
      return query && !children.length && !folder.name.toLocaleLowerCase().includes(query) ? [] : [parts.row];
    });
    this.#syncChildren(this.#tree, buildTree(null));
    this.#syncChildren(this.#list, this.workspaces.children().filter(node => typeof node !== "string" && visible.has(node) && !this.workspaces.isPinned(node)).map(tab => this.#rows.get(tab).row));
    this.#empty.hidden = !query || pins.length + normal.length > 0;
    if (this.#renderedWorkspace !== this.workspaces.active) {
      this.#renderedWorkspace = this.workspaces.active;
      const colors = ["#c3ccd9", "#adbfe0", "#b7ccb9", "#d4b9b1", "#c6badb"];
      this.#sidebar.style.setProperty(
        "--workspace-color",
        colors[
          this.workspaces.items.findIndex(
            (item) => item.id === this.workspaces.active,
          ) % colors.length
        ],
      );
      this.#animate(
        this.#list,
        [
          { opacity: 0.35, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ],
        190,
      );
    }
    const all = [...browser.tabs].filter((tab) => !tab.closing);
    const sleeping = all.filter((tab) => tab.hasAttribute("pending")).length;
    if (!this.#status.hasAttribute("data-message")) this.#status.textContent = `Загружено: ${all.length - sleeping}${sleeping ? ` · выгружено: ${sleeping}` : ""}`;
    this.#window.document
      .getElementById("night-split-button")
      .setAttribute("aria-pressed", String(!!browser.selectedTab.splitview));
  }

  #syncChildren(parent, children) {
    const wanted = new Set(children);
    for (const child of [...parent.children])
      if (!wanted.has(child)) child.remove();
    children.forEach((child, index) => {
      const entering = !child.isConnected;
      if (parent.children[index] !== child)
        parent.insertBefore(child, parent.children[index] ?? null);
      if (entering && index < 20)
        this.#animate(
          child,
          [
            { opacity: 0, transform: "translateY(-5px) scale(.985)" },
            { opacity: 1, transform: "none" },
          ],
          180,
        );
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
        this.#window.document.documentElement.removeAttribute("night-search-open");
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
        this.#window.document.documentElement.setAttribute("night-search-open", "true");
        this.toolbar.observe();
        this.#filter.focus();
      }
      if (key === "b") this.toggleSidebar();
      if (key === "s") {
        try {
          this.split();
        } catch (error) {
          this.#report(error.message);
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
    this.toolbar.destroy();
    for (const event of EVENTS) this.#window.removeEventListener(event, this);
    this.#window.removeEventListener("keydown", this, true);
    this.#window.removeEventListener("click", this);
    if (this.#frame !== null) this.#window.cancelAnimationFrame(this.#frame);
    Services.prefs.removeObserver("night.ui.", this);
    this.workspaces.destroy();
    this.#sidebar.remove();
    this.#window.document.getElementById("night-sidebar-toggle")?.remove();
    this.#window.document.getElementById("night-autohide-button")?.remove();
    this.#window.document.getElementById("night-focus-exit")?.remove();
  }
}
