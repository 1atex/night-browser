import {NightIsland} from "resource:///modules/night/NightIsland.sys.mjs";
import {downloadItem} from "resource:///modules/night/IslandDownloads.mjs";
import {applyIslandAppearance} from "resource:///modules/night/IslandAppearance.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";

const TOPICS = ["night-island-status", "night-island-downloads", "night-island-appearance"];
const plural = new Intl.PluralRules("ru");
const XHTML = "http://www.w3.org/1999/xhtml";

export class NightIslandView {
  #window;
  #button;
  #name;
  #detail;
  #progress;
  #footer;
  #top;

  constructor(window, owner, parent, top) {
    this.#window = window;
    this.#footer = parent;
    this.#top = top;
    const create = (tag, className) => {
      const node = window.document.createElementNS(XHTML, tag);
      node.className = className;
      return node;
    };
    this.#button = create("button", "night-island-capsule");
    this.#button.id = "night-island-pill";
    this.#button.type = "button";
    const icon = create("span", "night-island-glyph");
    icon.setAttribute("aria-hidden", "true");
    this.#name = create("span", "night-island-name");
    this.#detail = create("span", "night-island-detail");
    this.#progress = create("progress", "night-island-progress");
    this.#progress.max = 100;
    this.#progress.setAttribute("aria-hidden", "true");
    this.#button.append(icon, this.#name, this.#detail, this.#progress);
    this.#button.addEventListener("click", () => {
      if (!NightIsland.ready) owner.openSettings("integrations");
      else if (!NightIsland.openDownloads()) window.DownloadsPanel.showPanel();
    });
    parent.append(this.#button);
    for (const topic of TOPICS) Services.obs.addObserver(this, topic);
    Services.prefs.addObserver("night.island.", this);
    this.observe();
  }

  observe() {
    applyIslandAppearance(this.#window.document.documentElement, NightIsland.sharedAppearance);
    const parent = Services.prefs.getStringPref("night.island.position", "bottom") === "top" ? this.#top : this.#footer;
    if (this.#button.parentNode !== parent) parent.prepend(this.#button);
    this.#button.hidden = !NightIsland.enabled || !Services.prefs.getBoolPref("night.island.indicator", true) || PrivateBrowsingUtils.isWindowPrivate(this.#window);
    if (this.#button.hidden) return;
    const items = NightIsland.ready ? [...NightIsland.entries].map(([id, download]) => downloadItem(id, download)).filter(Boolean) : [];
    if (NightIsland.ready && Services.prefs.getStringPref("night.island.visibility", "always") === "unfinished" &&
        !items.some(item => ["active", "paused", "failed"].includes(item.state))) {
      this.#button.hidden = true;
      return;
    }
    const active = items.filter(item => item.state === "active");
    const item = active.at(-1) ?? items.findLast(item => ["paused", "failed"].includes(item.state)) ?? items.findLast(item => item.state === "complete");
    const state = !NightIsland.ready ? "offline" : item?.state ?? "idle";
    const name = item?.name ?? (NightIsland.ready ? "Island" : "Island · нет связи");
    const percent = item?.total ? Math.min(100, Math.floor(item.current / item.total * 100)) : null;
    const detail = state === "paused" ? "Пауза" : state === "complete" ? "Готово" : state === "failed" ? "Ошибка" :
      active.length > 1 ? `${active.length} ${{one:"файл",few:"файла",many:"файлов",other:"файла"}[plural.select(active.length)]}` : percent !== null ? `${percent}%` : state === "active" ? "Загрузка" : "";
    for (const [node, text] of [[this.#name, name], [this.#detail, detail]]) if (node.textContent !== text) node.textContent = text;
    if (this.#button.dataset.state !== state) this.#button.dataset.state = state;
    const action = NightIsland.ready ? (NightIsland.capabilities.has("show-downloads") ? "Открыть загрузки в Island" : "Открыть загрузки браузера") : "Открыть настройки соединения";
    const title = `${name}${detail ? " · " + detail : ""}\n${action}`;
    if (this.#button.title !== title) {
      this.#button.title = title;
      this.#button.setAttribute("aria-label", title.replace("\n", ". "));
    }
    this.#progress.hidden = percent === null || !["active", "paused"].includes(state);
    if (percent !== null && this.#progress.value !== percent) this.#progress.value = percent;
  }

  destroy() {
    for (const topic of TOPICS) Services.obs.removeObserver(this, topic);
    Services.prefs.removeObserver("night.island.", this);
    this.#button.remove();
    applyIslandAppearance(this.#window.document.documentElement, null);
  }
}
