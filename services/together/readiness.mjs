import {timelinePosition} from './timeline.mjs';
export class RoomReadiness{
  #states=new Map();#holds=new Map();#now;
  constructor(now){this.#now=now;}
  set(room,id,value){
    const key=room.id+':'+id;this.#states.set(key,{ready:value.ready===true,ad:value.ad===true,blocker:['enabled','none'].includes(value.blocker)?value.blocker:'unknown',at:this.#now()});
    return this.view(room);
  }
  view(room){
    const now=this.#now(),members=room.members.map(id=>({id,...this.#states.get(room.id+':'+id)})).map(value=>value.at>now-10000?value:{id:value.id,ready:false,ad:false,blocker:'unknown'});
    for(const [key,value]of this.#states)if(value.at<now-60000)this.#states.delete(key);
    const waiting=room.mode!=='cast'&&members.find(member=>member.ad),previous=this.#holds.get(room.id);
    if(waiting&&!previous){const elapsed=room.paused||room.buffering?0:Math.max(0,Math.min(15000,now-room.updatedAt))/1000;this.#holds.set(room.id,{reason:'ad',by:waiting.id,position:room.authority==='server'?timelinePosition(room,now):Math.min(604800,room.position+elapsed*(room.rate??1)),at:now});}
    else if(!waiting&&previous){room.position=previous.position;room.updatedAt=now;room.revision++;if(room.authority==='server')room.controlRevision=(room.controlRevision??0)+1;this.#holds.delete(room.id);}
    const blockers=new Set(members.map(member=>member.blocker).filter(value=>value!=='unknown'));
    return {members,hold:this.#holds.get(room.id)??null,mismatch:blockers.size>1};
  }
  control(room){const hold=this.#holds.get(room.id);if(hold){hold.position=room.position;hold.at=this.#now();}}
  remove(room){this.#holds.delete(room.id);for(const key of this.#states.keys())if(key.startsWith(room.id+':'))this.#states.delete(key);}
}
