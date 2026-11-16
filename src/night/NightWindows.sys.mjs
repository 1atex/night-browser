import {revision} from "resource:///modules/night/NightBuild.sys.mjs";
import {NightProfiles} from "resource:///modules/night/NightProfiles.sys.mjs";

export const NightWindows = {
  acknowledged: false,
  init() {
    if (Services.appinfo.OS !== "WINNT") return;
    if (!this.acknowledged) {
      this.acknowledged = true;
      const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
      const application = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
      const path = PathUtils.join(profile, "night-runtime.json");
      (async () => {
        const previous = await IOUtils.readJSON(path).catch(() => null);
        if (previous?.revision === revision && previous.application === application) return;
        await IOUtils.writeJSON(path, {revision, application}, {tmpPath: path + ".tmp"});
      })().catch(error => console.error("Night runtime acknowledgement failed", error));
    }
    const launcher = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.parent;
    launcher.append("Night.exe");
    if (!launcher.exists()) return;
    const process = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess,
    );
    process.init(launcher);
    process.runwAsync(["--identity", String(Services.appinfo.processID), "--profile-id", NightProfiles.context.id ?? "default"], 4);
  },
};
