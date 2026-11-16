import http from 'node:http';
import {timelinePosition, RoomCommands} from './timeline.mjs';
import {RoomReadiness} from './readiness.mjs';
import {notificationAction,publicNotices} from './notifications.mjs';
import {publicWeb} from './web.mjs';
import {randomBytes, timingSafeEqual, createHmac, createHash} from 'node:crypto';
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const colors = ['moon','violet','sky','jade','amber','rose'];
const icons = ['initial','☾','✦','⚡','☁','◈','⌘','🎧'];
const id = () => randomBytes(8).toString('hex');
const secret = () => randomBytes(32).toString('hex');
const validId = value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const safeURL = value => {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 2048) throw 0; return url.href; }
  catch { fail(400, 'Нужна ссылка HTTP или HTTPS без логина и пароля.'); }
};
export async function createService({path, now = Date.now, releases, iceServers, turnSecret = process.env.NIGHT_TURN_SECRET, turnURL = process.env.NIGHT_TURN_URL} = {}) {
  let state = {users: {}, rooms: {}};
  if (path) { try { state = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const rates = new Map(), signals = new Map(), seen=new Map(), readiness=new RoomReadiness(now), commands=new RoomCommands();
  let signalSequence = 0;
  const web = publicWeb({releases});
  const rtc = user => {
    const servers = iceServers ?? [{urls:'stun:stun.l.google.com:19302'}];
    if (!turnSecret || !turnURL) return servers;
    const username = `${Math.floor(now()/1000)+3600}:${user.id}`;
    return [...servers,{urls:turnURL.split(','),username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')}];
  };
  let queue = Promise.resolve();
  const save = async () => { if (path) { await mkdir(dirname(path), {recursive: true}); await writeFile(path + '.tmp', JSON.stringify(state), {mode: 0o600}); await rename(path + '.tmp', path); } };
  function videoInfo(body,url){
    const title=typeof body.title==='string'?body.title.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160):new URL(url).hostname;let poster='';
    try{const image=new URL(body.poster),source=new URL(url);if(image.protocol==='https:'&&!image.username&&!image.password&&image.href.length<=2048&&(image.origin===source.origin||image.hostname==='i.ytimg.com'&&['youtube.com','www.youtube.com','youtu.be'].includes(source.hostname)))poster=image.href;}catch{}
    return {title:title||new URL(url).hostname,poster};
  }
  function profile(user) { return {id: user.id, name: user.name || 'Участник ' + user.id.slice(-4), color: colors.includes(user.color) ? user.color : 'moon', icon: icons.includes(user.icon) ? user.icon : 'initial',online:seen.has(user.id)&&now()-seen.get(user.id)<70000,avatar:user.avatar?.digest?'/avatars/'+user.id+'/'+user.avatar.digest+'.png':null,noticeKey:user.noticeKey??null}; }
  function snapshot(user) {
    const room = Object.values(state.rooms).find(item => item.members.includes(user.id));
    const visible = new Set([...user.friends, ...user.incoming, ...user.outgoing, ...(room?.members ?? [])]);
    const invitations = user.invites.filter(id => state.rooms[id]).map(id => ({id, owner: state.rooms[id].owner,title:state.rooms[id].title||new URL(state.rooms[id].url).hostname,poster:state.rooms[id].poster||''}));
    for (const item of invitations) visible.add(item.owner);
    const people = Object.fromEntries([...visible].filter(id => state.users[id]).map(id => [id, profile(state.users[id])]));
    const ready=room?readiness.view(room):null;
    const publicRoom = room ? {...room, rate: room.rate ?? 1, buffering: room.buffering ?? false} : null;
    if (publicRoom) {
      if (room.authority === "server" && !ready.hold) { publicRoom.position=timelinePosition(room,now()); publicRoom.updatedAt=now(); }
      delete publicRoom.inviteToken; delete publicRoom.inviteExpires;
      publicRoom.readiness=ready;publicRoom.invited=room.owner===user.id?user.friends.filter(id=>state.users[id]?.invites.includes(room.id)).map(id=>profile(state.users[id])):[];
      publicRoom.requests = room.owner === user.id ? (room.requests ?? []).filter(id=>state.users[id]).map(id=>profile(state.users[id])) : [];
      publicRoom.link = room.owner === user.id && room.inviteToken && room.inviteExpires > now() ? `https://browser.night-watchers.com/join/${room.inviteToken}` : null;
    }
    return {protocol: 4,features:['authoritative-playback','readiness','cast','encrypted-notices','profile-avatars','video-invites'],notices:publicNotices(user,now()), pendingRooms:Object.values(state.rooms).filter(r=>r.requests?.includes(user.id)).map(r=>({id:r.id,owner:profile(state.users[r.owner])})), self: profile(user), people, id: user.id, friends: user.friends.map(id => profile(state.users[id])), incoming: user.incoming, outgoing: user.outgoing,
      invitations, room: publicRoom, serverTime: now()};
  }
  function authenticated(request) {
    const match = /^Bearer ([a-f0-9]{16}):([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
    const user = match && state.users[match[1]];
    if (!user || !timingSafeEqual(Buffer.from(user.token), Buffer.from(match[2]))) fail(401, 'Не удалось подтвердить ID.');
    seen.set(user.id,now());return user;
  }
  function leave(user) {
    for (const [key, room] of Object.entries(state.rooms)) if (room.members.includes(user.id)) {
      if (room.owner === user.id) {readiness.remove(room);delete state.rooms[key];} else room.members = room.members.filter(id => id !== user.id);
      signals.delete(user.id);
    }
  }
  async function handle(request, body) {
    if (request.url === '/health' && request.method === 'GET') return {ok: true};
    if (request.url === '/v1/register' && request.method === 'POST') {
      if (Object.keys(state.users).length >= 10000) fail(503, 'Регистрация временно недоступна.');
      const user = {id: id(), token: secret(), friends: [], incoming: [], outgoing: [], invites: []};
      state.users[user.id] = user; await save(); return {id: user.id, token: user.token};
    }
    const user = authenticated(request);
    if (request.url === '/v1/rtc' && request.method === 'GET') {
      const room = Object.values(state.rooms).find(r=>r.members.includes(user.id));
      if (!room) fail(403,'Сначала войди в комнату.'); return {iceServers:rtc(user)};
    }
    if (request.url.startsWith('/v1/signals?') && request.method === 'GET') {
      const after = Number(new URL(request.url,'http://localhost').searchParams.get('after'));
      if (!Number.isSafeInteger(after) || after < 0) fail(400,'Неверный номер сигнала.');
      const room = Object.values(state.rooms).find(r=>r.members.includes(user.id));
      if (!room) fail(403,'Комната недоступна.');
      const items = (signals.get(user.id) ?? []).filter(s=>s.room===room.id && s.at > now()-60000 && s.seq>after && room.members.includes(s.from));
      return {items, cursor:signalSequence};
    }
    if (request.url === '/v1/state'  && request.method === 'GET') return snapshot(user);
    if (request.url !== '/v1/action' || request.method !== 'POST') fail(404, 'Не найдено.');
    const peer = state.users[body.id];
    switch (body.type) {
      case 'notice-key':case 'notice-send':case 'notice-ack':case 'notice-disable':notificationAction(state,user,body,now());break;
      case 'room-ready': {
        const room=state.rooms[body.room];if(!room?.members.includes(user.id))fail(403,'Комната недоступна.');
        if(typeof body.ready!=='boolean'||typeof body.ad!=='boolean'||!['enabled','none','unknown'].includes(body.blocker))fail(400,'Неверное состояние готовности.');
        if (room.owner===user.id && body.authority==='server' && room.authority!=='server') {
          room.position=timelinePosition(room,now());room.updatedAt=now();room.authority='server';room.controlRevision=(room.controlRevision??0)+1;room.sourceRevision??=0;await save();
        }
        readiness.set(room,user.id,body);return snapshot(user);
      }
      case 'room-cast': {
        const room=state.rooms[body.room];if(room?.owner!==user.id||typeof body.active!=='boolean')fail(403,'Трансляцией управляет владелец.');
        if(room.authority==='server')room.position=timelinePosition(room,now());room.mode=body.active?'cast':'local';room.revision++;room.updatedAt=now();break;
      }
      case 'profile-avatar': {
        if(body.avatar===null){user.avatar=null;break;}
        const value=body.avatar;if(typeof value!=='string'||value.length>16384||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))fail(400,'Неверное изображение.');
        const data=Buffer.from(value.slice(22),'base64');if(data.length<32||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.subarray(12,16).toString()!=='IHDR'||data.readUInt32BE(16)<1||data.readUInt32BE(16)>96||data.readUInt32BE(20)<1||data.readUInt32BE(20)>96)fail(400,'Аватар должен быть PNG размером до 96 × 96.');
        let total=0;for(const peer of Object.values(state.users))if(peer!==user)total+=peer.avatar?.data?.length??0;if(total+value.length>16777216)fail(429,'Хранилище аватаров временно заполнено.');
        user.avatar={digest:createHash('sha256').update(data).digest('hex'),data:data.toString('base64')};break;
      }
      case 'profile-update': {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40 || /[\x00-\x1f\x7f]/.test(body.name) || !colors.includes(body.color) || !icons.includes(body.icon)) fail(400, 'Имя: 1–40 символов; выбери цвет и значок из списка.');
        Object.assign(user, {name: body.name.trim(), color: body.color, icon: body.icon}); break;
      }

      case 'friend-request':
        if (!validId(body.id) || !peer || peer === user) fail(400, 'ID не найден.');
        if (user.friends.length >= 100 || peer.incoming.length >= 100 || user.outgoing.length >= 100) fail(409, 'Лимит запросов или друзей.');
        if (!user.friends.includes(peer.id) && !user.outgoing.includes(peer.id)) { user.outgoing.push(peer.id); peer.incoming.push(user.id); }
        break;
      case 'friend-accept':
        if (!peer || !user.incoming.includes(peer.id) || user.friends.length >= 100 || peer.friends.length >= 100) fail(409, 'Запрос недоступен.');
        for (const [a,b] of [[user,peer],[peer,user]]) { a.incoming = a.incoming.filter(id => id !== b.id); a.outgoing = a.outgoing.filter(id => id !== b.id); if (!a.friends.includes(b.id)) a.friends.push(b.id); }
        break;
      case 'friend-remove':
      case 'friend-decline':
        if (!peer) fail(400, 'ID не найден.');
        for (const [a,b] of [[user,peer],[peer,user]]) { a.friends = a.friends.filter(id => id !== b.id); a.incoming = a.incoming.filter(id => id !== b.id); a.outgoing = a.outgoing.filter(id => id !== b.id); a.invites = a.invites.filter(id => state.rooms[id]?.owner !== b.id); }
        for (const room of Object.values(state.rooms)) if (room.owner === user.id) room.members = room.members.filter(id => id !== peer.id); else if (room.owner === peer.id) room.members = room.members.filter(id => id !== user.id);
        break;
      case 'room-link': {
        const room=state.rooms[body.room]; if (room?.owner!==user.id) fail(403,'Ссылку создаёт владелец.');
        if (!room.inviteToken || room.inviteExpires<=now() || body.rotate===true) {room.inviteToken=secret();room.inviteExpires=now()+86400000;room.requests=[];} break;
      }
      case 'room-request': {
        if (typeof body.invite!=='string' || !/^[a-f0-9]{64}$/.test(body.invite)) fail(400,'Неверная ссылка.');
        const room=Object.values(state.rooms).find(r=>r.inviteToken===body.invite && r.inviteExpires>now());
        if (!room) fail(404,'Ссылка устарела или комната закрыта.');
        if (room.members.includes(user.id)) return {...snapshot(user),requestedRoom:room.id};
        room.requests ??= []; if (room.requests.length>=20) fail(409,'Слишком много заявок.');
        if (!room.requests.includes(user.id)) room.requests.push(user.id); await save(); return {...snapshot(user),requestedRoom:room.id};
      }
      case 'room-admit':
      case 'room-deny': {
        const room=state.rooms[body.room];
        if (room?.owner!==user.id || !peer || !room.requests?.includes(peer.id)) fail(403,'Заявка недоступна.');
        if (body.type==='room-admit') {if(room.members.length>=8)fail(409,'В комнате уже восемь участников.');leave(peer);room.members.push(peer.id);}
        room.requests=room.requests.filter(id=>id!==peer.id);break;
      }
      case 'room-kick': {
        const room=state.rooms[body.room];if(room?.owner!==user.id || body.id===user.id || !room.members.includes(body.id))fail(403,'Удалять участников может владелец.');
        room.members=room.members.filter(id=>id!==body.id);signals.delete(body.id);break;
      }
      case 'room-cancel-request': {
        const room=state.rooms[body.room];if(room)room.requests=room.requests?.filter(id=>id!==user.id)??[];break;
      }
      case 'room-signal': {
        const room=state.rooms[body.room], payload=body.signal;
        if (!room?.members.includes(user.id) || !room.members.includes(body.id) || body.id===user.id) fail(403,'Участник недоступен.');
        if (payload?.channel!==undefined&&!['chat','cast'].includes(payload.channel))fail(400,'Неверный канал соединения.');
        if(payload?.channel==='cast'&&(room.mode!=='cast'||user.id!==room.owner&&body.id!==room.owner||payload.kind==='description'&&(payload.description?.type==='offer'?user.id!==room.owner:body.id!==room.owner)))fail(403,'Трансляция недоступна.');
        if (!payload || !['description','candidate','bye'].includes(payload.kind) || typeof payload.session!=='string' || !/^[a-f0-9]{32}$/.test(payload.session) || JSON.stringify(payload).length>70000) fail(400,'Некорректный сигнал.');
        if (payload.kind==='description' && (!['offer','answer'].includes(payload.description?.type) || typeof payload.description.sdp!=='string' || payload.description.sdp.length>65000)) fail(400,'Некорректное описание соединения.');
        if (payload.kind==='candidate' && (typeof payload.candidate?.candidate!=='string' || payload.candidate.candidate.length>2048)) fail(400,'Некорректный сетевой адрес.');
        for (const [key,items] of signals) {const live=items.filter(s=>s.at>now()-60000);if(live.length)signals.set(key,live);else signals.delete(key);}
        const items=signals.get(peer.id)??[], bytes=JSON.stringify(payload).length;
        if(items.length>=64 || JSON.stringify(items).length+bytes>524288 || JSON.stringify([...signals.values()]).length+bytes>4194304)fail(429,'Очередь соединения заполнена.');
        items.push({seq:++signalSequence,from:user.id,room:room.id,at:now(),signal:payload});signals.set(peer.id,items);
        return snapshot(user);
      }
      case 'room-create': {
        const url = safeURL(body.url); leave(user);
        const room = {id: id(), owner: user.id, members: [user.id], url, mode:'local',authority:body.authority==='server'?'server':'owner',sourceRevision:0,...videoInfo(body,url), position: 0, paused: true, revision: 0, controlRevision:0, updatedAt: now()};
        if(room.authority==='server'&&Number.isFinite(body.position)&&body.position>=0&&body.position<=604800&&typeof body.paused==='boolean'&&Number.isFinite(body.rate)&&body.rate>=.25&&body.rate<=4){room.position=body.position;room.paused=body.paused;room.rate=body.rate;if(Number.isFinite(body.duration)&&body.duration>0&&body.duration<=604800)room.duration=body.duration;}
        state.rooms[room.id] = room; break;
      }
      case 'room-invite': {
        const room = state.rooms[body.room];
        if (!peer || !user.friends.includes(peer.id) || room?.owner !== user.id) fail(403, 'Приглашать можно только друзей в свою комнату.');
        if (peer.invites.length >= 20) fail(409, 'Слишком много приглашений.');
        if (!peer.invites.includes(room.id)) peer.invites.push(room.id); break;
      }
      case 'room-join': {
        const room = state.rooms[body.room];
        if (!room || !user.invites.includes(room.id) || !user.friends.includes(room.owner) || room.members.length >= 8) fail(403, 'Приглашение недоступно.');
        leave(user); room.members.push(user.id); user.invites = user.invites.filter(id => id !== room.id); break;
      }
      case 'room-leave': leave(user); break;
      case 'room-metadata': {const room=state.rooms[body.room];if(room?.owner!==user.id)fail(403,'Видео меняет создатель комнаты.');Object.assign(room,videoInfo(body,room.url));break;}
      case 'room-source': {
        const room = state.rooms[body.room];
        if (room?.owner !== user.id) fail(403, 'Видео меняет создатель комнаты.');
        const sourceURL=safeURL(body.url);readiness.remove(room);Object.assign(room, {mode:'local',url: sourceURL,...videoInfo(body,sourceURL), position: 0, duration:null,lastCommand:null,paused: true, rate: 1, buffering: false, revision: room.revision + 1, sourceRevision:(room.sourceRevision??0)+1,controlRevision:(room.controlRevision??0)+1, updatedAt: now(), controlledBy:user.id}); break;
      }
      case 'room-control':
      case 'room-state': {
        const room = state.rooms[body.room];
        if (!room?.members.includes(user.id) || body.type === 'room-state' && room.owner !== user.id) fail(403, 'Нужно участвовать в комнате.');
        const waiting=readiness.view(room).hold;
        if(body.type==='room-state'&&waiting)return snapshot(user);
        const authoritative=room.authority==='server', control=body.type==='room-control';
        if (authoritative && control && commands.check(room,user,body,now())) {await save();return snapshot(user);}
        if ((!authoritative || !control || body.commandId===undefined) && body.revision !== room.revision) fail(409, 'Состояние комнаты изменилось.');
        if (!Number.isFinite(body.position) || body.position < 0 || body.position > 604800 || typeof body.paused !== 'boolean') fail(400, 'Некорректная позиция.');
        const rate = body.rate ?? 1;
        if (!Number.isFinite(rate) || rate < 0.25 || rate > 4 || (body.buffering !== undefined && typeof body.buffering !== 'boolean')) fail(400, 'Некорректная скорость.');
        const durationChanged=!control&&Number.isFinite(body.duration)&&body.duration>0&&body.duration<=604800&&body.duration!==room.duration;
        if(durationChanged)room.duration=body.duration;
        if (authoritative && !control) {if(durationChanged)await save();return snapshot(user);}
        if (authoritative && waiting) fail(409,'Ждём окончания рекламы у участника.');
        const command=['play','pause','seek','rate'].includes(body.command)?body.command:'state';
        const position=authoritative && command!=='seek' && body.seek!==true ? timelinePosition(room,now()) : body.position;
        if(control){room.controlRevision=(room.controlRevision??0)+1;room.command=body.seek===true?'seek':command;}
        Object.assign(room, {position, paused: body.paused, rate, buffering: authoritative?false:body.buffering===true, revision: room.revision + 1, updatedAt: now(), controlledBy:user.id});
        if(control){readiness.control(room);if(authoritative)commands.accept(room,user,body,now());} break;
      }
      default: fail(400, 'Неизвестное действие.');
    }
    await save(); return snapshot(user);
  }
  const server = http.createServer(async (request,response) => {
    response.setHeader('Content-Type','application/json; charset=utf-8'); response.setHeader('Cache-Control','no-store');
    try {
      const address = request.socket.remoteAddress, time = now();
      if (rates.size > 20000) for (const [key, value] of rates) if (time - value.time > 60000) rates.delete(key);
      const rate = rates.get(address); 
      if (!rate || time - rate.time > 60000) rates.set(address,{time,count:1,registrations:request.url === '/v1/register' ? 1 : 0});
      else { rate.count++; if (request.url === '/v1/register') rate.registrations++; if (rate.count > 6000 || rate.registrations > 5) fail(429,'Слишком много запросов.'); }
      const avatar=/^\/avatars\/([a-f0-9]{16})\/([a-f0-9]{64})\.png$/.exec(request.url);
      if(avatar&&['GET','HEAD'].includes(request.method)){const value=state.users[avatar[1]]?.avatar;if(!value||value.digest!==avatar[2])fail(404,'Аватар не найден.');const data=Buffer.from(value.data,'base64');response.writeHead(200,{'Content-Type':'image/png','Content-Length':data.length,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});response.end(request.method==='HEAD'?undefined:data);return;}
      if (await web(request,response)) return;
      let size=0; const chunks=[];
      for await (const chunk of request) { size+=chunk.length; if(size>73728) fail(413,'Слишком большой запрос.'); chunks.push(chunk); }
      let body={};try { if(size) body=JSON.parse(Buffer.concat(chunks)); } catch { fail(400,'Некорректный JSON.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400,'Некорректный запрос.');
      const result = queue.then(()=>handle(request,body)); queue=result.catch(()=>{});
      response.end(JSON.stringify(await result));
    } catch(error) { response.statusCode=error.status??500;response.end(JSON.stringify({error:error.status?error.message:'Ошибка сервера.'})); }
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server=await createService({path:process.env.NIGHT_TOGETHER_DATA??'./data/together.json'});
  server.listen(Number(process.env.PORT??8787),process.env.HOST??'127.0.0.1',()=>console.log('Night Together ready'));
}
