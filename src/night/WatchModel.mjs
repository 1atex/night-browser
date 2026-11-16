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
  return {position: value.position, paused: value.paused, rate: value.rate, buffering: value.buffering === true,ready:value.ready!==false,ad:value.ad===true,duration:Number.isFinite(value.duration)&&value.duration>0?Math.min(604800,value.duration):null};
}
export function roomTarget(room, serverTime, latency = 0) {
  const sample = mediaSample({...room, rate: room?.rate ?? 1});
  if (!sample || !Number.isFinite(room.updatedAt) || !Number.isFinite(serverTime)) return null;
  const elapsed = sample.paused || sample.buffering ? 0 : Math.max(0, Math.min(15000, serverTime + Math.min(1000, Math.max(0, latency)) - room.updatedAt)) / 1000;
  if(room.readiness?.hold)return {...sample,position:room.readiness.hold.position,buffering:true};
  return {...sample, position: Math.min(604800, sample.position + elapsed * sample.rate)};
}
export function playbackCorrection(current,target){
  if(!mediaSample(current)||!mediaSample(target))return null;
  const drift=target.position-current.position,absolute=Math.abs(drift),stopped=target.paused||target.buffering;
  const seek=target.forceSeek===true||absolute>(stopped ? .2 : 3);
  const multiplier=!seek&&!stopped&&absolute>.12?1+Math.max(-.05,Math.min(.05,drift*.035)):1;
  return {seek,position:target.position,rate:Math.max(.25,Math.min(4,target.rate*multiplier)),drift};
}
export function rememberVideo(records,item){
  if(!watchURL(item?.url)||!Number.isFinite(item.position)||item.position<0)return Array.isArray(records)?records.slice(0,50):[];
  const entry={url:item.url,title:String(item.title||new URL(item.url).hostname).slice(0,160),position:Math.min(604800,item.position),duration:Number.isFinite(item.duration)&&item.duration>0?Math.min(604800,item.duration):null,at:Number.isSafeInteger(item.at)?item.at:Date.now()};
  return [entry,...(Array.isArray(records)?records:[]).filter(old=>watchURL(old?.url)&&watchURL(old.url)!==watchURL(entry.url))].slice(0,50);
}
