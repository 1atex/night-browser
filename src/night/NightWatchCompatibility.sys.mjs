import {AddonManager} from 'resource://gre/modules/AddonManager.sys.mjs';
export const NightWatchCompatibility={
  checked:0,value:'unknown',
  async blocker(){
    if(!Services.prefs.getBoolPref('night.together.compare-ad-blocking',true))return 'unknown';
    if(Date.now()-this.checked<30000)return this.value;
    const ids=['uBlock0@raymondhill.net','adguardadblocker@adguard.com','jid1-NIfFY2CA8fy1tg@jetpack','{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}'];
    try{const addons=await Promise.all(ids.map(id=>AddonManager.getAddonByID(id)));this.value=addons.some(addon=>addon?.isActive)?'enabled':'none';this.checked=Date.now();}catch{this.value='unknown';}return this.value;
  },
};
