export class CastReceiver{
  #video;#signal;#ice;#peer=null;#owner=null;#active=false;#changed;
  constructor(video,signal,changed){this.#video=video;this.#signal=signal;this.#changed=changed;}
  configure(owner,ice){this.#owner=owner;this.#ice=ice;}
  async incoming(item){
    const value=item.signal;if(item.from!==this.#owner||value.channel!=='cast')return;
    if(value.kind==='bye'){if(this.#peer?.session===value.session)this.stop();return;}
    if(value.kind==='description'&&value.description.type==='offer'){
      if(this.#peer?.session===value.session)return;this.stop();
      const pc=new RTCPeerConnection({...this.#ice,bundlePolicy:'max-bundle'}),peer={pc,session:value.session,stream:new MediaStream()};this.#peer=peer;this.#active=true;
      pc.ontrack=event=>{if(this.#peer!==peer)return;peer.stream.addTrack(event.track);this.#video.srcObject=peer.stream;this.#video.play().catch(()=>this.#changed('Нажми «Разрешить звук», чтобы включить трансляцию.'));this.#changed();};pc.onconnectionstatechange=()=>this.#changed();
      try{await pc.setRemoteDescription(value.description);await pc.setLocalDescription(await pc.createAnswer());await this.#gather(pc);if(this.#peer===peer)await this.#signal(item.from,{channel:'cast',kind:'description',session:value.session,description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});}catch(error){if(this.#peer===peer)this.stop();throw error;}
    }else if(this.#peer?.session===value.session&&value.kind==='candidate'&&this.#peer.pc.remoteDescription)await this.#peer.pc.addIceCandidate(value.candidate);
  }
  async #gather(pc){if(pc.iceGatheringState==='complete')return;await new Promise(resolve=>{const done=()=>{if(pc.iceGatheringState==='complete'||pc.signalingState==='closed'){pc.removeEventListener('icegatheringstatechange',done);clearTimeout(timer);resolve();}},timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);resolve();},6000);pc.addEventListener('icegatheringstatechange',done);});}
  state(){return {active:this.#active,state:this.#peer?.pc.connectionState??'waiting',audio:!!this.#peer?.stream.getAudioTracks().length,video:!!this.#peer?.stream.getVideoTracks().length};}
  async stats(){let video=0,audio=0,frames=0;if(this.#peer)for(const row of (await this.#peer.pc.getStats()).values())if(row.type==='inbound-rtp'){if(row.kind==='video'){video+=row.bytesReceived??0;frames+=row.framesDecoded??0;}if(row.kind==='audio')audio+=row.bytesReceived??0;}return {...this.state(),videoBytes:video,audioBytes:audio,frames};}
  stop(){this.#active=false;if(this.#peer){this.#peer.pc.ontrack=null;this.#peer.pc.onconnectionstatechange=null;this.#peer.pc.close();this.#peer=null;}this.#video.srcObject=null;this.#changed();}
}
