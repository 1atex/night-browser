(() => {
  const start = () => {
    try {
      const { NightBrowser } = ChromeUtils.importESModule("resource:///modules/night/NightBrowser.sys.mjs");
      NightBrowser.init(window);
    } catch (error) {
      console.error("Night startup failed", error);
    }
  };
  const observer = subject => {
    if (subject !== window) return;
    Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
    start();
  };
  if (window.gBrowserInit?.delayedStartupFinished) start();
  else {
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
    window.addEventListener("unload", () => {
      try { Services.obs.removeObserver(observer, "browser-delayed-startup-finished"); } catch {}
    }, { once: true });
  }
})();
