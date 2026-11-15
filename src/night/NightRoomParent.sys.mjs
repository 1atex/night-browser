import {NightTogether} from 'resource:///modules/night/NightTogether.sys.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
export class NightRoomParent extends JSWindowActorParent {
  #browser=null;
  didDestroy(){if(this.#browser && NightTogether.roomBrowsers.get(this.#browser)===this)NightTogether.roomBrowsers.delete(this.#browser);this.#browser=null;if(NightTogether.roomActor===this)NightTogether.roomActor=null;}
  async receiveMessage({name,data}) {
    if(name!=='NightRoom:Request')return;
    const browser=this.browsingContext.top.embedderElement,window=browser?.ownerDocument.defaultView;
    if(this.browsingContext.parent || !window)throw Error('Комната доступна только в основной вкладке Night.');
    if(PrivateBrowsingUtils.isWindowPrivate(window))throw Error('Открой приглашение в обычном окне Night.');
    const credentials=await NightTogether.credentials(),endpoint=credentials?.endpoint??Services.prefs.getStringPref('night.together.server','https://browser.night-watchers.com');
    const url=new URL(this.manager.documentURI.spec);
    if(url.origin!==new URL(endpoint).origin || !(/^\/join\/[a-f0-9]{64}$/.test(url.pathname)||url.pathname==='/room'))throw Error('Эта страница не управляет комнатой.');
    if(data.method==='status')return {connected:!!credentials,state:credentials?await NightTogether.state():null};
    if(data.method==='request') {
      if(!/^\/join\/[a-f0-9]{64}$/.test(url.pathname))throw Error('Нужна ссылка приглашения.');
      if(!credentials)await NightTogether.connect(endpoint,window);
      if(typeof data.body?.name==='string'){const current=(await NightTogether.state()).self;await NightTogether.action({type:'profile-update',name:data.body.name,color:current?.color??'moon',icon:current?.icon??'initial'});}
      return NightTogether.action({type:'room-request',invite:url.pathname.split('/').at(-1)});
    }
    if(!credentials)throw Error('Сначала подключись в Night.');
    if(data.method==='signals') {
      if(!Number.isSafeInteger(data.body?.after)||data.body.after<0)throw Error('Неверный номер сигнала.');
      return NightTogether.request(endpoint,'/v1/signals?after='+data.body.after,{credentials});
    }
    if(data.method==='session') {
      if(data.body?.active===true){if(!(await NightTogether.state())?.room)throw Error('Комната недоступна.');if(NightTogether.roomActor&&NightTogether.roomActor!==this)throw Error('Чат уже подключён в другой вкладке. Отключи его там или вернись к ней.');NightTogether.roomActor=this;NightTogether.roomBrowsers.set(browser,this);this.#browser=browser;}
      else this.didDestroy();return {active:NightTogether.roomBrowsers.has(browser)};
    }
    if(data.method==='rtc')return NightTogether.request(endpoint,'/v1/rtc',{credentials});
    if(data.method==='action') {
      if(!['room-signal','room-admit','room-deny','room-kick','room-link','room-leave','room-cancel-request'].includes(data.body?.type))throw Error('Действие недоступно.');
      return NightTogether.action(data.body);
    }
    if(data.method==='watch'){
      const roomTab=window.gBrowser.getTabForBrowser(browser),video=await NightTogether.watch(window);
      if(data.body?.sideBySide===true&&roomTab!==video&&!roomTab.pinned&&!video.pinned)window.gNightBrowser.shell.split(roomTab);
      return {started:!!video};
    }
    throw Error('Неизвестное действие.');
  }
}
