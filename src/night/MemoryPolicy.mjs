/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export function parseSiteRules(value) {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((rule) => {
          const input = rule.startsWith("*.") ? rule.slice(2) : rule;
          const url = new URL(
            input.includes("://") ? input : `https://${input}`,
          );
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password
          ) {
            throw new Error(`Invalid site: ${rule}`);
          }
          if (url.pathname !== "/" || url.search || url.hash || url.port) {
            throw new Error(`Use a hostname without a path or port: ${rule}`);
          }
          return url.hostname.toLowerCase().replace(/\.$/, "");
        }),
    ),
  ];
}

export function matchesSite(url, rules) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return rules.some((rule) => host === rule || host.endsWith(`.${rule}`));
  } catch {
    return false;
  }
}

export function unloadDecision(tab, settings, now) {
  if (!settings.enabled) return "disabled";
  if (!Number.isFinite(settings.idleMinutes) || settings.idleMinutes < 1)
    return "disabled";
  if (tab.selected || tab.visibleInSplit) return "visible";
  if (tab.pending || tab.closing || !tab.remote) return "unavailable";
  if (tab.protected || tab.intercepted) return "protected";
  if (tab.media || tab.pictureInPicture || tab.sharing) return "media";
  if (tab.loading) return "loading";
  if (tab.private) return "private";
  if (!/^https?:\/\//i.test(tab.url)) return "internal";
  if (matchesSite(tab.url, settings.excludedSites)) return "site-exception";
  if (
    !Number.isFinite(tab.lastUsed) ||
    now - tab.lastUsed < settings.idleMinutes * 60_000
  )
    return "recent";
  return "unload";
}
