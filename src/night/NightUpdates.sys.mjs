import {setTimeout, clearTimeout} from "resource://gre/modules/Timer.sys.mjs";
import {releaseUpdate, checksumFor} from "resource:///modules/night/UpdateModel.mjs";
import {NightProfiles} from "resource:///modules/night/NightProfiles.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import {version} from "resource:///modules/night/NightVersion.sys.mjs";

function file(path) { const result = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); result.initWithPath(path); return result; }
async function request(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try { const response = await fetch(url, {signal: controller.signal, credentials: "omit", cache: "no-store"}); if (!response.ok) throw new Error(`Сервер обновлений: ${response.status}`); return await response.text(); }
  finally { clearTimeout(timer); }
}
export const NightUpdates = {
  busy: false,
  candidate: null,
  get supported() { return Services.appinfo.OS === "WINNT" && file(PathUtils.join(NightProfiles.context.application, "installed.marker")).exists(); },
  async check() {
    if (this.busy) throw new Error("Обновление уже выполняется.");
    this.candidate = releaseUpdate(JSON.parse(await request("https://api.github.com/repos/1atex/night-browser/releases?per_page=20")), version);
    return this.candidate;
  },
  async install(window) {
    if (!this.supported || PrivateBrowsingUtils.isWindowPrivate(window)) throw new Error("Обнови Night из обычного окна установленной версии.");
    if (this.busy || !this.candidate) throw new Error("Сначала проверь обновления.");
    this.busy = true;
    try {
      const candidate = this.candidate;
      const expected = checksumFor(await request(candidate.sums), candidate.name);
      const directory = PathUtils.join(PathUtils.tempDir, "night-update-" + Services.uuid.generateUUID().toString().replace(/[{}]/g, ""));
      await IOUtils.makeDirectory(directory);
      const setup = PathUtils.join(directory, "setup.exe");
      const {Downloads} = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      const download = await Downloads.createDownload({source: candidate.url, target: setup});
      await download.start();
      const hash = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
      const stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      stream.init(file(setup), 1, 0, 0);
      let actual;
      try { hash.init(hash.SHA256); hash.updateFromStream(stream, 0xffffffff); actual = [...hash.finish(false)].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(""); }
      finally { stream.close(); }
      if (actual !== expected) { await IOUtils.remove(setup); throw new Error("Контрольная сумма не совпала. Установка отменена."); }
      const context = NightProfiles.context;
      const helper = PathUtils.join(directory, "NightUpdate.exe");
      await IOUtils.copy(PathUtils.join(context.application, "Night.exe"), helper);
      await IOUtils.copy(PathUtils.join(context.application, "Night.exe.config"), helper + ".config");
      const plan = PathUtils.join(directory, "plan.json");
      await IOUtils.writeJSON(plan, {root: context.application, setup, sha256: expected, profile: context.id ?? "default", version: candidate.version});
      const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess); process.init(file(helper));
      process.runwAsync(["--run-update", plan], 2);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    } finally { this.busy = false; }
  },
  async startup(window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return;
    const previous = Services.prefs.getStringPref("night.updates.seen-version", "");
    const receipt = PathUtils.join(PathUtils.profileDir, "night-update-completed.json");
    const completed = await IOUtils.readJSON(receipt).catch(() => null);
    if (completed) await IOUtils.remove(receipt, {ignoreAbsent: true});
    if (previous === version && !completed) return;
    Services.prefs.setStringPref("night.updates.seen-version", version);
    if (previous || completed) window.openTrustedLinkIn("chrome://browser/content/night/changes.html", "tab");
  },
};
