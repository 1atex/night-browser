import {setTimeout, clearTimeout} from "resource://gre/modules/Timer.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import {watchURL, mediaSample, roomTarget} from "resource:///modules/night/WatchModel.mjs";

const path = () => PathUtils.join(PathUtils.profileDir, "night-together.json");
export const NightTogether = {
  async credentials() { return IOUtils.readJSON(path()).catch(() => null); },
  async request(endpoint, route, {credentials, body} = {}) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Для сервера нужен HTTPS.");
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error("Укажи адрес сервера без пути и пароля.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url.origin + route, {method: body ? "POST" : "GET", credentials: "omit", redirect: "error", signal: controller.signal,
        headers: {"Content-Type": "application/json", ...(credentials ? {Authorization: `Bearer ${credentials.id}:${credentials.token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Не удалось связаться с сервером."); return result;
    } finally { clearTimeout(timer); }
  },
  async connect(endpoint, window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) throw new Error("Подключись из обычного окна.");
    if (await this.credentials()) throw new Error("Сначала отключи текущий ID.");
    const result = await this.request(endpoint, "/v1/register", {body: {}});
    if (!/^[a-f0-9]{16}$/.test(result.id) || !/^[a-f0-9]{64}$/.test(result.token)) throw new Error("Сервер вернул неверный ID.");
    await IOUtils.writeJSON(path(), {endpoint: new URL(endpoint).origin, id: result.id, token: result.token}, {tmpPath: path() + ".tmp"});
  },
  async state() { const credentials = await this.credentials(); if (!credentials) return null; return this.request(credentials.endpoint, "/v1/state", {credentials}); },
  async action(body) { const credentials = await this.credentials(); if (!credentials) throw new Error("Сначала подключи сервер."); return this.request(credentials.endpoint, "/v1/action", {credentials, body}); },
  async disconnect() { this.stopWatch(); await IOUtils.remove(path(), {ignoreAbsent: true}); },
  watchSession: null,
  watchStatus: "",
  notify(text) { if (this.watchStatus === text) return; this.watchStatus = text; Services.obs.notifyObservers(null, "night-together-watch"); },
  async watch(window) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) throw new Error("Просмотр доступен в обычном окне.");
    const state = await this.state();
    if (!state?.room) throw new Error("Сначала создай комнату или прими приглашение.");
    if (state.protocol < 2) throw new Error("Обнови сервер Together до версии с синхронизацией видео.");
    if (!watchURL(state.room.url)) throw new Error("Некорректная ссылка комнаты.");
    this.stopWatch();
    const tab = window.gBrowser.addTrustedTab(state.room.url, {relatedToCurrent: true});
    window.gBrowser.selectedTab = tab;
    const session = {window, tab, room: state.room.id, source: state.room.url, actor: null, sample: null, dirty: true, sent: 0, timer: null, running: false};
    session.closed = () => this.stopWatch();
    tab.addEventListener("TabClose", session.closed, {once: true});
    window.addEventListener("unload", session.closed, {once: true});
    this.watchSession = session;
    this.notify("Открываем видео комнаты…");
    this.tick();
    return tab;
  },
  media(actor, value) {
    const session = this.watchSession;
    if (!session || session.actor !== actor) return;
    const sample = mediaSample(value);
    if (!sample) return;
    session.sample = sample; session.dirty = true;
    this.tick();
  },
  stopWatch(text = "") {
    const session = this.watchSession;
    if (session) {
      this.watchSession = null; clearTimeout(session.timer);
      session.tab.removeEventListener("TabClose", session.closed);
      session.window.removeEventListener("unload", session.closed);
      try { session.actor?.sendAsyncMessage("NightWatch:Stop"); } catch {}
    }
    this.notify(text);
  },
  async tick() {
    const session = this.watchSession;
    if (!session || session.running) return;
    clearTimeout(session.timer); session.running = true;
    try {
      const begin = Date.now(), state = await this.state(), end = Date.now();
      if (this.watchSession !== session) return;
      if (state?.room?.id !== session.room) { this.stopWatch("Комната закрыта или ты больше не участвуешь."); return; }
      if (state.protocol < 2) throw new Error("Обнови сервер Together.");
      const {room} = state;
      if (!watchURL(room.url)) throw new Error("Сервер вернул некорректную ссылку.");
      if (room.url !== session.source) {
        try { session.actor?.sendAsyncMessage("NightWatch:Stop"); } catch {}
        session.source = room.url; session.actor = null; session.sample = null; session.dirty = true;
        session.tab.linkedBrowser.loadURI(Services.io.newURI(room.url), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
      }
      const browser = session.tab.linkedBrowser;
      if (browser.currentURI.spec === 'about:blank' || session.tab.hasAttribute('busy')) { this.notify("Загружаем видео…"); return; }
      if (watchURL(browser.currentURI.spec) !== watchURL(room.url)) { this.stopWatch("Открыта другая страница. Вернись в комнату, чтобы продолжить."); return; }
      const actor = browser.browsingContext.currentWindowGlobal.getActor('NightWatch');
      if (actor !== session.actor) {
        session.actor = actor; session.sample = mediaSample(await actor.sendQuery('NightWatch:Start')); session.dirty = true;
      }
      const owner = room.owner === state.id;
      if (owner) {
        const sample = mediaSample(await actor.sendQuery('NightWatch:Read'));
        if (this.watchSession !== session) return;
        if (!sample) { this.notify("Ведущий: ждём появления видеоплеера."); return; }
        if (session.dirty || Date.now() - session.sent >= 5000) {
          session.dirty = false;
          await this.action({type: 'room-state', room: room.id, revision: room.revision, ...sample});
          if (this.watchSession !== session) return;
          session.sent = Date.now();
        }
        this.notify(sample.buffering ? "Ведущий: буферизация…" : `Ты ведущий · ${room.members.length} в комнате`);
      } else {
        const target = roomTarget(room, state.serverTime, (end - begin) / 2);
        if (!target) throw new Error("Некорректное состояние воспроизведения.");
        const stale = state.serverTime - room.updatedAt > 15000;
        if (stale) target.paused = true;
        const result = await actor.sendQuery('NightWatch:Apply', target);
        if (this.watchSession !== session) return;
        this.notify(stale ? "Ждём ведущего…" : result?.status === 'autoplay-blocked' ? "Нажми Play в плеере: сайт запретил автозапуск." : result?.status === 'waiting-video' ? "Ждём появления видеоплеера…" : `Смотрим вместе · ${room.members.length} в комнате`);
      }
    } catch (error) {
      if (this.watchError !== String(error)) console.error("Night Together player", error);
      this.watchError = String(error);
      if (this.watchSession === session) {
        try { session.actor?.sendAsyncMessage('NightWatch:Pause'); } catch {}
        this.notify("Связь с комнатой потеряна. Повторяем подключение…");
      }
    } finally {
      session.running = false;
      if (this.watchSession === session) session.timer = setTimeout(() => this.tick(), 1000);
    }
  },
};
