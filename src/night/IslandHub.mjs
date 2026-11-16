export const HUB_CAPABILITIES = ["tabs", "pocket", "activity", "requests"];
export const MAX_TAB_RESULTS = 8;

export function cleanText(value, limit) {
  return typeof value === "string" ? [...value.replace(/[\p{Cc}\p{Cf}]/gu, " ")].slice(0, limit).join("").trim() : "";
}

export function webURL(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.href.length > 2048 || url.username || url.password) return "";
    return url.href;
  } catch { return ""; }
}

export function pocketItem(input) {
  if (!input || !["link", "text", "image"].includes(input.kind)) return null;
  const url = webURL(input.url), source = webURL(input.source);
  const text = typeof input.text === "string" ? [...input.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")].slice(0, 4096).join("").trim() : "";
  if (input.kind === "text" ? !text : !url) return null;
  return {kind: input.kind, title: cleanText(input.title, 160) || cleanText(text, 80) || url, text, url, source};
}

export function findTabs(items, query) {
  const words = cleanText(query, 128).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => words.every(word => `${item.title} ${item.path} ${item.url}`.toLocaleLowerCase().includes(word)))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.accessed - a.accessed).slice(0, MAX_TAB_RESULTS);
}

export function validHubCommand(message) {
  if (message?.v !== 1 || typeof message.request !== "string" || !/^[\w-]{1,64}$/.test(message.request)) return false;
  if (message.type === "tab-query-end") return true;
  if (message.type === "tab-query") return typeof message.query === "string" && [...message.query].length <= 128;
  if (message.type === "open-link") return !!webURL(message.url);
  if (typeof message.id !== "string" || !/^[\w{}-]{1,64}$/.test(message.id)) return false;
  return message.type === "tab-action" && ["focus", "mute"].includes(message.action) ||
    message.type === "request-action" && ["forward", "abort", "edit"].includes(message.action);
}
