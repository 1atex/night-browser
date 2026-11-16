import {validAvatar} from 'resource:///modules/night/AvatarModel.mjs';
export const NightAvatar={
 async pick(window){
  const chooser=Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);chooser.init(window.browsingContext,'Выбрать аватар',Ci.nsIFilePicker.modeOpen);chooser.appendFilter('Изображения PNG, JPEG, WebP','*.png;*.jpg;*.jpeg;*.webp');
  if(await new Promise(resolve=>chooser.open(resolve))!==Ci.nsIFilePicker.returnOK)return null;
  if(chooser.file.fileSize>5242880)throw Error('Выбери изображение размером до 5 МБ.');
  return this.encode(window,await IOUtils.read(chooser.file.path));
 },
 async encode(window,bytes){
  if(!bytes?.length||bytes.length>5242880)throw Error('Изображение: до 5 МБ.');
  const start=Array.from(bytes.slice(0,12)),png=start.slice(0,8).join(',')==='137,80,78,71,13,10,26,10',jpeg=start[0]===255&&start[1]===216&&start[2]===255,webp=String.fromCharCode(...start.slice(0,4))==='RIFF'&&String.fromCharCode(...start.slice(8))==='WEBP';
  if(!png&&!jpeg&&!webp)throw Error('Поддерживаются PNG, JPEG и WebP.');
  const type=png?'image/png':jpeg?'image/jpeg':'image/webp',blob=new window.Blob([bytes],{type});let image;
  try{const info=Cc['@mozilla.org/image/tools;1'].getService(Ci.imgITools).decodeImageFromArrayBuffer(bytes.buffer,type);if(info.width<1||info.height<1||info.width>8192||info.height>8192||info.width*info.height>20000000)throw Error('Размер изображения: до 20 мегапикселей.');const side=Math.min(info.width,info.height);image=await window.createImageBitmap(blob,Math.floor((info.width-side)/2),Math.floor((info.height-side)/2),side,side,{resizeWidth:96,resizeHeight:96,resizeQuality:'high'});const canvas=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');for(const size of [96,72,48]){canvas.width=size;canvas.height=size;canvas.getContext('2d').drawImage(image,0,0,size,size);const result=canvas.toDataURL('image/png');if(validAvatar(result))return result;}throw Error('Не удалось уменьшить изображение.');}catch(error){throw Error('Не удалось прочитать изображение: '+error.message);}finally{image?.close();}
 },
 render(node,avatar,label){node.replaceChildren();if(avatar){const image=node.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml','img');image.src=avatar;image.alt='';image.className='night-avatar-image';image.referrerPolicy='no-referrer';node.append(image);}else node.textContent=label;},
};
