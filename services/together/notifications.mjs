const validId=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value);
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function notificationAction(state,user,body,now){
  if(body.type==='notice-key'){
    if(typeof body.publicKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(body.publicKey))fail(400,'Неверный публичный ключ.');
    const key=Buffer.from(body.publicKey,'base64url');if(key.length!==65||key[0]!==4)fail(400,'Неверный публичный ключ.');
    user.noticeKey=body.publicKey;return;
  }
  if(body.type==='notice-send'){
    const peer=state.users[body.id],value=body.envelope;
    if(!validId(body.id)||!peer||!user.friends.includes(peer.id)||!peer.friends.includes(user.id))fail(403,'Уведомления доступны подтверждённым друзьям.');
    if(!user.noticeKey||!peer.noticeKey)fail(409,'Сначала оба включите зашифрованные уведомления.');
    if(value?.version!==1||value.from!==user.id||value.to!==peer.id||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id)||!Number.isSafeInteger(value.at)||value.at<0||typeof value.nonce!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(value.nonce)||typeof value.ciphertext!=='string'||!/^[A-Za-z0-9_-]{22,8192}$/.test(value.ciphertext))fail(400,'Неверное зашифрованное уведомление.');
    user.noticeSent=(user.noticeSent??[]).filter(item=>item.at>now-86400000).slice(-99);
    if(user.noticeSent.some(item=>item.id===value.id))fail(409,'Уведомление уже отправлено.');
    if(user.noticeSent.filter(item=>item.at>now-60000).length>=10)fail(429,'Не более десяти уведомлений в минуту.');
    peer.notifications=(peer.notifications??[]).filter(item=>item.receivedAt>now-86400000);
    if(peer.notifications.length>=50)fail(429,'Очередь получателя заполнена.');
    let total=0;for(const value of Object.values(state.users)){value.notifications=(value.notifications??[]).filter(item=>item.receivedAt>now-86400000);total+=JSON.stringify(value.notifications).length;}if(total+value.ciphertext.length>8388608)fail(429,'Очередь уведомлений временно заполнена.');
    peer.notifications.push({version:1,id:value.id,from:user.id,to:peer.id,at:value.at,nonce:value.nonce,ciphertext:value.ciphertext,receivedAt:now});user.noticeSent.push({id:value.id,at:now});return;
  }
  if(body.type==='notice-ack'){
    if(!Array.isArray(body.ids)||body.ids.length>50||body.ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)))fail(400,'Неверные номера уведомлений.');
    const remove=new Set(body.ids);user.notifications=(user.notifications??[]).filter(value=>!remove.has(value.id));return;
  }
  fail(400,'Неизвестное действие уведомлений.');
}
export function publicNotices(user,now){return (user.notifications??[]).filter(value=>value.receivedAt>now-86400000&&user.friends.includes(value.from));}
