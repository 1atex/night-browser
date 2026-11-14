/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { NightWindows } from "resource:///modules/night/NightWindows.sys.mjs";
import { NightShell } from "resource:///modules/night/NightShell.sys.mjs";
import { NightMemory } from "resource:///modules/night/NightMemory.sys.mjs";

ChromeUtils.registerWindowActor("NightStart", {
  parent: { esModuleURI: "resource:///modules/night/NightStartParent.sys.mjs" },
  child: {
    esModuleURI: "resource:///modules/night/NightStartChild.sys.mjs",
    events: { DOMContentLoaded: {} },
  },
  matches: ["about:home", "about:newtab"],
});

const XHTML = "http://www.w3.org/1999/xhtml";

class NightWindow {
  #window;
  #panel = null;
  #section = "memory";
  #network = null;
  #destroyed = false;
  #refreshNetwork = () => {};
  #refreshTab = () => {};
  memory;

  constructor(window) {
    this.#window = window;
    window.document.documentElement.setAttribute("night-browser", "true");
    this.memory = new NightMemory(
      window,
      (tab) => this.#network?.protectsTab(tab) ?? false,
    );
    this.shell = new NightShell(window, this);
    NightWindows.init();
    window.gBrowser.tabContainer.addEventListener("TabSelect", this);
    window.addEventListener("unload", () => this.destroy(), { once: true });
  }

  handleEvent() {
    this.#refreshTab();
  }

