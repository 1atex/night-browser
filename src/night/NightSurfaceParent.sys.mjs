import {NightIsland} from "resource:///modules/night/NightIsland.sys.mjs";

const PREFS = ["night.ui.palette", "night.ui.animations", "night.island.appearance"];
const observers = new Set();
const changes = {observe() { for (const ref of observers) { const actor = ref.deref(); if (actor) actor.update(); else observers.delete(ref); } }};

export class NightSurfaceParent extends JSWindowActorParent {
  #reference = null;
  receiveMessage(message) {
    if (message.name !== "NightSurface:Ready") return;
    if (!this.#reference) {
      if (!observers.size) {
        for (const pref of PREFS) Services.prefs.addObserver(pref, changes);
        Services.obs.addObserver(changes, "night-island-appearance");
      }
      this.#reference = new WeakRef(this);
      observers.add(this.#reference);
    }
    this.update();
  }
  update() {
    try { this.sendAsyncMessage("NightSurface:Appearance", {
      palette: Services.prefs.getStringPref("night.ui.palette", "night"),
      motion: Services.prefs.getBoolPref("night.ui.animations", true),
      appearance: NightIsland.sharedAppearance,
    }); } catch {}
  }
  didDestroy() {
    if (!this.#reference) return;
    observers.delete(this.#reference);
    this.#reference = null;
    if (!observers.size) {
      for (const pref of PREFS) Services.prefs.removeObserver(pref, changes);
      Services.obs.removeObserver(changes, "night-island-appearance");
    }
  }
}
