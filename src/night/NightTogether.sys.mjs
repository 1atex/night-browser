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
  async disconnect() { this.command({type:"disconnect"});this.setCommunication(null);this.rememberState(null);this.stopWatch(); await IOUtils.remove(path(), {ignoreAbsent: true}); },
  communication:null,
  communicationSignature:'',
  watchEvents:[],
  trace(type,extra={}){this.watchEvents.push({at:Date.now(),type,...extra});if(this.watchEvents.length>80)this.watchEvents.shift();},
  setPhase(phase,text){const session=this.watchSession;if(session&&session.phase!==phase){session.phase=phase;this.trace('phase',{phase});}this.notify(text);},
  setCommunication(value){const signature=JSON.stringify(value);if(signature===this.communicationSignature)return;this.communication=value;this.communicationSignature=signature;Services.obs.notifyObservers(null,'night-together-communication');this.updateOverlay();},
  command(value){const command=roomCommand(value,this.communication);if(!command||!this.roomActor)return false;try{this.roomActor.sendAsyncMessage('NightRoom:Command',command);return true;}catch{return false;}},
  updateOverlay(){const session=this.watchSession;if(!session?.actor)return;try{session.actor.sendAsyncMessage('NightWatch:Overlay',{enabled:Services.prefs.getBoolPref('night.together.fullscreen-controls',true),microphone:this.communication?.microphone===true,active:this.communication?.active===true,participants:this.communication?.participants??[],status:this.watchStatus});}catch{}},
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
    const tab=watchURL(selected.linkedBrowser.currentURI.spec)===watchURL(state.room.url)?selected:window.gBrowser.addTrustedTab(state.room.url, {relatedToCurrent:true});
    window.gBrowser.selectedTab = tab;
    const session = {window, tab, room: state.room.id, source: state.room.url, actor: null, sample: null, dirty: true, sent: 0, timer: null, running: false};
    session.closed = () => this.stopWatch();
    tab.addEventListener("TabClose", session.closed, {once: true});
    window.addEventListener("unload", session.closed, {once: true});
    this.watchSession = session;
    this.setPhase("loading","Открываем видео комнаты…");
    this.tick();
    return tab;
  },
  media(actor, value) {
    const session = this.watchSession;
    if (!session || session.actor !== actor) return;
    const sample = mediaSample(value?.sample);
    if (!sample) return;
    session.sample = sample; session.dirty = true; if (value.control) {session.intent=sample;this.trace("control-queued");}
    this.tick();
  },
  stopWatch(text = "") {
    const session = this.watchSession;
    if (session) {
      this.watchSession = null; clearTimeout(session.timer);
      session.tab.removeEventListener("TabClose", session.closed);
      session.window.removeEventListener("unload", session.closed);
      try { session.actor?.sendAsyncMessage("NightWatch:Stop"); } catch {}
    }
    this.trace("stop");this.notify(text);
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
      if (room.url !== session.source) {
        try { session.actor?.sendAsyncMessage("NightWatch:Stop"); } catch {}
        session.source = room.url; session.actor = null; session.sample = null; session.intent=null; session.dirty = true;
        session.tab.linkedBrowser.loadURI(Services.io.newURI(room.url), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
        this.setPhase("loading","Загружаем новое видео…"); return;
      }
      const browser = session.tab.linkedBrowser;
      if (browser.currentURI.spec === 'about:blank' || !browser.browsingContext.currentWindowGlobal || !watchURL(browser.browsingContext.currentWindowGlobal.documentURI.spec)) { this.setPhase('loading','Загружаем видео…');return; }
      if (watchURL(browser.currentURI.spec) !== watchURL(room.url)) { this.stopWatch("Открыта другая страница. Вернись в комнату, чтобы продолжить."); return; }
      const actor = browser.browsingContext.currentWindowGlobal.getActor('NightWatch');
      if (actor !== session.actor) {
        session.actor = actor; session.sample = mediaSample(await actor.sendQuery('NightWatch:Start')); session.dirty = true;this.trace('player-attached');this.updateOverlay();
      }
      if (session.intent && state.protocol >= 3) {
        const intent=session.intent; session.intent=null;
        try {
          const updated=await this.action({type:'room-control',room:room.id,revision:room.revision,...intent});
          room=updated.room; session.revision=room.revision; session.sent=Date.now();this.trace("control-sent",{revision:room.revision});
        } catch(error) {if(error.status===409){session.intent ??= intent;this.trace("revision-conflict");}else throw error;}
        this.setPhase("ready",`Синхронизация готова · ${room.members.length} в комнате`); return;
      }
      const owner = room.owner === state.id;
      if (!owner || room.controlledBy && session.revision !== room.revision && room.controlledBy !== state.id) {
        const target=roomTarget(room,state.serverTime,(end-begin)/2);
        if (!target) throw new Error("Некорректное состояние воспроизведения.");
        const stale=state.serverTime-room.updatedAt>15000;
        if(stale)target.paused=true;
        const result=await actor.sendQuery('NightWatch:Apply',target);
        if(this.watchSession!==session)return;
        session.revision=room.revision;
        this.setPhase(stale?"stale":result?.status==='autoplay-blocked'?"autoplay":result?.status==='waiting-video'?"waiting-player":"ready",stale ? "Ждём соединения…" : result?.status==='autoplay-blocked' ? "Нажми Play в плеере: сайт запретил автозапуск." : result?.status==='waiting-video' ? "Ждём появления видеоплеера…" : `Синхронизация готова · ${room.members.length} в комнате`);
      }
      if (owner) {
        const sample=mediaSample(await actor.sendQuery('NightWatch:Read'));
        if(this.watchSession!==session)return;
        if(!sample){this.setPhase("waiting-player","Ждём появления видеоплеера…");return;}
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
      session.running = false;
      if (this.watchSession === session) session.timer = setTimeout(() => this.tick(), 1000);
    }
  },
};
