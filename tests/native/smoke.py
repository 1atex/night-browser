import argparse
import base64
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from marionette_driver.marionette import Marionette


class EchoHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'<!doctype html><link rel="icon" href="data:,"><title>Night local test</title><body style="background:#1c1c20;color:#ececf0;font:20px system-ui;padding:48px"><h1>Night Browser</h1><p>Local preview test</p>')

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.server.received.append(body.decode("utf-8"))
        self.server.paths.append(self.path)
        payload = json.dumps({"method": self.command, "body": body.decode("utf-8"), "header": self.headers.get("X-Night")}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_PUT = do_POST


def wait_for(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.05)
    raise AssertionError("Timed out waiting for the browser")


def run(binary, log, app_ini=None, preview=False, screenshot=None):
    server = ThreadingHTTPServer(("127.0.0.1", 0), EchoHandler)
    server.received = []
    server.paths = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    browser = Marionette(prefs={"night.onboarding.completed": True}, bin=binary, headless=True, app_args=["-app", app_ini] if app_ini else [], gecko_log=log, startup_timeout=60)
    try:
        browser.start_session()
        browser.timeout.script = 20
        browser.navigate(url)
        if preview:
            browser.set_context("chrome")
            wait_for(lambda: browser.execute_script("return !!Services.wm.getMostRecentWindow('navigator:browser')?.gNightBrowser;"), timeout=45)
            browser.set_window_rect(width=1280, height=900)
            ui = browser.execute_script("""
              const win = Services.wm.getMostRecentWindow("navigator:browser");
              const button = win.document.getElementById("night-network-button");
              button.click();
              const panel = win.document.getElementById("night-tools");
              return {name: Services.appinfo.name, panel: panel.getBoundingClientRect().width > 250,
                button: button.getBoundingClientRect().width > 0, background: win.getComputedStyle(panel).backgroundColor,
                updatesDisabled: !Services.policies.isAllowed("appUpdate"),
                networkEnabled: Services.prefs.getBoolPref("night.network.enabled", false)};
            """)
            assert ui == {"name": "Night", "panel": True, "button": True, "background": "rgb(27, 27, 31)", "updatesDisabled": True, "networkEnabled": True}, ui
            if screenshot:
                browser.execute_async_script("const done = arguments[arguments.length - 1]; const w = Services.wm.getMostRecentWindow('navigator:browser'); w.requestAnimationFrame(() => w.requestAnimationFrame(done));")
                Path(screenshot).write_bytes(base64.b64decode(browser.screenshot()))
            browser.execute_script("Services.wm.getMostRecentWindow('navigator:browser').gNightBrowser.close();")
            print("PASS: packaged Night startup, tools panel, graphite CSS and update policy", flush=True)
            browser.set_context("content")
        browser.set_context("chrome")
        browser.execute_script("""
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          Services.prefs.setBoolPref("night.network.enabled", true);
          const { NightNetwork } = ChromeUtils.importESModule("resource:///modules/night/NightNetwork.sys.mjs");
          win.nightSmokeNetwork = new NightNetwork(win, () => {});
          win.nightSmokeNetwork.start(win.gBrowser.selectedTab, true);
        """)
        browser.set_context("content")
        browser.execute_script("""
          window.wrappedJSObject.nightSmokeResult = null;
          window.wrappedJSObject.fetch(arguments[0], {method: "POST", body: "original"})
            .then(response => response.json())
            .then(value => window.wrappedJSObject.nightSmokeResult = JSON.stringify(value))
            .catch(error => window.wrappedJSObject.nightSmokeResult = JSON.stringify({error: String(error)}));
        """, script_args=[f"{url}/echo"])
        browser.set_context("chrome")
        pending = wait_for(lambda: browser.execute_script("""
          return Services.wm.getMostRecentWindow("navigator:browser").nightSmokeNetwork.pending.find(item => item.url.endsWith("/echo")) ?? null;
        """))
        assert server.received == [], "Intercepted request reached the server before approval"
        assert pending["bodyEditable"] and pending["body"] == "original", pending
        browser.execute_script("""
          const service = Services.wm.getMostRecentWindow("navigator:browser").nightSmokeNetwork;
          service.forward(arguments[0], {method: "PUT", url: arguments[1], headers: "Content-Type: text/plain; charset=utf-8\\nX-Night: edited", body: "изменено"});
        """, script_args=[pending["id"], pending["url"]])
        browser.set_context("content")
        result = json.loads(wait_for(lambda: browser.execute_script("return window.wrappedJSObject.nightSmokeResult;", new_sandbox=False)))
        assert result == {"method": "PUT", "body": "изменено", "header": "edited"}, result
        print("PASS: real request interception, method/header/body editing and resume", flush=True)
        browser.set_context("chrome")
        replay = browser.execute_async_script("""
          const done = arguments[arguments.length - 1];
          const service = Services.wm.getMostRecentWindow("navigator:browser").nightSmokeNetwork;
          service.replay({method: "POST", url: arguments[0], headers: "Content-Type: text/plain\\nX-Night: replay", body: "повтор"}, arguments[0])
            .then(done, error => done({error: String(error), stack: error.stack}));
        """, script_args=[f"{url}/echo"])
        assert "error" not in replay, replay
        assert replay["status"] == 200, replay
        assert json.loads(replay["body"])["body"] == "повтор", replay
        print("PASS: real replay with UTF-8 request and response bodies", flush=True)
        browser.set_context("content")
        browser.execute_script("""
          window.wrappedJSObject.nightSmokeResult = null;
          window.wrappedJSObject.fetch(arguments[0], {method: "POST", body: "redirect"})
            .then(response => response.json())
            .then(value => window.wrappedJSObject.nightSmokeResult = JSON.stringify(value))
            .catch(error => window.wrappedJSObject.nightSmokeResult = JSON.stringify({error: String(error)}));
        """, script_args=[f"{url}/echo"])
        browser.set_context("chrome")
        pending = wait_for(lambda: browser.execute_script("""
          return Services.wm.getMostRecentWindow("navigator:browser").nightSmokeNetwork.pending[0] ?? null;
        """))
        browser.execute_script("""
          Services.wm.getMostRecentWindow("navigator:browser").nightSmokeNetwork.forward(arguments[0],
            {method: "POST", url: arguments[1], headers: "Content-Type: text/plain", body: "redirected"});
        """, script_args=[pending["id"], f"{url}/edited-path"])
        browser.set_context("content")
        result = json.loads(wait_for(lambda: browser.execute_script("return window.wrappedJSObject.nightSmokeResult;", new_sandbox=False)))
        assert result.get("body") == "redirected" and server.paths[-1] == "/edited-path", (result, server.paths, browser.execute_script("return window.wrappedJSObject.nightSmokeResult;", new_sandbox=False))
        print("PASS: same-origin URL editing without intercepting the redirect twice", flush=True)
        browser.set_context("chrome")
        browser.execute_script("""
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          win.nightSmokeTab = win.gBrowser.addTrustedTab(arguments[0]);
        """, script_args=[f"{url}/background"])
        wait_for(lambda: browser.execute_script("""
          const tab = Services.wm.getMostRecentWindow("navigator:browser").nightSmokeTab;
          return tab.linkedBrowser.currentURI.spec.endsWith("/background") && !tab.hasAttribute("busy");
        """))
        assert browser.execute_script("return Services.wm.getMostRecentWindow('navigator:browser').nightSmokeNetwork.pending.length;") == 0
        print("PASS: an unrelated tab loads while interception is active", flush=True)
        received = list(server.received)
        browser.set_context("content")
        browser.execute_script("""
          window.wrappedJSObject.nightSmokeResult = null;
          window.wrappedJSObject.fetch(arguments[0], {method: "POST", body: "must not arrive"})
            .then(() => window.wrappedJSObject.nightSmokeResult = "sent")
            .catch(() => window.wrappedJSObject.nightSmokeResult = "cancelled");
        """, script_args=[f"{url}/cancel"])
        browser.set_context("chrome")
        wait_for(lambda: browser.execute_script("return Services.wm.getMostRecentWindow('navigator:browser').nightSmokeNetwork.pending.length === 1;"))
        browser.execute_script("Services.wm.getMostRecentWindow('navigator:browser').nightSmokeNetwork.destroy();")
        browser.set_context("content")
        assert wait_for(lambda: browser.execute_script("return window.wrappedJSObject.nightSmokeResult;", new_sandbox=False)) == "cancelled"
        assert server.received == received
        print("PASS: closing capture cancels a paused request before transmission", flush=True)
        browser.set_context("chrome")
        outcome = browser.execute_async_script("""
          const done = arguments[arguments.length - 1];
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          const { NightMemory } = ChromeUtils.importESModule("resource:///modules/night/NightMemory.sys.mjs");
          Services.prefs.setBoolPref("night.memory.enabled", true);
          Services.prefs.setIntPref("night.memory.idle-minutes", 1);
          Services.prefs.setStringPref("night.memory.excluded-sites", "youtube.com");
          let now = 0;
          const memory = new NightMemory(win, () => false, () => now);
          now = 120000;
          memory.protect(win.nightSmokeTab, true);
          memory.checkNow().then(async first => {
            memory.protect(win.nightSmokeTab, false);
            const second = await memory.checkNow();
            const pending = win.nightSmokeTab.hasAttribute("pending");
            memory.destroy();
            done({first, second, pending, active: !win.gBrowser.selectedTab.hasAttribute("pending")});
          }).catch(error => { memory.destroy(); done({error: String(error)}); });
        """)
        assert outcome == {"first": 0, "second": 1, "pending": True, "active": True}, outcome
        print("PASS: native tab exception, safe discard and active-tab preservation", flush=True)
    finally:
        browser.cleanup()
        browser.instance = None
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--log", default="night-smoke.log")
    parser.add_argument("--app-ini")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--screenshot")
    options = parser.parse_args()
    run(options.binary, options.log, options.app_ini, options.preview, options.screenshot)
