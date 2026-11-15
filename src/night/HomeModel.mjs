export const HOME_WIDGETS = ["clock", "shortcuts", "tabs", "island"];

export function homeWidgets(value) {
  if (!Array.isArray(value)) return [...HOME_WIDGETS];
  return [...new Set(value.filter(id => HOME_WIDGETS.includes(id)))];
}
