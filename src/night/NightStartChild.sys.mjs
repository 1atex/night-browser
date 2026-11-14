export class NightStartChild extends JSWindowActorChild {
  handleEvent() {
    this.sendAsyncMessage("NightStart:Ready");
  }

  receiveMessage(message) {
    if (message.name !== "NightStart:Appearance") return;
    const palette = message.data.palette;
    this.document.documentElement.dataset.palette =
      ["night", "graphite", "midnight", "mist"].includes(palette) ? palette : "night";
  }
}
