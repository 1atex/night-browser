export class NightWatchChild extends JSWindowActorChild {
  #active = false;
  #video = null;
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
  #unbind() { if (this.#video) for (const name of this.#events) this.#video.removeEventListener(name, this); this.#video = null; }
  #sample() {
    this.#find(); const video = this.#video;
    if (!video || video.readyState === 0 || !Number.isFinite(video.currentTime)) return null;
    return {position: video.currentTime, paused: video.paused || video.ended, rate: video.playbackRate, buffering: !video.paused && video.readyState < 3};
  }
  handleEvent(event) {
    if (!this.#active) return;
    const sample=this.#sample(), expected=this.#expected.get(event.type);
    if (expected) {
      this.#expected.delete(event.type);
      if (Date.now()<expected.until && expected.matches(sample)) return;
    }
    if (!this.#applying) this.sendAsyncMessage('NightWatch:Media', {sample, control:['play','pause','seeked','ratechange'].includes(event.type)});
  }
  #expect(name, matches) { this.#expected.set(name,{until:Date.now()+2000,matches}); }
  async receiveMessage({name, data}) {
    if (name === 'NightWatch:Stop') { this.didDestroy(); return null; }
    if (name === 'NightWatch:Start' && !this.#active) {
      this.#active = true;
      this.#observer = new this.contentWindow.MutationObserver(() => this.#find());
      this.#observer.observe(this.document, {childList: true, subtree: true});
      this.#find();
    }
    if (!this.#active) return null;
    if (name === 'NightWatch:Pause') { this.#expect('pause',sample=>sample?.paused===true); this.#video?.pause(); return null; }
    if (name === 'NightWatch:Read' || name === 'NightWatch:Start') return this.#sample();
    if (name !== 'NightWatch:Apply') return null;
    const video = this.#video, target = data;
    if (!video || video.readyState === 0) return {status: 'waiting-video'};
    if (!target || !Number.isFinite(target.position) || target.position < 0 || target.position > 604800 || typeof target.paused !== 'boolean' || !Number.isFinite(target.rate) || target.rate < .25 || target.rate > 4) return null;
    this.#applying = true;
    try {
      const position = Number.isFinite(video.duration) ? Math.min(target.position, Math.max(0, video.duration - .05)) : target.position;
      const drift = position - video.currentTime;
      if (Math.abs(drift) > (target.paused ? .15 : .8) && !video.seeking) { this.#expect('seeked',sample=>sample && Math.abs(sample.position-position)<1); video.currentTime = position; }
      const rate = !target.paused && Math.abs(drift) > .15 && Math.abs(drift) < .8 ? Math.min(4, Math.max(.25, target.rate + Math.sign(drift) * .05)) : target.rate;
      if (Math.abs(video.playbackRate - rate) > .001) { this.#expect('ratechange',sample=>sample && Math.abs(sample.rate-rate)<.001); video.playbackRate = rate; }
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
  didDestroy() { this.#active = false; this.#observer?.disconnect(); this.#observer = null; this.#unbind(); this.#expected.clear(); }
}
