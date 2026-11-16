import {NightRoomChats} from "resource:///modules/night/NightRoomChatView.sys.mjs";
import {NightTogether} from "resource:///modules/night/NightTogether.sys.mjs";
export class NightWatchParent extends JSWindowActorParent {
  receiveMessage(message) {if(message.name==='NightWatch:CastSignal'){NightTogether.castSignal(this,message.data);return;} if (message.name === 'NightWatch:Media') NightTogether.media(this, message.data);
    if(message.name==='NightWatch:Control'&&NightTogether.watchSession?.actor===this){const value=message.data;if(value?.type==='open-chat'){const window=this.browsingContext.top.embedderElement?.ownerDocument.defaultView;if(window)NightTogether.openRoom(window,{background:true}).then(()=>NightRoomChats.open(window)).catch(error=>console.error(error));}else if(value?.type==='open-room'){const window=this.browsingContext.top.embedderElement?.ownerDocument.defaultView;if(window)NightTogether.openRoom(window).catch(error=>console.error(error));}else if(['microphone-off','volume'].includes(value?.type))NightTogether.command(value);else if(['video-toggle','video-seek','video-step'].includes(value?.type))NightTogether.control(value);} }
}
