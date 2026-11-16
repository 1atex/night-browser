const key='night-room-audio-levels';
const validId=id=>typeof id==='string'&&/^[a-f0-9]{16}$/.test(id);
const validLevel=value=>Number.isFinite(value)&&value>=0&&value<=1;
export class AudioLevels{
  #values=new Map();
  #storage;
  constructor(storage){
    this.#storage=storage;
    try{const data=JSON.parse(storage?.getItem(key)??'{}');for(const [id,value]of Object.entries(data).slice(-100))if(validId(id)&&validLevel(value?.level)&&validLevel(value?.previous))this.#values.set(id,value);}catch{}
  }
  get(id){return this.#values.get(id)?.level??1;}
  set(id,level){
    if(!validId(id)||!validLevel(level))throw Error('Неверная громкость участника.');
    const previous=level>0?level:this.#values.get(id)?.previous||this.get(id)||1;
    this.#values.delete(id);this.#values.set(id,{level,previous});
    while(this.#values.size>100)this.#values.delete(this.#values.keys().next().value);
    try{this.#storage?.setItem(key,JSON.stringify(Object.fromEntries(this.#values)));}catch{}
    return level;
  }
  toggle(id){return this.set(id,this.get(id)>0?0:this.#values.get(id)?.previous||1);}
}
