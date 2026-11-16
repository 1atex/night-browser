import {applyIslandAppearance} from "resource:///modules/night/IslandAppearance.mjs";

export class NightSurfaceChild extends JSWindowActorChild {
  #loaded = false;
  handleEvent() {
    if (this.#loaded || !this.document.documentElement) return;
    this.#loaded = true;
    const utils = this.contentWindow.windowUtils;
    utils.loadSheetUsingURIString("chrome://browser/content/night/surfaces.css", utils.AUTHOR_SHEET);
    this.document.documentElement.setAttribute("night-surface", "true");
    this.sendAsyncMessage("NightSurface:Ready");
  }
  receiveMessage(message) {
    if (message.name !== "NightSurface:Appearance") return;
    const root = this.document.documentElement;
    root.dataset.palette = message.data.palette;
    root.dataset.motion = String(message.data.motion);
    applyIslandAppearance(root, message.data.appearance);
  }
}
