import argparse
import json
import os
import platform
import statistics
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psutil
from marionette_driver.marionette import Marionette
from smoke import wait_for


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        body = b'''<!doctype html><title>Memory fixture</title><link rel="icon" href="data:,"><h1>Night memory fixture</h1><script>window.allocation = new Uint8Array(32 * 1024 * 1024); window.allocation.fill(73); document.title = 'Ready ' + location.pathname;</script>'''
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def sample(pid):
    values = {"working_set_mib": 0, "private_working_set_mib": 0, "private_bytes_mib": 0, "processes": 0}
    root = psutil.Process(pid)
    for process in [root, *root.children(recursive=True)]:
        try:
            info = process.memory_full_info()
            values["working_set_mib"] += info.rss / 1048576
            values["private_working_set_mib"] += info.uss / 1048576
            values["private_bytes_mib"] += getattr(info, "private", info.uss) / 1048576
            values["processes"] += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return values


def samples(pid):
    result = []
    for _ in range(5):
        result.append(sample(pid))
        time.sleep(1)
    return {key: round(statistics.median(item[key] for item in result), 2) for key in result[0]}


def measure(binary, app_ini, url, output, label):
    browser = Marionette(bin=binary, headless=False, app_args=["-app", app_ini] if app_ini else [], gecko_log=str(output / f"memory-{label}-gecko.log"), startup_timeout=60)
    try:
        browser.start_session()
        browser.timeout.script = 30
        browser.set_context("chrome")
        if app_ini:
            wait_for(lambda: browser.execute_script("return !!Services.wm.getMostRecentWindow('navigator:browser')?.gNightBrowser;"))
        browser.execute_script("""
          const w = Services.wm.getMostRecentWindow('navigator:browser');
          w.gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0] + '/0'), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
          for (let i = 1; i < 7; i++) w.gBrowser.addTrustedTab(arguments[0] + '/' + i);
        """, script_args=[url])
        wait_for(lambda: browser.execute_script("""
          return [...Services.wm.getMostRecentWindow('navigator:browser').gBrowser.tabs].filter(t => t.label.startsWith('Ready ')).length === 7;
        """))
        pid = browser.execute_script("return Services.appinfo.processID;")
        browser.minimize_window()
        time.sleep(3)
        before = samples(pid)
        unloaded = 0
        if app_ini:
            unloaded = browser.execute_async_script("""
              const done = arguments[arguments.length-1], w = Services.wm.getMostRecentWindow('navigator:browser');
              const { NightMemory } = ChromeUtils.importESModule('resource:///modules/night/NightMemory.sys.mjs');
              let now = 0; const memory = new NightMemory(w, () => false, () => now);
              w.memoryExcepted = w.gBrowser.tabs[1];
              w.memoryPinned = w.gBrowser.tabs[2];
              memory.protect(w.memoryExcepted, true);
              w.gBrowser.pinTab(w.memoryExcepted);
              w.gBrowser.pinTab(w.memoryPinned);
              now = 15 * 60000;
              memory.checkNow().then(async count => { await memory.checkNow(); await memory.checkNow(); memory.destroy(); done(count); }, error => { memory.destroy(); done({error: String(error)}); });
            """)
            assert unloaded == 5, unloaded
        time.sleep(5)
        after = samples(pid)
        states = browser.execute_script("""
          const w = Services.wm.getMostRecentWindow('navigator:browser'), tabs = [...w.gBrowser.tabs];
          return {tabs: tabs.length, sleeping: tabs.filter(t => t.hasAttribute('pending')).length, selectedLoaded: !tabs.find(t => t.selected).hasAttribute('pending'), exceptedLoaded: !(w.memoryExcepted || tabs[1]).hasAttribute('pending'), pinnedSleeping: w.memoryPinned?.hasAttribute('pending') ?? null};
        """)
        assert states["selectedLoaded"] and states["exceptedLoaded"], states
        if app_ini: assert states["sleeping"] == 5 and states["pinnedSleeping"], states
        return {"before": before, "after": after, "unloaded": unloaded, "state": states}
    finally:
        browser.cleanup()
        browser.instance = None


def run(stock, night, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        result = {"platform": platform.platform(), "headless": os.environ.get("MOZ_HEADLESS") == "1", "method": "Browser minimized before measurement; headless mode is recorded separately. Fresh profiles, 7 same-origin local tabs, each allocates and touches 32 MiB. Median of 5 samples at 1 second intervals; all descendants included. Night idle clock advanced 15 minutes; active tab and one explicit exception protected. No forced GC or working-set trimming. Windows USS is private working set; private bytes is commit. This is not a real-site workload or rendering benchmark."}
        result["firefox"] = measure(stock, None, url, output, "firefox")
        result["night"] = measure(night, app_ini, url, output, "night")
        (output / "memory.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2), flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock", required=True)
    parser.add_argument("--night", required=True)
    parser.add_argument("--app-ini", required=True)
    parser.add_argument("--output", type=Path, default=Path("test-artifacts"))
    args = parser.parse_args()
    run(args.stock, args.night, args.app_ini, args.output)
