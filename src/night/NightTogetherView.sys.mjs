import {NightTogether} from "resource:///modules/night/NightTogether.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
export class NightTogetherView {
  #button;
  #window;
  constructor(window, parent) {
    this.#window = window;
    this.#button = window.document.createElementNS('http://www.w3.org/1999/xhtml', 'button');
    this.#button.id = 'night-together-watch'; this.#button.type = 'button';
    this.#button.addEventListener('click', () => NightTogether.openRoom(window).catch(error=>console.error(error)));
    parent.append(this.#button);
    Services.obs.addObserver(this, 'night-together-watch');
    this.observe();
  }
  observe() {
    this.#button.hidden = PrivateBrowsingUtils.isWindowPrivate(this.#window) || !NightTogether.watchStatus;
    this.#button.textContent = NightTogether.watchStatus;
    this.#button.title = NightTogether.watchStatus + ' · Открыть комнату';
  }
  destroy() { Services.obs.removeObserver(this, 'night-together-watch'); this.#button.remove(); }
}
