export function validAppearance(value) {
  const color = channels => Array.isArray(channels) && channels.length === 3 && channels.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  return !!value && value.v === 1 && value.type === "appearance" && color(value.panel) && color(value.accent) && typeof value.motion === "boolean";
}

export function appearanceStyles(value) {
  if (!validAppearance(value)) return null;
  const light = value.panel[0] * .2126 + value.panel[1] * .7152 + value.panel[2] * .0722 > 150;
  const ink = light ? "0, 0, 0" : "255, 255, 255";
  const color = channels => `rgb(${channels.join(", ")})`;
  const mix = amount => color(value.panel.map(n => Math.round(n + ((light ? 0 : 255) - n) * amount)));
  return {
    "--night-background": color(value.panel),
    "--night-page": mix(.035),
    "--night-surface": mix(.08),
    "--night-panel": mix(.12),
    "--night-accent": color(value.accent),
    "--night-text": `rgba(${ink}, .96)`,
    "--night-secondary": `rgba(${ink}, .68)`,
    "--night-muted": `rgba(${ink}, .48)`,
    "--night-line": `rgba(${ink}, .09)`,
    "--night-hover": `rgba(${ink}, .09)`,
    "--night-selected": `rgba(${ink}, .16)`,
    "--night-field": `rgba(${ink}, .075)`,
    "color-scheme": light ? "light" : "dark",
  };
}

const properties = Object.keys(appearanceStyles({v:1,type:"appearance",panel:[0,0,0],accent:[255,255,255],motion:true}));

export function applyIslandAppearance(root, value) {
  const styles = appearanceStyles(value);
  for (const property of properties) {
    if (styles && root.style.getPropertyValue(property) !== styles[property]) root.style.setProperty(property, styles[property]);
    else if (!styles && root.style.getPropertyValue(property)) root.style.removeProperty(property);
  }
  if (styles && root.getAttribute("data-island-motion") !== String(value.motion)) root.setAttribute("data-island-motion", String(value.motion));
  else if (!styles) root.removeAttribute("data-island-motion");
}
