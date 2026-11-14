import { normalizeFolders, savedTabEntry, validIcon } from "./WorkspaceModel.mjs";

export function parseIni(text) {
  const result = Object.create(null);
  let section;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const heading = line.trim().match(/^\[([^\]]+)\]$/);
    if (heading) section = result[heading[1]] = Object.create(null);
    else if (section && !/^\s*[;#]/.test(line)) {
      const index = line.indexOf("=");
      if (index > 0)
        section[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  return result;
}

export function importPreferences(text) {
  const allowed =
    /^(?:extensions\.(?:webextensions\.(?:uuids$|ExtensionStorageIDB\.migrated\.)|[a-z0-9_-]+@)|browser\.(?:download\.|search\.|urlbar\.|zoom\.)|privacy\.(?:trackingprotection\.|userContext\.)|network\.cookie\.|permissions\.default\.|font\.|signon\.|dom\.security\.https_only_mode$|intl\.accept_languages$)/i;
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^user_pref\(("(?:[^"\\]|\\.)*"),\s*(.+)\);\s*$/);
    if (!match) continue;
    try {
      const key = JSON.parse(match[1]);
      const value = JSON.parse(match[2]);
      if (
        allowed.test(key) &&
        ["string", "boolean", "number"].includes(typeof value)
      )
        values.set(key, value);
    } catch {}
  }
  values.set("browser.startup.page", 3);
  values.set("browser.sessionstore.resume_session_once", true);
  values.set("night.import.completed", true);
  return (
    [...values]
      .map(
        ([key, value]) =>
          `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
      )
      .join("\n") + "\n"
  );
}

export function convertZenSession(session = {}, sidebar = {}, legacy = {}) {
  const sourceWindows = Array.isArray(session.windows) ? session.windows : [];
  const spaces = sidebar.spaces?.length
    ? sidebar.spaces
    : (sourceWindows.find((w) => w.spaces?.length)?.spaces ??
      legacy.spaces ??
      []);
  const items = [];
  for (const space of spaces) {
    const id = String(space.uuid ?? space.id ?? "");
    if (id && !items.some((item) => item.id === id))
      items.push({
        id,
        name: String(space.name || "Область Zen").slice(0, 40),
      });
  }
  const getWorkspace = (tab) =>
    String(tab.zenWorkspace ?? tab.zenWorkspaceId ?? tab.workspaceUuid ?? "");
  const knownTabs = [
    ...(sidebar.tabs ?? []),
    ...sourceWindows.flatMap((w) => w.tabs ?? []),
    ...(legacy.pins ?? []),
  ];
  for (const tab of knownTabs) {
    const id = getWorkspace(tab);
    if (id && !items.some((item) => item.id === id))
      items.push({ id, name: `Область ${items.length + 1}` });
  }
  if (!items.length) items.push({ id: "zen-import", name: "Из Zen" });
  const warnings = new Set();
  let count = 0;
  const windows = (sourceWindows.length ? sourceWindows : [{}])
    .filter((w) => !w.isPrivate)
    .map((sourceWindow, index) => {
      let tabs = [...(sourceWindow.tabs ?? [])];
      if (index === 0) {
        const ids = new Map(tabs.map((tab, i) => [tab.zenSyncId || tab.zenPinnedId, i]).filter(([id]) => id));
        for (const tab of sidebar.tabs ?? []) {
          const id = tab.zenSyncId || tab.zenPinnedId;
          if (!id || !ids.has(id)) {
            if (id) ids.set(id, tabs.length);
            tabs.push(tab);
          } else {
            const offset = ids.get(id);
            const original = tabs[offset];
            const primary = original._zenIsActiveTab ? original : tab;
            const secondary = primary === original ? tab : original;
            tabs[offset] = { ...secondary, ...primary };
            if (!validIcon(primary.image) && validIcon(secondary.image)) tabs[offset].image = secondary.image;
            if (!savedTabEntry(primary)?.url || /^about:(blank|newtab)$/.test(savedTabEntry(primary).url))
              if (savedTabEntry(secondary)?.url && !/^about:(blank|newtab)$/.test(savedTabEntry(secondary).url)) {
                tabs[offset].entries = secondary.entries;
                tabs[offset].index = secondary.index;
              }
          }
        }
        for (const pin of legacy.pins ?? []) {
          if (
            pin.isGroup ||
            !pin.url ||
            tabs.some((tab) => tab.zenSyncId === pin.uuid)
          )
            continue;
          tabs.push({
            entries: [{ url: pin.url, title: pin.title || pin.url }],
            index: 1,
            pinned: true,
            zenEssential: !!pin.isEssential,
            zenSyncId: pin.uuid,
            zenWorkspace: pin.workspaceUuid,
            groupId: pin.parentUuid,
            zenStaticLabel: pin.editedTitle ? pin.title : undefined,
            userContextId: pin.containerTabId || 0,
          });
        }
      }
      const selectedSource = (sourceWindow.tabs ?? [])[
        Math.max(0, (sourceWindow.selected ?? 1) - 1)
      ];
      const active =
        String(sourceWindow.activeZenSpace ?? sourceWindow.workspaceID ?? "") ||
        getWorkspace(selectedSource ?? {}) ||
        items[0].id;
      const activeId = items.some((item) => item.id === active)
        ? active
        : items[0].id;
      const converted = [];
      const sidebarOrder = new Map((sidebar.tabs ?? []).map((tab, position) => [tab.zenSyncId || tab.zenPinnedId, position * 1024]));
      const rawFolders = sidebar.folders ?? sourceWindow.folders ?? (legacy.pins ?? []).filter(pin => pin.isGroup).map(pin => ({
        id: pin.uuid, name: pin.title, workspaceId: pin.workspaceUuid, parentId: pin.parentUuid,
        collapsed: pin.isFolderCollapsed, userIcon: pin.folderIcon, position: pin.position,
      }));
      const folderData = rawFolders.filter(folder => !folder.splitViewGroup).map((folder, i) => ({
        ...folder, workspace: folder.workspaceId || activeId, icon: folder.userIcon,
        position: Number.isFinite(folder.position) ? folder.position : i * 1024,
      }));
      const groups = sidebar.groups ?? sourceWindow.groups ?? [];
      for (const group of groups)
        if (!folderData.some(folder => folder.id === group.id) && !rawFolders.some(folder => folder.id === group.id && folder.splitViewGroup))
          folderData.push({ id: group.id, name: group.name || group.label || "Группа", workspace: activeId, collapsed: !!group.collapsed });
      const folders = normalizeFolders(folderData, items.map(item => item.id));
      const folderMap = new Map(folders.map(folder => [folder.id, folder]));
      let selected = 1;
      for (const source of tabs) {
        if (
          source.isPrivate ||
          source.zenIsEmpty ||
          source.zenIsGlance ||
          !source.entries?.length
        )
          continue;
        const tab = structuredClone(source);
        const splitFolder = rawFolders.find(folder => folder.id === source.groupId && folder.splitViewGroup);
        const parent = folderMap.get(splitFolder?.parentId || source.groupId);
        const workspace = parent?.workspace || getWorkspace(source) || activeId;
        for (const key of Object.keys(tab))
          if (/^(?:zen|_zen)/.test(key)) delete tab[key];
        tab.entries = tab.entries.map((entry) => ({
          ...entry,
          url: /^about:zen/.test(entry.url) ? "about:newtab" : entry.url,
        }));
        if (tab.splitViewId || splitFolder)
          warnings.add(
            "Split view перенесены отдельными вкладками внутри прежних папок.",
          );
        delete tab.groupId;
        delete tab.splitViewId;
        delete tab.searchMode;
        tab.hidden = false;
        tab.pinned = !!source.zenEssential;
        tab.extData = {
          ...(tab.extData ?? {}), "night-workspace": workspace,
          "night-node": String(source.zenSyncId || source.zenPinnedId || `import-tab-${index}-${converted.length}`),
          "night-order": String(sidebarOrder.get(source.zenSyncId || source.zenPinnedId) ?? ((sidebar.tabs?.length ?? 0) + converted.length) * 1024),
        };
        if (parent && !tab.pinned) tab.extData["night-folder"] = parent.id;
        if ((source.pinned || parent) && !tab.pinned) tab.extData["night-pinned"] = "true";
        if (source.zenStaticLabel) tab.extData["night-title"] = String(source.zenStaticLabel).slice(0, 200);
        if (validIcon(source.image)) tab.extData["night-favicon"] = source.image;
        if (source === selectedSource || (selectedSource?.zenSyncId && source.zenSyncId === selectedSource.zenSyncId)) selected = converted.length + 1;
        converted.push(tab);
        count++;
      }
      const positions = new Map(converted.map(tab => [tab.extData["night-node"], Number(tab.extData["night-order"])]));
      for (const folder of folders) {
        const children = converted.filter(tab => tab.extData["night-folder"] === folder.id);
        if (children.length) folder.position = Math.min(...children.map(tab => Number(tab.extData["night-order"]))) - 1;
        positions.set(folder.id, folder.position);
      }
      for (let pass = 0; pass < folders.length; pass++) {
        let changed = false;
        for (const folder of folders) {
          const previous = rawFolders.find(item => item.id === folder.id)?.prevSiblingInfo;
          if (previous?.id && positions.has(previous.id) && positions.get(previous.id) >= folder.position) {
            folder.position = positions.get(previous.id) + 1;
            positions.set(folder.id, folder.position);
            changed = true;
          }
        }
        if (!changed) break;
      }
      if (!converted.length)
        converted.push({
          entries: [{ url: "about:newtab" }],
          index: 1,
          extData: { "night-workspace": activeId },
        });
      return {
        tabs: converted,
        selected,
        cookies: sourceWindow.cookies,
        extData: {
          "night-workspaces": JSON.stringify({ items, active: activeId, folders, layoutVersion: 2 }),
        },
      };
    });
  if (!windows.length)
    windows.push({
      tabs: [{ entries: [{ url: "about:newtab" }], index: 1 }],
      selected: 1,
      extData: {
        "night-workspaces": JSON.stringify({ items, active: items[0].id }),
      },
    });
  return {
    session: {
      version: ["sessionrestore", 1],
      windows,
      selectedWindow: Math.max(
        1,
        Math.min(session.selectedWindow || 1, windows.length),
      ),
      session: {
        lastUpdate: Date.now(),
        startTime: Date.now(),
        recentCrashes: 0,
      },
    },
    tabs: count,
    workspaces: items.length,
    warnings: [...warnings],
  };
}

export function relocateExtensions(
  database,
  sourcePath,
  targetPath,
  sourceURI,
  targetURI,
) {
  const copy = structuredClone(database);
  for (const addon of copy.addons ?? []) {
    if (
      typeof addon.path === "string" &&
      addon.path.toLowerCase().startsWith(sourcePath.toLowerCase() + "\\")
    )
      addon.path = targetPath + addon.path.slice(sourcePath.length);
    if (typeof addon.rootURI === "string")
      addon.rootURI = addon.rootURI.replace(sourceURI, targetURI);
  }
  return copy;
}
