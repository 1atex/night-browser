import {homeLinks, homeGradient} from "resource:///modules/night/HomeModel.mjs";
import {applyIslandAppearance} from "resource:///modules/night/IslandAppearance.mjs";

export class NightStartChild extends JSWindowActorChild {
  #serial = 0;
  #timer = null;
  #items = [];
  #selected = -1;
  #bound = false;
  #links = [];
  #editing = -1;
  #gradient = homeGradient(null);

  #close() {
    this.#serial++;
    this.contentWindow.clearTimeout(this.#timer);
    this.#timer = null;
    this.#items = [];
    this.#selected = -1;
    const query = this.document.getElementById("query");
    query?.setAttribute("aria-expanded", "false");
    query?.removeAttribute("aria-activedescendant");
    const list = this.document.getElementById("suggestions");
    if (list) { list.hidden = true; list.removeAttribute("aria-busy"); list.replaceChildren(); }
    this.sendAsyncMessage("NightStart:Cancel");
  }

  #suggest() {
    const input = this.document.getElementById("query");
    if (!input?.value.trim() || input.value.length > 1024 || this.document.hidden) { this.#close(); return; }
    this.contentWindow.clearTimeout(this.#timer);
    this.#serial++;
    this.#items = [];
    this.#selected = -1;
    input.removeAttribute("aria-activedescendant");
    const list = this.document.getElementById("suggestions");
    list?.setAttribute("aria-busy", "true");
    for (const row of list?.children ?? []) row.setAttribute("aria-selected", "false");
    this.sendAsyncMessage("NightStart:Cancel");
    const serial = this.#serial, text = input.value;
    this.#timer = this.contentWindow.setTimeout(() => {
      this.#timer = null;
      this.sendAsyncMessage("NightStart:Suggest", {serial, text});
    }, 120);
  }

  #pick(index) {
    const item = this.#items[index];
    if (!item) return;
    this.sendAsyncMessage("NightStart:Pick", {id: item.id});
    this.#close();
  }

  #bind() {
    if (this.#bound) return;
    const doc = this.document, input = doc.getElementById("query"), list = doc.getElementById("suggestions");
    if (!input || !list) return;
    this.#bound = true;
    input.addEventListener("input", event => { if (!event.isComposing) this.#suggest(); });
    input.addEventListener("compositionend", () => this.#suggest());
    input.addEventListener("focus", () => { if (input.value) this.#suggest(); });
    input.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.#close(); }
      else if (["ArrowDown", "ArrowUp"].includes(event.key) && this.#items.length) {
        event.preventDefault();
        this.#selected = this.#selected < 0 ? (event.key === "ArrowDown" ? 0 : this.#items.length - 1) :
          (this.#selected + (event.key === "ArrowDown" ? 1 : -1) + this.#items.length) % this.#items.length;
        for (const [index, row] of [...list.children].entries()) row.setAttribute("aria-selected", String(index === this.#selected));
        const row = list.children[this.#selected];
        input.setAttribute("aria-activedescendant", row.id);
        row.scrollIntoView({block: "nearest"});
      } else if (["ArrowDown", "ArrowUp"].includes(event.key) && !this.#items.length && input.value.trim()) {
        event.preventDefault(); this.#suggest();
      } else if (event.key === "Enter" && this.#selected >= 0) { event.preventDefault(); this.#pick(this.#selected); }
      else if (event.key === "Tab") this.#close();
    });
    list.addEventListener("pointerdown", event => event.preventDefault());
    list.addEventListener("click", event => {
      const row = event.target.closest("[role='option']");
      if (row) this.#pick(Number(row.dataset.index));
    });
    doc.addEventListener("pointerdown", event => { if (!event.target.closest(".home-search")) this.#close(); });
    this.contentWindow.addEventListener("blur", () => this.#close());
    doc.addEventListener("visibilitychange", () => {
      if (doc.hidden) this.#close();
      this.sendAsyncMessage("NightStart:Visible", {visible: !doc.hidden});
    });
    doc.getElementById("home-customize")?.addEventListener("change", event => {
      if (!event.target.matches("[data-widget]")) return;
      this.sendAsyncMessage("NightStart:Widgets", {enabled: [...doc.querySelectorAll("[data-widget]:checked")].map(node => node.dataset.widget)});
    });
    doc.getElementById("home-shortcuts").addEventListener("click", event => {
      if (event.target.closest("[data-add-link]")) this.#editLink(-1);
    });
    doc.getElementById("home-links-editor").addEventListener("click", event => {
      const button = event.target.closest("[data-link-action]");
      if (!button) return;
      const index = Number(button.dataset.index);
      if (button.dataset.linkAction === "edit") this.#editLink(index);
      else {
        this.#links.splice(index, 1); this.#editLink(-1, false);
        this.sendAsyncMessage("NightStart:Shortcuts", {links: this.#links});
      }
    });
    doc.getElementById("home-link-cancel").addEventListener("click", () => this.#editLink(-1));
    doc.getElementById("home-gradient-presets").addEventListener("click", event => {
      const button = event.target.closest("[data-gradient]");
      if (!button) return;
      this.#gradient = homeGradient({...this.#gradient, preset: button.dataset.gradient});
      this.#paintGradient(); this.sendAsyncMessage("NightStart:Gradient", this.#gradient);
    });
    for (const id of ["first", "second", "intensity"]) {
      const node = doc.getElementById(`home-gradient-${id}`);
      node.addEventListener("input", () => {
        this.#gradient = homeGradient({...this.#gradient, [id]: id === "intensity" ? Number(node.value) : node.value});
        this.#paintGradient();
      });
      node.addEventListener("change", () => this.sendAsyncMessage("NightStart:Gradient", this.#gradient));
    }
    doc.getElementById("home-widgets")?.addEventListener("click", event => {
      const button = event.target.closest("[data-home-action]");
      if (button) this.sendAsyncMessage("NightStart:HomeAction", {action: button.dataset.homeAction, id: button.dataset.tab});
    });
    doc.addEventListener("focusout", event => { if (event.target === input && !list.contains(event.relatedTarget)) this.#close(); });
  }

  #render(message) {
    const input = this.document.getElementById("query"), list = this.document.getElementById("suggestions");
    if (message.serial !== this.#serial || this.document.activeElement !== input || this.document.hidden || !list) return;
    const selectedId = this.#items[this.#selected]?.id;
    this.#items = message.items;
    this.#selected = this.#items.findIndex(item => item.id === selectedId);
    list.removeAttribute("aria-busy");
    list.replaceChildren();
    for (const [index, item] of this.#items.entries()) {
      const row = this.document.createElement("div");
      row.className = "search-option"; row.id = `suggestion-${index}`; row.dataset.index = String(index);
      row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(index === this.#selected));
      if (item.icon) {
        const icon = this.document.createElement("img"); icon.src = item.icon; icon.alt = ""; row.append(icon);
      } else {
        const icon = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
        const path = this.document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", item.kind === "search" ? "M16 16l5 5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0" : "M4 5h16v14H4zM4 9h16");
        icon.append(path); row.append(icon);
      }
      const copy = this.document.createElement("span"); copy.className = "search-option-copy";
      for (const [key, text] of [["title", item.title], ["detail", item.detail]]) {
        const line = this.document.createElement("span"); line.className = `search-option-${key}`; line.textContent = text; copy.append(line);
      }
      row.append(copy); list.append(row);
    }
    list.hidden = !this.#items.length;
    input.setAttribute("aria-expanded", String(!list.hidden));
    if (this.#selected < 0) input.removeAttribute("aria-activedescendant");
  }

  handleEvent(event) {
    if (event.type === "DOMContentLoaded") this.#bind();
    if (event.type === "submit") {
      if (event.target.id === "home-link-form") {
        event.preventDefault(); this.#saveLink(); return;
      }
      if (event.target.id !== "home-search-form") return;
      event.preventDefault();
      this.#close();
      this.sendAsyncMessage("NightStart:Search", {query: this.document.getElementById("query")?.value ?? ""});
      return;
    }
    this.sendAsyncMessage("NightStart:Ready");
  }

  receiveMessage(message) {
    if (message.name === "NightStart:Home") { this.#renderHome(message.data); return; }
    if (message.name === "NightStart:Suggestions") { this.#render(message.data); return; }
    if (message.name === "NightStart:Focus") {
      if (!this.document.hidden) this.document.getElementById("query")?.focus({preventScroll: true});
      return;
    }
    if (message.name === "NightStart:SearchEngine") {
      const label = message.data.engine ? `Поиск в ${message.data.engine} или адрес` : "Поиск или адрес";
      const query = this.document.getElementById("query");
      if (query) { query.placeholder = label; query.setAttribute("aria-label", label); }
      return;
    }
    if (message.name !== "NightStart:Appearance") return;
    const palette = message.data.palette;
    this.document.documentElement.dataset.motion = String(message.data.motion);
    this.document.documentElement.dataset.palette =
      ["night", "graphite", "midnight", "mist"].includes(palette) ? palette : "night";
    applyIslandAppearance(this.document.documentElement, message.data.appearance);
  }

  #editLink(index, focus = true) {
    this.#editing = index;
    const doc = this.document, link = this.#links[index];
    doc.getElementById("home-customize").open = true;
    doc.getElementById("home-link-name").value = link?.name ?? "";
    doc.getElementById("home-link-url").value = link?.url ?? "";
    doc.getElementById("home-link-save").textContent = link ? "Сохранить" : "Добавить";
    doc.getElementById("home-link-cancel").hidden = !link;
    doc.getElementById("home-link-error").hidden = true;
    if (focus) doc.getElementById("home-link-name").focus();
  }

  #saveLink() {
    const doc = this.document, name = doc.getElementById("home-link-name").value.trim();
    let url = doc.getElementById("home-link-url").value.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    const link = homeLinks([{name, url}])[0];
    const error = doc.getElementById("home-link-error");
    let message = !link ? "Укажи название и адрес сайта с http:// или https://." : "";
    if (link && this.#links.some((item, index) => index !== this.#editing && item.url === link.url)) message = "Эта ссылка уже добавлена.";
    if (this.#editing < 0 && this.#links.length >= 12) message = "Можно добавить до 12 ссылок.";
    if (message) { error.textContent = message; error.hidden = false; return; }
    if (this.#editing >= 0) this.#links[this.#editing] = link; else this.#links.push(link);
    this.sendAsyncMessage("NightStart:Shortcuts", {links: this.#links});
    this.#editLink(-1);
  }

  #paintGradient() {
    const doc = this.document, value = this.#gradient, root = doc.documentElement;
    root.dataset.homeGradient = value.preset;
    root.style.setProperty("--home-first", value.first);
    root.style.setProperty("--home-second", value.second);
    root.style.setProperty("--home-intensity", `${value.intensity}%`);
    for (const button of doc.querySelectorAll("[data-gradient]")) button.setAttribute("aria-pressed", String(button.dataset.gradient === value.preset));
    doc.getElementById("home-gradient-options").hidden = value.preset === "none";
    doc.getElementById("home-gradient-colors").hidden = value.preset !== "custom";
    for (const id of ["first", "second", "intensity"]) doc.getElementById(`home-gradient-${id}`).value = value[id];
    doc.getElementById("home-gradient-value").textContent = `${value.intensity}%`;
  }

  #renderLinks(links) {
    const doc = this.document, nav = doc.getElementById("home-shortcuts"), editor = doc.getElementById("home-links-editor"), key = JSON.stringify(links);
    if (nav.dataset.items === key) return;
    nav.dataset.items = key; this.#links = links.map(({name, url}) => ({name, url}));
    nav.replaceChildren(); editor.replaceChildren();
    doc.getElementById("home-links-count").textContent = `${links.length}/12`;
    for (const [index, link] of links.entries()) {
      const anchor = doc.createElement("a"); anchor.href = link.url; anchor.title = link.url;
      const icon = doc.createElement("span"); icon.className = "tile-icon";
      if (link.icon?.startsWith("data:image/")) { const img = doc.createElement("img"); img.src = link.icon; img.alt = ""; icon.append(img); }
      else icon.textContent = link.name.slice(0, 1).toUpperCase();
      const label = doc.createElement("span"); label.textContent = link.name; anchor.append(icon, label); nav.append(anchor);
      const row = doc.createElement("div"); row.className = "home-link-row";
      const copy = doc.createElement("span"); copy.textContent = link.name; copy.title = link.url; row.append(copy);
      for (const [action, text] of [["edit", "Изменить"], ["remove", "Удалить"]]) {
        const button = doc.createElement("button"); button.type = "button"; button.dataset.linkAction = action; button.dataset.index = index;
        button.textContent = text; button.setAttribute("aria-label", `${text}: ${link.name}`); row.append(button);
      }
      editor.append(row);
    }
    if (links.length < 12) {
      const add = doc.createElement("button"); add.type = "button"; add.dataset.addLink = "";
      add.className = "home-add-link"; add.textContent = "+ Добавить ссылку"; nav.append(add);
    }
  }

  #renderHome(data) {
    const doc = this.document;
    this.#renderLinks(data.links);
    this.#gradient = homeGradient(data.gradient); this.#paintGradient();
    for (const id of ["clock", "shortcuts", "tabs", "island"]) {
      const show = data.enabled.includes(id);
      doc.getElementById(`home-${id}`).hidden = !show;
      doc.querySelector(`[data-widget="${id}"]`).checked = show;
    }
    doc.getElementById("home-widgets").hidden = !data.enabled.some(id => ["tabs", "island"].includes(id));
    doc.getElementById("home-workspace-name").textContent = data.workspace;
    doc.getElementById("home-tab-count").textContent = `${data.loaded} загружено · ${data.sleeping} спят`;
    const list = doc.getElementById("home-tab-items");
    const key = JSON.stringify(data.tabs);
    if (list.dataset.items !== key) {
      list.dataset.items = key;
      list.replaceChildren();
      for (const tab of data.tabs) {
        const button = doc.createElement("button");
        button.type = "button"; button.dataset.homeAction = "tab"; button.dataset.tab = tab.id;
        button.className = "home-tab"; button.toggleAttribute("data-sleeping", tab.sleeping);
        const icon = doc.createElement("span"); icon.className = "home-tab-icon";
        if (tab.icon?.startsWith("data:image/")) { const img = doc.createElement("img"); img.src = tab.icon; img.alt = ""; icon.append(img); }
        else icon.textContent = tab.title.slice(0, 1).toUpperCase();
        const title = doc.createElement("span"); title.className = "home-tab-title"; title.textContent = tab.title;
        button.append(icon, title);
        if (tab.sleeping) { const status = doc.createElement("span"); status.className = "home-tab-status"; status.textContent = "Спит"; button.append(status); }
        button.title = tab.sleeping ? `${tab.title} · загрузить вкладку` : tab.title;
        list.append(button);
      }
      if (!data.tabs.length) { const empty = doc.createElement("p"); empty.className = "widget-caption"; empty.textContent = "Страницы этого пространства будут здесь."; list.append(empty); }
    }
    if (data.island) {
      doc.getElementById("home-island-status").textContent = data.island.status;
      doc.querySelector('[data-home-action="integrations"]').textContent = data.island.connected ? "Настроить" : "Подключить";
      doc.getElementById("home-island").toggleAttribute("data-connected", data.island.connected);
      for (const action of ["pocket", "browser", "downloads"])
        doc.querySelector(`[data-home-action="${action}"]`).hidden = !data.island[action === "browser" ? "tabs" : action];
    }
    doc.dispatchEvent(new this.contentWindow.Event("NightHomeChanged"));
  }
}
