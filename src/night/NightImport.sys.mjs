import {
  parseIni,
  importPreferences,
  convertZenSession,
  relocateExtensions,
} from "resource:///modules/night/ZenImportModel.mjs";
import {
  setInterval,
  clearInterval,
} from "resource://gre/modules/Timer.sys.mjs";

function file(path) {
  const result = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  result.initWithPath(path);
  return result;
}
const optionalColumn = (row, name) => {try {return row.getResultByName(name);} catch {return null;}};
const readText = async (path) =>
  (await IOUtils.exists(path)) ? IOUtils.readUTF8(path) : "";

export const NightImport = {
  status: { phase: "idle", files: 0, bytes: 0 },
  get applicationRoot() {
    return Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.parent.path;
  },
  get root() {
    return Services.dirsvc.get("ProfD", Ci.nsIFile).parent.path;
  },
  get supported() {
    return Services.appinfo.OS === "WINNT";
  },

  async discover() {
    if (!this.supported) return [];
    const base = Services.dirsvc.get("AppData", Ci.nsIFile).path;
    const result = [];
    for (const name of ["zen", "Zen", "zen-twilight"]) {
      const directory = PathUtils.join(base, name);
      const ini = parseIni(
        await readText(PathUtils.join(directory, "profiles.ini")),
      );
      for (const [key, value] of Object.entries(ini)) {
        if (!/^Profile\d+$/.test(key) || !value.Path) continue;
        const path =
          value.IsRelative === "1"
            ? PathUtils.join(directory, ...value.Path.split(/[\\/]/))
            : value.Path;
        if (
          result.some((item) => item.path.toLowerCase() === path.toLowerCase())
        )
          continue;
        if (await IOUtils.exists(PathUtils.join(path, "prefs.js")))
          result.push({
            name: value.Name || "Zen",
            path,
            default: value.Default === "1",
          });
      }
    }
    return result.sort((a, b) => Number(b.default) - Number(a.default));
  },

  async inspect(path) {
    if (
      !(await IOUtils.exists(PathUtils.join(path, "places.sqlite"))) ||
      !(await IOUtils.exists(PathUtils.join(path, "prefs.js")))
    )
      throw new Error("Выбери папку профиля Zen с prefs.js и places.sqlite.");
    const compatibility = parseIni(
      await readText(PathUtils.join(path, "compatibility.ini")),
    );
    const version = compatibility.Compatibility?.LastVersion?.split("_")[0];
    if (!version || !/^\d/.test(version))
      throw new Error(
        "Не удалось определить версию профиля. Запусти и закрой Zen, затем повтори импорт.",
      );
    if (Services.vc.compare(version, Services.appinfo.platformVersion) > 0)
      throw new Error(
        `Профиль использует Gecko ${version}, текущая версия движка — ${Services.appinfo.platformVersion}. Сначала обнови браузер: перенос в более старый движок может повредить данные.`,
      );
    return { version };
  },

  async pending() {
    return IOUtils.exists(PathUtils.join(this.root, "night-import.json"));
  },

  async stage(source) {
    if (!this.supported)
      throw new Error("Импорт доступен в версии для Windows.");
    if (["copying", "preparing"].includes(this.status.phase))
      throw new Error("Импорт уже выполняется.");
    if (await this.pending())
      throw new Error(
        "Предыдущий импорт готов. Перезапусти браузер, чтобы его применить.",
      );
    await this.inspect(source);
    const id = Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
    const stageName = `import-stage-${id}`;
    const destination = PathUtils.join(this.root, stageName);
    const reportPath = destination + ".json";
    const backup = `profile-backup-${id}`;
    this.status = { phase: "copying", files: 0, bytes: 0 };
    let ticker;
    try {
      const process = Cc["@mozilla.org/process/util;1"].createInstance(
        Ci.nsIProcess,
      );
      process.init(file(PathUtils.join(this.applicationRoot, "Night.exe")));
      ticker = setInterval(async () => {
        try {
          const progress = await IOUtils.readJSON(reportPath);
          if (progress.status === "copying")
            this.status = {
              phase: "copying",
              files: progress.files,
              bytes: progress.bytes,
            };
        } catch {}
      }, 500);
      await new Promise((resolve, reject) =>
        process.runwAsync(["--copy-zen", source, stageName], 3, {
          observe(_subject, topic) {
            topic === "process-finished" && process.exitValue === 0
              ? resolve()
              : reject(new Error("Не удалось скопировать профиль."));
          },
        }),
      );
      clearInterval(ticker);
      const copied = await IOUtils.readJSON(reportPath);
      this.status = {
        phase: "preparing",
        files: copied.files,
        bytes: copied.bytes,
      };
      const summary = await this.prepare(destination, source);
      await IOUtils.writeJSON(
        PathUtils.join(destination, "night-import-report.json"),
        {
          ...summary,
          source: "Zen",
          importedAt: new Date().toISOString(),
          backup,
        },
        { tmpPath: PathUtils.join(destination, "night-import-report.tmp") },
      );
      await IOUtils.writeUTF8(
        PathUtils.join(destination, "night-import-ready.json"),
        stageName,
      );
      await IOUtils.writeJSON(
        PathUtils.join(this.root, "night-import.json"),
        { stage: stageName, backup },
        { tmpPath: PathUtils.join(this.root, "night-import.tmp") },
      );
      this.status = { ...this.status, ...summary, phase: "ready", backup };
      return this.status;
    } catch (error) {
      let detail = error.message;
      try {
        const report = await IOUtils.readJSON(reportPath);
        if (report.message) detail = report.message;
      } catch {}
      await IOUtils.remove(destination, {
        recursive: true,
        ignoreAbsent: true,
      }).catch(() => {});
      this.status = { phase: "error", message: detail };
      throw new Error(detail);
    } finally {
      clearInterval(ticker);
      await IOUtils.remove(reportPath, { ignoreAbsent: true }).catch(() => {});
    }
  },

  currentPreferences() {
    return Services.prefs.getChildList("night.ui.").map(key => {
      const type = Services.prefs.getPrefType(key);
      const value = type === 128 ? Services.prefs.getBoolPref(key) : type === 64 ? Services.prefs.getIntPref(key) : Services.prefs.getStringPref(key);
      return `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
    }).join("\n") + '\nuser_pref("night.onboarding.completed", true);\n';
  },

  async prepare(destination, source) {
    const warnings = [];
    const readSession = async (paths) => {
      for (const name of paths) {
        const path = PathUtils.join(destination, ...name.split("/"));
        if (!(await IOUtils.exists(path))) continue;
        try {
          return await IOUtils.readJSON(path, { decompress: true });
        } catch {
          warnings.push(
            `Не удалось прочитать ${name}; проверена следующая резервная копия.`,
          );
        }
      }
      return {};
    };
    const session = await readSession([
      "sessionstore.jsonlz4",
      "sessionstore-backups/recovery.jsonlz4",
      "sessionstore-backups/previous.jsonlz4",
      "sessionstore-backups/recovery.baklz4",
    ]);
    const sidebar = await readSession([
      "zen-sessions.jsonlz4",
      "zen-sessions-backup/clean.jsonlz4",
    ]);
    const legacy = { spaces: [], pins: [] };
    if (
      !sidebar.spaces?.length &&
      !session.windows?.some((w) => w.spaces?.length)
    ) {
      const { Sqlite } = ChromeUtils.importESModule(
        "resource://gre/modules/Sqlite.sys.mjs",
      );
      const db = await Sqlite.openConnection({
        path: PathUtils.join(destination, "places.sqlite"),
        readOnly: true,
      });
      try {
        if (await db.tableExists("zen_workspaces"))
          legacy.spaces = (
            await db.execute(
              "SELECT uuid, name FROM zen_workspaces ORDER BY position",
            )
          ).map((row) => ({
            uuid: row.getResultByName("uuid"),
            name: row.getResultByName("name"),
          }));
        if (await db.tableExists("zen_pins"))
          legacy.pins = (
            await db.execute("SELECT * FROM zen_pins ORDER BY position")
          ).map((row) => ({
            uuid: row.getResultByName("uuid"),
            title: row.getResultByName("title"),
            url: row.getResultByName("url"),
            workspaceUuid: row.getResultByName("workspace_uuid"),
            containerTabId: row.getResultByName("container_id"),
            isEssential: !!row.getResultByName("is_essential"),
            isGroup: !!row.getResultByName("is_group"),
            parentUuid: optionalColumn(row, "folder_parent_uuid"),
            folderIcon: optionalColumn(row, "folder_icon"),
            isFolderCollapsed: !!optionalColumn(row, "is_folder_collapsed"),
            editedTitle: !!optionalColumn(row, "edited_title"),
            position: optionalColumn(row, "position"),
          }));
      } finally {
        await db.close();
      }
    }
    const converted = convertZenSession(session, sidebar, legacy);
    await IOUtils.writeJSON(PathUtils.join(destination, "night-zen-source.jsonlz4"), {session, sidebar, legacy}, {compress: true});
    await IOUtils.writeJSON(
      PathUtils.join(destination, "sessionstore.jsonlz4"),
      converted.session,
      { compress: true },
    );
    await IOUtils.remove(PathUtils.join(destination, "sessionstore-backups"), {
      recursive: true,
      ignoreAbsent: true,
    });
    const prefsPath = PathUtils.join(destination, "prefs.js");
    await IOUtils.writeUTF8(
      prefsPath,
      importPreferences(await readText(prefsPath)) + this.currentPreferences(),
    );
    const addons = PathUtils.join(destination, "extensions.json");
    if (await IOUtils.exists(addons)) {
      const target = PathUtils.join(this.root, "profile");
      await IOUtils.writeJSON(
        addons,
        relocateExtensions(
          await IOUtils.readJSON(addons),
          source,
          target,
          Services.io.newFileURI(file(source)).spec,
          Services.io.newFileURI(file(target)).spec,
        ),
      );
    }
    return {
      tabs: converted.tabs,
      workspaces: converted.workspaces,
      warnings: [...warnings, ...converted.warnings],
    };
  },

  async repair(window) {
    const { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
    const { savedTabEntry } = ChromeUtils.importESModule("resource:///modules/night/WorkspaceModel.mjs");
    const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
    let source;
    for (const name of ["night-zen-source.jsonlz4", "zen-sessions.jsonlz4", "zen-sessions-backup/clean.jsonlz4"]) {
      try {
        const value = await IOUtils.readJSON(PathUtils.join(profile, ...name.split("/")), {decompress: true});
        source = name === "night-zen-source.jsonlz4" ? value : {sidebar: value};
        break;
      } catch {}
    }
    if (!source) throw new Error("Снимок прошлого импорта не найден. Для восстановления папок потребуется новый импорт из Zen.");
    const converted = convertZenSession(source.session, source.sidebar, source.legacy);
    const incoming = converted.session.windows.flatMap(item => item.tabs);
    const layout = JSON.parse(converted.session.windows[0].extData["night-workspaces"]);
    const shell = window.gNightBrowser.shell;
    const candidates = [...window.gBrowser.tabs];
    const matches = [];
    for (const imported of incoming) {
      const url = savedTabEntry(imported)?.url;
      const identity = imported.extData?.["night-node"];
      let tab = candidates.find(candidate => identity && SessionStore.getCustomTabValue(candidate, "night-node") === identity);
      if (!tab) {
        const same = candidates.filter(candidate => candidate.linkedBrowser.currentURI.spec === url &&
          Number(candidate.getAttribute("usercontextid") || 0) === Number(imported.userContextId || 0) &&
          shell.workspaces.workspaceOf(candidate) === imported.extData?.["night-workspace"]);
        if (same.length === 1) tab = same[0];
        else if (!same.length && incoming.filter(item => savedTabEntry(item)?.url === url && Number(item.userContextId || 0) === Number(imported.userContextId || 0)).length === 1) {
          const global = candidates.filter(candidate => candidate.pinned && candidate.linkedBrowser.currentURI.spec === url && Number(candidate.getAttribute("usercontextid") || 0) === Number(imported.userContextId || 0));
          if (global.length === 1) tab = global[0];
        }
      }
      if (!tab) continue;
      candidates.splice(candidates.indexOf(tab), 1);
      matches.push([tab, imported]);
    }
    if (!matches.length) throw new Error("Не удалось однозначно сопоставить вкладки с прошлым импортом. Текущие вкладки не изменены.");
    const backup = `night-layout-backup-${Date.now()}.jsonlz4`;
    const current = SessionStore.getWindowState(window);
    await IOUtils.writeJSON(PathUtils.join(profile, backup), typeof current === "string" ? JSON.parse(current) : current, {compress: true});
    for (const [tab, imported] of matches) {
      if (tab.pinned && !imported.pinned) window.gBrowser.unpinTab(tab);
      if (!tab.pinned && imported.pinned) window.gBrowser.pinTab(tab);
      for (const key of ["night-workspace", "night-folder", "night-pinned", "night-title", "night-favicon", "night-order", "night-node"])
        if (imported.extData?.[key]) SessionStore.setCustomTabValue(tab, key, imported.extData[key]);
        else SessionStore.deleteCustomTabValue(tab, key);
    }
    shell.workspaces.adoptLayout(layout);
    shell.render();
    return {matched: matches.length, skipped: incoming.length - matches.length, backup};
  },

  restart() {
    const process = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess,
    );
    process.init(file(PathUtils.join(this.applicationRoot, "Night.exe")));
    process.runwAsync(
      ["--finish-import", String(Services.appinfo.processID)],
      2,
    );
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  },
};
