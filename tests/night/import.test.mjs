import test from "node:test";
import assert from "node:assert/strict";
import {
  parseIni,
  importPreferences,
  convertZenSession,
  relocateExtensions,
} from "../../src/night/ZenImportModel.mjs";

test("discovers INI profile metadata without executing values", () => {
  const ini = parseIni(
    "\uFEFF[Profile0]\r\nName=Личное\r\nPath=Profiles/user.default\r\nIsRelative=1\r\n;ignored=true\r\n[Profile1]\r\nPath=D:\\Zen профиль\r\nIsRelative=0",
  );
  assert.equal(ini.Profile0.Name, "Личное");
  assert.equal(ini.Profile1.Path, "D:\\Zen профиль");
  assert.equal(ini.Profile0.ignored, undefined);
});

test("keeps extension identities and user data preferences while dropping shell, updater and security bypasses", () => {
  const source = [
    'user_pref("extensions.webextensions.uuids", "{\\"addon@example.test\\":\\"uuid\\"}");',
    'user_pref("signon.rememberSignons", false);',
    'user_pref("browser.uiCustomization.state", "zen-layout");',
    'user_pref("browser.bypassAutoTriggerActions", false);',
    'user_pref("xpinstall.signatures.required", false);',
    'user_pref("extensions.webextensions.remote", false);',
    'user_pref("extensions.webextensions.ExtensionStorageIDB.migrated.addon@example.test", true);',
    'user_pref("security.sandbox.content.level", 0);',
    'user_pref("zen.theme.accent-color", "red");',
    'user_pref("app.update.auto", true);',
    'user_pref("browser.search.suggest.enabled", false);',
    'user_pref("browser.search.evil", doSomething());',
  ].join("\n");
  const result = importPreferences(source);
  assert.match(result, /extensions.webextensions.uuids/);
  assert.match(result, /ExtensionStorageIDB.migrated.addon@example.test/);
  assert.doesNotMatch(result, /extensions.webextensions.remote/);
  assert.match(result, /signon.rememberSignons", false/);
  assert.match(result, /browser.search.suggest.enabled", false/);
  assert.doesNotMatch(
    result,
    /zen-layout|AutoTrigger|signatures|sandbox|accent-color|app.update|doSomething/,
  );
  assert.match(result, /resume_session_once", true/);
});

test("converts Zen workspaces, containers, essentials and session history without mutating the source", () => {
  const tab = {
    zenSyncId: "tab-a",
    zenWorkspace: "work",
    zenEssential: true,
    userContextId: 4,
    entries: [
      { url: "https://example.test/one" },
      { url: "https://example.test/two" },
    ],
    index: 2,
    splitViewId: "split",
  };
  const source = { windows: [{ tabs: [tab], selected: 1 }] };
  const sidebar = {
    spaces: [
      { uuid: "work", name: "Работа" },
      { uuid: "home", name: "Дом" },
    ],
    tabs: [
      tab,
      {
        zenSyncId: "tab-b",
        zenWorkspace: "home",
        entries: [{ url: "https://example.test/home" }],
      },
    ],
  };
  const original = JSON.stringify({ source, sidebar });
  const result = convertZenSession(source, sidebar);
  assert.equal(JSON.stringify({ source, sidebar }), original);
  assert.equal(result.tabs, 2);
  assert.equal(result.workspaces, 2);
  const imported = result.session.windows[0].tabs[0];
  assert.equal(imported.index, 2);
  assert.equal(imported.userContextId, 4);
  assert.equal(imported.pinned, true);
  assert.equal(imported.extData["night-workspace"], "work");
  assert.equal(imported.zenSyncId, undefined);
  assert.equal(imported.splitViewId, undefined);
  assert.equal(
    JSON.parse(result.session.windows[0].extData["night-workspaces"]).active,
    "work",
  );
  assert.equal(result.warnings.length, 1);
});

test("preserves duplicate URLs with distinct Zen tab identities and excludes private, empty and glance tabs", () => {
  const normal = (id) => ({
    zenSyncId: id,
    entries: [{ url: "https://example.test" }],
  });
  const result = convertZenSession({
    windows: [
      {
        tabs: [
          normal("a"),
          normal("b"),
          { ...normal("p"), isPrivate: true },
          { ...normal("e"), zenIsEmpty: true },
          { ...normal("g"), zenIsGlance: true },
        ],
      },
      { tabs: [normal("private")], isPrivate: true },
    ],
  });
  assert.equal(result.tabs, 2);
  assert.equal(result.session.windows.length, 1);
});

test("imports older Places workspace and pin records and uses valid empty-session defaults", () => {
  const result = convertZenSession(
    {},
    {},
    {
      spaces: [{ uuid: "legacy", name: "Старое" }],
      pins: [
        {
          uuid: "p",
          url: "https://example.test",
          workspaceUuid: "legacy",
          containerTabId: 2,
          isEssential: true,
        },
        { uuid: "folder", isGroup: true },
      ],
    },
  );
  assert.equal(result.tabs, 1);
  assert.equal(result.session.windows[0].tabs[0].pinned, true);
  assert.equal(result.session.windows[0].tabs[0].userContextId, 2);
  assert.equal(
    convertZenSession().session.windows[0].tabs[0].entries[0].url,
    "about:newtab",
  );
});

test("relocates installed extension paths without changing extension payload data", () => {
  const db = {
    addons: [
      {
        path: "C:\\Zen\\extensions\\a.xpi",
        rootURI: "jar:file:///C:/Zen/extensions/a.xpi!/",
        name: "C:\\Zen",
      },
    ],
  };
  const copy = relocateExtensions(
    db,
    "C:\\Zen",
    "D:\\Night\\profile",
    "file:///C:/Zen",
    "file:///D:/Night/profile",
  );
  assert.equal(copy.addons[0].path, "D:\\Night\\profile\\extensions\\a.xpi");
  assert.equal(
    copy.addons[0].rootURI,
    "jar:file:///D:/Night/profile/extensions/a.xpi!/",
  );
  assert.equal(copy.addons[0].name, "C:\\Zen");
  assert.equal(db.addons[0].path, "C:\\Zen\\extensions\\a.xpi");
});

test("keeps nested folders, workspace pins, global essentials and saved favicons separate", () => {
  const make = (id, extra = {}) => ({zenSyncId: id, zenWorkspace: "work", pinned: true, entries: [{url: `https://example.test/${id}`}], index: 1, ...extra});
  const icon = "data:image/png;base64,aGVsbG8=";
  const result = convertZenSession({windows: [{activeZenSpace: "work", tabs: [make("nested", {_zenIsActiveTab: true})]}]}, {
    spaces: [{uuid: "work", name: "Работа"}, {uuid: "home", name: "Дом"}],
    folders: [
      {id: "parent", name: "Проекты", workspaceId: "work", collapsed: true},
      {id: "child", name: "API", workspaceId: "work", parentId: "parent"},
      {id: "empty", name: "Пустая", workspaceId: "home"},
    ],
    tabs: [make("nested", {groupId: "child", image: icon}), make("global", {zenEssential: true}), make("scoped")],
  });
  const window = result.session.windows[0];
  const layout = JSON.parse(window.extData["night-workspaces"]);
  assert.equal(layout.folders.length, 3);
  assert.equal(layout.folders.find(f => f.id === "child").parentId, "parent");
  assert.equal(layout.folders.find(f => f.id === "parent").collapsed, true);
  const nested = window.tabs.find(t => t.extData["night-node"] === "nested");
  assert.equal(nested.extData["night-folder"], "child");
  assert.equal(nested.extData["night-pinned"], "true");
  assert.equal(nested.extData["night-favicon"], icon);
  assert.equal(nested.pinned, false);
  assert.equal(window.tabs.filter(t => t.pinned).length, 1);
  assert.equal(window.tabs.find(t => t.extData["night-node"] === "scoped").extData["night-pinned"], "true");
});

test("retains legacy nested folder parent, collapse and named pin metadata", () => {
  const result = convertZenSession({}, {}, {
    spaces: [{uuid: "work", name: "Work"}],
    pins: [
      {uuid: "a", title: "Root", isGroup: true, workspaceUuid: "work", isFolderCollapsed: true},
      {uuid: "b", title: "Nested", isGroup: true, workspaceUuid: "work", parentUuid: "a"},
      {uuid: "p", title: "Custom title", url: "https://example.test", workspaceUuid: "work", parentUuid: "b", editedTitle: true},
    ],
  });
  const window = result.session.windows[0];
  const folders = JSON.parse(window.extData["night-workspaces"]).folders;
  assert.equal(folders.find(f => f.id === "b").parentId, "a");
  assert.equal(folders.find(f => f.id === "a").collapsed, true);
  assert.equal(window.tabs[0].extData["night-folder"], "b");
  assert.equal(window.tabs[0].extData["night-title"], "Custom title");
});
