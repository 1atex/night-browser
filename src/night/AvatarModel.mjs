export function validAvatar(value){
 if(typeof value!=='string'||value.length>16384||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
 try{const raw=atob(value.slice(22));if(raw.length<32||raw.slice(0,8)!=='\x89PNG\r\n\x1a\n'||raw.slice(12,16)!=='IHDR')return false;const number=i=>((raw.charCodeAt(i)*16777216)+(raw.charCodeAt(i+1)<<16)+(raw.charCodeAt(i+2)<<8)+raw.charCodeAt(i+3));return number(16)>0&&number(16)<=96&&number(20)>0&&number(20)<=96;}catch{return false;}
}
export function friendAvatarURL(endpoint,path){try{if(typeof path!=='string'||!/^\/avatars\/[a-f0-9]{16}\/[a-f0-9]{64}\.png$/.test(path))return null;return new URL(path,new URL(endpoint).origin).href;}catch{return null;}}
