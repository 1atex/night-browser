export class NightRoomChild extends JSWindowActorChild {
  #bound=false;
  handleEvent(event) {
    if (this.#bound) return;
    this.#bound=true;
    this.document.addEventListener('NightRoom:Query',event=>{
      let value;try{value=JSON.parse(event.detail);}catch{return;}
      if (!Number.isSafeInteger(value.id) || typeof value.method!=='string' || JSON.stringify(value).length>75000) return;
      this.sendQuery('NightRoom:Request',value).then(result=>this.#reply(value.id,{result}),error=>this.#reply(value.id,{error:error.message}));
    }, false, true);
    this.contentWindow.dispatchEvent(new this.contentWindow.CustomEvent('NightRoom:Available'));
  }
  receiveMessage({name,data}){if(name==='NightRoom:Command')try{this.contentWindow.dispatchEvent(new this.contentWindow.CustomEvent('NightRoom:Command',{detail:JSON.stringify(data)}));}catch{}}
  #reply(id,value) { try {this.contentWindow.dispatchEvent(new this.contentWindow.CustomEvent('NightRoom:Reply',{detail:JSON.stringify({id,...value})}));}catch{} }
}
