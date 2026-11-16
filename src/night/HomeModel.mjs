export const HOME_WIDGETS = ["clock", "shortcuts", "tabs", "island"];
export const DEFAULT_HOME_WIDGETS = ["clock", "shortcuts"];
export const HOME_GRADIENTS = {
  none: {first: "#19202b", second: "#282035"},
  graphite: {first: "#67717e", second: "#3d4655"},
  dusk: {first: "#5264ba", second: "#8a557a"},
  forest: {first: "#387f74", second: "#64784c"},
  amber: {first: "#af794d", second: "#805463"},
};

export function homeWidgets(value) {
  if (!Array.isArray(value)) return [...DEFAULT_HOME_WIDGETS];
  return [...new Set(value.filter(id => HOME_WIDGETS.includes(id)))];
}

export function homeLinks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(), links = [];
  for (const item of value.slice(0, 12)) {
    if (typeof item?.url !== "string" || item.url.length > 2048 || typeof item.name !== "string") continue;
    const name = item.name.trim().replace(/[\x00-\x1f\x7f]/g, "").slice(0, 40);
    try {
      const url = new URL(item.url);
      if (!name || !["https:", "http:"].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
      seen.add(url.href); links.push({name, url: url.href});
    } catch {}
  }
  return links;
}

export function homeGradient(value) {
  const preset = value?.preset === "custom" || Object.hasOwn(HOME_GRADIENTS, value?.preset ?? "") ? value.preset : "none";
  const colors = HOME_GRADIENTS[preset] ?? HOME_GRADIENTS.none;
  const color = (input, fallback) => typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : fallback;
  return {preset, first: preset === "custom" ? color(value?.first, colors.first) : colors.first,
    second: preset === "custom" ? color(value?.second, colors.second) : colors.second,
    intensity: Number.isFinite(value?.intensity) ? Math.round(Math.max(0, Math.min(35, value.intensity))) : 18};
}
