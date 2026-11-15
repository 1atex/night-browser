import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";

export const NightAccounts = {
  get enabled() { return Services.prefs.getBoolPref("identity.fxaccounts.enabled", false); },
  state(window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return {status: "private"};
    if (!this.enabled) return {status: "disabled"};
    const {UIState} = ChromeUtils.importESModule("resource://services-sync/UIState.sys.mjs");
    UIState.isReady();
    return UIState.get();
  },
  prepare(window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) throw new Error("Подключи аккаунт из обычного окна.");
    Services.prefs.setBoolPref("identity.fxaccounts.enabled", true);
    const {EnsureFxAccountsWebChannel} = ChromeUtils.importESModule("resource://gre/modules/FxAccountsWebChannel.sys.mjs");
    EnsureFxAccountsWebChannel();
    window.gSync.init();
  },
  async connect(window) {
    this.prepare(window);
    await window.gSync.openFxAEmailFirstPage("preferences");
  },
  sync(window) { this.prepare(window); window.gSync.doSync(); },
  async disconnect(window) { this.prepare(window); await window.gSync.disconnect(); },
  settings(window) {
    this.prepare(window);
    window.openTrustedLinkIn("chrome://browser/content/preferences/advanced.xhtml#sync", "tab");
  },
};
