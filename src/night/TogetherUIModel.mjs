const states=new Set(['new','connecting','connected','disconnected','failed','closed','waiting']);
export function communicationState(value,state){
  if(!value||value.active!==true||!state?.room)return null;
  const reported=new Map((Array.isArray(value.peers)?value.peers:[]).slice(0,8).filter(p=>p&&typeof p.id==='string').map(p=>[p.id,p]));
  return {active:true,microphone:value.microphone===true,microphonePending:value.microphonePending===true,members:state.room.members.length,participants:state.room.members.filter(id=>id!==state.id).slice(0,7).map(id=>{
    const peer=reported.get(id),profile=state.people?.[id];
    return {id,name:typeof profile?.name==='string'?profile.name.slice(0,40):'Участник',volume:Number.isFinite(peer?.volume)&&peer.volume>=0&&peer.volume<=1?peer.volume:1,state:states.has(peer?.state)?peer.state:'waiting'};
  })};
}
export function roomCommand(value,communication){
  if(!value||typeof value!=='object')return null;
  if(['microphone-toggle','microphone-off','disconnect'].includes(value.type))return {type:value.type};
  if(value.type==='volume'&&communication?.participants?.some(p=>p.id===value.id)&&Number.isFinite(value.volume)&&value.volume>=0&&value.volume<=1)return {type:'volume',id:value.id,volume:value.volume};
  return null;
}
export function stateSignature(state){
  if(!state)return '';
  const room=state.room?{...state.room,position:0,paused:false,rate:1,buffering:false,revision:0,updatedAt:0,controlledBy:''}:null;
  return JSON.stringify({...state,room,serverTime:0});
}
