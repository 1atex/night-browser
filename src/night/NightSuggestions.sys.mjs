import {ProvidersManager} from "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs";
import {UrlbarQueryContext} from "chrome://browser/content/urlbar/UrlbarQueryContext.mjs";
import {PlacesUtils} from "resource://gre/modules/PlacesUtils.sys.mjs";

const PROVIDERS = ["Autofill", "HeuristicFallback", "Places", "InputHistory", "SearchSuggestions"].map(name => `UrlbarProvider${name}`);

export class NightSuggestions {
  #context = null;
  #manager = ProvidersManager.getInstanceForSap("urlbar");
  #revision = 0;
  #results = new Map();

  cancel() {
    this.#revision++;
    if (this.#context) this.#manager.cancelQuery(this.#context);
    this.#context = null;
    this.#results.clear();
  }

  get(id) { return this.#results.get(id); }

  async query(text, options, publish) {
    this.cancel();
    const revision = this.#revision;
    const context = this.#context = new UrlbarQueryContext({sapName: "urlbar", searchString: text,
      isPrivate: options.isPrivate, userContextId: options.userContextId, maxResults: 6,
      allowAutofill: true, providers: PROVIDERS, excludeSponsoredResults: true});
    let batch = 0;
    const ids = new Map();
    const receiveResults = async context => {
      const current = ++batch;
      const records = context.results.filter(result => result.type === 2 || [1, 3].includes(result.type) && /^https?:/.test(result.payload.url)).slice(0, 6);
      const items = await Promise.all(records.map(async result => {
        const p = result.payload;
        const search = result.type === 2;
        const value = search ? p.suggestion || p.query || text : p.url;
        const key = `${result.type}:${value}`;
        if (!ids.has(key)) ids.set(key, `${revision}-${ids.size}`);
        const id = ids.get(key);
        let icon = "";
        if (!search && /^https?:/.test(value)) {
          try { icon = (await PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(value), 16))?.dataURI?.spec ?? ""; } catch {}
          if (icon.length > 100000) icon = "";
        }
        return {id, title: (search ? value : p.title || value).slice(0, 200),
          detail: search ? p.engine || "Поиск" : (() => {try { return new URL(value).host; } catch {return value;}})(),
          kind: search ? "search" : result.type === 1 ? "tab" : "page", icon, value, engine: p.engine || ""};
      }));
      if (revision !== this.#revision || current !== batch) return;
      this.#results = new Map(items.map(item => [item.id, item]));
      publish(items.map(({value, engine, ...item}) => item));
    };
    try { await this.#manager.startQuery(context, {receiveResults: context => { receiveResults(context).catch(console.error); }}); }
    catch (error) { if (revision === this.#revision) { console.error(error); publish([]); } }
    finally {
      this.#manager.cancelQuery(context);
      if (this.#context === context) this.#context = null;
      if (!batch && revision === this.#revision) publish([]);
    }
  }
}
