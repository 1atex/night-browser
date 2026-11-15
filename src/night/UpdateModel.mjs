export function newerVersion(candidate, current) {
  const parse = value => /^(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function releaseUpdate(releases, current, preview = 1) {
  if (!Array.isArray(releases)) throw new Error("Некорректный ответ сервера обновлений.");
  for (const release of releases) {
    const match = /^v(\d+\.\d+\.\d+)-preview\.(\d+)$/.exec(release.tag_name ?? "");
    if (release.draft || !match || !(newerVersion(match[1], current) || match[1] === current && Number(match[2]) > preview)) continue;
    const name = `night-browser-${match[1]}-preview-windows-x64-setup.exe`;
    const asset = release.assets?.find(item => item.name === name);
    const sums = release.assets?.find(item => item.name === "SHA256SUMS.txt");
    const prefix = `https://github.com/1atex/night-browser/releases/download/${release.tag_name}/`;
    if (!asset || asset.browser_download_url !== prefix + name || !sums || sums.browser_download_url !== prefix + "SHA256SUMS.txt") continue;
    return {version: match[1], tag: release.tag_name, name, url: asset.browser_download_url, sums: sums.browser_download_url};
  }
  return null;
}
export function checksumFor(text, name) {
  const line = text.split(/\r?\n/).map(item => /^([a-f0-9]{64})\s+\*?([^\s]+)$/i.exec(item.trim())).find(item => item?.[2] === name);
  if (!line) throw new Error("Нет контрольной суммы обновления.");
  return line[1].toLowerCase();
}
