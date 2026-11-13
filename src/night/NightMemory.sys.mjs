/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  parseSiteRules,
  matchesSite,
  unloadDecision,
} from "resource:///modules/night/MemoryPolicy.mjs";
import { SessionStore } from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";
import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import { webrtcUI } from "resource:///modules/webrtcUI.sys.mjs";

export class NightMemory {
  #window;
  #timer;
  #lastUsed = new WeakMap();
  #destroyed = false;
  #running = false;
  #isIntercepted;
  #now;

  constructor(window, isIntercepted = () => false, now = () => Date.now()) {
    this.#window = window;
    this.#now = now;
    this.#isIntercepted = isIntercepted;
    for (const tab of this.tabs) this.#lastUsed.set(tab, this.#now());
    for (const event of ["TabSelect", "TabOpen", "TabBrowserInserted"]) {
      window.gBrowser.tabContainer.addEventListener(event, this);
    }
    Services.prefs.addObserver("night.memory.", this);
    this.#schedule();
  }

  get tabs() {
    return this.#window.gBrowser.tabs;
  }

  get settings() {
    let excludedSites;
    try {
      excludedSites = parseSiteRules(
        Services.prefs.getStringPref(
          "night.memory.excluded-sites",
          "youtube.com youtu.be",
        ),
      );
    } catch {
      return { enabled: false, idleMinutes: 10, excludedSites: [] };
    }
    return {
      enabled: Services.prefs.getBoolPref("night.memory.enabled", true),
      idleMinutes: Services.prefs.getIntPref("night.memory.idle-minutes", 10),
      excludedSites,
    };
  }

  setSettings({ enabled, idleMinutes, excludedSites }) {
    if (
      !Number.isInteger(idleMinutes) ||
      idleMinutes < 1 ||
      idleMinutes > 1440
    ) {
      throw new Error("Choose an idle interval between 1 and 1440 minutes.");
    }
    const rules = parseSiteRules(excludedSites);
    Services.prefs.setIntPref("night.memory.idle-minutes", idleMinutes);
    Services.prefs.setStringPref(
      "night.memory.excluded-sites",
      rules.join("\n"),
    );
    Services.prefs.setBoolPref("night.memory.enabled", enabled);
  }

  isProtected(tab) {
    return SessionStore.getCustomTabValue(tab, "night-keep-loaded") === "true";
  }

  shouldKeepLoaded(tab) {
    return (
      (!!tab.splitview && tab.splitview === this.#window.gBrowser.activeSplitView) ||
      this.isProtected(tab) ||
      this.#isIntercepted(tab) ||
      matchesSite(
        tab.linkedBrowser?.currentURI?.spec ?? "",
        this.settings.excludedSites,
      )
    );
  }

  protect(tab, enabled) {
    if (enabled)
      SessionStore.setCustomTabValue(tab, "night-keep-loaded", "true");
    else SessionStore.deleteCustomTabValue(tab, "night-keep-loaded");
  }

  handleEvent(event) {
    this.#lastUsed.set(event.target, this.#now());
    if (event.type === "TabSelect" && event.detail?.previousTab) {
      this.#lastUsed.set(event.detail.previousTab, this.#now());
    }
  }

  observe() {
    this.#schedule();
  }

  #snapshot(tab) {
    const browser = tab.linkedBrowser;
    const context = browser?.browsingContext;
    return {
      url: browser?.currentURI?.spec ?? "",
      selected: tab.selected,
      visibleInSplit: !!tab.splitview && tab.splitview === this.#window.gBrowser.activeSplitView,
      pending: tab.hasAttribute("pending"),
      closing: tab.closing,
      remote: browser?.isRemoteBrowser && browser.isConnected,
      protected: tab.undiscardable || this.isProtected(tab),
      intercepted: this.#isIntercepted(tab),
      media: tab.soundPlaying || context?.mediaController?.isPlaying,
      pictureInPicture: tab.pictureinpicture,
      sharing:
        webrtcUI.browserHasStreams(browser) ||
        context?.currentWindowGlobal?.hasActivePeerConnections(),
      loading: tab.hasAttribute("busy"),
      private: PrivateBrowsingUtils.isWindowPrivate(this.#window),
      lastUsed: this.#lastUsed.get(tab),
    };
  }

  async checkNow() {
    if (this.#destroyed || this.#running) return 0;
    this.#running = true;
    let unloaded = 0;
    try {
      for (const tab of [...this.tabs]) {
        if (this.#destroyed) break;
        try {
          const snapshot = this.#snapshot(tab);
          if (
            snapshot.selected ||
            snapshot.media ||
            snapshot.sharing ||
            snapshot.visibleInSplit
          ) {
            this.#lastUsed.set(tab, this.#now());
          }
          if (unloadDecision(snapshot, this.settings, this.#now()) !== "unload")
            continue;
          await this.#window.gBrowser.prepareDiscardBrowser(tab);
          if (
            this.#destroyed ||
            unloadDecision(this.#snapshot(tab), this.settings, this.#now()) !==
              "unload"
          )
            continue;
          if (this.#window.gBrowser.discardBrowser(tab, false)) unloaded++;
        } catch (error) {
          console.error("Night tab unloading failed", error);
        }
      }
    } finally {
      this.#running = false;
    }
    return unloaded;
  }

  #schedule() {
    this.#window.clearTimeout(this.#timer);
    if (this.#destroyed || !this.settings.enabled) return;
    this.#timer = this.#window.setTimeout(async () => {
      try {
        await this.checkNow();
      } finally {
        this.#schedule();
      }
    }, 30_000);
  }

  destroy() {
    this.#destroyed = true;
    this.#window.clearTimeout(this.#timer);
    Services.prefs.removeObserver("night.memory.", this);
    for (const event of ["TabSelect", "TabOpen", "TabBrowserInserted"]) {
      this.#window.gBrowser.tabContainer.removeEventListener(event, this);
    }
  }
}
