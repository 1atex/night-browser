import {NightWatchHistory} from "resource:///modules/night/NightWatchHistory.sys.mjs";
import {NightWatchCompatibility} from "resource:///modules/night/NightWatchCompatibility.sys.mjs";
import {NightTogetherSounds} from "resource:///modules/night/NightTogetherSounds.sys.mjs";
import {setTimeout, clearTimeout} from "resource://gre/modules/Timer.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import {roomCommand,stateSignature} from "resource:///modules/night/TogetherUIModel.mjs";
import {watchURL, mediaSample, roomTarget} from "resource:///modules/night/WatchModel.mjs";

const path = () => PathUtils.join(PathUtils.profileDir, "night-together.json");
export const NightTogether = {
  async credentials() { return IOUtils.readJSON(path()).catch(() => null); },
  async request(endpoint, route, {credentials, body} = {}) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Для сервера нужен HTTPS.");
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error("Укажи адрес сервера без пути и пароля.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url.origin + route, {method: body ? "POST" : "GET", credentials: "omit", redirect: "error", signal: controller.signal,
        headers: {"Content-Type": "application/json", ...(credentials ? {Authorization: `Bearer ${credentials.id}:${credentials.token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
      const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error ?? "Не удалось связаться с сервером."), {status:response.status}); return result;
    } finally { clearTimeout(timer); }
  },
  async connect(endpoint, window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) throw new Error("Подключись из обычного окна.");
    if (await this.credentials()) throw new Error("Сначала отключи текущий ID.");
    const result = await this.request(endpoint, "/v1/register", {body: {}});
    if (!/^[a-f0-9]{16}$/.test(result.id) || !/^[a-f0-9]{64}$/.test(result.token)) throw new Error("Сервер вернул неверный ID.");
    await IOUtils.writeJSON(path(), {endpoint: new URL(endpoint).origin, id: result.id, token: result.token}, {tmpPath: path() + ".tmp"});
  },
  cachedState:null,
  cachedSignature:'',
  rememberState(state){this.cachedState=state;const signature=stateSignature(state);if(signature!==this.cachedSignature){this.cachedSignature=signature;Services.obs.notifyObservers(null,'night-together-state');}return state;},
  async state() { const credentials = await this.credentials(); if (!credentials) return null; return this.rememberState(await this.request(credentials.endpoint, "/v1/state", {credentials})); },
  async action(body) { const credentials = await this.credentials(); if (!credentials) throw new Error("Сначала подключи сервер."); const state = await this.request(credentials.endpoint, "/v1/action", {credentials, body}); if (body.type === "room-leave") {this.command({type:"disconnect"});this.stopWatch();} return this.rememberState(state); },
  async disconnect(){
    this.command({type:'disconnect'});this.roomActor?.didDestroy();this.setCommunication(null);this.rememberState(null);this.stopWatch();
    const credentials=await this.credentials();if(credentials){for(const type of ['room-leave','notice-disable'])this.request(credentials.endpoint,'/v1/action',{credentials,body:{type}}).catch(()=>{});}
    await IOUtils.remove(path(),{ignoreAbsent:true});await ChromeUtils.importESModule('resource:///modules/night/NightFriendNotices.sys.mjs').NightFriendNotices.forget();
  },
  communication:null,
  communicationSignature:'',
  watchEvents:[],
  trace(type,extra={}){this.watchEvents.push({at:Date.now(),type,...extra});if(this.watchEvents.length>80)this.watchEvents.shift();},
  setPhase(phase,text){const session=this.watchSession;if(session&&session.phase!==phase){session.phase=phase;this.trace('phase',{phase});}this.notify(text);},
  setCommunication(value){const previous=this.communication;if(value&&previous?.room===value.room){const messages=new Map((previous.messages??[]).map(m=>[m.id,m]));for(const message of value.messages??[])if(!messages.has(message.id))messages.set(message.id,message);value={...value,messages:[...messages.values()].slice(-20)};}if(value?.active&&previous?.active){const before=new Set(previous.participants.filter(p=>p.chatReady).map(p=>p.id)),after=new Set(value.participants.filter(p=>p.chatReady).map(p=>p.id));if([...after].some(id=>!before.has(id)))NightTogetherSounds.play('join');else if([...before].some(id=>!after.has(id)))NightTogetherSounds.play('leave');}if(value){const beforeIds=new Set((previous?.messages??[]).map(m=>m.id));this.chatUnread=Math.min(99,(previous?.room===value.room?this.chatUnread??0:0)+(value.messages??[]).filter(m=>m.from!==value.self&&!beforeIds.has(m.id)).length);}else this.chatUnread=0;const signature=JSON.stringify(value);if(signature===this.communicationSignature)return;this.communication=value;this.communicationSignature=signature;Services.obs.notifyObservers(null,'night-together-communication');this.updateOverlay();},
  command(value){const command=roomCommand(value,this.communication);if(!command||!this.roomActor)return false;try{this.roomActor.sendAsyncMessage('NightRoom:Command',command);return true;}catch{return false;}},
  updateOverlay(){
    const session=this.watchSession;if(!session?.actor)return;
    const room=session.roomSnapshot,now=(session.serverTime??Date.now())+Math.max(0,Date.now()-(session.snapshotAt??Date.now())),target=room?roomTarget(room,now):null;
    const duration=session.sample?.duration??room?.duration??null;
    try{session.actor.sendAsyncMessage('NightWatch:Overlay',{enabled:Services.prefs.getBoolPref('night.together.fullscreen-controls',true),glass:Services.prefs.getBoolPref('night.together.glass',true),microphone:this.communication?.microphone===true,active:true,participants:this.communication?.participants??[],unread:this.chatUnread??0,casting:!!this.castSession,status:this.watchStatus,timeline:target?{position:target.position,duration,paused:target.paused,rate:target.rate,blocked:!!room.readiness?.hold||session.wasAdvertisement===true}:null});}catch{}
  },
  control(value){
    const session=this.watchSession,room=session?.roomSnapshot;if(!session||!room||!['video-toggle','video-seek','video-step'].includes(value?.type)||room.readiness?.hold||session.wasAdvertisement)return false;
    const base=session.intent??session.pendingIntent??roomTarget(room,(session.serverTime??Date.now())+Math.max(0,Date.now()-(session.snapshotAt??Date.now())));if(!base)return false;
    const sample={position:base.position,paused:base.paused,rate:base.rate,buffering:false};let command='play';
    if(value.type==='video-toggle'){sample.paused=!sample.paused;command=sample.paused?'pause':'play';}
    else{const position=value.type==='video-step'&&[-10,10].includes(value.seconds)?sample.position+value.seconds:value.type==='video-seek'?value.position:null;if(!Number.isFinite(position)||position<0&&value.type!=='video-step'||position>604800)return false;sample.position=Math.max(0,Math.min(session.sample?.duration??room.duration??604800,position));command='seek';}
    session.intent={...sample,command};this.trace('overlay-control',{command});this.tick();return true;
  },
  roomBrowsers: new WeakMap(),
  roomActor: null,
  async openRoom(window,{connect=true,background=false}={}) {
    const credentials=await this.credentials();if(!credentials){window.openPreferences("together");return null;}
    const endpoint=new URL(credentials.endpoint);
    for(const owner of [window,...Services.wm.getEnumerator('navigator:browser')]){
      if(!owner.gBrowser||PrivateBrowsingUtils.isWindowPrivate(owner))continue;
      const existing=[...owner.gBrowser.tabs].find(tab=>{try{const url=new URL(tab.linkedBrowser.currentURI.spec);return !tab.closing&&url.origin===endpoint.origin&&url.pathname==='/room';}catch{return false;}});
      if(existing){
        if(!background){owner.gNightBrowser.shell.workspaces.switchTo(owner.gNightBrowser.shell.workspaces.workspaceOf(existing),existing);owner.restore();owner.focus();}
        if(connect&&!this.communication?.active)try{existing.linkedBrowser.browsingContext.currentWindowGlobal.getActor('NightRoom').sendAsyncMessage('NightRoom:Command',{type:'connect'});}catch{}
        return existing;
      }
    }
    const tab=window.gBrowser.addTrustedTab(endpoint.origin+'/room'+(connect?'?connect=1':''),{relatedToCurrent:true});
    if(!background)window.gBrowser.selectedTab=tab;return tab;
  },
  castSession:null,
  castStatus:'',
  castIndicators(){ChromeUtils.importESModule('resource:///modules/night/NightCastIndicator.sys.mjs').NightCastIndicators.update();Services.obs.notifyObservers(null,'night-together-watch');this.updateOverlay();},
  async startCast(window){
    if(PrivateBrowsingUtils.isWindowPrivate(window))throw Error('Трансляция доступна в обычном окне.');
    const state=await this.state();if(state?.room?.owner!==state?.id||!state?.room)throw Error('Трансляцию начинает создатель комнаты.');
    if(!state.features?.includes('cast'))throw Error('Сначала обнови сервер Together.');
    if(this.castSession)return;
    await this.watch(window);const session=this.watchSession;
    for(let attempt=0;attempt<100&&this.watchSession===session&&!session.actor;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    if(!session.actor||this.watchSession!==session)throw Error('Дождись появления видеоплеера.');
    const credentials=await this.credentials(),ice=await this.request(credentials.endpoint,'/v1/rtc',{credentials});
    await session.actor.sendQuery('NightWatch:CastStart',{room:state.room.id,ice,members:[]});
    try{
      const updated=await this.action({type:'room-cast',room:state.room.id,active:true});
      if(this.watchSession!==session)throw Error('Вкладка просмотра уже закрыта.');
      this.castSession={actor:session.actor,room:state.room.id,cursor:0,sending:Promise.resolve(),stats:null};this.castStatus='Подключаем зрителей…';this.castIndicators();
      await this.castTick(updated);
    }catch(error){session.actor.sendAsyncMessage('NightWatch:CastStop');await this.action({type:'room-cast',room:state.room.id,active:false}).catch(()=>{});throw error;}
  },
  async stopCast(){
    const cast=this.castSession;if(!cast)return;this.castSession=null;try{cast.actor.sendAsyncMessage('NightWatch:CastStop');}catch{}
    this.castStatus='';this.castIndicators();await this.action({type:'room-cast',room:cast.room,active:false}).catch(()=>{});
  },
  castSignal(actor,value){
    const cast=this.castSession;if(!cast||cast.actor!==actor)return;
    if(value?.event==='ended'){this.stopCast();return;}
    if(value?.event==='peer-error'){this.castStatus='Не удалось подключить зрителя. Повторяем…';this.castIndicators();return;}
    if(!this.cachedState?.room?.members.includes(value?.id)||value?.signal?.channel!=='cast')return;
    cast.sending=cast.sending.catch(()=>{}).then(async()=>{if(this.castSession===cast)await this.action({type:'room-signal',room:cast.room,id:value.id,signal:value.signal});}).catch(error=>{this.castStatus=error.message;this.castIndicators();});
  },
  async castTick(state){
    const cast=this.castSession;if(!cast)return;
    if(state?.room?.id!==cast.room||state.room.mode!=='cast'){await this.stopCast();return;}
    const credentials=await this.credentials(),batch=await this.request(credentials.endpoint,'/v1/signals?after='+cast.cursor,{credentials});
    if(this.castSession!==cast)return;cast.cursor=batch.cursor;
    cast.stats=await cast.actor.sendQuery('NightWatch:CastUpdate',{members:state.room.members.filter(id=>id!==state.id),signals:batch.items.filter(item=>item.signal?.channel==='cast'&&state.room.members.includes(item.from))});
    if(!cast.stats?.active){await this.stopCast();return;}
    this.castStatus=`Плеер передаётся · ${cast.stats.peers.filter(peer=>peer.state==='connected').length} зрителей`;this.castIndicators();
  },
  watchSession: null,
  watchStatus: "",
  notify(text) { if (this.watchStatus === text) return; this.watchStatus = text; Services.obs.notifyObservers(null, "night-together-watch");this.updateOverlay(); },
  async watch(window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) throw new Error("Просмотр доступен в обычном окне.");
    const state = await this.state();
    if (!state?.room) throw new Error("Сначала создай комнату или прими приглашение.");
    if (state.protocol < 2) throw new Error("Обнови сервер Together до версии с синхронизацией видео.");
    if (!watchURL(state.room.url)) throw new Error("Некорректная ссылка комнаты.");
    const current = this.watchSession;
    if (current?.room === state.room.id && !current.tab.closing && current.tab.isConnected) {
      current.window.gBrowser.selectedTab = current.tab; current.window.restore(); current.window.focus(); return current.tab;
    }
    try { current?.actor?.sendAsyncMessage("NightWatch:Pause"); } catch {}
    this.stopWatch();
    this.watchEvents=[];this.trace("start");
    const selected=window.gBrowser.selectedTab;
    const viewer=state.room.mode==='cast'&&state.room.owner!==state.id;
    const tab=viewer?await this.openRoom(window,{connect:true}):watchURL(selected.linkedBrowser.currentURI.spec)===watchURL(state.room.url)?selected:window.gBrowser.addTrustedTab(state.room.url, {relatedToCurrent:true});
    window.gBrowser.selectedTab = tab;
    const session = {window, tab, viewer, room: state.room.id, source: state.room.url, actor: null, sample: null, dirty: true, sent: 0, timer: null, running: false};
    session.closed = () => this.stopWatch();
    tab.addEventListener("TabClose", session.closed, {once: true});
    window.addEventListener("unload", session.closed, {once: true});
    this.watchSession = session;
    this.openRoom(window,{connect:true,background:true}).catch(error=>console.error("Night room connection",error));
    this.setPhase("loading","Открываем видео комнаты…");
    this.tick();
    return tab;
  },
  media(actor, value) {
    const session = this.watchSession;
    if (!session || session.actor !== actor) return;
    const sample = mediaSample(value?.sample);
    if (!sample) return;
    session.sample = sample; session.dirty = true; if (value.control) {session.intent={...sample,command:value.event==='seeked'?'seek':value.event==='ratechange'?'rate':sample.paused?'pause':'play'};this.trace("control-queued");}
    this.tick();
  },
  stopWatch(text = "") {
    this.stopCast();
    const session = this.watchSession;
    if (session) {
      if(session.roomSnapshot&&session.sample)NightWatchHistory.record({url:session.source,title:session.tab.linkedBrowser.contentTitle,position:session.roomSnapshot?roomTarget(session.roomSnapshot,(session.serverTime??Date.now())+Math.max(0,Date.now()-(session.snapshotAt??Date.now())))?.position??session.sample.position:session.sample.position,duration:session.sample.duration,at:Date.now()}).then(()=>NightWatchHistory.flush());
      this.watchSession = null; clearTimeout(session.timer);
      session.tab.removeEventListener("TabClose", session.closed);
      session.window.removeEventListener("unload", session.closed);
      try { session.actor?.sendAsyncMessage("NightWatch:Stop"); } catch {}
    }
    NightWatchHistory.flush();this.trace("stop");this.notify(text);
  },
  async tick() {
    const session = this.watchSession;
    if (!session || session.running) return;
    clearTimeout(session.timer); session.running = true;
    try {
      const begin = Date.now(), state = await this.state(), end = Date.now();
      if (this.watchSession !== session) return;
      if (state?.room?.id !== session.room) { this.stopWatch("Комната закрыта или ты больше не участвуешь."); return; }
      if (state.protocol < 2) throw new Error("Обнови сервер Together.");
      this.watchError = null;
      let {room} = state;
      if (!watchURL(room.url)) throw new Error("Сервер вернул некорректную ссылку.");
      const viewer=room.mode==='cast'&&room.owner!==state.id;
      if(viewer!==session.viewer){this.stopWatch();await this.watch(session.window);return;}
      await this.castTick(state);
      if (room.url !== session.source) {
        await this.stopCast();
        try { session.actor?.sendAsyncMessage("NightWatch:Stop"); } catch {}
        session.source = room.url; session.actor = null; session.sample = null; session.intent=null; session.dirty = true;
        session.tab.linkedBrowser.loadURI(Services.io.newURI(room.url), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
        this.setPhase("loading","Загружаем новое видео…"); return;
      }
      const browser = session.tab.linkedBrowser;
      if (browser.currentURI.spec === 'about:blank' || !browser.browsingContext.currentWindowGlobal || !watchURL(browser.browsingContext.currentWindowGlobal.documentURI.spec)) { this.setPhase('loading','Загружаем видео…');return; }
      if (!session.viewer&&watchURL(browser.currentURI.spec) !== watchURL(room.url)) { this.stopWatch("Открыта другая страница. Вернись в комнату, чтобы продолжить."); return; }
      const actor = browser.browsingContext.currentWindowGlobal.getActor('NightWatch');
      if (actor !== session.actor) {
        session.actor = actor; session.sample = mediaSample(await actor.sendQuery('NightWatch:Start',{viewer:session.viewer})); session.dirty = true;this.trace('player-attached');this.updateOverlay();
      }
      const playerStatus=await actor.sendQuery('NightWatch:Status');const local=mediaSample(playerStatus?.sample);if(local)session.sample=local;
      if(!session.viewer&&state.protocol>=4&&(Date.now()-(session.readinessAt??0)>3000||session.readinessAd!==playerStatus?.ad)){
        const updated=await this.action({type:'room-ready',room:room.id,ready:playerStatus?.ready===true,ad:playerStatus?.ad===true,blocker:await NightWatchCompatibility.blocker()});room=updated.room;session.readinessAt=Date.now();session.readinessAd=playerStatus?.ad;
      }
      session.roomSnapshot=room;session.snapshotAt=Date.now();session.serverTime=state.serverTime;
      if(!session.viewer&&playerStatus?.ad){session.wasAdvertisement=true;session.intent=null;this.setPhase('advertisement','У тебя реклама · ждём окончания вставки…');return;}
      if(!session.viewer&&room.readiness?.hold){session.wasHeld=true;session.intent=null;const target=roomTarget(room,state.serverTime);await actor.sendQuery('NightWatch:Apply',target);this.setPhase('waiting-advertisement','У участника реклама · ждём вместе…');return;}
      if(session.wasHeld||session.wasAdvertisement&&playerStatus?.ready){const target=roomTarget(room,state.serverTime);if(target){target.forceSeek=session.wasAdvertisement===true;await actor.sendQuery('NightWatch:Apply',target);}session.wasHeld=false;session.wasAdvertisement=false;}
      if(Date.now()-(session.historyAt??0)>15000&&local){session.historyAt=Date.now();NightWatchHistory.record({url:room.url,title:browser.contentTitle,position:roomTarget(room,state.serverTime)?.position??local.position,duration:local.duration,at:Date.now()});}
      if (session.intent && state.protocol >= 3) {
        const intent=session.intent; session.intent=null;session.pendingIntent=intent;
        try {
          const updated=await this.action({type:'room-control',room:room.id,revision:room.revision,...intent});
          room=updated.room;session.roomSnapshot=room;session.snapshotAt=Date.now();session.serverTime=updated.serverTime;session.pendingIntent=null; session.revision=room.revision; session.sent=Date.now();this.trace("control-sent",{revision:room.revision});
        } catch(error) {if(error.status===409){session.intent ??= intent;this.trace("revision-conflict");}else throw error;}finally{session.pendingIntent=null;}
        this.setPhase("ready",`Синхронизация готова · ${room.members.length} в комнате`); return;
      }
      if(session.viewer){this.setPhase('cast-viewer','Смотришь трансляцию плеера · управление общее');return;}
      const owner = room.owner === state.id;
      if (!owner || room.controlledBy && session.revision !== room.revision && room.controlledBy !== state.id) {
        const target=roomTarget(room,state.serverTime,(end-begin)/2);if(target)target.forceSeek=room.command==='seek'&&session.controlRevision!==room.controlRevision;
        if (!target) throw new Error("Некорректное состояние воспроизведения.");
        const stale=state.serverTime-room.updatedAt>15000;
        if(stale)target.paused=true;
        const result=await actor.sendQuery('NightWatch:Apply',target);
        if(this.watchSession!==session)return;
        session.revision=room.revision;session.controlRevision=room.controlRevision;
        this.setPhase(stale?"stale":result?.status==='autoplay-blocked'?"autoplay":result?.status==='waiting-video'?"waiting-player":"ready",stale ? "Ждём соединения…" : result?.status==='autoplay-blocked' ? "Нажми Play в плеере: сайт запретил автозапуск." : result?.status==='waiting-video' ? "Ждём появления видеоплеера…" : `Синхронизация готова · ${room.members.length} в комнате`);
      }
      if (owner) {
        const sample=mediaSample(await actor.sendQuery('NightWatch:Read'));
        if(this.watchSession!==session)return;
        if(!sample||!sample.ready){this.setPhase("waiting-player","Ждём появления видеоплеера…");return;}
        if(session.dirty || Date.now()-session.sent>=5000){
          session.dirty=false;
          try {const updated=await this.action({type:'room-state',room:room.id,revision:room.revision,...sample});session.revision=updated.room.revision;}
          catch(error){if(error.status!==409)throw error;}
          if(this.watchSession!==session)return;session.sent=Date.now();
        }
        this.setPhase(sample.buffering?"buffering":"ready",sample.buffering ? "Буферизация…" : `Синхронизация готова · ${room.members.length} в комнате`);
      }
    } catch (error) {
      if (this.watchError !== String(error)) console.error("Night Together player", error);
      this.watchError = String(error);
      if (this.watchSession === session) {
        try { session.actor?.sendAsyncMessage('NightWatch:Pause'); } catch {}
        this.trace("request-error",{status:Number.isInteger(error.status)?error.status:0});this.setPhase("reconnecting","Связь с комнатой потеряна. Повторяем подключение…");
      }
    } finally {
      session.running = false;this.updateOverlay();
      if (this.watchSession === session) session.timer = setTimeout(() => this.tick(), 1000);
    }
  },
};
