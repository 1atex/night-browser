window.addEventListener("DOMContentLoaded", async () => {
  const { NightImport } = ChromeUtils.importESModule("resource:///modules/night/NightImport.sys.mjs");
  const owner = window.browsingContext.topChromeWindow;
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  let busy = false, staged = false, progressTimer;
  window.addEventListener("unload", () => window.clearInterval(progressTimer), { once: true });
  const status = text => { $("status").textContent = text; };
  const show = step => {
    ["appearance", "migration", "ready"].forEach((id, index) => { $(id).hidden = index !== step; });
    $("progress").textContent = `${step + 1} / 3`;
    const heading = document.querySelector("section:not([hidden]) h1");
    heading.tabIndex = -1;
    heading.focus();
    status("");
  };
  const theme = () => {
    const palette = Services.prefs.getStringPref("night.ui.palette", "night");
    root.dataset.palette = palette;
    root.dataset.layout = Services.prefs.getStringPref("night.ui.navigation-layout", "sidebar");
    root.toggleAttribute("data-motion", Services.prefs.getBoolPref("night.ui.animations", true));
    for (const button of $("palettes").children) if (button.dataset.palette) button.setAttribute("aria-pressed", String(button.dataset.palette === palette));
  };
  theme();
  $("palettes").addEventListener("click", event => {
    if (!event.target.dataset.palette) return;
    Services.prefs.setStringPref("night.ui.palette", event.target.dataset.palette);
    theme();
  });
  $("layout").value = root.dataset.layout;
  $("layout").addEventListener("change", () => { Services.prefs.setStringPref("night.ui.navigation-layout", $("layout").value); theme(); });
  $("motion").checked = root.hasAttribute("data-motion");
  $("motion").addEventListener("change", () => { Services.prefs.setBoolPref("night.ui.animations", $("motion").checked); theme(); });
  const selection = () => {
    $("profile-path").textContent = $("profiles").value || "Не найден автоматически. Можно указать папку вручную или перенести данные позже в настройках.";
    $("import").disabled = busy || !$("consent").checked || !$("profiles").value;
  };
  const addProfile = (name, path) => {
    const option = document.createElementNS("http://www.w3.org/1999/xhtml", "option");
    option.value = path; option.textContent = name;
    $("profiles").append(option);
  };
  $("next").onclick = () => show(1);
  $("back").onclick = () => show(0);
  $("skip").onclick = () => show(2);
  $("profiles").onchange = selection;
  $("consent").onchange = selection;
  $("pick").onclick = async () => {
    try {
      const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      picker.init(owner.browsingContext, "Папка профиля Zen", Ci.nsIFilePicker.modeGetFolder);
      if (await new Promise(resolve => picker.open(resolve)) !== Ci.nsIFilePicker.returnOK) return;
      await NightImport.inspect(picker.file.path);
      addProfile(picker.file.leafName, picker.file.path);
      $("profiles").value = picker.file.path;
      selection();
    } catch (error) { status(error.message); }
  };
  $("import").onclick = async () => {
    busy = true;
    for (const node of $("migration").querySelectorAll("button,input,select")) node.disabled = true;
    status("Копируем данные. Это может занять несколько минут…");
    progressTimer = window.setInterval(() => {
      const progress = NightImport.status;
      if (progress.phase === "copying") status(`Скопировано файлов: ${progress.files} · ${Math.round(progress.bytes / 1048576)} МБ`);
      else if (progress.phase === "preparing") status("Восстанавливаем пространства, папки и значки…");
    }, 500);
    try {
      const report = await NightImport.stage($("profiles").value);
      staged = true;
      show(2);
      $("ready-copy").textContent = "Данные подготовлены. Перезапуск применит импорт и откроет твои пространства.";
      $("ready-note").textContent = "Исходный профиль Zen не изменён";
      $("finish").textContent = "Перезапустить и открыть →";
      status(report.warnings?.join(" ") || "Резервная копия текущего профиля будет сохранена при перезапуске.");
    } catch (error) { status(error.message); }
    finally {
      window.clearInterval(progressTimer);
      busy = false;
      for (const node of $("migration").querySelectorAll("button,input,select")) node.disabled = false;
      selection();
    }
  };
  $("default-browser").hidden = !NightImport.supported || !await IOUtils.exists(PathUtils.join(NightImport.applicationRoot, "installed.marker"));
  $("default-browser").onclick = () => {
    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(PathUtils.join(NightImport.applicationRoot, "Night.exe"));
      const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      process.init(file); process.runwAsync(["--default-browser"], 1);
      status("Выбери Night Browser в настройках приложений Windows.");
    } catch (error) { status(error.message); }
  };
  $("finish").onclick = () => {
    Services.prefs.setBoolPref("night.onboarding.completed", true);
    Services.prefs.savePrefFile(null);
    if (staged) NightImport.restart();
    else window.location.replace("about:home");
  };
  try {
    if (await NightImport.pending()) {
      staged = true;
      show(2);
      $("ready-copy").textContent = "Импорт уже подготовлен. Перезапусти браузер, чтобы применить его.";
      $("finish").textContent = "Перезапустить и открыть →";
    }
    for (const profile of await NightImport.discover()) addProfile(profile.name, profile.path);
    if (!NightImport.supported) $("import-form").hidden = true;
    selection();
  } catch (error) { status(error.message); }
}, { once: true });
