import argparse
import base64
import json
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from marionette_driver.marionette import Marionette
from smoke import wait_for

WIN = "Services.wm.getMostRecentWindow('navigator:browser')"

class Site(BaseHTTPRequestHandler):
    requests = 0
    def log_message(self, *_): pass
    def do_GET(self):
        Site.requests += 1
        body = b'<!doctype html><title>Saved page</title><link rel="icon" href="data:,"><input id="draft">'
        self.send_response(200);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Site)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    browser=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True},app_args=['-app',app_ini],gecko_log=str(output/'start-flow-gecko.log'))
    def chrome(script,*args):
        browser.set_context('chrome')
        return browser.execute_script(f'const w={WIN},d=w.document,b=w.gBrowser,s=w.gNightBrowser.shell;'+script,script_args=list(args))
    def type_text(text, new_tab=False):
        sequence=browser.actions.sequence('key','start-search')
        if new_tab:sequence.key_down('\ue009').key_down('t').key_up('t').key_up('\ue009')
        for char in text:sequence.key_down(char).key_up(char)
        sequence.perform()
    def search_value():
        value=chrome('return w.gURLBar.focused ? w.gURLBar.value : null;')
        if value is not None:return value
        browser.set_context('content')
        return browser.execute_script('return document.activeElement?.id === "query" ? document.activeElement.value : null;')
    try:
        browser.start_session();browser.set_window_rect(width=1280,height=900)
        wait_for(lambda: chrome('return !!w.gNightBrowser;'))
        chrome('w.saved=s.workspaces.newTab(arguments[0]);w.folder=s.workspaces.createFolder("Saved");s.workspaces.move(w.saved,s.workspaces.active,w.folder);',f'http://127.0.0.1:{server.server_port}/saved')
        wait_for(lambda: chrome('return w.saved.label==="Saved page"&&!w.saved.hasAttribute("busy");'))
        chrome('w.ordinary=s.workspaces.newTab("about:blank");for(const t of [...b.tabs])if(t!==w.saved&&t!==w.ordinary)b.removeTab(t,{animate:false});')
        browser.execute_async_script(f'const done=arguments[arguments.length-1],w={WIN};w.gNightBrowser.shell.closeTab(w.saved).then(done);')
        wait_for(lambda: chrome('return w.saved.hasAttribute("pending");'))
        requests=Site.requests
        chrome('b.removeTab(w.ordinary,{animate:false});')
        wait_for(lambda: chrome('return b.selectedBrowser.currentURI.spec==="about:newtab";'))
        assert chrome('return w.saved.hasAttribute("pending")&&b.tabs.includes(w.saved)&&!!s.workspaces.folderOf(w.saved);')
        assert Site.requests==requests
        wait_for(lambda: search_value() is not None)
        type_text('ready')
        wait_for(lambda: search_value() == 'ready')
        chrome('s.workspaces.newTab();')
        wait_for(lambda: search_value() == '')
        type_text('from sidebar')
        wait_for(lambda: search_value() == 'from sidebar')
        type_text('immediate',new_tab=True)
        wait_for(lambda: search_value() == 'immediate')
        assert chrome('return w.saved.hasAttribute("pending");')
        browser.set_context('chrome')
        (output/'night-start-flow.png').write_bytes(base64.b64decode(browser.screenshot()))
        chrome('b.selectedTab=w.saved;')
        wait_for(lambda: chrome('return !w.saved.hasAttribute("pending")&&!w.saved.hasAttribute("busy");'))
        wait_for(lambda: Site.requests==requests+1)
        chrome('b.removeCurrentTab();')
        wait_for(lambda: chrome('return w.saved.hasAttribute("pending");'))
        assert chrome('return b.tabs.includes(w.saved)&&!!s.workspaces.folderOf(w.saved);')
        chrome('s.workspaces.newTab();')
        browser.set_context('content')
        browser.switch_to_window(browser.window_handles[-1])
        wait_for(lambda: browser.execute_script('return !!document.querySelector("#query");'))
        browser.set_context('chrome')
        engine=browser.execute_async_script('''const done=arguments[arguments.length-1];(async()=>{const {SearchService}=ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");await SearchService.init();const engines=await SearchService.getVisibleEngines();const next=engines.find(e=>e.id!==SearchService.defaultEngine.id);if(next)await SearchService.setDefault(next,SearchService.CHANGE_REASON.USER);return SearchService.defaultEngine.name;})().then(done,e=>done({error:String(e)}));''')
        assert isinstance(engine,str),engine
        browser.set_context('content')
        wait_for(lambda: browser.execute_script('return document.querySelector("#query").placeholder.includes(arguments[0]);',script_args=[engine]))
        query=browser.find_element('id','query')
        query.click();query.send_keys(f'http://127.0.0.1:{server.server_port}/from-start', '\ue007')
        wait_for(lambda: chrome('return b.selectedBrowser.currentURI.spec.endsWith("/from-start");'))
        (output/'start-flow-result.json').write_text(json.dumps({'last_open_tab_shows_start':True,'saved_tabs_stay_asleep':True,'start_accepts_typing':True,'new_tab_accepts_typing':True,'ctrl_t_immediate_typing':True,'saved_ctrl_w_unloads':True,'start_accepts_address':True,'search_engine_label_updates':True}))
        print('PASS: last page returns home, saved pages stay asleep, new tabs immediately accept typing and Ctrl+W preserves saved pages',flush=True)
    finally:
        if not (output/'start-flow-result.json').exists():
            try:
                (output/'start-flow-failure.json').write_text(json.dumps(chrome('return {url:b.selectedBrowser.currentURI.spec,bar:w.gURLBar.value,selected:b.selectedTab.label,tabs:[...b.tabs].map(t=>({url:t.linkedBrowser.currentURI.spec,pending:t.hasAttribute("pending")}))};')))
            except Exception:pass
        browser.cleanup();browser.instance=None;server.shutdown();server.server_close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
