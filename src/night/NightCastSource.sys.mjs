const list=value=>Array.prototype.slice.call(value);
export class NightCastSource{
  #window;#send;#stream=null;#peers=new Map();#configuration;#video=null;#room=null;#stopped=true;
  constructor(window,send){this.#window=window;this.#send=send;}
  async start(video,configuration){
    this.stop();if(!video||video.readyState<2)throw Error('Дождись готовности плеера.');
    if(video.mediaKeys)throw Error('Плеер использует DRM. Трансляция защищённого видео недоступна.');
    const capture=video.captureStream;if(!capture)throw Error('Этот плеер не поддерживает трансляцию.');
    const stream=capture.call(video);if(!list(stream.getVideoTracks()).length){list(stream.getTracks()).forEach(track=>track.stop());throw Error('Плеер не предоставил видеодорожку.');}
    this.#stream=stream;this.#video=video;this.#configuration=configuration.ice;this.#room=configuration.room;this.#stopped=false;
    const ended=()=>this.#window.setTimeout(()=>{if(!this.#stopped&&!list(stream.getVideoTracks()).some(track=>track.readyState==='live')){this.stop();this.#send({event:'ended'});}},750);const bind=track=>track.addEventListener('ended',ended,{once:true});for(const track of list(stream.getTracks()))bind(track);stream.addEventListener('addtrack',event=>{bind(event.track);for(const peer of this.#peers.values()){const sender=list(peer.pc.getSenders()).find(sender=>sender.track?.kind===event.track.kind)||list(peer.pc.getTransceivers()).find(t=>t.receiver.track.kind===event.track.kind)?.sender;sender?.replaceTrack(event.track).catch(()=>{});}});
    await this.update(configuration.members);return {active:true,audio:stream.getAudioTracks().length>0,video:true};
  }
  async update(members){
    if(this.#stopped)return;if(this.#video?.mediaKeys){this.stop();throw Error('Плеер переключился на защищённое видео. Трансляция остановлена.');}const ids=new Set((members??[]).filter(value=>typeof value==='string').slice(0,7));
    for(const [id,peer]of this.#peers)if(!ids.has(id)){peer.pc.close();this.#peers.delete(id);}
    for(const id of ids){const existing=this.#peers.get(id);if(existing&&!['failed','closed'].includes(existing.pc.connectionState)&&!(Date.now()-existing.started>25000&&existing.pc.connectionState!=='connected'))continue;if(existing){existing.pc.close();this.#peers.delete(id);}this.#offer(id);}
  }
  async #offer(id){
    if(this.#stopped)return;const pc=new this.#window.RTCPeerConnection({...this.#configuration,bundlePolicy:'max-bundle'}),session=this.#window.crypto.randomUUID().replaceAll('-',''),peer={id,session,pc,started:Date.now()};this.#peers.set(id,peer);
    try{
      for(const kind of ['video','audio']){const track=list(this.#stream.getTracks()).find(track=>track.kind===kind&&track.readyState==='live');pc.addTransceiver(track??kind,{direction:'sendonly',streams:[this.#stream]});}
      await pc.setLocalDescription(await pc.createOffer());
      for(const sender of list(pc.getSenders()))if(sender.track?.kind==='video')try{const parameters=sender.getParameters();if(!parameters.encodings?.length)parameters.encodings=[{}];parameters.encodings[0].maxBitrate=1800000;parameters.encodings[0].maxFramerate=30;parameters.encodings[0].scaleResolutionDownBy=Math.max(1,(this.#video.videoWidth??0)/1280,(this.#video.videoHeight??0)/720);await sender.setParameters(parameters);}catch{}
      await this.#gather(pc);
      if(!this.#stopped&&this.#peers.get(id)===peer)this.#send({id,signal:{channel:'cast',kind:'description',session,description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}}});
    }catch(error){if(this.#peers.get(id)===peer){pc.close();this.#peers.delete(id);this.#send({event:'peer-error',id,message:String(error)});}}
  }
  async #gather(pc){if(pc.iceGatheringState==='complete')return;await new Promise(resolve=>{const done=()=>{if(pc.iceGatheringState==='complete'||pc.signalingState==='closed'){pc.removeEventListener('icegatheringstatechange',done);this.#window.clearTimeout(timer);resolve();}},timer=this.#window.setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);resolve();},6000);pc.addEventListener('icegatheringstatechange',done);});}
  async incoming(item){
    const peer=this.#peers.get(item?.from),signal=item?.signal;if(!peer||signal?.channel!=='cast'||signal.session!==peer.session)return;
    if(signal.kind==='description'&&signal.description?.type==='answer'&&peer.pc.signalingState==='have-local-offer')await peer.pc.setRemoteDescription(signal.description);
    else if(signal.kind==='candidate'&&peer.pc.remoteDescription)await peer.pc.addIceCandidate(signal.candidate);
    else if(signal.kind==='bye'){peer.pc.close();this.#peers.delete(item.from);}
  }
  async stats(){const results=[];for(const peer of this.#peers.values()){let video=0,audio=0;(await peer.pc.getStats()).forEach(row=>{if(row.type==='outbound-rtp'){if(row.kind==='video')video+=row.bytesSent??0;if(row.kind==='audio')audio+=row.bytesSent??0;}});results.push({id:peer.id,state:peer.pc.connectionState,video,audio});}return {active:!this.#stopped,peers:results,audio:this.#stream?.getAudioTracks().length>0};}
  stop(){this.#stopped=true;for(const peer of this.#peers.values())peer.pc.close();this.#peers.clear();this.#stream?.getTracks().forEach(track=>track.stop());this.#stream=null;this.#video=null;this.#room=null;}
}
