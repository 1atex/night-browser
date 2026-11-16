import {NightWatchHistory} from "resource:///modules/night/NightWatchHistory.sys.mjs";
import {NightFriendNotices} from "resource:///modules/night/NightFriendNotices.sys.mjs";
import {NightFriendNoticeViews} from "resource:///modules/night/NightFriendNoticesView.sys.mjs";
import {NightRoomChats} from "resource:///modules/night/NightRoomChatView.sys.mjs";
import {NightTogether} from "resource:///modules/night/NightTogether.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
const XHTML='http://www.w3.org/1999/xhtml';
export class NightTogetherView {
  #window;#dock;#button;#microphone;#notices;#panel;#body;#status;#rows=new Map();#signature='';#timer=null;#busy=false;#alive=true;
  constructor(window,parent){
    this.#window=window;
    this.#dock=this.#element('div','',{id:'night-together-dock'});
    this.#button=this.#buttonNode('Вместе',()=>this.#panel.state==='open'?this.#panel.hidePopup():this.open(),{id:'night-together-watch','data-icon':'people','aria-haspopup':'dialog','aria-expanded':'false'});
    this.#microphone=this.#buttonNode('',()=>this.#command({type:'microphone-toggle'}),{id:'night-together-microphone'});
    this.#notices=this.#buttonNode('',()=>NightFriendNoticeViews.open(window),{id:'night-together-notices','aria-label':'Уведомления друзей',title:'Уведомления друзей'});this.#dock.append(this.#button,this.#microphone,this.#notices);parent.append(this.#dock);
    const doc=window.document;this.#panel=doc.createXULElement('panel');this.#panel.id='night-together-panel';this.#panel.setAttribute('role','dialog');this.#panel.setAttribute('aria-label','Совместный просмотр');this.#panel.setAttribute('type','arrow');this.#panel.setAttribute('consumeoutsideclicks','false');doc.getElementById('mainPopupSet').append(this.#panel);
    this.#panel.addEventListener('popuphidden',()=>{this.#button.setAttribute('aria-expanded','false');window.clearInterval(this.#timer);this.#timer=null;});
    for(const topic of ['night-together-state','night-together-communication','night-together-watch','night-friend-notices','night-together-history'])Services.obs.addObserver(this,topic);
    Services.prefs.addObserver('night.together.fullscreen-controls',this);Services.prefs.addObserver('night.together.glass',this);window.addEventListener('keydown',this,true);this.observe();
  }
  #element(tag,text='',attrs={}){const node=this.#window.document.createElementNS(XHTML,tag);node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;}
  #buttonNode(text,run,attrs={}){const button=this.#element('button',text,{type:'button',...attrs});if(attrs['data-icon'])button.style.setProperty('--together-icon',`url("chrome://browser/content/night/icons/${attrs['data-icon']}.svg")`);button.addEventListener('click',()=>Promise.resolve().then(run).catch(error=>this.#message(error.message)));return button;}
  #message(text){if(this.#status&&this.#panel.state==='open')this.#status.textContent=text;else this.#window.gNightBrowser.shell.notify(text);}
  #command(value){if(!NightTogether.command(value))this.#message('Открой комнату и подключи чат.');}
  async open(){
    if(PrivateBrowsingUtils.isWindowPrivate(this.#window))return;
    this.#signature='';this.#body=this.#element('div','',{class:'night-together-body'});this.#status=this.#element('p','Получаем состояние…',{role:'status',class:'night-together-status'});this.#body.append(this.#status);this.#panel.replaceChildren(this.#body);this.#button.setAttribute('aria-expanded','true');this.#panel.openPopup(this.#button,'before_start');
    await this.#refresh();if(this.#alive&&this.#panel.state!=='closed')this.#timer=this.#window.setInterval(()=>this.#refresh(),3000);
  }
  async #refresh(){if(this.#busy||!this.#alive)return;this.#busy=true;try{await NightTogether.state();this.#render();}catch(error){this.#message(error.message);}finally{this.#busy=false;}}
  async #act(body){await NightTogether.action(body);this.#render();}
  #close(){this.#panel.hidePopup();}
  async #watch(split=false){
    let room=null;if(split)room=await NightTogether.openRoom(this.#window,{connect:true,background:true});
    const tab=await NightTogether.watch(this.#window);
    if(split&&room&&room!==tab){if(room.ownerDocument.defaultView!==tab.ownerDocument.defaultView)throw Error('Комната открыта в другом окне.');if(room.pinned||tab.pinned)throw Error('Для разделения сначала открепи вкладку.');this.#window.gNightBrowser.shell.split(room);}
    this.#close();this.#window.gBrowser.selectedBrowser.focus();
  }
  async #history(){
    const body=this.#body;const records=await NightWatchHistory.list();if(!records.length||body!==this.#body||!body?.isConnected||NightTogether.cachedState?.room)return;
    const details=this.#element('details','',{class:'night-together-friends'});details.append(this.#element('summary','Недавно смотрели'));
    for(const record of records.slice(0,10)){const row=this.#element('div','',{class:'night-together-line'});row.append(this.#element('span',record.title),this.#buttonNode('Продолжить',async()=>{await NightTogether.action({type:'room-create',url:record.url});const state=await NightTogether.state();await NightTogether.action({type:'room-control',room:state.room.id,revision:state.room.revision,position:record.position,paused:true,rate:1,command:'seek'});await this.#watch();},{'data-icon':'play'}));details.append(row);}this.#body.append(details);
  }
  #friends(state){
    const details=this.#element('details','',{class:'night-together-friends'});details.append(this.#element('summary',`Друзья · ${state.friends.length}`));
    const add=this.#element('div','',{class:'night-together-line'}),id=this.#element('input','',{placeholder:'ID друга',maxlength:'16','aria-label':'ID друга'});add.append(id,this.#buttonNode('Добавить',async()=>{await this.#act({type:'friend-request',id:id.value.trim().toLowerCase()});this.#message('Запрос дружбы отправлен.');},{'data-icon':'plus'}));details.append(add);
    for(const id of state.incoming??[]){const row=this.#element('div','',{class:'night-together-line'});row.append(this.#element('span',state.people?.[id]?.name??id),this.#buttonNode('Принять',()=>this.#act({type:'friend-accept',id})),this.#buttonNode('Отклонить',()=>this.#act({type:'friend-decline',id})));details.append(row);}
    for(const friend of state.friends){const row=this.#element('div','',{class:'night-together-line'});row.append(this.#element('span',friend.name),this.#buttonNode('Написать',()=>{this.#close();NightFriendNoticeViews.open(this.#window,friend.id);},{'data-icon':'bell'}));details.append(row);}
    const identity=this.#buttonNode('Скопировать мой ID',()=>{Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(state.id);this.#message('ID скопирован.');});details.append(identity);return details;
  }
  #render(){
    if(!this.#body||!['open','showing'].includes(this.#panel.state))return;
    const state=NightTogether.cachedState,room=state?.room,signature=JSON.stringify([state?.id,room?.id,room?.owner,room?.url,room?.members,room?.requests,room?.link,room?.mode,!!NightTogether.castSession,state?.invitations,state?.friends,state?.people]);
    if(signature!==this.#signature){
      this.#signature=signature;this.#rows.clear();this.#body.replaceChildren();
      const heading=this.#element('div','',{class:'night-together-heading'});heading.append(this.#element('strong',room?`Комната · ${room.members.length}/8`:'Смотреть вместе'));heading.append(this.#buttonNode('',()=>this.#close(),{'aria-label':'Закрыть панель','data-icon':'close','data-icon-only':'true'}));this.#body.append(heading);this.#status=this.#element('p','',{role:'status',class:'night-together-status'});this.#body.append(this.#status);
      if(!state){this.#body.append(this.#element('p','Создай ID этого профиля, чтобы приглашать друзей и смотреть вместе.'));this.#body.append(this.#buttonNode('Подключить Together',async()=>{await NightTogether.connect(Services.prefs.getStringPref('night.together.server','https://browser.night-watchers.com'),this.#window);await this.#refresh();},{'data-icon':'people','data-accent':'primary'}));return;}
      for(const invite of state.invitations??[]){const row=this.#element('div','',{class:'night-together-line'});row.append(this.#element('span','Приглашение: '+(state.people?.[invite.owner]?.name??'участник')),this.#buttonNode('Войти',()=>this.#act({type:'room-join',room:invite.id})));this.#body.append(row);}
      this.#body.append(this.#friends(state));
      if(!room){
        let current='';try{const url=new URL(this.#window.gBrowser.selectedBrowser.currentURI.spec);if(['http:','https:'].includes(url.protocol))current=url.href;}catch{}
        const label=this.#element('label','Ссылка на видео',{for:'night-together-create-url'}),url=this.#element('input','',{type:'url',id:'night-together-create-url',placeholder:'Вставь ссылку на видео',value:current});this.#body.append(label,url,this.#buttonNode('Создать комнату',()=>this.#act({type:'room-create',url:url.value}),{'data-icon':'play','data-accent':'primary'}));this.#history().catch(error=>console.error(error));return;
      }
      const actions=this.#element('div','',{class:'night-together-actions'});actions.append(this.#buttonNode('Смотреть',()=>this.#watch(),{id:'night-together-start','data-icon':'play','data-accent':'primary'}),this.#buttonNode('Видео + чат',()=>this.#watch(true),{id:'night-together-split','data-icon':'split'}),this.#buttonNode('Чат',async()=>{await NightTogether.openRoom(this.#window,{connect:true,background:true});this.#close();this.#window.setTimeout(()=>NightRoomChats.open(this.#window),0);},{'data-icon':'chat'}));this.#body.append(actions,this.#element('p','',{id:'night-together-compatibility',class:'night-together-hint'}));
      if(room.owner===state.id){
        this.#body.append(this.#buttonNode(NightTogether.castSession?'Остановить трансляцию':'Транслировать плеер',async()=>{if(NightTogether.castSession)await NightTogether.stopCast();else await NightTogether.startCast(this.#window);this.#render();},{id:'night-together-cast','data-icon':'screen','data-accent':'soft'}),this.#element('p','Передаётся только видео и звук плеера. Защищённые DRM-плееры не поддерживаются.',{class:'night-together-hint'}));
        this.#body.append(this.#buttonNode('Скопировать приглашение',async()=>{const next=await NightTogether.action({type:'room-link',room:room.id});Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(next.room.link);this.#message('Ссылка скопирована. Вход подтверждаешь ты.');},{id:'night-together-invite','data-icon':'link','data-accent':'soft'}));
        for(const person of room.requests??[]){const line=this.#element('div','',{class:'night-together-line'});line.append(this.#element('span',person.name+' просится'),this.#buttonNode('Принять',()=>this.#act({type:'room-admit',room:room.id,id:person.id})),this.#buttonNode('Отклонить',()=>this.#act({type:'room-deny',room:room.id,id:person.id})));this.#body.append(line);}
        if(state.friends.length){const friends=this.#element('select','',{'aria-label':'Пригласить друга'});for(const person of state.friends)friends.append(this.#element('option',person.name??person.id,{value:person.id}));const line=this.#element('div','',{class:'night-together-line'});line.append(friends,this.#buttonNode('Пригласить',async()=>{await this.#act({type:'room-invite',room:room.id,id:friends.value});this.#message('Приглашение отправлено.');},{'data-icon':'people'}));this.#body.append(line);}
      }
      const mic=this.#buttonNode('',()=>this.#command({type:'microphone-toggle'}),{id:'night-together-panel-microphone','data-icon':'microphone'});this.#body.append(mic,this.#element('p','Микрофон: Ctrl+Alt+M',{class:'night-together-hint'}));
      for(const id of room.members.filter(id=>id!==state.id)){
        const row=this.#element('div','',{class:'night-together-person'}),name=this.#element('span',state.people?.[id]?.name??'Участник'),range=this.#element('input','',{type:'range',min:'0',max:'100',step:'1','aria-label':'Громкость: '+(state.people?.[id]?.name??'участник'),'data-volume':id}),level=this.#element('output','100%');
        range.addEventListener('input',()=>{level.textContent=range.value+'%';this.#command({type:'volume',id,volume:Number(range.value)/100});});row.append(name,range,level);this.#rows.set(id,{range,level});this.#body.append(row);
      }
      if(room.owner===state.id){const source=this.#element('input','',{type:'url',value:room.url,'aria-label':'Сменить видео'});this.#body.append(source,this.#buttonNode('Сменить видео',()=>this.#act({type:'room-source',room:room.id,url:source.value}),{'data-icon':'reload'}));}
      const bottom=this.#element('div','',{class:'night-together-actions'});bottom.append(this.#buttonNode('Состояние связи',()=>{Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(JSON.stringify({status:NightTogether.watchStatus,events:NightTogether.watchEvents},null,2));this.#message('Журнал без ссылок и ключей скопирован.');},{'data-icon':'network',title:'Скопировать журнал синхронизации'}),this.#buttonNode(room.owner===state.id?'Завершить комнату':'Выйти',()=>this.#act({type:'room-leave'}),{'data-icon':'leave','data-tone':'danger'}));this.#body.append(bottom);
    }
    const compatibility=this.#window.document.getElementById('night-together-compatibility');if(compatibility){const readiness=room?.readiness,ready=readiness?.members?.filter(member=>member.ready&&!member.ad).length??0;compatibility.textContent=room?.mode==='cast'?'Трансляция плеера · видео и звук от создателя':readiness?.mismatch?'Разная блокировка рекламы. Во время обнаруженной вставки просмотр подождёт участника.':`Плеер готов: ${ready} из ${room?.members.length??0}`;}
    this.#status.textContent=NightTogether.castStatus||NightTogether.watchStatus||(NightTogether.communication?.active?(NightTogether.communication.participants.some(p=>p.state==='connected')?'Чат подключён':'Подключаем чат…'):'Пригласи друга или открой чат.');
    const mic=this.#window.document.getElementById('night-together-panel-microphone'),communication=NightTogether.communication;
    if(mic){mic.textContent=communication?.microphone?'Выключить микрофон':communication?.microphonePending?'Отменить включение микрофона':'Включить микрофон';mic.disabled=!communication?.active;mic.setAttribute('aria-pressed',String(communication?.microphone===true));mic.setAttribute('data-tone',communication?.microphone?'live':'muted');mic.style.setProperty('--together-icon',`url("chrome://browser/content/night/icons/${communication?.microphone?'microphone':'microphone-off'}.svg")`);}
    for(const [id,row]of this.#rows){const peer=communication?.participants.find(p=>p.id===id);row.range.disabled=!peer;if(this.#window.document.activeElement!==row.range)row.range.value=String(Math.round((peer?.volume??1)*100));row.level.textContent=Math.round((peer?.volume??1)*100)+'%';}
  }
  observe(subject,topic){
    if(!this.#alive)return;if(topic==='night-together-history')this.#signature='';if(topic==='nsPref:changed')NightTogether.updateOverlay();
    const privateWindow=PrivateBrowsingUtils.isWindowPrivate(this.#window),communication=NightTogether.communication;this.#notices.toggleAttribute('data-unread',NightFriendNotices.inbox.length>0);this.#notices.title=NightFriendNotices.inbox.length?`Уведомления · ${NightFriendNotices.inbox.length}`:'Уведомления друзей';this.#dock.hidden=privateWindow;
    this.#button.textContent=NightTogether.watchStatus||communication?.active?`Вместе · ${communication?.members??NightTogether.cachedState?.room?.members.length??'…'}`:'Вместе';
    this.#button.title=NightTogether.watchStatus||'Комната, приглашение, чат и звук';this.#microphone.hidden=!communication?.active;this.#microphone.toggleAttribute('data-muted',!communication?.microphone);this.#microphone.setAttribute('aria-pressed',String(communication?.microphone===true));this.#microphone.title=(communication?.microphone?'Выключить микрофон':'Включить микрофон')+' · Ctrl+Alt+M';this.#microphone.setAttribute('aria-label',this.#microphone.title);this.#render();
  }
  handleEvent(event){if(event.type==='keydown'&&event.ctrlKey&&event.altKey&&!event.shiftKey&&!event.metaKey&&event.code==='KeyM'&&NightTogether.communication?.active&&!PrivateBrowsingUtils.isWindowPrivate(this.#window)&&Services.prefs.getBoolPref('night.together.microphone-shortcut',true)){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.#command({type:'microphone-toggle'});}}
  destroy(){this.#alive=false;Services.prefs.removeObserver('night.together.fullscreen-controls',this);Services.prefs.removeObserver('night.together.glass',this);this.#window.clearInterval(this.#timer);this.#window.removeEventListener('keydown',this,true);for(const topic of ['night-together-state','night-together-communication','night-together-watch','night-friend-notices','night-together-history'])Services.obs.removeObserver(this,topic);this.#panel.remove();this.#dock.remove();}
}
