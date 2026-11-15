export const PROFILE_ID = /^(?:default|[a-f0-9]{32})$/;
export function profileName(value) {
  if (typeof value !== "string") throw new Error("Укажи название профиля.");
  const name = value.trim();
  if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Название должно содержать от 1 до 40 символов.");
  return name;
}
export function profileMetadata(value, id) {
  if (!PROFILE_ID.test(id)) throw new Error("Неизвестный профиль.");
  try { return {id, name: profileName(value?.name)}; }
  catch { return {id, name: id === "default" ? "Личный" : "Профиль"}; }
}
