import argparse
import base64
import json
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons
from smoke import EchoHandler, ThreadingHTTPServer, wait_for

WIN = 'Services.wm.getMostRecentWindow("navigator:browser")'


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), EchoHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    browser = Marionette(bin=binary, headless=True, app_args=["-app", app_ini], gecko_log=str(output / "product-gecko.log"), startup_timeout=60)

    def click_toolbar(element_id):
        rect = browser.execute_script(f"return {WIN}.document.getElementById(arguments[0]).getBoundingClientRect().toJSON();", script_args=[element_id])
        browser.actions.sequence('pointer', 'extension-mouse').pointer_move(x=round(rect['x']+rect['width']/2), y=round(rect['y']+rect['height']/2), origin='viewport').pointer_down(button=0).pointer_up(button=0).perform()

    try:
        browser.start_session()
        browser.timeout.script = 30
        browser.set_context("chrome")
        wait_for(lambda: browser.execute_script(f"return !!{WIN}?.gNightBrowser?.shell;"))
        browser.set_window_rect(width=1360, height=900)
        if sys.platform == "win32":
            controls = browser.execute_script(f"return [...{WIN}.document.querySelectorAll('.titlebar-close')].filter(b => b.getBoundingClientRect().width > 0).length;")
            assert controls == 1, controls
            print("PASS: one visible set of Windows caption controls", flush=True)
        browser.set_context("content")
        browser.navigate("about:home")
        wait_for(lambda: browser.execute_script("return /^\\d{2}:\\d{2}$/.test(document.querySelector('#clock')?.textContent);"))
        assert browser.execute_script("return [...document.scripts].map(s => s.src);") == ["resource://newtab/prerendered/night-start.js"]
        browser.set_context("chrome")
        browser.execute_async_script(f"const done = arguments[arguments.length-1]; const w = {WIN}; w.requestAnimationFrame(() => w.requestAnimationFrame(done));")
        (output / "night-home.png").write_bytes(base64.b64decode(browser.screenshot()))
        print("PASS: Night start page without Activity Stream scripts", flush=True)
        browser.set_context("content")
        browser.navigate(url)
        with tempfile.TemporaryDirectory() as directory:
            extension = Path(directory) / "compatibility.xpi"
            with zipfile.ZipFile(extension, "w") as archive:
                archive.writestr("manifest.json", json.dumps({"manifest_version": 2, "name": "Night compatibility test", "version": "1.0", "browser_specific_settings": {"gecko": {"id": "compatibility@night.test", "strict_min_version": "128.0"}}, "content_scripts": [{"matches": ["http://127.0.0.1/*"], "js": ["content.js"]}], "browser_action": {"default_popup": "popup.html", "default_title": "Compatibility action", "default_icon": "icon.png"}, "background": {"scripts": ["background.js"]}}))
                archive.writestr("content.js", "document.documentElement.setAttribute('data-night-extension', 'running');")
                archive.writestr("background.js", "browser.browserAction.setBadgeText({text:'3'});")
                archive.writestr("popup.html", '<!doctype html><meta charset="utf-8"><title>Extension popup</title><body style="width:180px;height:80px">Extension action is available</body>')
                archive.writestr("icon.png", (Path(__file__).resolve().parents[2] / 'src/night/branding/icon32.png').read_bytes())
            addon = Addons(browser).install(str(extension), temp=True)
            browser.refresh()
            wait_for(lambda: browser.execute_script("return document.documentElement.getAttribute('data-night-extension') === 'running';"))
            browser.set_context('chrome')
            browser.execute_script("const {CustomizableUI}=ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');CustomizableUI.addWidgetToArea('compatibility_night_test-browser-action',CustomizableUI.AREA_NAVBAR);")
            wait_for(lambda: browser.execute_script(f"const b={WIN}.document.getElementById('compatibility_night_test-browser-action');return b?.getBoundingClientRect().width>0&&b.querySelector('.toolbarbutton-badge')?.textContent==='3';"))
            click_toolbar('compatibility_night_test-browser-action')
            wait_for(lambda: browser.execute_script(f"return [...{WIN}.document.querySelectorAll('panel')].some(p=>p.state==='open'&&p.querySelector('browser.webextension-popup-browser'));"))
            browser.execute_script(f"for(const p of {WIN}.document.querySelectorAll('panel'))if(p.state==='open'&&p.querySelector('browser.webextension-popup-browser'))p.hidePopup();")
            wait_for(lambda: browser.execute_script(f"return ![...{WIN}.document.querySelectorAll('panel')].some(p=>p.state==='open'&&p.querySelector('browser.webextension-popup-browser'));"))
            browser.execute_script("const {CustomizableUI}=ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');CustomizableUI.addWidgetToArea('compatibility_night_test-browser-action',CustomizableUI.AREA_ADDONS);")
            click_toolbar('unified-extensions-button')
            wait_for(lambda: browser.execute_script(f"return {WIN}.document.getElementById('unified-extensions-panel').state==='open';"))
            browser.execute_script(f"{WIN}.document.getElementById('unified-extensions-panel').hidePopup();")
            Addons(browser).uninstall(addon)
        print("PASS: Firefox WebExtension content script, pinned action, badge, popup and extensions menu", flush=True)
        browser.set_context("chrome")
        state = browser.execute_script(f"""
          const w = {WIN}, b = w.gBrowser, s = w.gNightBrowser.shell;
          w.productOriginal = b.selectedTab;
          w.productPinned = s.workspaces.newTab(arguments[0] + '/pinned');
          b.pinTab(w.productPinned);
          s.workspaces.switchTo('development');
          return {{active: s.workspaces.active, hidden: w.productOriginal.hidden, pinVisible: !w.productPinned.hidden,
            noZen: !w.gZenWorkspaces && !w.document.getElementById('zen-main-app-wrapper'),
            sidebar: w.document.getElementById('night-sidebar').getBoundingClientRect().width}};
        """, script_args=[url])
        assert state == {"active": "development", "hidden": True, "pinVisible": True, "noZen": True, "sidebar": 320}, state
        state = browser.execute_script(f"""
          const w = {WIN}, s = w.gNightBrowser.shell;
          s.workspaces.move(w.productOriginal, 'development');
          w.gBrowser.selectedTab = w.productOriginal;
          w.productSecond = s.workspaces.newTab(arguments[0] + '/second');
          return {{moved: s.workspaces.workspaceOf(w.productOriginal), visible: !w.productOriginal.hidden}};
        """, script_args=[url])
        assert state == {"moved": "development", "visible": True}, state
        wait_for(lambda: browser.execute_script(f"return !{WIN}.productSecond.hasAttribute('busy');"))
        state = browser.execute_script(f"""
          const w = {WIN};
          w.gBrowser.selectedTab = w.productOriginal;
          w.gNightBrowser.shell.split(w.productSecond);
          return {{split: !!w.gBrowser.activeSplitView, tabs: w.gBrowser.activeSplitView?.tabs.length,
            same: w.productOriginal.splitview === w.productSecond.splitview}};
        """)
        assert state == {"split": True, "tabs": 2, "same": True}, state
        browser.execute_async_script(f"const done = arguments[arguments.length-1]; const w = {WIN}; w.requestAnimationFrame(() => w.requestAnimationFrame(done));")
        widths = browser.execute_script(f"return [{WIN}.productOriginal, {WIN}.productSecond].map(t => t.linkedBrowser.getBoundingClientRect().width);")
        assert all(250 < width < 850 for width in widths), widths
        (output / "night-split.png").write_bytes(base64.b64decode(browser.screenshot()))
        protected = browser.execute_async_script(f"""
          const done = arguments[arguments.length-1]; const w = {WIN};
          const {{ NightMemory }} = ChromeUtils.importESModule('resource:///modules/night/NightMemory.sys.mjs');
          let now = 0; const memory = new NightMemory(w, () => false, () => now); now = 900000;
          memory.checkNow().then(() => {{ const result = !w.productOriginal.hasAttribute('pending') && !w.productSecond.hasAttribute('pending'); memory.destroy(); done(result); }}).catch(e => done(String(e)));
        """)
        assert protected is True, protected
        print("PASS: workspace isolation, global pins, tab move, real split view and split memory protection", flush=True)
        state = browser.execute_script(f"""
          const w = {WIN}, s = w.gNightBrowser.shell;
          s.split();
          s.render();
          const tabs = s.workspaces.tabs.filter(t => !t.pinned);
          const rows = [...w.document.getElementById('night-tab-list').children];
          const source = rows[tabs.indexOf(w.productSecond)], target = rows[tabs.indexOf(w.productOriginal)];
          const transfer = new w.DataTransfer();
          source.dispatchEvent(new w.DragEvent('dragstart', {{dataTransfer: transfer, bubbles: true}}));
          target.dispatchEvent(new w.DragEvent('drop', {{dataTransfer: transfer, bubbles: true, cancelable: true}}));
          const moved = w.productSecond.index < w.productOriginal.index;
          w.document.getElementById('night-network-button').click();
          const network = !!w.document.querySelector('#night-tools select');
          w.gNightBrowser.close();
          return {{moved, network}};
        """)
        assert state == {"moved": True, "network": True}, state
        print("PASS: sidebar drag ordering and the network workbench", flush=True)
        state = browser.execute_script(f"""
          const w = {WIN}, s = w.gNightBrowser.shell;
          const id = s.workspaces.create('Исследования');
          s.workspaces.rename('Работа');
          s.workspaces.remove();
          s.workspaces.switchTo('development');
          s.render();
          const field = w.document.getElementById('night-tab-search');
          field.value = 'nothing-matches-this'; field.dispatchEvent(new w.Event('input'));
          const filtered = w.document.getElementById('night-tab-list').children.length === 0;
          const empty = w.document.getElementById('night-tab-empty');
          if (empty.hidden) throw new Error('Missing empty search state');
          empty.querySelector('button').click();
          if (field.value || !empty.hidden) throw new Error('Search reset did not restore the list');
          const count = w.gBrowser.tabs.length;
          w.document.getElementById('night-new-tab').click();
          const opened = w.gBrowser.tabs.length === count + 1;
          const selector = w.document.getElementById('night-workspace-select');
          selector.value = 'personal'; selector.dispatchEvent(new w.Event('change'));
          selector.value = 'development'; selector.dispatchEvent(new w.Event('change'));
          return {{filtered, opened, active: s.workspaces.active, count: s.workspaces.items.length}};
        """)
        assert state == {"filtered": True, "opened": True, "active": "development", "count": 2}, state
        browser.execute_script(f"""
          const w = {WIN};
          w.gNightBrowser.memory.protect(w.productOriginal, true);
          Services.prefs.setIntPref('browser.startup.page', 3);
          Services.prefs.setBoolPref('browser.sessionstore.resume_session_once', true);
        """)
        browser.restart(in_app=True)
        browser.set_context("chrome")
        wait_for(lambda: browser.execute_script(f"return !!{WIN}?.gNightBrowser?.shell;"))
        wait_for(lambda: browser.execute_script(f"return {WIN}.gBrowser.tabs.length >= 4;"))
        state = browser.execute_script(f"""
          const w = {WIN}, s = w.gNightBrowser.shell;
          const original = [...w.gBrowser.tabs].find(t => t.linkedBrowser.currentURI.spec === arguments[0] + '/');
          return {{active: s.workspaces.active, pinned: [...w.gBrowser.tabs].filter(t => t.pinned).length,
            protected: !!original && w.gNightBrowser.memory.isProtected(original),
            workspace: original && s.workspaces.workspaceOf(original)}};
        """, script_args=[url])
        assert state == {"active": "development", "pinned": 1, "protected": True, "workspace": "development"}, state
        print("PASS: workspace controls, tab filtering and new tab; session survives browser restart with pin and memory exception", flush=True)
    finally:
        browser.cleanup()
        browser.instance = None
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--app-ini", required=True)
    parser.add_argument("--output", type=Path, default=Path("test-artifacts"))
    args = parser.parse_args()
    run(args.binary, args.app_ini, args.output)
