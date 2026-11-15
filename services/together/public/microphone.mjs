export class MicrophoneSession {
  #generation=0;
  #pending=0;
  #stream=null;
  get pending(){return this.#pending!==0;}
  get stream(){return this.#stream;}
  async start(acquire){
    if(this.#pending||this.#stream)return null;
    const generation=++this.#generation;this.#pending=generation;
    try{
      const stream=await acquire();
      if(generation!==this.#generation){stream.getTracks().forEach(track=>track.stop());return null;}
      this.#stream=stream;return stream;
    }finally{if(this.#pending===generation)this.#pending=0;}
  }
  stop(){++this.#generation;this.#pending=0;this.#stream?.getTracks().forEach(track=>track.stop());this.#stream=null;}
}
