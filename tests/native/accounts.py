import argparse,base64,json,threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse
from marionette_driver.marionette import Marionette
from smoke import wait_for

class Page(BaseHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        body=b'<!doctype html><title>Account isolation fixture</title><p>Private session</p>'
        self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body)

def run(binary,app_ini,output):
    output.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Page);threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    b=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True},app_args=['-app',app_ini],gecko_log=str(output/'accounts-gecko.log'))
    def chrome(script,*args):
        b.set_context('chrome');return b.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;"+script,script_args=list(args))
    def content(script,*args):
        b.set_context('content');return b.execute_script(script,script_args=list(args))
    def selected():
        handle=chrome('const {NavigableManager}=ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");return NavigableManager.getIdForBrowser(w.gBrowser.selectedBrowser);')
        b.set_context('content');b.switch_to_window(handle)
    def private():
        b.set_context('chrome')
        b.actions.sequence('key','private-shortcut').key_down('\ue009').key_down('\ue008').key_down('n').key_up('n').key_up('\ue008').key_up('\ue009').perform()
        wait_for(lambda:chrome('return [...Services.wm.getEnumerator("navigator:browser")].length===2&&!!w.gNightBrowser;'))
        assert chrome('const {PrivateBrowsingUtils:P}=ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");return P.isWindowPrivate(w)&&!w.gBrowser.tabs.some(t=>t.linkedBrowser.currentURI.spec==="about:addons");')
        selected()
    result={}
    try:
        b.start_session();b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome('return !!w.gNightBrowser;'))
        assert not chrome('return Services.prefs.getBoolPref("identity.fxaccounts.enabled");')
        b.set_context('content');b.navigate(origin+'/normal');content("document.cookie='account=normal; path=/';")
        normal=b.current_window_handle
        private()
        b.navigate(origin+'/private')
        assert content('return document.cookie;')==''
        content("document.cookie='account=private; path=/';")
        assert content('return document.cookie;')=='account=private'
        assert chrome('return d.getElementById("night-profile-button").hasAttribute("data-private");')
        assert chrome('const {NightAccounts}=ChromeUtils.importESModule("resource:///modules/night/NightAccounts.sys.mjs");try{NightAccounts.prepare(w);return false;}catch{return !NightAccounts.enabled;}')
        chrome('d.getElementById("night-profile-button").click();')
        wait_for(lambda:chrome('return d.getElementById("night-profiles-panel").state==="open";'))
        b.set_context('chrome');(output/'night-private-profile.png').write_bytes(base64.b64decode(b.screenshot()))
        chrome('const normal=[...Services.wm.getEnumerator("navigator:browser")].find(win=>win!==w);normal.privateClosed=false;const observer=()=>{normal.privateClosed=true;Services.obs.removeObserver(observer,"last-pb-context-exited");};Services.obs.addObserver(observer,"last-pb-context-exited");w.close();');b.set_context('content');b.switch_to_window(normal)
        wait_for(lambda:chrome('return w.privateClosed;'))
        wait_for(lambda:chrome('return [...Services.wm.getEnumerator("navigator:browser")].length===1;'))
        assert content('return document.cookie;')=='account=normal'
        private();b.navigate(origin+'/private-again')
        assert content('return document.cookie;')==''
        chrome('const normal=[...Services.wm.getEnumerator("navigator:browser")].find(win=>win!==w);normal.privateClosed=false;const observer=()=>{normal.privateClosed=true;Services.obs.removeObserver(observer,"last-pb-context-exited");};Services.obs.addObserver(observer,"last-pb-context-exited");w.close();');b.set_context('content');b.switch_to_window(normal)
        wait_for(lambda:chrome('return w.privateClosed;'))
        b.set_context('chrome')
        history=b.execute_async_script('const done=arguments[arguments.length-1];ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs").PlacesUtils.history.fetch(arguments[0]).then(done);',script_args=[origin+'/private'])
        assert history is None,history
        result['private_shortcut_and_isolation']=True
        b.set_context('content');b.navigate('about:preferences#accounts')
        wait_for(lambda:content('return !!document.getElementById("night-sync-connect");'))
        assert content('return document.getElementById("night-sync-state").textContent;')=='Вход не выполнен'
        content("document.querySelector('[data-pref=\"services.sync.engine.passwords\"]').click();")
        assert not chrome('return Services.prefs.getBoolPref("services.sync.engine.passwords");')
        result['sync_disabled_initially']=not chrome('return Services.prefs.getBoolPref("identity.fxaccounts.enabled");')
        wait_for(lambda:content('return document.getAnimations().every(a=>a.playState!=="running");'))
        b.set_context('chrome');(output/'night-accounts.png').write_bytes(base64.b64decode(b.screenshot()))
        content('document.getElementById("night-sync-connect").click();')
        wait_for(lambda:chrome('return w.gBrowser.tabs.some(t=>t.linkedBrowser.currentURI.spec.startsWith("https://accounts.firefox.com/"));'),timeout=60)
        selected()
        result['account_url']=content('return location.origin+location.pathname;')
        try:
            wait_for(lambda:content('return document.readyState==="complete";'),timeout=15)
            result['remote_page_completed']=True
        except AssertionError:result['remote_page_completed']=False
        result['account_page_title']=content('return document.title;')
        result['user_agent']=content('return navigator.userAgent;')
        assert urlparse(result['account_url']).hostname=='accounts.firefox.com'
        assert 'Firefox/' in result['user_agent'] and 'Night/' in result['user_agent']
        assert chrome('return w.gSync._initialized&&Services.prefs.getBoolPref("identity.fxaccounts.enabled");')
        b.set_context('chrome')
        prefs=b.execute_async_script('const done=arguments[arguments.length-1];(async()=>{const {Weave}=ChromeUtils.importESModule("resource://services-sync/main.sys.mjs");await Weave.Service.promiseInitialized;Services.prefs.setStringPref("night.ui.palette","graphite");Services.prefs.setStringPref("night.ui.navigation-layout","top");const values=Weave.Service.engineManager.get("prefs")._store._getAllPrefs();return {palette:values["night.ui.palette"],navigation:values["night.ui.navigation-layout"],island:Object.hasOwn(values,"night.island.downloads"),passwords:Weave.Service.engineManager.get("passwords").enabled};})().then(done,e=>done({error:String(e)}));')
        assert prefs=={'palette':'graphite','navigation':'top','island':False,'passwords':False},prefs
        result['native_sync_preference_record']=prefs
        b.set_context('content');b.navigate('about:preferences?action=choose-what-to-sync#sync')
        wait_for(lambda:content('return location.href==="chrome://browser/content/preferences/advanced.xhtml?action=choose-what-to-sync#sync"&&!!window.SyncHelpers;'))
        result['native_sync_settings_route']=True
        result['sync_connect_uses_native_service']=True
        result['passed']=True
        (output/'accounts-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print('PASS: native private shortcut, cookie/history isolation, explicit Mozilla account connection',flush=True)
    finally:
        if not result.get('passed'):
            try:
                b.set_context('chrome');(output/'accounts-failure.png').write_bytes(base64.b64decode(b.screenshot()))
                (output/'accounts-failure.json').write_text(json.dumps(chrome('return {url:w.gBrowser.selectedBrowser.currentURI.spec,windows:[...Services.wm.getEnumerator("navigator:browser")].length,initialized:w.gSync?._initialized};')))
            except Exception:pass
        b.cleanup();b.instance=None;server.shutdown();server.server_close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
