export function watchURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 2048) return null;
    url.hash = '';
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return 'youtube:' + url.pathname.slice(1);
    if (['youtube.com','www.youtube.com','m.youtube.com'].includes(host) && url.pathname === '/watch' && url.searchParams.get('v')) return 'youtube:' + url.searchParams.get('v');
    return url.href;
  } catch { return null; }
}
export function mediaSample(value) {
  if (!value || !Number.isFinite(value.position) || value.position < 0 || value.position > 604800 || typeof value.paused !== 'boolean' || !Number.isFinite(value.rate) || value.rate < .25 || value.rate > 4) return null;
  return {position: value.position, paused: value.paused, rate: value.rate, buffering: value.buffering === true};
}
export function roomTarget(room, serverTime, latency = 0) {
  const sample = mediaSample({...room, rate: room?.rate ?? 1});
  if (!sample || !Number.isFinite(room.updatedAt) || !Number.isFinite(serverTime)) return null;
  const elapsed = sample.paused || sample.buffering ? 0 : Math.max(0, Math.min(15000, serverTime + Math.min(1000, Math.max(0, latency)) - room.updatedAt)) / 1000;
  return {...sample, position: Math.min(604800, sample.position + elapsed * sample.rate)};
}
