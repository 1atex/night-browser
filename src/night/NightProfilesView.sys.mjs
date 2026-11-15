import {NightProfiles} from "resource:///modules/night/NightProfiles.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";

import {PROFILE_COLORS, profileBadge} from "resource:///modules/night/ProfileModel.mjs";

const XHTML = "http://www.w3.org/1999/xhtml";
export class NightProfilesView {
  #window;
  #button;
  #panel;
  #alive = true;
  constructor(window, parent) {
    this.#window = window;
    const doc = window.document;
    this.#button = doc.createElementNS(XHTML, "button");
    this.#button.id = "night-profile-button"; this.#button.type = "button";
    this.#button.setAttribute("aria-label", "Профили и синхронизация");
    this.#button.setAttribute("aria-haspopup", "dialog");
    this.#button.setAttribute("aria-expanded", "false");
    this.#button.textContent = "Л";
    parent.append(this.#button);
    this.#panel = doc.createXULElement("panel");
    this.#panel.id = "night-profiles-panel";
    this.#panel.setAttribute("role", "dialog");
    this.#panel.setAttribute("aria-label", "Профили браузера");
    this.#panel.setAttribute("type", "arrow");
    this.#panel.setAttribute("consumeoutsideclicks", "false");
    doc.getElementById("mainPopupSet").append(this.#panel);
    this.#button.addEventListener("click", () => this.#panel.state === "open" ? this.#panel.hidePopup() : this.open());
    this.#panel.addEventListener("popuphidden", () => this.#button.setAttribute("aria-expanded", "false"));
    Services.obs.addObserver(this, "night-profiles-changed");
    this.observe();
  }
  async observe() {
    const isPrivate = PrivateBrowsingUtils.isWindowPrivate(this.#window);
    const current = (await NightProfiles.list().catch(() => [])).find(item => item.current);
    if (!this.#alive) return;
    this.#button.textContent = isPrivate ? "" : profileBadge(current ?? {name: "П"});
    this.#button.style.setProperty("--profile-color", PROFILE_COLORS[current?.color] ?? PROFILE_COLORS.moon);
    this.#button.toggleAttribute("data-private", isPrivate);
    this.#button.title = isPrivate ? "Приватное окно · Ctrl+Shift+N" : `${current?.name ?? "Профиль"} · Профили и синхронизация`;
    this.#button.setAttribute("aria-label", this.#button.title);
  }
  #element(tag, text, attrs = {}) {
    const node = this.#window.document.createElementNS(XHTML, tag); node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }
  async open() {
    let errorMessage = "";
    const profiles = await NightProfiles.list().catch(error => { errorMessage = error.message; return []; });
    if (!this.#alive) return;
    const body = this.#element("div", "", {class: "night-profiles-body"});
    const isPrivate = PrivateBrowsingUtils.isWindowPrivate(this.#window);
    body.append(this.#element("strong", isPrivate ? "Приватное окно" : "Профили"));
    const status = this.#element("p", isPrivate ? "История и cookies этого сеанса удалятся после закрытия всех приватных окон. Скачанные файлы сохранятся." : "У каждого профиля свои пароли, входы на сайты и оформление.", {role: "status"});
    if (errorMessage) status.textContent = errorMessage;
    if (!isPrivate) for (const profile of profiles) {
      const button = this.#element("button", profile.name + (profile.current ? " · сейчас" : ""), {type: "button", "data-profile-id": profile.id, "aria-current": String(profile.current)});
      const badge = this.#element("span", profileBadge(profile), {class: "profile-badge", "aria-hidden": "true"});
      badge.style.setProperty("--profile-color", PROFILE_COLORS[profile.color] ?? PROFILE_COLORS.moon);
      button.prepend(badge);
      button.addEventListener("click", async () => {
        button.disabled = true; status.textContent = "Открываем профиль…";
        try { await NightProfiles.open(profile.id, this.#window); this.#panel.hidePopup(); }
        catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
      });
      body.append(button);
    }
    body.append(status);
    if (!isPrivate) {
      const settings = this.#element("button", "Добавить профиль / настроить Sync", {type: "button", id: "night-profile-settings"});
      settings.addEventListener("click", () => { this.#panel.hidePopup(); this.#window.openPreferences("accounts"); });
      body.append(settings);
    }
    this.#panel.replaceChildren(body);
    this.#button.setAttribute("aria-expanded", "true");
    this.#panel.openPopup(this.#button, "before_start");
  }
  destroy() {
    this.#alive = false;
    Services.obs.removeObserver(this, "night-profiles-changed");
    this.#panel.remove(); this.#button.remove();
  }
}
