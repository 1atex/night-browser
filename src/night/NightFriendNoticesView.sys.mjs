import {NightFriendNotices} from 'resource:///modules/night/NightFriendNotices.sys.mjs';
import {NightTogether} from 'resource:///modules/night/NightTogether.sys.mjs';
import {noticeFingerprint} from 'resource:///modules/night/NoticeCrypto.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
const HTML='http://www.w3.org/1999/xhtml';
export const NightFriendNoticeViews={views:new Map(),open(window,friend=null){if(PrivateBrowsingUtils.isWindowPrivate(window))return;let view=this.views.get(window);if(!view){view=new NoticeView(window);this.views.set(window,view);}view.open(friend);}};
class NoticeView{
  #window;#root;#status;#list;#recipient;#text;#send;#enable;#clear;#fingerprint;#confirm;#pending=false;#signature='';#friends='';
  constructor(window){
    this.#window=window;this.#root=this.#el('section','',{id:'night-friend-notices',popover:'auto',role:'dialog','aria-label':'Уведомления друзей'});this.#root.hidden=true;
    const head=this.#el('header'),close=this.#button('×',()=>this.close(),{'aria-label':'Закрыть уведомления'});head.append(this.#el('strong','Уведомления'),close);this.#status=this.#el('p','',{role:'status',class:'notice-status'});
    this.#enable=this.#button('Включить зашифрованные уведомления',async()=>{if(!await NightTogether.credentials())await NightTogether.connect(Services.prefs.getStringPref('night.together.server','https://browser.night-watchers.com'),window);await NightFriendNotices.enable();this.render();},{id:'night-notices-enable',class:'notice-primary'});
    this.#list=this.#el('ol','',{'aria-live':'polite'});this.#clear=this.#button('Очистить прочитанное',()=>NightFriendNotices.clear());
    const label=this.#el('label','Отправить другу',{for:'night-notice-recipient'});this.#recipient=this.#el('select','',{id:'night-notice-recipient'});this.#recipient.onchange=()=>this.updateKey();
    this.#text=this.#el('textarea','',{id:'night-notice-text',maxlength:'1000',rows:'3',placeholder:'Напиши другу…','aria-label':'Текст уведомления'});this.#send=this.#button('Отправить',()=>this.send(),{id:'night-notice-send',class:'notice-primary'});
    const security=this.#el('details'),summary=this.#el('summary','Ключи и шифрование');this.#fingerprint=this.#el('p','',{class:'notice-fingerprint'});this.#confirm=this.#button('Подтвердить новый ключ',async()=>{const friend=(NightTogether.cachedState?.friends??[]).find(value=>value.id===this.#recipient.value);await NightFriendNotices.pin(friend,true);this.#status.textContent='Новый ключ подтверждён.';this.updateKey();});
    const own=this.#button('Скопировать мой отпечаток',async()=>{const identity=await NightFriendNotices.ensureIdentity();this.copy(await noticeFingerprint(identity.publicKey,window.crypto));});
    security.append(summary,this.#el('p','Содержание шифруется на устройствах. При первом контакте ключ запоминается; отпечатки можно сверить через другой канал. Смена ключа требует подтверждения.'),this.#fingerprint,this.#confirm,own);
    const disable=this.#button('Выключить уведомления',async()=>{await NightFriendNotices.disable();this.render();});
    this.#root.append(head,this.#status,this.#enable,this.#list,this.#clear,label,this.#recipient,this.#text,this.#send,security,disable);window.document.documentElement.append(this.#root);
    this.#root.addEventListener('toggle',()=>{if(!this.#root.matches(':popover-open'))this.#root.hidden=true;});
    Services.obs.addObserver(this,'night-friend-notices');Services.obs.addObserver(this,'night-together-state');window.addEventListener('unload',()=>this.destroy(),{once:true});
  }
  #el(tag,text='',attributes={}){const value=this.#window.document.createElementNS(HTML,tag);value.textContent=text;for(const [name,item]of Object.entries(attributes))value.setAttribute(name,item);return value;}
  #button(text,action,attributes={}){const button=this.#el('button',text,{type:'button',...attributes});button.onclick=()=>Promise.resolve().then(action).catch(error=>this.#status.textContent=error.message);return button;}
  copy(value){Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(value);this.#status.textContent='Отпечаток скопирован.';}
  async open(friend){this.#root.hidden=false;this.#root.showPopover();await NightTogether.state().catch(error=>this.#status.textContent=error.message);this.render();if(friend)this.#recipient.value=friend;this.updateKey();this.#text.focus();}
  close(){if(this.#root.matches(':popover-open'))this.#root.hidePopover();this.#root.hidden=true;}
  async updateKey(){const friend=NightTogether.cachedState?.friends.find(value=>value.id===this.#recipient.value);this.#confirm.hidden=true;if(!friend?.noticeKey){this.#fingerprint.textContent='Друг ещё не включил уведомления.';return;}try{const fingerprint=await noticeFingerprint(friend.noticeKey,this.#window.crypto);this.#fingerprint.textContent='Ключ друга: '+fingerprint.match(/.{1,8}/g).join(' ');const data=await NightFriendNotices.load();this.#confirm.hidden=!data.pins[friend.id]||data.pins[friend.id]===friend.noticeKey;}catch{this.#fingerprint.textContent='Ключ друга не поддерживается.';}}
  async send(){
    if(this.#pending)return;const text=this.#text.value.trim(),id=this.#recipient.value;if(!text||!id){this.#status.textContent='Выбери друга и напиши сообщение.';return;}
    this.#pending=true;this.#send.disabled=true;this.#status.textContent='Шифруем и отправляем…';
    try{await NightFriendNotices.send(id,text);if(this.#text.value.trim()===text)this.#text.value='';this.#status.textContent='Отправлено. Уведомление доставится при подключении друга.';}catch(error){this.#status.textContent=error.message;}finally{this.#pending=false;this.#send.disabled=false;}
  }
  render(){
    if(!this.#root.matches(':popover-open'))return;
    const enabled=Services.prefs.getBoolPref('night.together.notices',false),state=NightTogether.cachedState;this.#enable.hidden=enabled;this.#recipient.disabled=!enabled;this.#text.disabled=!enabled;this.#send.disabled=!enabled||this.#pending;
    if(!this.#pending)this.#status.textContent=NightFriendNotices.error||(enabled?'Сервер передаёт зашифрованные уведомления':'Включи уведомления, чтобы получать сообщения друзей.');
    const signature=JSON.stringify(NightFriendNotices.inbox);if(signature!==this.#signature){this.#signature=signature;this.#list.replaceChildren();for(const item of NightFriendNotices.inbox){const row=this.#el('li');row.append(this.#el('strong',item.name),this.#el('p',item.text));this.#list.append(row);}}this.#clear.hidden=!NightFriendNotices.inbox.length;
    const friends=JSON.stringify(state?.friends??[]);if(friends!==this.#friends){this.#friends=friends;const previous=this.#recipient.value;this.#recipient.replaceChildren(this.#el('option','Выбери друга',{value:''}));for(const friend of state?.friends??[])this.#recipient.append(this.#el('option',friend.name+(friend.noticeKey?'':' · уведомления выключены'),{value:friend.id}));this.#recipient.value=previous;this.updateKey();}
  }
  observe(){this.render();}
  destroy(){this.close();Services.obs.removeObserver(this,'night-friend-notices');Services.obs.removeObserver(this,'night-together-state');this.#root.remove();NightFriendNoticeViews.views.delete(this.#window);}
}
