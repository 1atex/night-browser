export const PROFILE_ID = /^(?:default|[a-f0-9]{32})$/;
export const PROFILE_COLORS = {moon: "#b9c1ce", violet: "#bb9af7", sky: "#83b9f2", jade: "#86c9b0", amber: "#e5bd82", rose: "#df9aaf"};
export const PROFILE_ICONS = ["initial", "☾", "✦", "⚡", "☁", "◈", "⌘", "🎧"];
export function profileName(value) {
  if (typeof value !== "string") throw new Error("Укажи название профиля.");
  const name = value.trim();
  if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Название должно содержать от 1 до 40 символов.");
  return name;
}
export function profileMetadata(value, id) {
  if (!PROFILE_ID.test(id)) throw new Error("Неизвестный профиль.");
  let name;
  try { name = profileName(value?.name); } catch { name = id === "default" ? "Личный" : "Профиль"; }
  return {id, name, color: Object.hasOwn(PROFILE_COLORS, value?.color) ? value.color : "moon", icon: PROFILE_ICONS.includes(value?.icon) ? value.icon : "initial"};
}
export function profileBadge(value) { return value.icon && value.icon !== "initial" && PROFILE_ICONS.includes(value.icon) ? value.icon : [...value.name][0].toLocaleUpperCase(); }
