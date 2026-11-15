const $=id=>document.getElementById(id), peers=new Map(), waiting=new Map();
import {MicrophoneSession} from './microphone.mjs';
const capture=new MicrophoneSession();
let serial=0,state=null,active=false,stream=null,cursor=0,timer,busy=false,available=false,rtcConfig,signature='';
function bridge(method,body){return new Promise((resolve,reject)=>{const id=++serial,timeout=setTimeout(()=>{waiting.delete(id);reject(Error('Night не ответил. Проверь обновления браузера и сервера.'));},15000);waiting.set(id,{resolve,reject,timeout});document.dispatchEvent(new CustomEvent('NightRoom:Query',{detail:JSON.stringify({id,method,body})}));});}
window.addEventListener('NightRoom:Reply',event=>{let v;try{v=JSON.parse(event.detail);}catch{return;}const p=waiting.get(v.id);if(!p)return;waiting.delete(v.id);clearTimeout(p.timeout);v.error?p.reject(Error(v.error)):p.resolve(v.result);});
window.addEventListener('NightRoom:Available',()=>{available=true;refresh();});
const status=text=>{$('room-status').textContent=text;};
function random(){return crypto.randomUUID().replaceAll('-','');}
function signal(peer,value){peer.sending=peer.sending.catch(()=>{}).then(()=>bridge('action',{type:'room-signal',room:peer.room,id:peer.id,signal:{session:peer.session,...value}}));return peer.sending;}
function closePeer(id){const peer=peers.get(id);if(!peer)return;peers.delete(id);peer.pc.onconnectionstatechange=null;peer.pc.close();peer.audio?.remove();}
function receiveChannel(peer,channel){
 if(channel.label!=='night-chat'){channel.close();return;}
 peer.channel=channel;
 channel.onopen=()=>renderMembers();channel.onclose=()=>renderMembers();
 channel.onmessage=event=>{
  if(typeof event.data!=='string'||event.data.length>8192)return;
  const now=Date.now();if(now-peer.rateAt>1000){peer.rateAt=now;peer.received=0;}if(++peer.received>20)return;
  let value;try{value=JSON.parse(event.data);}catch{return;}
  if(value.type!=='chat'||typeof value.text!=='string'||!value.text.trim()||value.text.length>2000||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id)||peer.seen.has(value.id))return;
  peer.seen.add(value.id);if(peer.seen.size>500)peer.seen.delete(peer.seen.values().next().value);
  message(state.people[peer.id]?.name??peer.id,value.text);
 };
}
function message(name,text){const li=document.createElement('li'),label=document.createElement('strong'),body=document.createElement('p');label.textContent=name;body.textContent=text;li.append(label,body);$('messages').append(li);while($('messages').children.length>200)$('messages').firstChild.remove();li.scrollIntoView({block:'nearest'});}
function makePeer(id,session=random(),offering=true){
 closePeer(id);
 const pc=new RTCPeerConnection({...rtcConfig,bundlePolicy:'max-bundle'}),transceiver=offering?pc.addTransceiver('audio',{direction:'sendrecv'}):null;
 const peer={id,session,room:state.room.id,pc,sending:Promise.resolve(),transceiver,seen:new Set(),rateAt:0,received:0,started:Date.now()};peers.set(id,peer);
 if(stream&&transceiver)transceiver.sender.replaceTrack(stream.getAudioTracks()[0]).catch(error=>status(error.message));
 pc.ondatachannel=event=>receiveChannel(peer,event.channel);
 pc.onconnectionstatechange=()=>renderMembers();
 pc.ontrack=event=>{
  if(event.track.kind!=='audio')return;
  const audio=document.createElement('audio');audio.autoplay=true;audio.srcObject=new MediaStream([event.track]);audio.dataset.peer=id;peer.audio?.remove();peer.audio=audio;$('audios').append(audio);
  audio.play().catch(()=>status('Нажми «Разрешить звук», чтобы слышать участников.'));
 };
 return peer;
}
async function gathered(pc){if(pc.iceGatheringState==='complete')return;await new Promise(resolve=>{const done=()=>{if(pc.iceGatheringState==='complete'||pc.signalingState==='closed'){pc.removeEventListener('icegatheringstatechange',done);clearTimeout(timeout);resolve();}},timeout=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);resolve();},6000);pc.addEventListener('icegatheringstatechange',done);});}
async function offer(id){const peer=makePeer(id);receiveChannel(peer,peer.pc.createDataChannel('night-chat',{ordered:true}));try{await peer.pc.setLocalDescription(await peer.pc.createOffer());await gathered(peer.pc);if(peers.get(id)===peer)await signal(peer,{kind:'description',description:{type:peer.pc.localDescription.type,sdp:peer.pc.localDescription.sdp}});}catch(error){if(peers.get(id)===peer)status('Соединение: '+error.message);}}
async function incoming(item){
 if(!active||!state.room.members.includes(item.from)||item.from===state.id)return;
 const value=item.signal;let peer=peers.get(item.from);
 if(value.kind==='bye'){closePeer(item.from);return;}
 if(value.kind==='description'&&value.description.type==='offer'){
  if(item.from>state.id)return;
  if(peer?.session===value.session)return;
  peer=makePeer(item.from,value.session,false);
  await peer.pc.setRemoteDescription(value.description);
  peer.transceiver=peer.pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');
  if(peer.transceiver){peer.transceiver.direction='sendrecv';if(stream)await peer.transceiver?.sender.replaceTrack(stream.getAudioTracks()[0]);}
  await peer.pc.setLocalDescription(await peer.pc.createAnswer());await gathered(peer.pc);
  if(peers.get(item.from)===peer)await signal(peer,{kind:'description',description:{type:peer.pc.localDescription.type,sdp:peer.pc.localDescription.sdp}});
 }else if(peer?.session===value.session&&value.kind==='description'&&value.description.type==='answer'&&peer.pc.signalingState==='have-local-offer')await peer.pc.setRemoteDescription(value.description);
 else if(peer?.session===value.session&&value.kind==='candidate'&&peer.pc.remoteDescription)await peer.pc.addIceCandidate(value.candidate);
}
function renderMembers(){
 if(!state?.room)return;
 const ids=state.room.members,next=JSON.stringify(ids.map(id=>[id,state.people[id]?.name??state.self.name,peers.get(id)?.pc.connectionState,peers.get(id)?.channel?.readyState]));
 if(next===signature)return;signature=next;$('members').replaceChildren();
 for(const id of ids){const row=document.createElement('div'),name=document.createElement('span'),info=document.createElement('small');row.dataset.id=id;row.dataset.state=id===state.id?'self':peers.get(id)?.pc.connectionState??'waiting';name.textContent=id===state.id?state.self.name+' · ты':state.people[id]?.name??id;const p=peers.get(id);info.textContent=id===state.id?'В комнате':p?.pc.connectionState==='connected'?(p.channel?.readyState==='open'?'Чат подключён':'Соединён'):p?.pc.connectionState==='failed'?'Сеть не пропускает связь':active?'Подключение…':'В комнате';row.append(name,info);if(state.room.owner===state.id&&id!==state.id){const kick=document.createElement('button');kick.textContent='Удалить';kick.onclick=()=>bridge('action',{type:'room-kick',room:state.room.id,id}).then(()=>refresh()).catch(error=>status(error.message));row.append(kick);}$('members').append(row);}
 const connected=[...peers.values()].filter(p=>p.channel?.readyState==='open').length;
 $('chat-state').textContent=active?`${connected} соединений`:'Не подключён';$('message').disabled=!connected;$('send').disabled=!connected;
}
function renderRequests(){
 const requests=state.room.requests??[],next=JSON.stringify(requests);if($('requests').dataset.value===next)return;$('requests').dataset.value=next;$('requests').replaceChildren();
 for(const person of requests){const row=document.createElement('div'),name=document.createElement('span');name.textContent=person.name+' просится в комнату';row.append(name);for(const [text,type]of[['Принять','room-admit'],['Отклонить','room-deny']]){const b=document.createElement('button');b.textContent=text;b.onclick=()=>bridge('action',{type,room:state.room.id,id:person.id}).then(()=>refresh()).catch(error=>status(error.message));row.append(b);}$('requests').append(row);}
}
async function refresh(){
 if(!available||busy)return;busy=true;
 try{
  const next=(await bridge('status')).state;
  if(!next?.room){stop();state=next;status('Комната закрыта или ты вышел. Создай новую в настройках Night.');$('watch').disabled=true;$('watch-split').disabled=true;$('connect').disabled=true;return;}
  if(state?.room&&state.room.id!==next.room.id){stop();cursor=0;}
  state=next;$('invite').hidden=state.room.owner!==state.id;$('video-link').textContent=new URL(state.room.url).hostname;$('video-link').href=state.room.url;$('connection').textContent=`${state.room.members.length} в комнате`;
  renderMembers();renderRequests();
  if(!active){status('Пауза, продолжение и перемотка общие. Видео можно открыть в отдельной вкладке, а эту оставить для общения.');return;}
  for(const id of [...peers.keys()])if(!state.room.members.includes(id))closePeer(id);
  const batch=await bridge('signals',{after:cursor});cursor=batch.cursor;
  const groups=new Map();
  for(const item of batch.items){const previous=groups.get(item.from)??Promise.resolve();groups.set(item.from,previous.then(()=>incoming(item)).catch(error=>{closePeer(item.from);status('Не удалось подключить участника: '+error.message);}));}
  await Promise.all(groups.values());
  for(const id of state.room.members){if(id===state.id)continue;const peer=peers.get(id);if(peer&&(['failed','closed'].includes(peer.pc.connectionState)||Date.now()-peer.started>25000&&peer.pc.connectionState!=='connected'))closePeer(id);if(!peers.has(id)&&state.id<id)offer(id);}
  const failed=[...peers.values()].some(p=>p.pc.connectionState==='failed'||Date.now()-p.started>15000&&p.pc.connectionState!=='connected');
  status(failed?'Прямое соединение не установилось. Для этой сети может понадобиться TURN-релей.':'Общение подключено. Микрофон включается отдельно.');
 }catch(error){status(error.message);if(active)stop();}finally{busy=false;}
}
async function microphone(){
 if(capture.pending||capture.stream)return;
 const room=state?.room?.id;let acquired;$('voice').disabled=true;
 try{
  if(!active)throw Error('Сначала подключи чат.');
  acquired=await capture.start(()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}));
  if(!acquired)return;
  if(!active||state?.room?.id!==room){capture.stop();return;}
  stream=acquired;stream.getAudioTracks()[0].onended=()=>{stopMicrophone();status('Микрофон отключён устройством.');};
  for(const peer of peers.values()){
   if(capture.stream!==acquired)break;
   await peer.transceiver?.sender.replaceTrack(acquired.getAudioTracks()[0]);
  }
  if(capture.stream!==acquired){acquired.getTracks().forEach(t=>t.stop());return;}
  $('voice').hidden=true;$('mute').hidden=false;status('Микрофон включён.');
 }catch(error){
  acquired?.getTracks().forEach(t=>t.stop());
  if(capture.stream===acquired){capture.stop();stream=null;}
  if(active)status(error.name==='NotAllowedError'?'Доступ к микрофону не разрешён. Чат продолжает работать.':error.message);
 }finally{$('voice').disabled=!active||capture.pending;}
}
function stopMicrophone(){capture.stop();stream=null;for(const p of peers.values())p.transceiver?.sender.replaceTrack(null).catch(()=>{});$('voice').hidden=false;$('mute').hidden=true;$('voice').disabled=!active;}
function stop(){if(active)bridge('session',{active:false}).catch(()=>{});active=false;stopMicrophone();for(const id of [...peers.keys()])closePeer(id);$('connect').textContent='Подключить чат';$('voice').disabled=true;signature='';renderMembers();}
$('connect').onclick=async()=>{if(active){for(const p of peers.values())signal(p,{kind:'bye'}).catch(()=>{});stop();return;}try{rtcConfig=await bridge('rtc');await bridge('session',{active:true});active=true;$('connect').textContent='Отключить чат';$('voice').disabled=false;await refresh();}catch(error){status(error.message);}};
$('voice').onclick=microphone;$('mute').onclick=()=>{stopMicrophone();status('Микрофон выключен.');};
const sound=document.createElement('button');sound.textContent='Разрешить звук';sound.onclick=()=>{for(const audio of $('audios').children)audio.play().catch(error=>status(error.message));};$('mute').after(sound);
$('invite').onclick=async()=>{try{const next=await bridge('action',{type:'room-link',room:state.room.id});await navigator.clipboard.writeText(next.room.link);status('Приглашение скопировано. Вход подтверждаешь ты.');}catch(error){status(error.message);}};
$('watch-split').onclick=()=>bridge('watch',{sideBySide:true}).catch(error=>status(error.message));
$('watch').onclick=()=>bridge('watch').catch(error=>status(error.message));
$('leave').onclick=()=>{stop();bridge('action',{type:'room-leave'}).then(()=>refresh()).catch(error=>status(error.message));};
$('message-form').onsubmit=event=>{event.preventDefault();const text=$('message').value.trim();if(!text)return;const payload=JSON.stringify({type:'chat',id:random(),text});let count=0;for(const p of peers.values())if(p.channel?.readyState==='open'&&p.channel.bufferedAmount<65536){try{p.channel.send(payload);count++;}catch{}}if(!count){status('Нет соединений: сообщение не отправлено.');return;}message(state.self.name+' · ты',text);$('message').value='';};
export async function connectionReport(){
 const results=[];
 for(const p of peers.values()){
  let received=0,sent=0,route='unknown';const stats=await p.pc.getStats();
  for(const stat of stats.values()){
   if(stat.type==='inbound-rtp'&&stat.kind==='audio')received+=stat.bytesReceived??0;
   if(stat.type==='outbound-rtp'&&stat.kind==='audio')sent+=stat.bytesSent??0;
   if(stat.type==='transport'&&stat.selectedCandidatePairId){const pair=stats.get(stat.selectedCandidatePairId),local=stats.get(pair?.localCandidateId),remote=stats.get(pair?.remoteCandidateId);route=local?.candidateType==='relay'||remote?.candidateType==='relay'?'relay':'direct';}
   if(route==='unknown'&&stat.type==='candidate-pair'&&stat.nominated&&stat.state==='succeeded'){const local=stats.get(stat.localCandidateId),remote=stats.get(stat.remoteCandidateId);route=local?.candidateType==='relay'||remote?.candidateType==='relay'?'relay':'direct';}
  }
  results.push({id:p.id,state:p.pc.connectionState,channel:p.channel?.readyState,received,sent,route,audio:p.pc.getTransceivers().map(t=>({direction:t.currentDirection,local:t.sender.track?.readyState??null,remote:t.receiver.track.readyState}))});
 }return results;
}
$('rtc-refresh').onclick=async()=>{try{const report=await connectionReport();$('rtc-report').textContent=JSON.stringify(report,null,2);$('rtc-report').dataset.serial=String(Date.now());}catch(error){status(error.message);}};
timer=setInterval(()=>{if(!document.hidden||active)refresh();},1500);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('pagehide',()=>{clearInterval(timer);stop();for(const p of waiting.values()){clearTimeout(p.timeout);p.reject(Error('Комната закрыта.'));}waiting.clear();});
