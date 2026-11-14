export const MAX_DOWNLOADS = 32;
export const MAX_FRAME = 32768;
const STATES = new Set(["active", "paused", "complete", "failed", "cancelled"]);
const ACTIONS = new Set(["pause", "resume", "cancel", "reveal"]);

export function downloadState(download) {
  if (download.succeeded) return "complete";
  if (download.error) return "failed";
  if (download.canceled) return download.hasPartialData ? "paused" : "cancelled";
  return download.stopped ? "paused" : "active";
}

export function allowedActions(download) {
  const state = downloadState(download);
  if (state === "complete") return ["reveal"];
  if (state === "active") return ["pause", "cancel"];
  if (state === "paused") return ["resume", "cancel"];
  if (state === "failed") return ["resume", "cancel"];
  return [];
}

export function downloadItem(id, download) {
  if (download.source?.isPrivate) return null;
  const name = (download.target.path.split(/[\\/]/).pop() || "Файл").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160);
  return { id, name, state: downloadState(download),
    current: Math.max(0, Math.floor(download.currentBytes || 0)),
    total: download.hasProgress ? Math.max(0, Math.floor(download.totalBytes || 0)) : null,
    actions: allowedActions(download) };
}

export function validCommand(message) {
  return message?.v === 1 && message.type === "command" &&
    typeof message.id === "string" && message.id.length <= 64 &&
    typeof message.request === "string" && message.request.length <= 64 && ACTIONS.has(message.action);
}

export function validSnapshot(message) {
  return message?.v === 1 && message.type === "downloads" && Array.isArray(message.items) &&
    message.items.length <= MAX_DOWNLOADS && message.items.every(item =>
      typeof item.id === "string" && item.id.length <= 64 && typeof item.name === "string" && item.name.length <= 160 &&
      STATES.has(item.state) && Number.isSafeInteger(item.current) && item.current >= 0 &&
      (item.total === null || Number.isSafeInteger(item.total) && item.total >= 0) &&
      Array.isArray(item.actions) && item.actions.every(action => ACTIONS.has(action)));
}
