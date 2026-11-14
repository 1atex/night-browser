export class NightStartParent extends JSWindowActorParent {
  #observing = false;
  #observer = { observe: () => this.observe() };

  receiveMessage(message) {
    if (message.name !== "NightStart:Ready") return;
    if (!this.#observing) {
      Services.prefs.addObserver("night.ui.palette", this.#observer);
      this.#observing = true;
    }
    this.observe();
  }

  observe() {
    this.sendAsyncMessage("NightStart:Appearance", {
      palette: Services.prefs.getStringPref("night.ui.palette", "night"),
    });
  }

  didDestroy() {
    if (this.#observing) Services.prefs.removeObserver("night.ui.palette", this.#observer);
  }
}
