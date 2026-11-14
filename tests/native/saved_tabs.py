import argparse
import base64
import json
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from marionette_driver.marionette import Marionette
from marionette_driver.errors import NoAlertPresentException
from smoke import wait_for

WIN = "Services.wm.getMostRecentWindow('navigator:browser')"


class Site(BaseHTTPRequestHandler):
    requests = []
    def log_message(self, *_args):
        pass
    def do_GET(self):
        Site.requests.append(self.path)
        body = b'<!doctype html><title>Saved project</title><link rel="icon" href="data:,"><button id="edit" onclick="window.onbeforeunload=(e)=>{e.preventDefault();e.returnValue=1;return 1}">Edit unsaved draft</button><input id="draft" value="hello">'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Site)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    browser=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True},app_args=['-app',app_ini,'--remote-debugging-port','0'],gecko_log=str(output/'saved-tabs-gecko.log'))
    def chrome(script,*args):
        browser.set_context('chrome')
        return browser.execute_script(f'const w={WIN},d=w.document,b=w.gBrowser,s=w.gNightBrowser.shell;'+script,script_args=list(args))
    def row():
        return "[...d.querySelectorAll('.night-tab')].find(r=>r.querySelector('.night-tab-title')?.textContent==='Saved project')"
    try:
        browser.start_session({"webSocketUrl":True,"unhandledPromptBehavior":{"default":"ignore","beforeUnload":"ignore"}})
        browser.set_window_rect(width=1280,height=900)
        wait_for(lambda: chrome('return !!w.gNightBrowser;'))
        chrome('w.saved=s.workspaces.newTab(arguments[0]);w.folder=s.workspaces.createFolder("Проект");s.workspaces.move(w.saved,s.workspaces.active,w.folder);',origin+'/saved')
        wait_for(lambda: chrome('return w.saved.label==="Saved project"&&!w.saved.hasAttribute("busy");'))
        chrome('s.render();')
        browser.set_context('content')
        for handle in browser.window_handles:
            browser.switch_to_window(handle)
            if browser.get_url() == origin+'/saved':
                break
        browser.find_element('id','edit').click()
        chrome(row()+'.querySelector(".night-tab-close").click();')
        def has_prompt():
            try:
                return bool(browser.switch_to_alert().text)
            except NoAlertPresentException:
                return False
        wait_for(has_prompt)
        browser.switch_to_alert().dismiss()
        assert chrome('return !w.saved.closing&&!w.saved.hasAttribute("pending")&&b.selectedTab===w.saved;')
        browser.set_context('content')
        browser.execute_script('window.wrappedJSObject.onbeforeunload=null;document.querySelector("#draft").value="keep my draft";document.querySelector("#draft").dispatchEvent(new Event("input",{bubbles:true}));')
        chrome(row()+'.querySelector(".night-tab-close").click();')
        wait_for(lambda: chrome('return w.saved.hasAttribute("pending");'))
        assert chrome('return b.tabs.includes(w.saved)&&s.workspaces.folderOf(w.saved)===w.folder&&b.selectedTab!==w.saved;')
        assert chrome('return '+row()+'.textContent.includes("Спит");')
        wait_for(lambda: chrome('return !d.getElementById("night-memory-status").hasAttribute("data-message");'))
        assert Site.requests.count('/saved') == 1,Site.requests
        browser.set_context('content')
        browser.switch_to_window(browser.window_handles[0])
        browser.navigate('about:home')
        wait_for(lambda: browser.execute_script('return !!document.querySelector("#clock")?.textContent;'))
        browser.set_context('chrome')
        (output/'night-sleeping-folder.png').write_bytes(base64.b64decode(browser.screenshot()))
        browser.restart(in_app=True)
        wait_for(lambda: chrome('return !!w.gNightBrowser&&s.workspaces.folders.length===1;'))
        chrome('w.saved=[...b.tabs].find(t=>t.linkedBrowser.currentURI.spec===arguments[0]);',origin+'/saved')
        assert chrome('return !!w.saved&&w.saved.hasAttribute("pending")&&!!s.workspaces.folderOf(w.saved);')
        assert Site.requests.count('/saved') == 1,Site.requests
        chrome(row()+'.querySelector(".night-tab-main").click();')
        wait_for(lambda: chrome('return !w.saved.hasAttribute("pending")&&!w.saved.hasAttribute("busy");'))
        wait_for(lambda: Site.requests.count('/saved') == 2)
        browser.set_context('content')
        for handle in browser.window_handles:
            browser.switch_to_window(handle)
            if browser.get_url() == origin+'/saved':
                break
        wait_for(lambda: browser.execute_script('return document.querySelector("#draft")?.value==="keep my draft";'))
        chrome(row()+'.dispatchEvent(new w.MouseEvent("contextmenu",{bubbles:true}));')
        chrome('[...d.querySelectorAll("#night-context-menu button")].find(n=>n.textContent==="Удалить из папки").click();')
        wait_for(lambda: chrome('return !b.tabs.includes(w.saved);'))
        chrome('w.ordinary=s.workspaces.newTab(arguments[0]);',origin+'/ordinary')
        wait_for(lambda: chrome('return w.ordinary.label==="Saved project";'))
        chrome(row()+'.querySelector(".night-tab-close").click();')
        wait_for(lambda: chrome('return !b.tabs.includes(w.ordinary);'))
        (output/'saved-tabs-result.json').write_text(json.dumps({'unsaved_cancel_preserves_tab':True,'folder_close_unloads':True,'folder_survives_restart':True,'background_stays_asleep':True,'form_restores':True,'explicit_removal':True,'ordinary_tab_closes':True}))
        print('PASS: cancel unsaved prompt, unload folder tab, restore draft after restart, explicit removal and ordinary close',flush=True)
    finally:
        browser.cleanup()
        browser.instance=None
        server.shutdown()
        server.server_close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--binary',required=True)
    parser.add_argument('--app-ini',required=True)
    parser.add_argument('--output',type=Path,default=Path('test-artifacts'))
    args=parser.parse_args()
    run(args.binary,args.app_ini,args.output)
