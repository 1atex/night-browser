import {readFile} from 'node:fs/promises';
const root = new URL('./public/', import.meta.url);
const files = {'/cast-receiver.mjs':['cast-receiver.mjs','text/javascript'],'/audio-levels.mjs':['audio-levels.mjs','text/javascript'],'/microphone.mjs':['microphone.mjs','text/javascript'],'/icon.svg':['icon.svg','image/svg+xml'],'/':['index.html','text/html'], '/room':['room.html','text/html'], '/site.css':['site.css','text/css'], '/site.js':['site.js','text/javascript'], '/room.js':['room.js','text/javascript']};
export function publicWeb({releases = async () => {
  const response = await fetch('https://api.github.com/repos/1atex/night-browser/releases?per_page=100', {headers:{Accept:'application/vnd.github+json','User-Agent':'Night-Together'},signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw Error('Release service unavailable'); return response.json();
}} = {}) {
  let cached, checked = 0, pending;
  const releaseInfo = async () => {
    if (cached && Date.now()-checked < 600000) return cached;
    pending ??= (async () => {
      const list = await releases(); if (!Array.isArray(list)) throw Error('Invalid release list');
      const builds = list.filter(r => !r.draft && /^v\d+\.\d+\.\d+-preview\.\d+$/.test(r.tag_name)).map(r => {
        const version = r.tag_name.match(/^v(\d+\.\d+\.\d+)-preview\.(\d+)$/)[1];
        const prefix = `https://github.com/1atex/night-browser/releases/download/${r.tag_name}/`;
        const assets = (r.assets ?? []).filter(a => new RegExp(`^night-browser-${version.replaceAll('.','\\.')}-preview-windows-x64(?:-setup\\.exe|\\.zip)$`).test(a.name) && a.browser_download_url === prefix+a.name);
        return {tag:r.tag_name,version,assets};
      }).filter(r => r.assets.some(a => a.name.endsWith('.exe')));
      builds.sort((a,b) => b.tag.localeCompare(a.tag,undefined,{numeric:true}));
      if (!builds.length) throw Error('No release available');
      const latest=builds[0];
      cached={version:latest.version,tag:latest.tag,installer:latest.assets.find(a=>a.name.endsWith('.exe')).browser_download_url,portable:latest.assets.find(a=>a.name.endsWith('.zip'))?.browser_download_url,downloads:builds.reduce((sum,r)=>sum+r.assets.reduce((n,a)=>n+(Number.isSafeInteger(a.download_count)&&a.download_count>=0?a.download_count:0),0),0),checkedAt:new Date().toISOString()}; checked=Date.now(); return cached;
    })().finally(()=>{pending=null;});
    return pending;
  };
  return async (request,response) => {
    const path = new URL(request.url,'http://localhost').pathname;
    if (!['GET','HEAD'].includes(request.method)) return false;
    if (path === '/api/releases' || path === '/download') {
      try { const info=await releaseInfo(); if (path==='/download') { response.writeHead(302,{Location:info.installer,'Cache-Control':'no-store'}); response.end(); }
        else { response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60'});response.end(JSON.stringify(info)); } }
      catch {if(path==='/download'){response.writeHead(302,{Location:'https://github.com/1atex/night-browser/releases','Cache-Control':'no-store'});response.end();}else{response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:'Сервис загрузок временно недоступен.'}));}}
      return true;
    }
    const file = /^\/join\/[a-f0-9]{64}$/.test(path) ? ['join.html','text/html'] : files[path];
    if (!file) return false;
    response.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cache-Control':path==='/room'||path.startsWith('/join/')?'no-store, no-transform':'public, max-age=60, no-transform'});
    response.end(request.method==='HEAD'?undefined:await readFile(new URL(file[0],root))); return true;
  };
}
