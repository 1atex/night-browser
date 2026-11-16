const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=text=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const validId=id=>typeof id==='string'&&/^[a-f0-9]{16}$/.test(id);
export async function createNoticeIdentity(api=crypto){
  const pair=await api.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  return {publicKey:encode(await api.subtle.exportKey('raw',pair.publicKey)),privateKey:await api.subtle.exportKey('jwk',pair.privateKey)};
}
export async function noticeFingerprint(publicKey,api=crypto){
  const key=decode(publicKey);if(key.length!==65||key[0]!==4)throw Error('Неверный ключ устройства.');
  return [...new Uint8Array(await api.subtle.digest('SHA-256',key))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function keyFor(privateKey,publicKey,from,to,api){
  const secret=await api.subtle.importKey('jwk',privateKey,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const peer=await api.subtle.importKey('raw',decode(publicKey),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const bits=await api.subtle.deriveBits({name:'ECDH',public:peer},secret,256);
  const seed=await api.subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
  return api.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:utf8.encode('Night Together notifications v1'),info:utf8.encode([from,to].sort().join(':'))},seed,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function metadata(value){
  if(value?.version!==1||!validId(value.from)||!validId(value.to)||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id)||!Number.isSafeInteger(value.at)||value.at<0)throw Error('Неверное уведомление.');
  return utf8.encode(JSON.stringify({version:1,id:value.id,from:value.from,to:value.to,at:value.at}));
}
export async function encryptNotice(privateKey,publicKey,{from,to,text,at=Date.now()},api=crypto){
  if(typeof text!=='string'||!text.trim()||text.length>1000)throw Error('Уведомление: от 1 до 1000 символов.');
  const value={version:1,id:[...api.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join(''),from,to,at};
  const nonce=api.getRandomValues(new Uint8Array(12)),key=await keyFor(privateKey,publicKey,from,to,api);
  return {...value,nonce:encode(nonce),ciphertext:encode(await api.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:metadata(value)},key,utf8.encode(text.trim())))};
}
export async function decryptNotice(privateKey,publicKey,value,self,api=crypto){
  const aad=metadata(value);if(value.to!==self||typeof value.ciphertext!=='string'||value.ciphertext.length>8192||typeof value.nonce!=='string')throw Error('Неверный получатель или размер уведомления.');
  const nonce=decode(value.nonce);if(nonce.length!==12)throw Error('Неверное уведомление.');
  const key=await keyFor(privateKey,publicKey,value.from,value.to,api);
  const text=decoder.decode(await api.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad},key,decode(value.ciphertext)));
  if(!text||text.length>1000)throw Error('Неверный размер уведомления.');return text;
}
