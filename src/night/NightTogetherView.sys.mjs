import {NightWatchHistory} from 'resource:///modules/night/NightWatchHistory.sys.mjs';
import {NightFriendNotices} from 'resource:///modules/night/NightFriendNotices.sys.mjs';
import {NightFriendNoticeViews} from 'resource:///modules/night/NightFriendNoticesView.sys.mjs';
import {NightRoomChats} from 'resource:///modules/night/NightRoomChatView.sys.mjs';
import {NightTogether} from 'resource:///modules/night/NightTogether.sys.mjs';
import {friendAvatarURL} from 'resource:///modules/night/AvatarModel.mjs';
import {watchURL} from 'resource:///modules/night/WatchModel.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
const XHTML='http://www.w3.org/1999/xhtml';
const topics=['night-together-state','night-together-communication','night-together-watch','night-friend-notices','night-together-history'];
export class NightTogetherView {
  #window;#dock;#button;#microphone;#notices;#panel;#body;#status;#rows=new Map();#signature='';#timer=null;#busy=false;#alive=true;#video=null;#url='';#input;#editor=false;#microphoneConnecting=false;
  constructor(window,parent){
    this.#window=window;this.#dock=this.#element('div','',{id:'night-together-dock'});
    this.#button=this.#buttonNode('Вместе',()=>this.#panel.state==='open'?this.#panel.hidePopup():this.open(),{id:'night-together-watch','data-icon':'people','aria-haspopup':'dialog','aria-expanded':'false'});
    this.#microphone=this.#buttonNode('',()=>this.#toggleMicrophone(),{id:'night-together-microphone'});
    this.#notices=this.#buttonNode('',()=>NightFriendNoticeViews.open(window),{id:'night-together-notices','aria-label':'Уведомления друзей',title:'Уведомления друзей'});this.#dock.append(this.#button,this.#microphone,this.#notices);parent.append(this.#dock);
    const doc=window.document;this.#panel=doc.createXULElement('panel');this.#panel.id='night-together-panel';this.#panel.setAttribute('role','dialog');this.#panel.setAttribute('aria-label','Совместный просмотр');this.#panel.setAttribute('type','arrow');this.#panel.setAttribute('consumeoutsideclicks','false');doc.getElementById('mainPopupSet').append(this.#panel);
    this.#panel.addEventListener('popuphidden',()=>{this.#button.setAttribute('aria-expanded','false');window.clearInterval(this.#timer);this.#timer=null;});
    for(const topic of topics)Services.obs.addObserver(this,topic);for(const pref of ['night.together.fullscreen-controls','night.together.glass'])Services.prefs.addObserver(pref,this);window.addEventListener('keydown',this,true);this.observe();
  }
  #element(tag,text='',attrs={}){const node=this.#window.document.createElementNS(XHTML,tag);node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;}
  #buttonNode(text,run,attrs={}){const button=this.#element('button',text,{type:'button',...attrs});if(attrs['data-icon'])button.style.setProperty('--together-icon',`url("chrome://browser/content/night/icons/${attrs['data-icon']}.svg")`);button.addEventListener('click',()=>Promise.resolve().then(run).catch(error=>this.#message(error.message)));return button;}
  #message(text){if(this.#status&&this.#panel.state==='open')this.#status.textContent=text;else if(this.#alive)this.#window.gNightBrowser.shell.notify(text);}
  #close(){this.#panel.hidePopup();}
  async open(){
    if(PrivateBrowsingUtils.isWindowPrivate(this.#window))return;
    this.#signature='';this.#body=this.#element('div','',{class:'night-together-body'});this.#status=this.#element('p','Получаем состояние…',{role:'status',class:'night-together-status'});this.#body.append(this.#status);this.#panel.replaceChildren(this.#body);this.#button.setAttribute('aria-expanded','true');this.#panel.openPopup(this.#button,'before_start');
    this.#video=await NightTogether.inspect(this.#window);if(this.#video&&!NightTogether.cachedState?.room)this.#url=this.#video.url;
    await this.#refresh();if(this.#alive&&this.#panel.state!=='closed')this.#timer=this.#window.setInterval(()=>this.#refresh(),3000);
  }
  async #refresh(){if(this.#busy||!this.#alive)return;this.#busy=true;try{await NightTogether.state();this.#render();}catch(error){this.#message(error.message);}finally{this.#busy=false;}}
  async #act(body){await NightTogether.action(body);this.#render();}
  #source(){const url=this.#input?.value.trim()||this.#url;if(!watchURL(url))throw Error('Открой вкладку с видео или вставь ссылку.');return {url,title:this.#video&&watchURL(this.#video.url)===watchURL(url)?this.#video.title:new URL(url).hostname,poster:this.#video&&watchURL(this.#video.url)===watchURL(url)?this.#video.poster:''};}
  async #ensureRoom(){if(NightTogether.cachedState?.room)return NightTogether.cachedState.room;return (await NightTogether.action({type:'room-create',...this.#source()})).room;}
  async #invite(id){
    const room=await this.#ensureRoom();await this.#act({type:'room-invite',room:room.id,id});
    if(!NightTogether.watchSession)await NightTogether.watch(this.#window);
    this.#render();const friend=NightTogether.cachedState?.friends.find(person=>person.id===id);this.#message('Ждём подключения: '+(friend?.name??'друг'));
  }
  async #link(){const room=await this.#ensureRoom(),next=await NightTogether.action({type:'room-link',room:room.id});Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(next.room.link);if(!NightTogether.watchSession)await NightTogether.watch(this.#window);this.#render();this.#message('Ссылка скопирована. Вход по ссылке подтверждаешь ты.');}
  async #watch(split=false){
    let room=null;if(split)room=await NightTogether.openRoom(this.#window,{connect:true,background:true});const tab=await NightTogether.watch(this.#window);
    if(split&&room&&room!==tab){if(room.ownerDocument.defaultView!==tab.ownerDocument.defaultView)throw Error('Комната открыта в другом окне.');if(room.pinned||tab.pinned)throw Error('Для разделения сначала открепи вкладку.');this.#window.gNightBrowser.shell.split(room);}
    else if(!split&&tab.splitview)tab.splitview.unsplitTabs();
    this.#close();this.#window.gBrowser.selectedBrowser.focus();
  }
  async #toggleMicrophone(){
    if(NightTogether.communication?.active){NightTogether.command({type:'microphone-toggle'});return;}
    this.#microphoneConnecting=true;this.#sync();this.#message('Подключаем голос…');
    try{await NightTogether.openRoom(this.#window,{connect:true,background:true});for(let i=0;i<100&&this.#alive&&!NightTogether.communication?.active;i++)await new Promise(resolve=>this.#window.setTimeout(resolve,100));if(!this.#alive)return;if(!NightTogether.command({type:'microphone-toggle'}))throw Error('Голос ещё не подключён. Открой чат и проверь соединение.');}
    finally{this.#microphoneConnecting=false;this.#sync();}
  }
  #avatar(person){const url=friendAvatarURL(NightTogether.endpoint,person?.avatar);return url?this.#element('img','',{class:'together-avatar',src:url,alt:'',referrerpolicy:'no-referrer'}):this.#element('span',person?.icon&&person.icon!=='initial'?person.icon:[...(person?.name??'П')][0],{class:'together-avatar together-avatar-fallback','aria-hidden':'true'});}
  #videoCard(info){
    const card=this.#element('div','',{class:'together-video-card'}),preview=this.#element('span','',{class:'together-video-poster','aria-hidden':'true'});
    if(info.poster&&/^https:\/\//.test(info.poster))preview.append(this.#element('img','',{src:info.poster,alt:'',referrerpolicy:'no-referrer',crossorigin:'anonymous'}));else preview.textContent='▶';
    const copy=this.#element('div');copy.append(this.#element('strong',info.title||'Видео не выбрано'),this.#element('small',info.subtitle??(watchURL(info.url)?new URL(info.url).hostname:'Открой видео или вставь ссылку')));card.append(preview,copy);return card;
  }
  #friends(state){
    const section=this.#element('section','',{class:'together-friend-list','aria-label':'Друзья'});section.append(this.#element('h3','Друзья'));
    const room=state.room,people=new Map(state.friends.map(person=>[person.id,person]));for(const id of room?.members??[])if(id!==state.id&&!people.has(id))people.set(id,state.people?.[id]??{id,name:'Участник'});
    for(const person of people.values()){
      const member=room?.members.includes(person.id),invited=room?.invited?.some(value=>value.id===person.id),row=this.#element('div','',{class:'together-friend','data-friend':person.id}),copy=this.#element('div','',{class:'together-friend-copy'});
      copy.append(this.#element('strong',person.name),this.#element('small',member?'В комнате':invited?'Приглашение отправлено':person.online===true?'В сети':person.online===false?'Не в сети':'Статус неизвестен',{'data-presence':person.id}));row.append(this.#avatar(person),copy);
      if(member){const range=this.#element('input','',{type:'range',min:'0',max:'100',step:'1','aria-label':'Громкость: '+person.name,'data-volume':person.id}),level=this.#element('output','100%');range.oninput=()=>{level.textContent=range.value+'%';NightTogether.command({type:'volume',id:person.id,volume:Number(range.value)/100});};const audio=this.#element('div','',{class:'together-friend-audio'});audio.append(range,level);row.append(audio);this.#rows.set(person.id,{range,level});}
      else{const invite=this.#buttonNode(invited?'Отправлено':'Позвать смотреть',()=>this.#invite(person.id),{'data-invite-friend':person.id,'data-icon':'people','data-accent':invited?'soft':'primary'});invite.disabled=invited||!!room&&room.owner!==state.id;row.append(invite);}
      section.append(row);
    }
    if(!people.size)section.append(this.#element('p','Добавь друга по ID или отправь приглашение по ссылке.',{class:'night-together-hint'}));
    const add=this.#element('details','',{class:'together-add-friend'});add.append(this.#element('summary','Добавить друга по ID'));const line=this.#element('div','',{class:'night-together-line'}),id=this.#element('input','',{placeholder:'ID друга',maxlength:'16','aria-label':'ID друга'});line.append(id,this.#buttonNode('Добавить',()=>this.#act({type:'friend-request',id:id.value.trim().toLowerCase()}),{'data-icon':'plus'}));add.append(line,this.#buttonNode('Скопировать мой ID',()=>{Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(state.id);this.#message('ID скопирован.');}));section.append(add);
    for(const id of state.incoming??[]){const line=this.#element('div','',{class:'night-together-line'});line.append(this.#element('span',state.people?.[id]?.name??id),this.#buttonNode('Принять',()=>this.#act({type:'friend-accept',id})),this.#buttonNode('Отклонить',()=>this.#act({type:'friend-decline',id})));section.append(line);}return section;
  }
  async #history(){const body=this.#body,records=await NightWatchHistory.list();if(body!==this.#body||!body?.isConnected||NightTogether.cachedState?.room||!records.length)return;const details=this.#element('details','',{class:'night-together-friends'});details.append(this.#element('summary','Недавно смотрели'));for(const record of records.slice(0,5))details.append(this.#buttonNode(record.title,async()=>{this.#url=record.url;await NightTogether.action({type:'room-create',url:record.url,title:record.title});const state=await NightTogether.state();await NightTogether.action({type:'room-control',room:state.room.id,revision:state.room.revision,position:record.position,paused:true,rate:1,command:'seek'});await this.#watch();}));body.append(details);}
  #render(){
    if(!this.#body||!['open','showing'].includes(this.#panel.state))return;
    const state=NightTogether.cachedState,room=state?.room,signature=JSON.stringify([state?.id,room?.id,room?.owner,room?.url,room?.title,room?.poster,room?.members,room?.requests,room?.invited?.map(p=>p.id),room?.mode,!!NightTogether.castSession,state?.invitations,state?.friends?.map(({online,...person})=>person),state?.incoming,this.#video,this.#editor]);
    if(signature!==this.#signature){
      this.#signature=signature;this.#rows.clear();this.#body.replaceChildren();const head=this.#element('div','',{class:'night-together-heading'});head.append(this.#element('strong',room?`Вместе · ${room.members.length}/8`:'Позвать смотреть'),this.#buttonNode('',()=>this.#close(),{'aria-label':'Закрыть панель','data-icon':'close','data-icon-only':'true'}));this.#status=this.#element('p','',{role:'status',class:'night-together-status'});this.#body.append(head,this.#status);
      if(!state){this.#body.append(this.#element('p','Подключи профиль, чтобы приглашать друзей.'),this.#buttonNode('Подключить Together',async()=>{await NightTogether.connect(Services.prefs.getStringPref('night.together.server','https://browser.night-watchers.com'),this.#window);await this.#refresh();},{'data-icon':'people','data-accent':'primary'}));return;}
      for(const invite of state.invitations??[]){const incoming=this.#element('section','',{class:'together-invitation'});incoming.append(this.#element('p',(state.people?.[invite.owner]?.name??'Друг')+' приглашает смотреть'),this.#videoCard({title:invite.title||'Видео',poster:invite.poster,subtitle:'Приглашение на просмотр'}),this.#buttonNode('Присоединиться',async()=>{await this.#act({type:'room-join',room:invite.id});await this.#watch();},{'data-icon':'play','data-accent':'primary','data-join-room':invite.id}));this.#body.append(incoming);}
      const info=room?{url:room.url,title:room.title||new URL(room.url).hostname,poster:room.poster}:this.#video&&watchURL(this.#video.url)===watchURL(this.#url)?this.#video:{url:this.#url,title:watchURL(this.#url)?new URL(this.#url).hostname:'Видео не выбрано'};
      const card=this.#videoCard(info);if(!room||room.owner===state.id)card.append(this.#buttonNode('Сменить',()=>{if(!this.#editor&&room)this.#url=room.url;this.#editor=!this.#editor;this.#render();},{class:'together-source-change'}));this.#body.append(card);
      const editor=this.#element('div','',{class:'together-source-editor'});editor.hidden=!this.#editor&&!!info.url;const label=this.#element('label','Ссылка на видео',{for:'night-together-create-url'});this.#input=this.#element('input','',{type:'url',id:'night-together-create-url',placeholder:'Вставь ссылку на видео',value:this.#editor?this.#url||room?.url||'':room?.url||this.#url});this.#input.oninput=()=>{this.#url=this.#input.value;};editor.append(label,this.#input);if(room?.owner===state.id)editor.append(this.#buttonNode('Выбрать видео',async()=>{await this.#act({type:'room-source',room:room.id,...this.#source()});this.#editor=false;await this.#watch();},{'data-icon':'play'}));this.#body.append(editor);
      if(room?.owner===state.id)for(const person of room.requests??[]){const line=this.#element('div','',{class:'night-together-line'});line.append(this.#avatar(person),this.#element('span',person.name+' · запрос на вход'),this.#buttonNode('Принять',()=>this.#act({type:'room-admit',room:room.id,id:person.id}),{'data-accent':'primary'}),this.#buttonNode('Отклонить',()=>this.#act({type:'room-deny',room:room.id,id:person.id})));this.#body.append(line);}
      this.#body.append(this.#friends(state));
      if(!room||room.owner===state.id)this.#body.append(this.#buttonNode('Скопировать приглашение',()=>this.#link(),{id:'night-together-invite','data-icon':'link',class:'together-link-secondary'}));
      if(room){
        const mic=this.#buttonNode('',()=>this.#toggleMicrophone(),{id:'night-together-panel-microphone','data-icon':'microphone'});this.#body.append(mic,this.#element('p','',{id:'night-together-mic-hint',class:'night-together-hint'}));
        const layouts=this.#element('div','',{class:'night-together-actions together-layouts'});layouts.append(this.#buttonNode('Открыть видео',()=>this.#watch(),{id:'night-together-start','data-icon':'play','data-accent':'primary'}),this.#buttonNode('Видео и чат рядом',()=>this.#watch(true),{id:'night-together-split','data-icon':'split'}),this.#buttonNode('Открыть чат',async()=>{await NightTogether.openRoom(this.#window,{connect:true,background:true});this.#close();this.#window.setTimeout(()=>NightRoomChats.open(this.#window),0);},{'data-icon':'chat'}));this.#body.append(layouts);
        const more=this.#element('details','',{class:'together-advanced'});more.append(this.#element('summary','Дополнительно'));
        if(room.owner===state.id)more.append(this.#buttonNode(NightTogether.castSession?'Остановить трансляцию':'Транслировать мой плеер',async()=>{if(NightTogether.castSession)await NightTogether.stopCast();else await NightTogether.startCast(this.#window);this.#render();},{id:'night-together-cast','data-icon':'screen'}),this.#element('p','Необязательно: передаёт изображение и звук плеера. Обычный совместный просмотр работает без трансляции. DRM-плееры не поддерживаются.',{class:'night-together-hint'}));
        more.append(this.#buttonNode('Скопировать состояние связи',()=>{Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(JSON.stringify({status:NightTogether.watchStatus,events:NightTogether.watchEvents},null,2));this.#message('Журнал скопирован.');},{'data-icon':'network'}));this.#body.append(more,this.#buttonNode(room.owner===state.id?'Завершить просмотр':'Выйти из комнаты',()=>this.#act({type:'room-leave'}),{'data-icon':'leave','data-tone':'danger'}));
      }else this.#history().catch(error=>console.error(error));
    }
    this.#sync();
  }
  #sync(){
    const state=NightTogether.cachedState,room=state?.room,communication=NightTogether.communication;
    if(this.#status&&['open','showing'].includes(this.#panel.state)){
      this.#status.textContent=NightTogether.watchSession?.phase==='reconnecting'?NightTogether.watchStatus:room?.members.length===1?(room.invited?.length?'Ждём подключения: '+room.invited.map(p=>p.name).join(', '):'Пригласи друга или отправь ссылку.'):room?(NightTogether.watchSession?.sample?.ready?'Видео готово':NightTogether.watchStatus||'Выбираем видео'):this.#video?'Видео найдено в текущей вкладке':'Открой видео или вставь ссылку.';
      if(room?.readiness?.mismatch)this.#status.textContent='Разная блокировка рекламы. При вставке подождём участника.';
      for(const friend of state?.friends??[]){const node=this.#body.querySelector(`[data-presence="${friend.id}"]`);if(node&&!room?.members.includes(friend.id)&&!room?.invited?.some(p=>p.id===friend.id))node.textContent=friend.online===true?'В сети':friend.online===false?'Не в сети':'Статус неизвестен';}
    }
    const mic=this.#window.document.getElementById('night-together-panel-microphone'),hint=this.#window.document.getElementById('night-together-mic-hint');
    if(mic){mic.textContent=this.#microphoneConnecting?'Подключаем голос…':communication?.microphone?'Выключить микрофон':communication?.microphonePending?'Отменить включение':'Включить микрофон';mic.disabled=this.#microphoneConnecting;mic.setAttribute('aria-pressed',String(communication?.microphone===true));mic.setAttribute('data-tone',communication?.microphone?'live':'muted');mic.style.setProperty('--together-icon',`url("chrome://browser/content/night/icons/${communication?.microphone?'microphone':'microphone-off'}.svg")`);if(hint)hint.textContent=communication?.microphone?'Микрофон включён · Ctrl+Alt+M':communication?.microphonePending?'Разреши доступ в окне браузера.':'По нажатию подключим голос и запросим доступ · Ctrl+Alt+M';}
    for(const [id,row]of this.#rows){const peer=communication?.participants.find(p=>p.id===id);row.range.disabled=!peer;if(this.#window.document.activeElement!==row.range)row.range.value=String(Math.round((peer?.volume??1)*100));row.level.textContent=Math.round((peer?.volume??1)*100)+'%';}
  }
  observe(_subject,topic){
    if(!this.#alive)return;if(topic==='night-together-history')this.#signature='';if(topic==='nsPref:changed')NightTogether.updateOverlay();
    const privateWindow=PrivateBrowsingUtils.isWindowPrivate(this.#window),communication=NightTogether.communication,state=NightTogether.cachedState,invites=state?.invitations?.length??0;this.#dock.hidden=privateWindow;
    this.#button.textContent=invites?`Приглашение · ${invites}`:state?.room?.invited?.length&&state.room.members.length===1?'Ждём друга':state?.room?`Вместе · ${state.room.members.length}`:'Вместе';this.#button.toggleAttribute('data-invitation',invites>0);this.#button.title=invites?'Приглашение на совместный просмотр':NightTogether.watchStatus||'Друзья и совместный просмотр';
    this.#notices.toggleAttribute('data-unread',NightFriendNotices.inbox.length>0);this.#microphone.hidden=!state?.room;this.#microphone.disabled=this.#microphoneConnecting;this.#microphone.toggleAttribute('data-muted',!communication?.microphone);this.#microphone.setAttribute('aria-pressed',String(communication?.microphone===true));this.#microphone.title=(communication?.microphone?'Выключить микрофон':'Включить микрофон')+' · Ctrl+Alt+M';this.#microphone.setAttribute('aria-label',this.#microphone.title);this.#render();
  }
  handleEvent(event){if(event.type==='keydown'&&event.ctrlKey&&event.altKey&&!event.shiftKey&&!event.metaKey&&event.code==='KeyM'&&NightTogether.cachedState?.room&&!PrivateBrowsingUtils.isWindowPrivate(this.#window)&&Services.prefs.getBoolPref('night.together.microphone-shortcut',true)){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.#toggleMicrophone().catch(error=>this.#message(error.message));}}
  destroy(){this.#alive=false;for(const pref of ['night.together.fullscreen-controls','night.together.glass'])Services.prefs.removeObserver(pref,this);this.#window.clearInterval(this.#timer);this.#window.removeEventListener('keydown',this,true);for(const topic of topics)Services.obs.removeObserver(this,topic);this.#panel.remove();this.#dock.remove();}
}
