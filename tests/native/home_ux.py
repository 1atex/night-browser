import argparse,base64,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from marionette_driver.marionette import Marionette
from smoke import wait_for

class Site(BaseHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        body=b'<!doctype html><title>Project reference</title><link rel="icon" href="data:,"><input id="draft"><p>Test page</p>'
        self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

def run(binary,app_ini,output):
    output.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Site);threading.Thread(target=server.serve_forever,daemon=True).start()
    b=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True},app_args=['-app',app_ini],gecko_log=str(output/'home-ux-gecko.log'))
    def chrome(script,*args):
        b.set_context('chrome');return b.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document,s=w.gNightBrowser?.shell;"+script,script_args=list(args))
    def selected_content():
        handle=chrome('const {NavigableManager}=ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");return NavigableManager.getIdForBrowser(w.gBrowser.selectedBrowser);')
        b.set_context('content');b.switch_to_window(handle,focus=False)
    def content(script,*args):
        selected_content();return b.execute_script(script,script_args=list(args))
    def click(id):
        b.set_context('chrome');b.find_element('id',id).click()
    def shot(name):
        b.set_context('chrome');(output/name).write_bytes(base64.b64decode(b.screenshot()))
    try:
        b.start_session();b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome('return !!s;'))
        click('night-new-tab')
        wait_for(lambda:content('return document.activeElement?.id==="query";'))
        b.actions.sequence('key','manual-home').key_down('q').key_up('q').perform()
        assert content('return document.getElementById("query").value==="q";')
        wait_for(lambda:content('return document.getElementById("home-tab-count").textContent.length>0;'))
        content('document.getElementById("home-customize").open=true;')
        b.find_element('css selector','[data-widget="island"]').click()
        wait_for(lambda:content('return document.getElementById("home-island").hidden;'))
        click('night-new-tab')
        wait_for(lambda:content('return document.getElementById("home-island").hidden&&document.activeElement.id==="query";'))
        chrome('Services.prefs.setStringPref("night.home.widgets",JSON.stringify(["clock","shortcuts","tabs","island"]));w.fixture=s.workspaces.newTab(arguments[0]);',f'http://127.0.0.1:{server.server_port}/page')
        wait_for(lambda:chrome('return w.fixture.label==="Project reference"&&!w.fixture.hasAttribute("busy");'))
        chrome('w.folder=s.workspaces.createFolder("Research");s.workspaces.move(w.fixture,s.workspaces.active,w.folder);')
        click('night-workspace-collapse')
        wait_for(lambda:chrome('return s.workspaces.collapsed&&d.getElementById("night-folder-tree").getBoundingClientRect().height===0&&d.getElementById("night-tab-list").getBoundingClientRect().height===0;'))
        assert chrome('const {SessionStore}=ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");const state=JSON.parse(SessionStore.getCustomWindowValue(w,"night-workspaces"));return state.items.find(item=>item.id===state.active).collapsed&&w.gBrowser.selectedTab===w.fixture;')
        click('night-workspace-collapse')
        wait_for(lambda:chrome('return !s.workspaces.collapsed&&d.getElementById("night-folder-tree").getBoundingClientRect().height>0;'))
        chrome('w.ZoomManager.zoom=1.1;d.getElementById("identity-permission-box").setAttribute("hasPermissions","true");')
        assert chrome('return getComputedStyle(d.getElementById("identity-permission-box")).display==="none"&&getComputedStyle(d.getElementById("star-button-box")).display==="none";')
        chrome('d.getElementById("identity-permission-box").setAttribute("hasSharingIcon","true");')
        assert chrome('return getComputedStyle(d.getElementById("identity-permission-box")).display!=="none";')
        chrome('d.getElementById("identity-permission-box").removeAttribute("hasSharingIcon");')
        click('night-page-actions');wait_for(lambda:chrome('return d.getElementById("night-page-menu").state==="open";'))
        shot('night-page-actions.png')
        chrome('d.querySelector("#night-page-menu button").click();')
        wait_for(lambda:chrome('return d.getElementById("permission-popup")?.state==="open";'))
        chrome('w.gPermissionPanel.hidePopup();Services.prefs.setBoolPref("night.ui.address-details",true);')
        assert chrome('return d.documentElement.hasAttribute("night-address-detailed")&&getComputedStyle(d.getElementById("identity-permission-box")).display!=="none";')
        chrome('Services.prefs.setBoolPref("night.ui.address-details",false);')
        click('night-new-tab');wait_for(lambda:content('return document.activeElement?.id==="query"&&document.querySelector("#home-tab-items button");'))
        shot('night-home-widgets.png')
        content('document.querySelector("#home-tab-items button").click();')
        wait_for(lambda:chrome('return w.gBrowser.selectedTab===w.fixture;'))
        (output/'home-ux-result.json').write_text(json.dumps({'passed':True,'manual_new_tab_focus':True,'widgets_persist':True,'workspace_collapse_persisted':True,'permissions_accessible':True,'sharing_indicator_visible':True,'home_tab_activation':True}))
        print('PASS: manual new-tab focus, configurable home, persistent workspace folding and compact address permissions')
    finally:
        if not (output/'home-ux-result.json').exists():
            try:
                shot('home-ux-failure.png')
                (output/'home-ux-failure.json').write_text(json.dumps({'chrome':chrome('return {url:w.gBrowser.selectedBrowser.currentURI.spec,focus:d.activeElement?.id,bar:w.gURLBar.value};'),'content':content('return {url:location.href,focus:document.activeElement?.id,text:document.body?.innerText};')},ensure_ascii=False),encoding='utf-8')
            except Exception:pass
        b.cleanup();b.instance=None;server.shutdown();server.server_close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
