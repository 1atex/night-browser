import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const id = () => randomBytes(8).toString('hex');
const secret = () => randomBytes(32).toString('hex');
const validId = value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const safeURL = value => {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 2048) throw 0; return url.href; }
  catch { fail(400, 'Нужна ссылка HTTP или HTTPS без логина и пароля.'); }
};
export async function createService({path, now = Date.now} = {}) {
  let state = {users: {}, rooms: {}};
  if (path) { try { state = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const rates = new Map();
  let queue = Promise.resolve();
  const save = async () => { if (path) { await mkdir(dirname(path), {recursive: true}); await writeFile(path + '.tmp', JSON.stringify(state), {mode: 0o600}); await rename(path + '.tmp', path); } };
  function snapshot(user) {
    const room = Object.values(state.rooms).find(item => item.members.includes(user.id));
    return {id: user.id, friends: user.friends.map(id => ({id})), incoming: user.incoming, outgoing: user.outgoing,
      invitations: user.invites.filter(id => state.rooms[id]).map(id => ({id, owner: state.rooms[id].owner})), room: room ?? null, serverTime: now()};
  }
  function authenticated(request) {
    const match = /^Bearer ([a-f0-9]{16}):([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
    const user = match && state.users[match[1]];
    if (!user || !timingSafeEqual(Buffer.from(user.token), Buffer.from(match[2]))) fail(401, 'Не удалось подтвердить ID.');
    return user;
  }
  function leave(user) {
    for (const [key, room] of Object.entries(state.rooms)) if (room.members.includes(user.id)) {
      if (room.owner === user.id) delete state.rooms[key]; else room.members = room.members.filter(id => id !== user.id);
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
    if (request.url === '/v1/state' && request.method === 'GET') return snapshot(user);
    if (request.url !== '/v1/action' || request.method !== 'POST') fail(404, 'Не найдено.');
    const peer = state.users[body.id];
    switch (body.type) {
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
      case 'room-create': {
        const url = safeURL(body.url); leave(user);
        const room = {id: id(), owner: user.id, members: [user.id], url, position: 0, paused: true, revision: 0, updatedAt: now()};
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
      case 'room-state': {
        const room = state.rooms[body.room];
        if (room?.owner !== user.id) fail(403, 'Воспроизведением управляет создатель комнаты.');
        if (body.revision !== room.revision) fail(409, 'Состояние комнаты изменилось.');
        if (!Number.isFinite(body.position) || body.position < 0 || body.position > 604800 || typeof body.paused !== 'boolean') fail(400, 'Некорректная позиция.');
        Object.assign(room, {position: body.position, paused: body.paused, revision: room.revision + 1, updatedAt: now()}); break;
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
      else { rate.count++; if (request.url === '/v1/register') rate.registrations++; if (rate.count > 600 || rate.registrations > 5) fail(429,'Слишком много запросов.'); }
      let size=0; const chunks=[];
      for await (const chunk of request) { size+=chunk.length; if(size>8192) fail(413,'Слишком большой запрос.'); chunks.push(chunk); }
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
