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
        const ids = new Set(tabs.map((tab) => tab.zenSyncId).filter(Boolean));
        for (const tab of sidebar.tabs ?? []) {
          if (!tab.zenSyncId || !ids.has(tab.zenSyncId)) tabs.push(tab);
          if (tab.zenSyncId) ids.add(tab.zenSyncId);
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
            zenWorkspace: pin.workspaceUuid,
            userContextId: pin.containerTabId || 0,
          });
        }
      }
      const selectedSource = (sourceWindow.tabs ?? [])[
        Math.max(0, (sourceWindow.selected ?? 1) - 1)
      ];
      const active =
        getWorkspace(selectedSource ?? {}) ||
        String(sourceWindow.workspaceID ?? "") ||
        items[0].id;
      const activeId = items.some((item) => item.id === active)
        ? active
        : items[0].id;
      const converted = [];
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
        const workspace = getWorkspace(source) || activeId;
        for (const key of Object.keys(tab))
          if (/^(?:zen|_zen)/.test(key)) delete tab[key];
        tab.entries = tab.entries.map((entry) => ({
          ...entry,
          url: /^about:zen/.test(entry.url) ? "about:newtab" : entry.url,
        }));
        if (tab.groupId || tab.splitViewId)
          warnings.add(
            "Папки, группы и split view перенесены отдельными вкладками.",
          );
        delete tab.groupId;
        delete tab.splitViewId;
        delete tab.searchMode;
        tab.hidden = false;
        tab.pinned = !!(source.pinned || source.zenEssential);
        tab.extData = { ...(tab.extData ?? {}), "night-workspace": workspace };
        if (source === selectedSource) selected = converted.length + 1;
        converted.push(tab);
        count++;
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
          "night-workspaces": JSON.stringify({ items, active: activeId }),
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
