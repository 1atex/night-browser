export function timelinePosition(room, now) {
  const elapsed = room.paused || room.buffering ? 0 : Math.max(0, now - room.updatedAt) / 1000;
  const limit = Number.isFinite(room.duration) && room.duration > 0 ? Math.min(604800, room.duration) : 604800;
  return Math.max(0, Math.min(limit, room.position + elapsed * (room.rate ?? 1)));
}

export class RoomCommands {
  #accepted = new Map();
  check(room, user, command, now) {
    for (const [key, value] of this.#accepted) if (now - value > 60000) this.#accepted.delete(key);
    if (command.commandId === undefined) return false;
    if (typeof command.commandId !== 'string' || !/^[a-f0-9]{32}$/.test(command.commandId)) throw Object.assign(Error('Неверный номер команды.'), {status:400});
    const key = room.id + ':' + user.id + ':' + command.commandId;
    if (this.#accepted.has(key)) return true;
    if (command.sourceRevision !== (room.sourceRevision ?? 0) || command.baseControlRevision !== (room.controlRevision ?? 0))
      throw Object.assign(Error('Уже принята другая команда. Применяем состояние комнаты.'), {status:409});
    return false;
  }
  accept(room, user, command, now) {
    if (command.commandId === undefined) return;
    if (this.#accepted.size >= 4096) this.#accepted.delete(this.#accepted.keys().next().value);
    this.#accepted.set(room.id + ':' + user.id + ':' + command.commandId, now);
    room.lastCommand = {id:command.commandId, by:user.id};
  }
}
