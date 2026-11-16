import {NightTogether} from 'resource:///modules/night/NightTogether.sys.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
export const NightCastIndicators={
  windows:new Map(),
  start(window){
    if(PrivateBrowsingUtils.isWindowPrivate(window)||this.windows.has(window))return;
    const document=window.document,node=document.createElementNS('http://www.w3.org/1999/xhtml','section');node.id='night-cast-indicator';node.setAttribute('popover','manual');node.setAttribute('role','status');node.hidden=true;
    const text=document.createElementNS('http://www.w3.org/1999/xhtml','span');text.textContent='Передаём плеер';const stop=document.createElementNS('http://www.w3.org/1999/xhtml','button');stop.type='button';stop.textContent='Остановить';stop.onclick=()=>NightTogether.stopCast();node.append(text,stop);document.documentElement.append(node);this.windows.set(window,node);
    window.addEventListener('unload',()=>{this.windows.delete(window);},{once:true});this.update();
  },
  update(){for(const [window,node]of this.windows){if(window.closed){this.windows.delete(window);continue;}if(NightTogether.castSession){node.hidden=false;if(!node.matches(':popover-open'))node.showPopover();}else{if(node.matches(':popover-open'))node.hidePopover();node.hidden=true;}}},
};
