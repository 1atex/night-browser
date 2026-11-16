import {setTimeout,clearTimeout} from 'resource://gre/modules/Timer.sys.mjs';
import {OSKeyStore} from 'resource://gre/modules/OSKeyStore.sys.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
import {NightTogether} from 'resource:///modules/night/NightTogether.sys.mjs';
import {NightTogetherSounds} from 'resource:///modules/night/NightTogetherSounds.sys.mjs';
import {createNoticeIdentity,encryptNotice,decryptNotice,noticeFingerprint} from 'resource:///modules/night/NoticeCrypto.mjs';
const api=()=>[...Services.wm.getEnumerator('navigator:browser')].find(window=>!PrivateBrowsingUtils.isWindowPrivate(window))?.crypto??Services.appShell.hiddenDOMWindow.crypto;
const path=()=>PathUtils.join(PathUtils.profileDir,'night-notices.json');
export const NightFriendNotices={
  windows:new Set(),timer:null,busy:false,identity:null,data:null,inbox:[],error:'',state:null,
  async load(){if(!this.data){const value=await IOUtils.readJSON(path()).catch(()=>null);this.data=value&&typeof value==='object'&&!Array.isArray(value)?value:{pins:{},seen:[]};if(!this.data.pins||typeof this.data.pins!=='object'||Array.isArray(this.data.pins))this.data.pins={};this.data.seen=Array.isArray(this.data.seen)?this.data.seen.slice(-500):[];}return this.data;},
  saveQueue:Promise.resolve(),
  save(){const text=JSON.stringify(this.data);this.saveQueue=this.saveQueue.catch(()=>{}).then(()=>IOUtils.writeUTF8(path(),text,{tmpPath:path()+'.tmp'}));return this.saveQueue;},
  start(window){if(PrivateBrowsingUtils.isWindowPrivate(window)||this.windows.has(window))return;this.windows.add(window);window.addEventListener('unload',()=>{this.windows.delete(window);if(!this.windows.size)clearTimeout(this.timer);},{once:true});if(this.windows.size===1)this.poll();},
  async enable(){try{const state=await NightTogether.state();if(!state?.features?.includes('encrypted-notices'))throw Error('Для уведомлений обнови сервер Together.');await this.ensureIdentity(true);Services.prefs.setBoolPref('night.together.notices',true);await this.poll();}catch(error){Services.prefs.setBoolPref('night.together.notices',false);this.error=error.message;Services.obs.notifyObservers(null,'night-friend-notices');throw error;}},
  async disable(){Services.prefs.setBoolPref('night.together.notices',false);if(await NightTogether.credentials())await NightTogether.action({type:'notice-disable'});this.inbox=[];this.error='';Services.obs.notifyObservers(null,'night-friend-notices');},
  keyPending:null,
  async ensureIdentity(create=false){
    const credentials=await NightTogether.credentials();if(!credentials)throw Error('Сначала получи ID Together.');
    if(this.keyPending){await this.keyPending.catch(()=>{});return this.ensureIdentity(create);}
    const data=await this.load();if(this.identity&&data.id===credentials.id&&data.endpoint===credentials.endpoint)return this.identity;
    this.keyPending=(async()=>{
      let identity,box;
      if(data.box&&data.id===credentials.id&&data.endpoint===credentials.endpoint)identity=JSON.parse(await OSKeyStore.decrypt(data.box,'night-together-notices'));
      else{if(!create)throw Error('Включи уведомления этого профиля.');identity=await createNoticeIdentity(api());box=await OSKeyStore.encrypt(JSON.stringify(identity));}
      const current=await NightTogether.credentials();if(current?.id!==credentials.id||current?.endpoint!==credentials.endpoint)throw Error('ID изменился во время подключения. Повтори действие.');
      if(box){Object.assign(data,{id:credentials.id,endpoint:credentials.endpoint,box,pins:{},seen:[]});await this.save();}
      this.identity=identity;return identity;
    })();
    try{return await this.keyPending;}finally{this.keyPending=null;}
  },
  async forget(){Services.prefs.setBoolPref('night.together.notices',false);clearTimeout(this.timer);await this.keyPending?.catch(()=>{});this.identity=null;this.data=null;this.inbox=[];this.error='';await this.saveQueue.catch(()=>{});await IOUtils.remove(path(),{ignoreAbsent:true});Services.obs.notifyObservers(null,'night-friend-notices');},
  async pin(friend,confirm=false){
    if(!friend?.noticeKey)throw Error('Друг ещё не включил зашифрованные уведомления.');
    await noticeFingerprint(friend.noticeKey,api());const data=await this.load(),old=data.pins[friend.id];
    if(old&&old!==friend.noticeKey&&!confirm)throw Error('Ключ друга изменился. Сверь отпечаток и подтверди новый ключ.');
    if(old!==friend.noticeKey){data.pins[friend.id]=friend.noticeKey;const allowed=new Set((NightTogether.cachedState?.friends??this.state?.friends??[]).map(value=>value.id));for(const id of Object.keys(data.pins))if(!allowed.has(id))delete data.pins[id];await this.save();}return friend.noticeKey;
  },
  async send(id,text){
    const identity=await this.ensureIdentity(true);Services.prefs.setBoolPref('night.together.notices',true);const state=await NightTogether.state();this.state=state;if(!state?.features?.includes('encrypted-notices'))throw Error('Обнови сервер Together.');
    if(state.self.noticeKey!==identity.publicKey)await NightTogether.action({type:'notice-key',publicKey:identity.publicKey});
    const friend=state.friends.find(value=>value.id===id);if(!friend)throw Error('Друг недоступен.');
    const key=await this.pin(friend),envelope=await encryptNotice(identity.privateKey,key,{from:state.id,to:id,text},api());
    await NightTogether.action({type:'notice-send',id,envelope});return envelope.id;
  },
  async fingerprint(id){const state=this.state??await NightTogether.state(),friend=state?.friends.find(value=>value.id===id);return friend?.noticeKey?noticeFingerprint(friend.noticeKey,api()):null;},
  async poll(){
    clearTimeout(this.timer);if(this.busy)return;this.busy=true;
    try{
      if(!Services.prefs.getBoolPref('night.together.notices',false)||!this.windows.size)return;
      const credentials=await NightTogether.credentials();if(!credentials)return;
      const identity=await this.ensureIdentity(),state=await NightTogether.state();this.state=state;if(!Services.prefs.getBoolPref('night.together.notices',false)||(await NightTogether.credentials())?.id!==state?.id)return;if(!state?.features?.includes('encrypted-notices'))throw Error('Для уведомлений обнови сервер Together.');
      if(state.self.noticeKey!==identity.publicKey)await NightTogether.action({type:'notice-key',publicKey:identity.publicKey});
      this.error='';const acknowledged=[];let arrived=false;
      for(const envelope of state.notices??[]){
        if(this.data.seen.includes(envelope.id)){acknowledged.push(envelope.id);continue;}
        const friend=state.friends.find(value=>value.id===envelope.from);if(!friend)continue;
        try{const key=await this.pin(friend),text=await decryptNotice(identity.privateKey,key,envelope,state.id,api());if(!Services.prefs.getBoolPref('night.together.notices',false))return;this.inbox.unshift({id:envelope.id,from:friend.id,name:friend.name,text,at:envelope.receivedAt});this.inbox=this.inbox.slice(0,30);this.data.seen.push(envelope.id);this.data.seen=this.data.seen.slice(-500);acknowledged.push(envelope.id);arrived=true;}catch(error){this.error=error.message;}
      }
      if(acknowledged.length){await this.save();await NightTogether.action({type:'notice-ack',ids:acknowledged});}
      if(arrived){NightTogetherSounds.play('notice');this.alert();}Services.obs.notifyObservers(null,'night-friend-notices');
    }catch(error){this.error=error.message;Services.obs.notifyObservers(null,'night-friend-notices');}
    finally{this.busy=false;if(this.windows.size&&Services.prefs.getBoolPref('night.together.notices',false))this.timer=setTimeout(()=>this.poll(),5000);}
  },
  alert(){
    const window=[...this.windows].find(value=>!value.closed);if(!window||[...Services.wm.getEnumerator('navigator:browser')].some(value=>value.fullScreen))return;
    const message=this.inbox[0];if(!message)return;
    try{const alert=Cc['@mozilla.org/alert-notification;1'].createInstance(Ci.nsIAlertNotification),preview=Services.prefs.getBoolPref('night.together.notice-preview',false);alert.init('night-friend-notice','','От '+message.name,preview?message.text:'Новое зашифрованное уведомление',true,message.id,'','', '',Services.scriptSecurityManager.getSystemPrincipal(),false,false,true);Cc['@mozilla.org/alerts-service;1'].getService(Ci.nsIAlertsService).showAlert(alert,{observe:(_subject,topic)=>{if(topic==='alertclickcallback'&&!window.closed){window.restore();window.focus();ChromeUtils.importESModule('resource:///modules/night/NightFriendNoticesView.sys.mjs').NightFriendNoticeViews.open(window);}}});}catch{}
  },
  clear(){this.inbox=[];Services.obs.notifyObservers(null,'night-friend-notices');},
};
