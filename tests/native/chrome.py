import argparse
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from marionette_driver.keys import Keys
from marionette_driver.marionette import Marionette
from smoke import wait_for


class Site(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/icon'):
            size = 16 if self.path.startswith('/icon-next') else 32
            content = (Path(__file__).resolve().parents[2] / f'src/night/branding/icon{size}.png').read_bytes()
            kind = 'image/png'
        else:
            content = b'<!doctype html><meta charset="utf-8"><title>Night website</title><link rel="icon" href="/icon.png"><style>body{background:#171b23;color:#d4dbe6;font:20px system-ui;margin:50px}h1{font-weight:400}</style><h1>A full window for the website</h1><p>Native address entry, site identity and favicon remain available.</p>'
            kind = 'text/html; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *args):
        pass


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    browser = Marionette(bin=binary, headless=True, app_args=['-app', app_ini], gecko_log=str(output / 'chrome-gecko.log'))

    def chrome(script, *args):
        browser.set_context('chrome')
        return browser.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document,r=d.documentElement,s=w.gNightBrowser?.shell;" + script, script_args=list(args))

    def settle():
        browser.set_context('chrome')
        browser.execute_async_script('const done=arguments[arguments.length-1];setTimeout(done,500);')

    def screenshot(name):
        settle()
        (output / name).write_bytes(base64.b64decode(browser.screenshot()))

    def keys(*values):
        sequence = browser.actions.sequence('key', 'keyboard')
        for value in values:
            sequence.key_down(value)
        for value in reversed(values):
            sequence.key_up(value)
        sequence.perform()

    def move(x, y):
        browser.set_context('chrome')
        browser.actions.sequence('pointer', 'mouse').pointer_move(x=x, y=y, duration=100, origin='viewport').perform()

    def hidden():
        return chrome("return r.hasAttribute('night-toolbar-auto')&&!r.hasAttribute('night-toolbar-visible')&&d.getElementById('navigator-toolbox').getBoundingClientRect().bottom<=0;")

    def visible():
        return chrome("return r.hasAttribute('night-toolbar-visible')&&d.getElementById('navigator-toolbox').getBoundingClientRect().top>=0;")

    try:
        browser.start_session()
        browser.set_window_rect(width=1440, height=960)
        browser.timeout.script = 30
        wait_for(lambda: chrome('return !!s?.toolbar;'))
        assert chrome("return !d.getElementById('night-autohide-button').hasAttribute('checked');")
        browser.set_context('content')
        browser.navigate('about:newtab')
        wait_for(lambda: browser.execute_script("return !!document.getElementById('query');"))
        chrome("Services.prefs.setStringPref('night.ui.palette','midnight');")
        browser.set_context('content')
        wait_for(lambda: browser.execute_script("return document.documentElement.dataset.palette==='midnight';"))
        chrome("Services.prefs.setStringPref('night.ui.palette','night');")
        browser.set_context('content')
        wait_for(lambda: browser.execute_script("return document.documentElement.dataset.palette==='night';"))
        browser.find_element('id', 'query').click()
        assert browser.execute_script("return getComputedStyle(document.getElementById('query')).outlineStyle;") == 'none'
        assert browser.execute_script("return [...document.querySelectorAll('.tile-icon img')].every(i=>i.complete&&i.naturalWidth>0);")
        wait_for(lambda: chrome("const i=d.querySelector('.night-tab[data-selected] .night-tab-icon img');return i?.complete&&i.naturalWidth>0&&i.src==='chrome://browser/content/night/icons/newtab.svg';"))
        screenshot('night-home-focus.png')
        bar = chrome("const b=d.querySelector('#urlbar .urlbar-background');return {radius:w.getComputedStyle(b).borderTopLeftRadius,outline:w.getComputedStyle(b).outlineStyle};")
        assert bar == {'radius':'999px','outline':'none'}, bar
        browser.set_context('content')
        browser.navigate(origin)
        wait_for(lambda: chrome("const t=w.gBrowser.selectedTab,i=d.querySelector('.night-tab[data-selected] .night-tab-icon img');return !t.hasAttribute('busy')&&i?.complete&&i.naturalWidth>0&&i.getAttribute('src')===t.getAttribute('image');"))
        first_icon = chrome("return w.gBrowser.selectedTab.getAttribute('image');")
        browser.set_context('content')
        browser.execute_script("document.querySelector('link[rel=icon]').href='/icon-next.png';")
        wait_for(lambda: chrome("const t=w.gBrowser.selectedTab,i=d.querySelector('.night-tab[data-selected] .night-tab-icon img');return t.getAttribute('image')!==arguments[0]&&i?.complete&&i.naturalWidth>0&&i.getAttribute('src')===t.getAttribute('image');", first_icon))
        chrome("w.gBrowser.pinTab(w.gBrowser.selectedTab);")
        wait_for(lambda: chrome("const i=d.querySelector('#night-pinned-tabs .night-tab-icon img');return i?.naturalWidth>0;"))
        chrome("w.gBrowser.unpinTab(w.gBrowser.selectedTab);")
        wait_for(lambda: chrome("const i=d.getElementById('night-address-icon');return i?.complete&&i.naturalWidth>0&&i.getAttribute('src')===w.gBrowser.selectedTab.getAttribute('image');"))
        keys(Keys.CONTROL, 'l')
        wait_for(lambda: chrome("return d.getElementById('urlbar').hasAttribute('focused');"))
        address_geometry = chrome("const box=d.getElementById('urlbar').getBoundingClientRect();return {width:box.width,right:box.right,viewport:w.innerWidth};")
        assert address_geometry['width'] >= 600 and address_geometry['right'] <= address_geometry['viewport'], address_geometry
        chrome("w.gURLBar.value=arguments[0];w.gURLBar.inputField.dispatchEvent(new w.Event('input',{bubbles:true}));", origin+'/sidebar')
        wait_for(lambda: chrome("return w.gURLBar.view.isOpen;"))
        screenshot('night-sidebar-address.png')
        keys(Keys.RETURN)
        wait_for(lambda: chrome("return w.gBrowser.selectedBrowser.currentURI.spec===arguments[0];", origin+'/sidebar'))
        screenshot('night-site-address.png')
        identity = chrome("return ['trust-icon-container','identity-icon-box'].map(id=>d.getElementById(id)).filter(n=>n?.getBoundingClientRect().width>0)[0]?.getBoundingClientRect().toJSON();")
        assert identity, 'Site identity must remain accessible'
        browser.actions.sequence('pointer', 'mouse').pointer_move(x=round(identity['x']+identity['width']/2), y=round(identity['y']+identity['height']/2), origin='viewport').pointer_down(button=0).pointer_up(button=0).perform()
        wait_for(lambda: chrome("return ['trustpanel-popup','identity-popup'].some(id=>d.getElementById(id)?.state==='open');"))
        screenshot('night-site-security.png')
        keys(Keys.ESCAPE)
        wait_for(lambda: chrome("return !['trustpanel-popup','identity-popup'].some(id=>d.getElementById(id)?.state==='open');"))
        normal_y = chrome("return d.getElementById('tabbrowser-tabbox').getBoundingClientRect().y;")
        assert normal_y < 12, normal_y
        chrome("Services.prefs.setStringPref('night.ui.navigation-layout','top');")
        settle()
        assert chrome("return d.getElementById('tabbrowser-tabbox').getBoundingClientRect().y;") > 35
        chrome("Services.prefs.setStringPref('night.ui.navigation-layout','sidebar');")
        settle()
        chrome("s.toolbar.toggleAutohide();")
        move(650, 400)
        wait_for(hidden)
        auto_y = chrome("return d.getElementById('tabbrowser-tabbox').getBoundingClientRect().y;")
        assert auto_y < 12, auto_y
        screenshot('night-toolbar-hidden.png')
        keys(Keys.CONTROL, 'l')
        wait_for(visible)
        assert chrome("return d.activeElement.id;") == 'urlbar-input'
        assert chrome("return d.getElementById('tabbrowser-tabbox').getBoundingClientRect().y;") == auto_y
        keys(Keys.ESCAPE)
        wait_for(hidden)
        move(700, 1)
        wait_for(visible)
        move(650, 400)
        wait_for(hidden)
        keys(Keys.CONTROL, 'l')
        wait_for(visible)
        chrome("w.gURLBar.value=arguments[0];w.gURLBar.inputField.dispatchEvent(new w.Event('input',{bubbles:true}));", origin+'/next')
        wait_for(lambda: chrome("return w.gURLBar.view.isOpen;"))
        settle()
        suggestion_geometry = chrome("const input=d.querySelector('#urlbar .urlbar-input-container').getBoundingClientRect(),background=d.querySelector('#urlbar .urlbar-background').getBoundingClientRect(),view=d.querySelector('#urlbar .urlbarView').getBoundingClientRect();return {gap:view.top-input.bottom,backgroundExtra:background.bottom-input.bottom};")
        assert suggestion_geometry['gap'] >= 6 and suggestion_geometry['backgroundExtra'] <= 1, suggestion_geometry
        keys(Keys.RETURN)
        wait_for(lambda: chrome("return w.gBrowser.selectedBrowser.currentURI.spec===arguments[0];", origin+'/next'))
        move(650, 400)
        wait_for(hidden)
        chrome("d.getElementById('night-menu-button').doCommand();")
        wait_for(lambda: chrome("return d.getElementById('night-main-menu').state==='open';"))
        settle()
        assert visible()
        assert chrome("return d.getElementById('night-main-menu').getBoundingClientRect().top>=0;")
        assert chrome("return d.activeElement.getAttribute('aria-label');") == 'Новое окно'
        keys(Keys.ARROW_DOWN)
        assert chrome("return d.activeElement.getAttribute('aria-label');") == 'Приватное'
        chrome("d.querySelector('#night-main-menu button[aria-label=\"Увеличить масштаб\"]').click();")
        wait_for(lambda: chrome("return w.ZoomManager.zoom>1&&d.getElementById('night-menu-zoom-reset').textContent!=='100%';"))
        chrome("d.getElementById('night-menu-zoom-reset').click();")
        wait_for(lambda: chrome("return w.ZoomManager.zoom===1&&d.getElementById('night-menu-zoom-reset').textContent==='100%';"))
        keys(Keys.ESCAPE)
        wait_for(lambda: chrome("return d.getElementById('night-main-menu').state==='closed';"))
        active_after_menu = chrome("return d.activeElement.id;")
        assert active_after_menu == 'night-menu-button', active_after_menu
        chrome("d.getElementById('night-menu-button').doCommand();")
        wait_for(lambda: chrome("return d.getElementById('night-main-menu').state==='open';"))
        chrome("d.querySelector('#night-main-menu button[aria-label=\"Найти на странице\"]').click();")
        wait_for(lambda: chrome("return w.gBrowser.getCachedFindBar()?.hidden===false;"))
        chrome("w.gBrowser.getCachedFindBar().close();w.gBrowser.selectedBrowser.focus();")
        wait_for(hidden)
        chrome("d.getElementById('night-menu-button').doCommand();")
        wait_for(lambda: chrome("return d.getElementById('night-main-menu').state==='open';"))
        chrome("d.querySelector('#night-main-menu button[aria-label=\"Инструменты разработчика\"]').click();")
        wait_for(lambda: chrome("return !!ChromeUtils.importESModule('chrome://devtools-startup/content/DevToolsShim.sys.mjs').DevToolsShim.getToolboxForTab(w.gBrowser.selectedTab)?.isReady;"))
        browser.execute_async_script("const done=arguments[arguments.length-1],w=Services.wm.getMostRecentWindow('navigator:browser');ChromeUtils.importESModule('chrome://devtools-startup/content/DevToolsShim.sys.mjs').DevToolsShim.getToolboxForTab(w.gBrowser.selectedTab).destroy().then(done);")
        chrome("w.gBrowser.selectedBrowser.focus();")
        wait_for(hidden)
        keys(Keys.ALT, Keys.SHIFT, 'f')
        wait_for(hidden)
        focus = chrome("return {enabled:r.hasAttribute('night-focus-mode'),sidebar:w.getComputedStyle(d.getElementById('night-sidebar')).display,rect:d.getElementById('tabbrowser-tabbox').getBoundingClientRect().toJSON(),width:w.innerWidth,height:w.innerHeight};")
        assert focus['enabled'] and focus['sidebar']=='none', focus
        assert focus['rect']['x']==focus['rect']['y']==0, focus
        assert focus['rect']['width']==focus['width'] and focus['rect']['height']==focus['height'], focus
        screenshot('night-focus-mode.png')
        keys(Keys.F11)
        wait_for(lambda: chrome("return r.hasAttribute('inFullscreen')&&!r.hasAttribute('night-toolbar-auto');"))
        keys(Keys.F11)
        wait_for(hidden)
        chrome("Services.prefs.setBoolPref('night.ui.animations',false);")
        assert chrome("return w.getComputedStyle(d.getElementById('navigator-toolbox')).transitionDuration;") == '0s'
        chrome("Services.prefs.setBoolPref('night.ui.animations',true);Services.prefs.setIntPref('ui.prefersReducedMotion',1);")
        settle()
        assert chrome("return w.getComputedStyle(d.getElementById('navigator-toolbox')).transitionDuration;") == '0s'
        chrome("Services.prefs.clearUserPref('ui.prefersReducedMotion');")
        keys(Keys.CONTROL, 'l')
        wait_for(visible)
        assert chrome("return d.getElementById('tabbrowser-tabbox').getBoundingClientRect().height;") == focus['height']
        screenshot('night-address-overlay.png')
        chrome("d.getElementById('night-focus-exit').doCommand();")
        assert not chrome("return r.hasAttribute('night-focus-mode');")
        chrome("Services.prefs.setBoolPref('night.ui.toolbar-autohide',false);")
        wait_for(lambda: chrome("return !r.hasAttribute('night-toolbar-auto');"))
        assert chrome("return d.getElementById('tabbrowser-tabbox').getBoundingClientRect().y;") == normal_y
        browser.set_context('content')
        browser.navigate('about:preferences#appearance')
        wait_for(lambda: browser.execute_script("return !!document.querySelector('[data-pref=\"night.ui.toolbar-autohide\"]');"))
        browser.execute_script("document.querySelector('[data-pref=\"night.ui.toolbar-autohide\"]').click();")
        assert chrome("return Services.prefs.getBoolPref('night.ui.toolbar-autohide');")
        browser.restart(clean=False)
        wait_for(lambda: chrome("return r.hasAttribute('night-toolbar-auto');"))
        chrome("Services.prefs.setBoolPref('night.ui.toolbar-autohide',false);")
        result = {'home_focus_outline':'none','internal_and_site_favicons':True,'favicon_updates_and_pins':True,'native_address_navigation':True,'sidebar_address_expands':True,'address_favicon_tracks_site':True,'keyboard_and_edge_reveal':True,'popup_keeps_toolbar_visible':True,'menu_keyboard_zoom_find_devtools':True,'focus_mode_fills_window':True,'overlay_preserves_page_size':True,'native_fullscreen_roundtrip':True,'toolbar_reduced_motion':True,'settings_persist_after_restart':True}
        (output / 'chrome-result.json').write_text(json.dumps(result,indent=2))
        print('PASS: actual urlbar styles, home focus, favicons, dynamic icons/pins, native address navigation, edge/keyboard reveal, popup visibility, full-window focus mode and persisted settings',flush=True)
    finally:
        if not (output / 'chrome-result.json').exists() and browser.session:
            try:
                state=chrome("return {root:r.outerHTML.slice(0,2000),active:d.activeElement?.id,bar:d.getElementById('urlbar').outerHTML.slice(0,500),panels:[...d.querySelectorAll('panel,menupopup')].filter(p=>p.state!=='closed').map(p=>[p.id,p.state])};")
                (output / 'chrome-failure-state.json').write_text(json.dumps(state,indent=2))
            except Exception:
                pass
        browser.cleanup()
        browser.instance = None
        server.shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--app-ini', required=True)
    parser.add_argument('--output', type=Path, default=Path('test-artifacts'))
    args = parser.parse_args()
    run(args.binary, args.app_ini, args.output)
