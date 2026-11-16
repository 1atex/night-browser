import {setTimeout} from 'resource://gre/modules/Timer.sys.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
export const NightTogetherSounds={
  last:0,
  play(kind){
    if(!Services.prefs.getBoolPref('night.together.sounds',true)||Date.now()-this.last<500)return;
    const window=[...Services.wm.getEnumerator('navigator:browser')].find(w=>!PrivateBrowsingUtils.isWindowPrivate(w)&&!w.closed);if(!window)return;
    const volume=Math.max(0,Math.min(100,Services.prefs.getIntPref('night.together.sound-volume',25)))/100;if(!volume)return;
    this.last=Date.now();let audio;
    try{audio=new window.AudioContext();const frequencies=kind==='leave'?[660,440]:kind==='notice'?[620,780]:[440,660];for(let i=0;i<frequencies.length;i++){const oscillator=audio.createOscillator(),gain=audio.createGain(),start=audio.currentTime+i*.085;oscillator.frequency.value=frequencies[i];gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.06*volume,start+.008);gain.gain.exponentialRampToValueAtTime(.0001,start+.075);oscillator.connect(gain).connect(audio.destination);oscillator.start(start);oscillator.stop(start+.08);}setTimeout(()=>audio.close().catch(()=>{}),350);}catch{audio?.close().catch(()=>{});}
  },
};
