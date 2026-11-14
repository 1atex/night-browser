export function normalizeFolders(input, workspaceIds) {
  const folders = [];
  const ids = new Set();
  for (const item of Array.isArray(input) ? input.slice(0, 2000) : []) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) continue;
    const workspace = String(item.workspace ?? item.workspaceId ?? "");
    if (!workspaceIds.includes(workspace)) continue;
    ids.add(item.id);
    folders.push({
      id: item.id,
      name: String(item.name || "Папка").slice(0, 100),
      workspace,
      parentId: typeof item.parentId === "string" ? item.parentId : null,
      collapsed: !!item.collapsed,
      position: Number.isFinite(item.position) ? item.position : folders.length * 1024,
      icon: typeof item.icon === "string" && /^data:image\//.test(item.icon) ? item.icon : "",
    });
  }
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  for (const folder of folders) {
    const seen = new Set([folder.id]);
    let parent = byId.get(folder.parentId);
    if (!parent || parent.workspace !== folder.workspace) folder.parentId = null;
    while (parent) {
      if (seen.has(parent.id)) {
        folder.parentId = null;
        break;
      }
      seen.add(parent.id);
      parent = byId.get(parent.parentId);
    }
  }
  return folders;
}

export function folderContains(folders, ancestor, child) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const seen = new Set();
  for (let id = child; id && !seen.has(id); id = byId.get(id)?.parentId) {
    if (id === ancestor) return true;
    seen.add(id);
  }
  return false;
}

export function savedTabEntry(state) {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  return entries[Math.max(0, Math.min(entries.length - 1, (state?.index || entries.length) - 1))] ?? null;
}

export function validIcon(value) {
  return typeof value === "string" && /^(?:data:image\/|https?:|page-icon:|moz-anno:favicon:|chrome:|resource:|moz-extension:)/.test(value);
}
