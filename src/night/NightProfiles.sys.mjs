import {PROFILE_ID, profileName, profileMetadata, PROFILE_COLORS, PROFILE_ICONS} from "resource:///modules/night/ProfileModel.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";

function file(path) { const value = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); value.initWithPath(path); return value; }
function equal(a, b) { return Services.appinfo.OS === "WINNT" ? a.toLowerCase() === b.toLowerCase() : a === b; }

export const NightProfiles = {
  get context() {
    const application = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.parent.path;
    const installed = file(PathUtils.join(application, "installed.marker")).exists();
    const base = installed && Services.appinfo.OS === "WINNT" ? PathUtils.join(Services.dirsvc.get("LocalAppData", Ci.nsIFile).path, "NightBrowser") : application;
    const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path, root = PathUtils.parent(profile);
    let id = equal(profile, PathUtils.join(base, "profile")) ? "default" : null;
    const candidate = PathUtils.filename(root);
    if (!id && /^[a-f0-9]{32}$/.test(candidate) && equal(profile, PathUtils.join(base, "profiles", candidate, "profile"))) id = candidate;
    return {application, base, root, profile, id, managed: !!id};
  },
  rootFor(id) {
    const {base, managed} = this.context;
    if (!managed || !PROFILE_ID.test(id)) throw new Error("Профили доступны при запуске через Night.exe.");
    return id === "default" ? base : PathUtils.join(base, "profiles", id);
  },
  async list() {
    const context = this.context;
    if (!context.managed) return [{id: "external", name: "Текущий профиль", current: true}];
    const ids = ["default"];
    const directory = PathUtils.join(context.base, "profiles");
    if (await IOUtils.exists(directory)) for (const path of await IOUtils.getChildren(directory)) {
      const id = PathUtils.filename(path);
      if (/^[a-f0-9]{32}$/.test(id) && await IOUtils.exists(PathUtils.join(path, "night-profile.json"))) ids.push(id);
    }
    const profiles = [];
    for (const id of ids.slice(0, 100)) {
      const root = this.rootFor(id);
      if (!await IOUtils.exists(PathUtils.join(root, "profile"))) continue;
      const metadata = await IOUtils.readJSON(PathUtils.join(root, "night-profile.json")).catch(() => null);
      profiles.push({...profileMetadata(metadata, id), current: id === context.id});
    }
    return profiles;
  },
  async create(name, palette = "night") {
    if (!this.context.managed) throw new Error("Запусти браузер через Night.exe, чтобы создавать профили.");
    name = profileName(name);
    if (!['night', 'graphite', 'midnight', 'mist'].includes(palette)) throw new Error("Неизвестная палитра.");
    if ((await this.list()).length >= 32) throw new Error("Можно создать до 32 профилей.");
    const id = Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
    const root = this.rootFor(id), profile = PathUtils.join(root, "profile");
    await IOUtils.makeDirectory(profile);
    await IOUtils.writeUTF8(PathUtils.join(profile, "prefs.js"), `user_pref("night.onboarding.completed", true);\nuser_pref("night.ui.palette", ${JSON.stringify(palette)});\n`);
    await IOUtils.writeJSON(PathUtils.join(root, "night-profile.json"), {id, name}, {tmpPath: PathUtils.join(root, "night-profile.tmp")});
    Services.obs.notifyObservers(null, "night-profiles-changed");
    return id;
  },
  async rename(id, name) { await this.customize(id, {name}); },
  async customize(id, changes) {
    const current = (await this.list()).find(item => item.id === id);
    if (!current) throw new Error("Профиль не найден.");
    if (changes.name !== undefined) profileName(changes.name);
    if (changes.color !== undefined && !Object.hasOwn(PROFILE_COLORS, changes.color)) throw new Error("Неизвестный цвет.");
    if (changes.icon !== undefined && !PROFILE_ICONS.includes(changes.icon)) throw new Error("Неизвестный значок.");
    const root = this.rootFor(id), path = PathUtils.join(root, "night-profile.json");
    await IOUtils.writeJSON(path, profileMetadata({...current, ...changes}, id), {tmpPath: path + "." + Services.appinfo.processID + ".tmp"});
    Services.obs.notifyObservers(null, "night-profiles-changed");
  },
  async open(id, window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) throw new Error("Переключай профили из обычного окна.");
    if (!(await this.list()).some(item => item.id === id)) throw new Error("Профиль не найден.");
    if (!this.context.managed && id === "external") { window.focus(); return; }
    if (Services.appinfo.OS !== "WINNT" && id === this.context.id) { window.focus(); return; }
    if (Services.appinfo.OS !== "WINNT") throw new Error("Переключение профилей доступно в Windows.");
    const launcher = file(PathUtils.join(this.context.application, "Night.exe"));
    const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(launcher);
    await new Promise((resolve, reject) => process.runwAsync(["--profile-id", id], 2, {observe() {
      if (process.exitValue === 0) resolve(); else reject(new Error("Не удалось открыть профиль. Закрой его окна и повтори попытку."));
    }}));
  },
};
