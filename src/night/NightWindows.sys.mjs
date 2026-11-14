export const NightWindows = {
  init() {
    if (Services.appinfo.OS !== "WINNT") return;
    const launcher = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.parent;
    launcher.append("Night.exe");
    if (!launcher.exists()) return;
    const process = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess,
    );
    process.init(launcher);
    process.runwAsync(["--identity", String(Services.appinfo.processID)], 2);
  },
};
