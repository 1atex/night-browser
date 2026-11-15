import {applyIslandAppearance} from "resource:///modules/night/IslandAppearance.mjs";

export class NightStartChild extends JSWindowActorChild {
  #serial = 0;
  #timer = null;
  #items = [];
  #selected = -1;
  #bound = false;

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
    doc.addEventListener("visibilitychange", () => { if (doc.hidden) this.#close(); });
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
      if (event.target.localName !== "form") return;
      event.preventDefault();
      this.#close();
      this.sendAsyncMessage("NightStart:Search", {query: this.document.getElementById("query")?.value ?? ""});
      return;
    }
    this.sendAsyncMessage("NightStart:Ready");
  }

  receiveMessage(message) {
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
}
