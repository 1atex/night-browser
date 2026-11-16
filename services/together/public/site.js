let serial=0,available=false,joinInitialized=false,closed=false,bootstrapTimer,bootstrapAttempts=0;
const waiting=new Map();
function bridge(method,body,waitMs=15000){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{waiting.delete(id);reject(Error('Night не ответил. Обнови браузер и открой приглашение снова.'));},waitMs);waiting.set(id,{resolve,reject,timer});document.dispatchEvent(new CustomEvent('NightRoom:Query',{detail:JSON.stringify({id,method,body})}));});}
window.addEventListener('NightRoom:Reply',event=>{let value;try{value=JSON.parse(event.detail);}catch{return;}const task=waiting.get(value.id);if(!task)return;available=true;waiting.delete(value.id);clearTimeout(task.timer);value.error?task.reject(Error(value.error)):task.resolve(value.result);});
window.addEventListener('NightRoom:Available',()=>{available=true;setupJoin();});
fetch('/api/releases').then(r=>{if(!r.ok)throw Error();return r.json();}).then(info=>{document.querySelectorAll('[data-download]').forEach(a=>a.href=info.installer);document.querySelectorAll('[data-releases]').forEach(a=>a.href='https://github.com/1atex/night-browser/releases/tag/'+info.tag);const count=document.getElementById('downloads');if(count)count.textContent=info.downloads.toLocaleString('ru-RU');const label=document.getElementById('release');if(label)label.textContent=`Night ${info.version} · Windows 10/11 · x64 · Preview`;}).catch(()=>{const count=document.getElementById('downloads');if(count)count.textContent='Недоступно';document.querySelectorAll('[data-download]').forEach(a=>{a.href='https://github.com/1atex/night-browser/releases';a.textContent='Открыть загрузки ↗';});});
let poll,requestedRoom;
async function setupJoin(){
 if(!document.getElementById('join-form')||!available||joinInitialized)return;joinInitialized=true;
 document.getElementById('external').hidden=true;document.getElementById('join-form').hidden=false;
 try{const {state}=await bridge('status');if(state?.self)document.getElementById('join-name').value=state.self.name;if(state&&(state.protocol??1)<3){setStatus('Обнови сервер Together до 0.15 для приглашений по ссылке.');document.querySelector('#join-form button').disabled=true;}}catch(error){setStatus(error.message);}
}
function setStatus(text){document.getElementById('join-status').textContent=text;}
async function check(){
 if(document.hidden)return;
 try{const {state}=await bridge('status');
 if(state?.room?.id===requestedRoom){clearInterval(poll);setStatus('Вход подтверждён. Можно переходить в комнату.');document.getElementById('enter-room').hidden=false;document.getElementById('join-form').hidden=true;}
 else if(!state?.pendingRooms?.some(r=>r.id===requestedRoom)){clearInterval(poll);setStatus('Заявка отклонена или комната закрыта. Можно отправить новую заявку.');document.querySelector('#join-form button').disabled=false;}
 }catch(error){setStatus(error.message);}
}
const token=/^\/join\/([a-f0-9]{64})$/.exec(location.pathname)?.[1];
if(token){document.getElementById('open-night').href='night://join/'+token;document.getElementById('copy-invite').onclick=()=>navigator.clipboard.writeText(location.href).then(()=>setStatus('Ссылка скопирована.'),()=>setStatus('Скопируй ссылку из адресной строки.'));document.getElementById('join-form').onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{const state=await bridge('request',{name:document.getElementById('join-name').value.trim()});requestedRoom=state.requestedRoom;setStatus('Заявка отправлена. Ждём подтверждения владельца…');clearInterval(poll);poll=setInterval(check,2000);await check();}catch(error){setStatus(error.message);button.disabled=false;}};setupJoin();}
async function bootstrap(){
 if(closed||available||!token)return;
 try{await bridge('status',undefined,1500);}
 catch(error){if(closed)return;if(!available){if(++bootstrapAttempts<8)bootstrapTimer=setTimeout(bootstrap,250);return;}}
 if(!closed)setupJoin();
}
if(token)bootstrapTimer=setTimeout(bootstrap,0);
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(bootstrapTimer);clearInterval(poll);for(const item of waiting.values()){clearTimeout(item.timer);item.reject(Error('Страница закрыта.'));}waiting.clear();});
