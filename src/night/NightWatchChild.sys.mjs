import {NightCastSource} from "resource:///modules/night/NightCastSource.sys.mjs";
import {playbackCorrection} from "resource:///modules/night/WatchModel.mjs";
import {NightWatchOverlay} from "resource:///modules/night/NightWatchOverlay.sys.mjs";
export class NightWatchChild extends JSWindowActorChild {
  #active = false;
  #overlay=null;
  #cast=null;
  #viewer=false;
  #video = null;
  #nominalRate=null;
  #advertising=false;
  #quietUntil=0;
  #observer = null;
  #applying = false;
  #expected = new Map();
  #events = ['play','pause','seeked','ratechange','waiting','playing','ended','loadedmetadata'];
  #find() {
    if (!this.#active || this.#video?.isConnected) return;
    this.#unbind();
    this.#video = [...this.document.querySelectorAll('video')].sort((a,b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? null;
    if (this.#video) for (const name of this.#events) this.#video.addEventListener(name, this);
  }
  #unbind() { if (this.#video) for (const name of this.#events) this.#video.removeEventListener(name, this); this.#video = null;this.#nominalRate=null;this.#advertising=false;this.#quietUntil=0; }
  #ad(){const marked=!!this.#video?.closest('.ad-showing,.ad-interrupting');if(marked){this.#advertising=true;return true;}if(this.#advertising){if((this.#video?.readyState??0)<2)return true;this.#advertising=false;this.#quietUntil=Date.now()+1500;}return false;}
  #sample() {
    this.#find(); const video = this.#video;
    if (!video || video.readyState === 0 || !Number.isFinite(video.currentTime)) return null;
    return {position: video.currentTime, paused: video.paused || video.ended, rate: this.#nominalRate??video.playbackRate, buffering: !video.paused && video.readyState < 3,ready:video.readyState>=2,ad:this.#ad(),duration:Number.isFinite(video.duration)?video.duration:null};
  }
  handleEvent(event) {
    if (!this.#active) return;
    let sample=this.#sample();const expected=this.#expected.get(event.type);
    if (expected) {
      this.#expected.delete(event.type);
      if (Date.now()<expected.until && expected.matches(sample)) return;
    }
    if(event.type==='ratechange'){this.#nominalRate=this.#video?.playbackRate??null;sample=this.#sample();}
    if(sample?.ad||Date.now()<this.#quietUntil)return;
    if(this.#viewer)return;
    if (!this.#applying) this.sendAsyncMessage('NightWatch:Media', {sample,event:event.type, control:['play','pause','seeked','ratechange'].includes(event.type)});
  }
  #expect(name, matches) { this.#expected.set(name,{until:Date.now()+2000,matches}); }
  async receiveMessage({name, data}) {
    if (name === 'NightWatch:Stop') { this.didDestroy(); return null; }
    if (name === 'NightWatch:Start' && !this.#active) {
      this.#active = true;this.#viewer=data?.viewer===true;
      this.#observer = new this.contentWindow.MutationObserver(() => this.#find());
      this.#observer.observe(this.document, {childList: true, subtree: true});
      this.#find();
    }
    if (!this.#active) return null;
    if(name==='NightWatch:CastStart'){this.#find();this.#cast??=new NightCastSource(this.contentWindow,value=>this.sendAsyncMessage('NightWatch:CastSignal',value));return this.#cast.start(this.#video,data);}
    if(name==='NightWatch:CastUpdate'){await this.#cast?.update(data.members);for(const item of data.signals??[])await this.#cast?.incoming(item);return this.#cast?.stats()??{active:false};}
    if(name==='NightWatch:CastStop'){this.#cast?.stop();this.#cast=null;return {active:false};}
    if(name==='NightWatch:CastStats')return this.#cast?.stats()??{active:false};
    if(name==='NightWatch:Status'){this.#find();return {sample:this.#sample(),ad:this.#ad(),ready:(this.#video?.readyState??0)>=2};}
    if(name==='NightWatch:OverlayState')return this.#overlay?.state()??{visible:false};
    if(name==='NightWatch:Overlay'){if(!data?.enabled){this.#overlay?.destroy();this.#overlay=null;return;}this.#overlay??=new NightWatchOverlay(this.contentWindow,value=>this.sendAsyncMessage('NightWatch:Control',value));this.#overlay.update(data);return;}
    if (name === 'NightWatch:Pause') { this.#expect('pause',sample=>sample?.paused===true); this.#video?.pause(); return null; }
    if (name === 'NightWatch:Read' || name === 'NightWatch:Start') return this.#sample();
    if (name !== 'NightWatch:Apply') return null;
    const video = this.#video, target = data;
    if (!video || video.readyState === 0) return {status: 'waiting-video'};
    if (!target || !Number.isFinite(target.position) || target.position < 0 || target.position > 604800 || typeof target.paused !== 'boolean' || !Number.isFinite(target.rate) || target.rate < .25 || target.rate > 4) return null;
    this.#applying = true;
    try {
      const position = Number.isFinite(video.duration) ? Math.min(target.position, Math.max(0, video.duration - .05)) : target.position;
      if(this.#sample()?.ad)return {status:'advertisement'};
      const correction=playbackCorrection({position:video.currentTime,paused:video.paused,rate:video.playbackRate},{...target,position});
      const {drift,rate}=correction;this.#nominalRate=target.rate;
      if(correction.seek&&!video.seeking){this.#expect('seeked',sample=>sample&&Math.abs(sample.position-position)<1);video.currentTime=position;}
      if(Math.abs(video.playbackRate-rate)>.001){this.#expect('ratechange',()=>Math.abs(video.playbackRate-rate)<.001);video.playbackRate=rate;}
      if (target.paused || target.buffering) { if (!video.paused) this.#expect('pause',sample=>sample?.paused===true); video.pause(); }
      else if (video.paused) {
        this.#expect('play',sample=>sample?.paused===false);
        let timer;
        try {
          const played = await Promise.race([video.play().then(() => true, () => false), new Promise(resolve => { timer = this.contentWindow.setTimeout(() => resolve(null), 1000); })]);
          if (played === false) return {status: 'autoplay-blocked'};
          if (played === null) return {status: 'waiting-video'};
        } finally { if (timer) this.contentWindow.clearTimeout(timer); }
      }
      return {status: 'connected', drift};
    } finally { this.#applying = false; }
  }
  didDestroy() {this.#cast?.stop();this.#cast=null; try{this.#overlay?.destroy();}catch{}this.#overlay=null;this.#active = false;if(this.#video&&this.#nominalRate!==null)try{this.#video.playbackRate=this.#nominalRate;}catch{} this.#observer?.disconnect(); this.#observer = null; this.#unbind(); this.#expected.clear(); }
}
