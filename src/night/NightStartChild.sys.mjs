import {applyIslandAppearance} from "resource:///modules/night/IslandAppearance.mjs";

export class NightStartChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type === "submit") {
      if (event.target.localName !== "form") return;
      event.preventDefault();
      this.sendAsyncMessage("NightStart:Search", {query: this.document.getElementById("query")?.value ?? ""});
      return;
    }
    this.sendAsyncMessage("NightStart:Ready");
  }

  receiveMessage(message) {
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
    this.document.documentElement.dataset.palette =
      ["night", "graphite", "midnight", "mist"].includes(palette) ? palette : "night";
    applyIslandAppearance(this.document.documentElement, message.data.appearance);
  }
}