  #element(tag, text = "", attrs = {}) {
    const element = this.#window.document.createElementNS(XHTML, tag);
    element.textContent = text;
    for (const [name, value] of Object.entries(attrs))
      element.setAttribute(name, value);
    return element;
  }

  #button(text, action) {
    const button = this.#element("button", text, { type: "button" });
    button.addEventListener("click", async () => {
      try {
        await action();
      } catch (error) {
        this.#status(error.message, true);
      }
    });
    return button;
  }

  #field(parent, text, element) {
    const label = this.#element("label", text);
    label.append(element);
    parent.append(label);
    return element;
  }

  #status(message, error = false) {
    const status = this.#panel?.querySelector("[role=status]");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("night-error", error);
  }

  openSettings(section = "appearance") {
    this.#window.openPreferences(section);
  }

  toggle(section = "network") {
    if (section === "memory") {
      this.openSettings("memory");
      return;
    }
    if (this.#destroyed) return;
    if (this.#panel) {
      this.close();
      return;
    }
    const doc = this.#window.document;
    doc.documentElement.setAttribute("night-workbench", "true");
    this.#panel = this.#element("section", "", {
      id: "night-tools",
      "aria-label": "Сетевые инструменты",
    });
    const heading = this.#element("header", "", {
      class: "night-workbench-header",
    });
    const identity = this.#element("div", "", {
      class: "night-workbench-identity",
    });
    identity.append(this.#element("h2", "Запросы"));
    const close = this.#button("×", () => this.close());
    close.setAttribute("aria-label", "Закрыть сетевые инструменты");
    heading.append(
      identity,
      this.#element("p", "Перехват и Repeater в текущей вкладке"),
      close,
    );
    const content = this.#element("div", "", { class: "night-network-layout" });
    this.#panel.append(
      heading,
      content,
      this.#element("p", "", {
        class: "night-status",
        role: "status",
        "aria-live": "polite",
      }),
    );
    doc.getElementById("browser").append(this.#panel);
    this.#buildNetwork(content).catch((error) =>
      this.#status(error.message, true),
    );
  }

  async #buildNetwork(parent) {
    const { NightNetwork } = ChromeUtils.importESModule(
      "resource:///modules/night/NightNetwork.sys.mjs",
    );
    const { compareResponses } = ChromeUtils.importESModule(
      "resource:///modules/night/RequestModel.mjs",
    );
    if (!this.#panel) return;
    this.#network = new NightNetwork(this.#window, () =>
      this.#refreshNetwork(),
    );
    const capture = this.#element("div", "", { class: "night-capture" });
    const editor = this.#element("div", "", { class: "night-editor" });
    const reply = this.#element("div", "", { class: "night-reply" });
    capture.append(this.#element("h3", "Захват"));
    editor.append(this.#element("h3", "Запрос"));
    reply.append(this.#element("h3", "Ответ"));
    parent.append(capture, editor, reply);
    const intercept = this.#field(
      capture,
      "Останавливать запросы перед отправкой",
      this.#element("input", "", { type: "checkbox" }),
    );
    const actions = this.#element("div", "", { class: "night-row" });
    const scope = this.#element("p");
    actions.append(
      this.#button("Начать", () => {
        const tab = this.#window.gBrowser.selectedTab;
        this.#network.start(tab, intercept.checked);
        scope.textContent = `Вкладка: ${tab.label}`;
        this.#status("Захват включён. Воспроизведи действие на странице.");
      }),
      this.#button("Остановить", () => {
        this.#network.stop();
        scope.textContent = "Захват выключен.";
      }),
    );
    capture.append(actions, scope);
    const list = this.#field(
      capture,
      "Запросы",
      this.#element("select", "", { size: "5" }),
    );
    const requestLine = this.#element("div", "", {
      class: "night-request-line",
    });
    editor.append(requestLine);
    const method = this.#field(
      requestLine,
      "Метод",
      this.#element("input", "", { value: "GET" }),
    );
    const url = this.#field(
      requestLine,
      "URL",
      this.#element("input", "", { type: "url" }),
    );
    const headers = this.#field(
      editor,
      "Заголовки",
      this.#element("textarea", "", {
        class: "night-code",
        spellcheck: "false",
      }),
    );
    const body = this.#field(
      editor,
      "Тело запроса",
      this.#element("textarea", "", {
        class: "night-code",
        spellcheck: "false",
      }),
    );
    let selected = null,
      lastResponse = null;
    const read = () => ({
      method: method.value,
      url: url.value,
      headers: headers.value,
      body: body.disabled ? null : body.value,
    });
    const response = this.#element("pre", "", {
      class: "night-code night-response",
      tabindex: "0",
    });
    const buttons = this.#element("div", "", { class: "night-row" });
    const forward = this.#button("Пропустить", () => {
      if (selected) this.#network.forward(selected.id, read());
    });
    const abort = this.#button("Отбросить", () => {
      if (selected) this.#network.abort(selected.id);
    });
    const replay = this.#button("Отправить копию", async () => {
      replay.disabled = true;
      const service = this.#network;
      try {
        const result = await service.replay(read(), selected?.url);
        if (service !== this.#network) return;
        this.#status(
          `${result.status} · ${result.duration} ms${result.truncated ? " · ответ обрезан до 1 MiB" : ""}\n${compareResponses(lastResponse, result)}`,
        );
        response.textContent = `${result.headers}\n\n${result.body}`;
        lastResponse = result;
      } finally {
        replay.disabled = false;
      }
    });
    buttons.append(forward, abort, replay);
    editor.append(buttons);
    reply.append(response);
    response.textContent = "Отправь запрос, чтобы увидеть ответ.";
    const updateButtons = () => {
      const paused = this.#network.pending.some(
        (item) => item.id === selected?.id,
      );
      forward.disabled = !paused;
      abort.disabled = !paused;
    };
    const selectRequest = () => {
      selected = [
        ...this.#network.pending,
        ...this.#network.history.items,
      ].find((item) => item.id === list.value);
      if (!selected) {
        method.value = "GET";
        url.value = headers.value = body.value = response.textContent = "";
        body.disabled = false;
        lastResponse = null;
        updateButtons();
        return;
      }
      method.value = selected.method;
      url.value = selected.url;
      headers.value = selected.headers;
      body.value = selected.body;
      body.disabled = !selected.bodyEditable;
      lastResponse = null;
      response.textContent = "";
      if (!selected.bodyEditable)
        this.#status(
          "Тело слишком большое, двоичное или недоступно. Его изменение и повторная отправка отключены.",
        );
      updateButtons();
    };
    list.addEventListener("change", selectRequest);
    this.#refreshNetwork = () => {
      const previous = list.value;
      const items = new Map(
        [...this.#network.pending, ...this.#network.history.items].map(
          (item) => [item.id, item],
        ),
      );
      list.replaceChildren(
        ...[...items.values()].map((item) =>
          this.#element(
            "option",
            `${item.status} · ${item.method} ${item.url}`,
            { value: item.id },
          ),
        ),
      );
      if (items.has(previous)) list.value = previous;
      if (!items.has(selected?.id)) {
        list.selectedIndex = items.size ? 0 : -1;
        selectRequest();
      }
      updateButtons();
    };
    updateButtons();
  }

  close() {
    this.#window.document.documentElement.removeAttribute("night-workbench");
    this.#refreshNetwork = () => {};
    this.#refreshTab = () => {};
    this.#network?.destroy();
    this.#network = null;
    this.#panel?.remove();
    this.#panel = null;
  }

  destroy() {
    this.#destroyed = true;
    this.close();
    this.memory.destroy();
    this.shell.destroy();
    this.#window.gBrowser.tabContainer.removeEventListener("TabSelect", this);
  }
}

export const NightBrowser = {
  onboardingWindow: null,
  init(window) {
    if (window.gNightBrowser) return;
    window.gNightBrowser = new NightWindow(window);
    if (Services.prefs.getBoolPref("night.onboarding.completed", false) ||
        ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs").PrivateBrowsingUtils.isWindowPrivate(window) ||
        (this.onboardingWindow && !this.onboardingWindow.closed)) return;
    this.onboardingWindow = window;
    window.addEventListener("unload", () => {
      if (this.onboardingWindow === window) this.onboardingWindow = null;
    }, { once: true });
    const { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
    SessionStore.promiseAllWindowsRestored.then(() => {
      if (window.closed || Services.prefs.getBoolPref("night.onboarding.completed", false)) return;
      const url = "chrome://browser/content/night/welcome.xhtml";
      const existing = [...window.gBrowser.tabs].find(tab => tab.linkedBrowser.currentURI.spec === url);
      if (existing) window.gBrowser.selectedTab = existing;
      else {
        const current = window.gBrowser.selectedBrowser.currentURI.spec;
        window.openTrustedLinkIn(url, ["about:blank", "about:home", "about:newtab"].includes(current) ? "current" : "tab");
      }
    }).catch(error => console.error("First-run setup failed", error));
  },
};
