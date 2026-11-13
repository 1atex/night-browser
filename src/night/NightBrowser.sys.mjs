/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { NightShell } from "resource:///modules/night/NightShell.sys.mjs";
import { NightMemory } from "resource:///modules/night/NightMemory.sys.mjs";

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

  toggle(section = "memory") {
    if (this.#destroyed) return;
    if (this.#panel) {
      if (section !== this.#section) {
        this.#panel.querySelector(`[data-section="${section}"]`).click();
        return;
      }
      this.close();
      return;
    }
    this.#section = "memory";
    this.#panel = this.#element("section", "", {
      id: "night-tools",
      "aria-label": "Night tools",
    });
    const heading = this.#element("div", "", { class: "night-row" });
    heading.append(
      this.#element("h2", "Night"),
      this.#button("Закрыть", () => this.close()),
    );
    const navigation = this.#element("div", "", { class: "night-row" });
    const memory = this.#element("div", "", { class: "night-section" });
    const network = this.#element("div", "", {
      class: "night-section",
      hidden: "",
    });
    navigation.append(
      this.#button("Память", () => {
        this.#section = "memory";
        memory.hidden = false;
        network.hidden = true;
      }),
      this.#button("Запросы", async () => {
        this.#section = "network";
        memory.hidden = true;
        network.hidden = false;
        if (!network.childElementCount) await this.#buildNetwork(network);
      }),
    );
    navigation.children[0].dataset.section = "memory";
    navigation.children[1].dataset.section = "network";
    this.#panel.append(
      heading,
      navigation,
      memory,
      network,
      this.#element("p", "", {
        class: "night-status",
        role: "status",
        "aria-live": "polite",
      }),
    );
    this.#buildMemory(memory);
    this.#window.document
      .getElementById("browser")
      .append(this.#panel);
    if (section === "network") navigation.children[1].click();
    this.#panel.querySelector("button").focus();
  }

  #buildMemory(parent) {
    const settings = this.memory.settings;
    parent.append(
      this.#element(
        "p",
        "Неактивные вкладки освобождают память. Страница загрузится при возвращении.",
      ),
    );
    const enabled = this.#field(
      parent,
      "Выгружать неактивные вкладки",
      this.#element("input", "", { type: "checkbox" }),
    );
    enabled.checked = settings.enabled;
    const interval = this.#field(
      parent,
      "Время неактивности, минут",
      this.#element("input", "", { type: "number", min: "1", max: "1440" }),
    );
    interval.value = settings.idleMinutes;
    const exclusions = this.#field(
      parent,
      "Не выгружать сайты и их поддомены",
      this.#element("textarea", "", {
        placeholder: "youtube.com\nchatgpt.com",
      }),
    );
    exclusions.value = settings.excludedSites.join("\n");
    parent.append(
      this.#button("Сохранить", () => {
        this.memory.setSettings({
          enabled: enabled.checked,
          idleMinutes: Number(interval.value),
          excludedSites: exclusions.value,
        });
        this.#status("Настройки сохранены.");
      }),
    );
    const keep = this.#field(
      parent,
      "Не выгружать текущую вкладку",
      this.#element("input", "", { type: "checkbox" }),
    );
    const title = this.#element("p");
    parent.append(title);
    this.#refreshTab = () => {
      const tab = this.#window.gBrowser.selectedTab;
      keep.checked = this.memory.isProtected(tab);
      title.textContent = tab.label;
    };
    keep.addEventListener("change", () =>
      this.memory.protect(this.#window.gBrowser.selectedTab, keep.checked),
    );
    this.#refreshTab();
    parent.append(
      this.#button("Проверить неактивные вкладки", async () => {
        this.#status(`Выгружено вкладок: ${await this.memory.checkNow()}`);
      }),
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
    parent.append(
      this.#element(
        "p",
        "Захват ограничен выбранной вкладкой. Остановленные запросы отменяются через 60 секунд или при закрытии панели.",
      ),
    );
    const intercept = this.#field(
      parent,
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
    parent.append(actions, scope);
    const list = this.#field(
      parent,
      "Запросы",
      this.#element("select", "", { size: "5" }),
    );
    const method = this.#field(
      parent,
      "Метод",
      this.#element("input", "", { value: "GET" }),
    );
    const url = this.#field(
      parent,
      "URL",
      this.#element("input", "", { type: "url" }),
    );
    const headers = this.#field(
      parent,
      "Заголовки",
      this.#element("textarea", "", {
        class: "night-code",
        spellcheck: "false",
      }),
    );
    const body = this.#field(
      parent,
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
    parent.append(buttons, response);
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
  init(window) {
    if (window.gNightBrowser) return;
    window.gNightBrowser = new NightWindow(window);
  },
};
