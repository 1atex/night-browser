import {setTimeout,clearTimeout} from 'resource://gre/modules/Timer.sys.mjs';
import {rememberVideo} from 'resource:///modules/night/WatchModel.mjs';
const path=()=>PathUtils.join(PathUtils.profileDir,'night-watch-history.json');
export const NightWatchHistory={
  records:null,loading:null,timer:null,writing:Promise.resolve(),
  async list(){if(this.records)return this.records;this.loading??=IOUtils.readJSON(path()).catch(()=>[]).then(value=>{if(this.records)return this.records;this.records=[];for(const item of (Array.isArray(value)?value:[]).slice(0,50).reverse())this.records=rememberVideo(this.records,item);return this.records;}).finally(()=>{this.loading=null;});return this.loading;},
  async record(item){if(!Services.prefs.getBoolPref('night.together.history',true))return;this.records=rememberVideo(await this.list(),item);clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),1000);Services.obs.notifyObservers(null,'night-together-history');},
  flush(){clearTimeout(this.timer);if(this.records===null)return this.writing;const records=this.records;this.writing=this.writing.catch(()=>{}).then(()=>IOUtils.writeJSON(path(),records,{tmpPath:path()+'.tmp'})).catch(error=>console.error('Night watch history',error));return this.writing;},
  async clear(){this.records=[];await this.flush();Services.obs.notifyObservers(null,'night-together-history');},
};
