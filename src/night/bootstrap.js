(() => {
  const { NightBrowser } = ChromeUtils.importESModule("resource:///modules/night/NightBrowser.sys.mjs");
  const start = () => {
    try {
      NightBrowser.init(window);
      document.documentElement.removeAttribute("night-starting");
    } catch (error) {
      console.error("Night startup failed", error);
      const message = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      message.id = "night-startup-error";
      message.textContent = "Не удалось открыть интерфейс. Закрой окно и запусти браузер ещё раз. Если ошибка повторится, распакуй новую копию приложения — профиль можно сохранить.";
      document.documentElement.append(message);
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
