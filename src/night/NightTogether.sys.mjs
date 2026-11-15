import {setTimeout, clearTimeout} from "resource://gre/modules/Timer.sys.mjs";
import {PrivateBrowsingUtils} from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
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
  async disconnect() { await IOUtils.remove(path(), {ignoreAbsent: true}); },
};
