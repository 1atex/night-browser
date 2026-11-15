import {NightTogether} from "resource:///modules/night/NightTogether.sys.mjs";
export class NightWatchParent extends JSWindowActorParent {
  receiveMessage(message) { if (message.name === 'NightWatch:Media') NightTogether.media(this, message.data); }
}
