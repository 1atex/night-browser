export class NightWatchOverlay{
  #window;#document;#send;#host;#root;#mic;#room;#people;#participantsButton;#rows=new Map();#timer;#data={};#dragging=false;#keyboard=false;#over=false;
  constructor(window,send){
    this.#window=window;this.#document=window.document;this.#send=send;window.windowUtils.loadSheetUsingURIString('chrome://browser/content/night/watch-overlay.css',window.windowUtils.AGENT_SHEET);
    const host=this.#document.createElement('div');host.id='night-watch-controls';host.setAttribute('popover','manual');host.hidden=true;this.#host=host;this.#root=host.attachShadow({mode:'closed'});
    const sheet=new window.CSSStyleSheet();sheet.replaceSync(`
      :host{position:fixed;inset:16px 16px auto auto;margin:0;padding:0;border:0;background:transparent;color:#f2f2f5;font:12px system-ui,sans-serif;max-width:360px;z-index:2147483647}
      *{box-sizing:border-box}
      .bar,.people{border:1px solid #ffffff26;background:rgba(18,18,21,.64);backdrop-filter:blur(18px) saturate(125%);box-shadow:0 10px 32px #0005,inset 0 1px #ffffff07}
      .bar{display:flex;gap:5px;align-items:center;border-radius:24px;padding:5px}
      button{display:flex;align-items:center;gap:7px;font:inherit;color:inherit;border:1px solid transparent;border-radius:18px;background:transparent;padding:8px 11px;cursor:pointer}
      button:hover,button[aria-expanded=true]{background:#ffffff13}
      button[data-microphone]{color:#c5e6d7;background:#b9dbcb16;border-color:#b9dbcb28}
      button[data-microphone]:disabled{color:#edbab4;background:#e6a6a114;border-color:#e6a6a12d;cursor:default}
      button[data-room]{color:#e2e7ef}
      button:focus-visible,input:focus-visible{outline:1px solid #c2c8d2;outline-offset:2px}
      .people{display:flex;flex-direction:column;gap:12px;border-radius:16px;padding:14px;margin-top:7px}
      .person{display:grid;grid-template-columns:105px 100px 32px;gap:9px;align-items:center}
      .person span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .person output{font-size:10px;color:#ffffffb3;text-align:right}
      input{width:100%;accent-color:#c2c8d2}
      svg{width:16px;height:16px;flex:0 0 16px;vertical-align:middle}
      .hidden{display:none}
      :host([data-solid]) .bar,:host([data-solid]) .people{background:#171719;backdrop-filter:none}
      @media (prefers-reduced-transparency:reduce),(prefers-contrast:more){.bar,.people{background:#171719;backdrop-filter:none}}
    `);this.#root.adoptedStyleSheets=[sheet];
    const bar=this.#element('div','',{class:'bar'});this.#mic=this.#element('button','',{type:'button','aria-label':'Выключить микрофон','data-microphone':'true'});this.#mic.append(this.#icon('microphone'),this.#element('span','Микрофон'));this.#mic.addEventListener('click',event=>{if(event.isTrusted)this.#send({type:'microphone-off'});this.#schedule();});
    const participants=this.#element('button','Громкость',{type:'button','aria-expanded':'false'});participants.prepend(this.#icon('volume'));this.#participantsButton=participants;this.#people=this.#element('div','',{class:'people hidden'});participants.addEventListener('click',event=>{if(!event.isTrusted)return;const hidden=this.#people.classList.toggle('hidden');participants.setAttribute('aria-expanded',String(!hidden));this.#schedule();});
    this.#room=this.#element('button','Комната',{type:'button','data-room':'true'});this.#room.prepend(this.#icon('chat'));this.#room.addEventListener('click',event=>{if(event.isTrusted)this.#send({type:'open-room'});});bar.append(this.#mic,participants,this.#room);this.#root.append(bar,this.#people);
    this.#host.addEventListener('pointerenter',()=>{this.#over=true;this.#window.clearTimeout(this.#timer);});this.#host.addEventListener('pointerleave',()=>{this.#over=false;this.#schedule();});
    this.#root.addEventListener('pointerdown',event=>{this.#keyboard=false;if(event.target?.type==='range')this.#dragging=true;});this.#root.addEventListener('keydown',()=>{this.#keyboard=true;this.#schedule();});
    window.addEventListener('pointermove',this,{capture:true,passive:true});window.addEventListener('pointerup',this,true);this.#document.addEventListener('fullscreenchange',this);this.#document.documentElement.append(host);
  }
  #element(tag,text='',attributes={}){const element=this.#document.createElement(tag);element.textContent=text;for(const [key,value]of Object.entries(attributes))element.setAttribute(key,value);return element;}
  #icon(name){
    const paths={microphone:'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V6M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M8 21h8','microphone-off':'M9 5a3 3 0 0 1 6 1v6M6 10v2a6 6 0 0 0 10 4M12 18v3M8 21h8M3 3l18 18M9 9v3a3 3 0 0 0 4 3',volume:'M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',chat:'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z'};
    const svg=this.#document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);const path=this.#document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]);svg.append(path);return svg;
  }
  update(data){
    if(this.#data.microphone!==data.microphone)this.#mic.replaceChildren(this.#icon(data.microphone?'microphone':'microphone-off'),this.#element('span',data.microphone?'Микрофон':'Выкл.'));this.#data=data;this.#host.toggleAttribute('data-solid',data.glass===false);this.#mic.disabled=!data.microphone;this.#mic.title=data.microphone?'Выключить микрофон':'Микрофон выключен · включение из панели браузера';this.#mic.setAttribute('aria-label',this.#mic.title);
    const ids=new Set((data.participants??[]).map(p=>p.id));for(const [id,row]of this.#rows)if(!ids.has(id)){row.root.remove();this.#rows.delete(id);}
    for(const peer of data.participants??[]){
      let row=this.#rows.get(peer.id);if(!row){const root=this.#element('div','',{class:'person'}),name=this.#element('span'),input=this.#element('input','',{type:'range',min:'0',max:'100',step:'1'}),level=this.#element('output');input.addEventListener('input',event=>{if(!event.isTrusted)return;const volume=Number(input.value)/100;level.textContent=input.value+'%';this.#send({type:'volume',id:peer.id,volume});});root.append(name,input,level);this.#people.append(root);row={root,name,input,level};this.#rows.set(peer.id,row);}row.name.textContent=peer.name;row.input.setAttribute('aria-label','Громкость: '+peer.name);if(this.#root.activeElement!==row.input)row.input.value=String(Math.round(peer.volume*100));row.level.textContent=Math.round(peer.volume*100)+'%';
    }
    if(!data.active)this.hide();
  }
  handleEvent(event){
    if(event.type==='fullscreenchange'){this.hide();return;}
    if(event.type==='pointerup'){this.#dragging=false;this.#schedule();return;}
    if(event.type==='pointermove'&&this.#document.fullscreenElement&&this.#data.active&&event.clientX>this.#window.innerWidth-180&&event.clientY<75)this.show();
  }
  show(){if(!this.#document.fullscreenElement||!this.#data.active)return;if(!this.#host.isConnected)this.#document.documentElement.append(this.#host);this.#host.hidden=false;try{if(!this.#host.matches(':popover-open'))this.#host.showPopover();}catch{}this.#schedule();}
  #schedule(){this.#window.clearTimeout(this.#timer);this.#timer=this.#window.setTimeout(()=>{if(this.#over||this.#dragging||this.#keyboard&&this.#root.activeElement){this.#schedule();return;}this.hide();},2500);}
  hide(){this.#window.clearTimeout(this.#timer);try{this.#host.hidePopover();}catch{}this.#host.hidden=true;this.#people.classList.add('hidden');this.#participantsButton.setAttribute('aria-expanded','false');this.#over=false;this.#dragging=false;this.#keyboard=false;}
  state(){const rect=this.#host.getBoundingClientRect(),mic=this.#mic.getBoundingClientRect();const glass=this.#window.getComputedStyle(this.#root.querySelector('.bar'));return {glass:{filter:glass.backdropFilter,background:glass.backgroundColor},visible:!this.#host.hidden,fullscreen:!!this.#document.fullscreenElement,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},microphone:{enabled:!this.#mic.disabled,x:mic.x+mic.width/2,y:mic.y+mic.height/2},participants:this.#rows.size,peopleButton:(()=>{const b=this.#participantsButton.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})(),volumes:[...this.#rows].map(([id,row])=>{const b=row.input.getBoundingClientRect();return {id,value:Number(row.input.value),x:b.x,y:b.y,width:b.width,height:b.height};})};}
  destroy(){this.hide();this.#window.windowUtils.removeSheetUsingURIString('chrome://browser/content/night/watch-overlay.css',this.#window.windowUtils.AGENT_SHEET);this.#window.removeEventListener('pointermove',this,true);this.#window.removeEventListener('pointerup',this,true);this.#document.removeEventListener('fullscreenchange',this);this.#host.remove();this.#rows.clear();}
}
