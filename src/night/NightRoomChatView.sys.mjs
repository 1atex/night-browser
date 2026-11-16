import {NightTogether} from 'resource:///modules/night/NightTogether.sys.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
const HTML='http://www.w3.org/1999/xhtml';
export const NightRoomChats={
  views:new Map(),seen:new Set(),room:null,unread:0,
  open(window){if(PrivateBrowsingUtils.isWindowPrivate(window))return;let view=this.views.get(window);if(!view){view=new NightRoomChatView(window);this.views.set(window,view);}view.open();},
  update(){const value=NightTogether.communication;if(value?.room!==this.room){this.room=value?.room;this.seen.clear();}if([...this.views.values()].some(view=>view.opened))for(const message of value?.messages??[])this.seen.add(message.id);this.unread=(value?.messages??[]).filter(message=>message.from!==value?.self&&!this.seen.has(message.id)).length;NightTogether.chatUnread=this.unread;NightTogether.updateOverlay();},
};
class NightRoomChatView{
  #window;#root;#list;#input;#send;#status;#pending=null;#lastAttempt=null;#timer;#signature='';
  constructor(window){
    this.#window=window;this.#root=this.#element('section','',{id:'night-room-chat',popover:'auto',role:'dialog','aria-label':'Чат комнаты'});this.#root.hidden=true;
    const head=this.#element('header'),close=this.#element('button','×',{type:'button','aria-label':'Закрыть чат'});head.append(this.#element('strong','Чат комнаты'),close);close.onclick=()=>this.close();
    this.#status=this.#element('p','',{role:'status',class:'room-chat-status'});this.#list=this.#element('ol','',{'aria-live':'polite','aria-relevant':'additions'});
    const form=this.#element('form'),label=this.#element('label','Сообщение',{for:'night-room-chat-input',class:'sr-only'});this.#input=this.#element('input','',{id:'night-room-chat-input',maxlength:'2000',autocomplete:'off',placeholder:'Напиши участникам…'});this.#send=this.#element('button','↑',{type:'submit','aria-label':'Отправить сообщение'});form.append(label,this.#input,this.#send);form.onsubmit=event=>{event.preventDefault();this.send();};
    const full=this.#element('button','Открыть комнату',{type:'button',class:'room-chat-full'});full.onclick=()=>{this.close();NightTogether.openRoom(window).catch(error=>this.#status.textContent=error.message);};
    this.#root.append(head,this.#status,this.#list,form,full);window.document.documentElement.append(this.#root);
    this.#root.addEventListener('toggle',()=>{if(this.opened){NightRoomChats.update();this.render();this.#input.focus();}else{this.#root.hidden=true;window.gBrowser.selectedBrowser.focus();}});
    window.addEventListener('keydown',this,true);window.gBrowser.tabContainer.addEventListener('TabSelect',this);window.addEventListener('fullscreen',this);window.addEventListener('unload',()=>this.destroy(),{once:true});
    Services.obs.addObserver(this,'night-together-communication');Services.obs.addObserver(this,'night-together-watch');Services.obs.addObserver(this,'night-together-state');
  }
  #element(tag,text='',attributes={}){const node=this.#window.document.createElementNS(HTML,tag);node.textContent=text;for(const [name,value]of Object.entries(attributes))node.setAttribute(name,value);return node;}
  get opened(){return this.#root.matches(':popover-open');}
  open(){this.#root.hidden=false;this.#root.showPopover();this.render();this.#input.focus();}
  close(){if(this.opened)this.#root.hidePopover();this.#root.hidden=true;}
  send(){
    const text=this.#input.value.trim();if(!text||this.#pending)return;
    const id=this.#lastAttempt?.text===text?this.#lastAttempt.id:Services.uuid.generateUUID().toString().replace(/[{}-]/g,'');this.#lastAttempt={id,text};
    if(!NightTogether.command({type:'chat-send',id,text})){this.#status.textContent='Подключаем чат. Попробуй через секунду.';return;}
    this.#pending={id,text};this.#send.disabled=true;this.#status.textContent='Отправляем…';
    this.#timer=this.#window.setTimeout(()=>{if(!this.#pending)return;this.#pending=null;this.#status.textContent='Нет подтверждения отправки. Текст сохранён в поле.';this.#send.disabled=false;},5000);
  }
  render(){
    if(!this.opened)return;const value=NightTogether.communication;
    if(this.#pending&&value?.messages?.some(message=>message.id===this.#pending.id)){if(this.#input.value.trim()===this.#pending.text)this.#input.value='';this.#pending=null;this.#lastAttempt=null;this.#window.clearTimeout(this.#timer);}
    if(this.#pending&&value?.lastSendError){this.#pending=null;this.#window.clearTimeout(this.#timer);}
    const connected=value?.participants.some(peer=>peer.chatReady);this.#send.disabled=!!this.#pending||!connected;this.#input.disabled=!value?.active;
    this.#status.textContent=value?.lastSendError||(this.#pending?'Отправляем…':connected?'Сообщения идут напрямую участникам':value?.active?'Ждём подключения участников…':'Подключаем чат…');
    const signature=JSON.stringify(value?.messages??[]);if(signature!==this.#signature){const atEnd=this.#list.scrollHeight-this.#list.scrollTop-this.#list.clientHeight<35;this.#signature=signature;this.#list.replaceChildren();for(const message of value?.messages??[]){const row=this.#element('li'),author=this.#element('strong',message.name+(message.from===value.self?' · ты':'')),body=this.#element('p',message.text);row.append(author,body);this.#list.append(row);}if(atEnd)this.#list.scrollTop=this.#list.scrollHeight;}
  }
  observe(_subject,topic){if(!NightTogether.cachedState?.room)this.close();NightRoomChats.update();this.render();}
  handleEvent(event){if(event.type==='TabSelect'||event.type==='fullscreen'&&!this.#window.fullScreen)this.close();if(event.type==='keydown'&&event.key==='Escape'&&this.opened){event.preventDefault();event.stopImmediatePropagation();this.close();}}
  destroy(){this.close();this.#window.clearTimeout(this.#timer);this.#window.removeEventListener('keydown',this,true);this.#window.removeEventListener('fullscreen',this);this.#window.gBrowser.tabContainer.removeEventListener('TabSelect',this);Services.obs.removeObserver(this,'night-together-communication');Services.obs.removeObserver(this,'night-together-watch');Services.obs.removeObserver(this,'night-together-state');this.#root.remove();NightRoomChats.views.delete(this.#window);}
}
