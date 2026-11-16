import argparse
import base64
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from marionette_driver.marionette import Marionette
from smoke import wait_for

class Site(BaseHTTPRequestHandler):
    queries=[]
    def log_message(self,*_):pass
    def do_GET(self):
        path=urlparse(self.path)
        origin=f'http://127.0.0.1:{self.server.server_port}'
        if path.path=='/engine.xml':
            kind='application/opensearchdescription+xml'
            body=f'''<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Local search</ShortName><Description>Test search</Description><InputEncoding>UTF-8</InputEncoding><Url type="text/html" template="{origin}/search?q={{searchTerms}}"/><Url type="application/x-suggestions+json" template="{origin}/suggest?q={{searchTerms}}"/></OpenSearchDescription>'''.encode()
        elif path.path=='/suggest':
            query=parse_qs(path.query).get('q',[''])[0];Site.queries.append(query)
            if query=='slow':time.sleep(.8)
            kind='application/x-suggestions+json';body=json.dumps([query,[query+' example',query+' guide']]).encode()
        else:kind='text/html';body=b'<!doctype html><title>Official research</title><p>Source page</p>'
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers()
        try:self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):pass

def run(binary,app_ini,output):
    output.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Site);threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    b=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True,'browser.search.suggest.enabled':True,'browser.urlbar.suggest.searches':True,'night.ui.navigation-layout':'sidebar'},app_args=['-app',app_ini],gecko_log=str(output/'search-gecko.log'))
    def chrome(script,*args):
        b.set_context('chrome');return b.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;"+script,script_args=list(args))
    def content(script,*args):
        b.set_context('content');return b.execute_script(script,script_args=list(args))
    def type_query(value):
        b.set_context('content');q=b.find_element('id','query');q.clear();q.send_keys(value)
    def results():return content('return [...document.querySelectorAll(".search-option-title")].map(x=>x.textContent);')
    def key(code):
        b.actions.sequence('key','search-key').key_down(code).key_up(code).perform()
    try:
        b.start_session();b.set_window_rect(width=1280,height=900)
        chrome('return !!w.gNightBrowser;')
        result=b.execute_async_script('''const done=arguments[arguments.length-1];(async()=>{
          const {SearchService}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');await SearchService.init();
          const engine=await SearchService.addOpenSearchEngine(arguments[0]+'/engine.xml',null,{});await SearchService.setDefault(engine,SearchService.CHANGE_REASON.USER);
          const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
          await PlacesUtils.history.insert({url:arguments[0]+'/official',title:'Official research',visits:[{date:new Date()}]});
          const icon=Services.io.newURI('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>'));
          await PlacesUtils.favicons.setFaviconForPage(Services.io.newURI(arguments[0]+'/official'),Services.io.newURI(arguments[0]+'/icon.svg'),icon);
          return true;})().then(done,e=>done({error:String(e),stack:e.stack}));''',script_args=[origin])
        assert result is True,result
        b.set_context('content');b.navigate('about:newtab')
        wait_for(lambda:content('return document.activeElement?.id==="query";'))
        type_query('official')
        wait_for(lambda:'Official research' in results())
        wait_for(lambda:any(x=='official example' for x in results()))
        assert content('return document.querySelector("#suggestions").hidden===false && document.getElementById("query").getAttribute("aria-expanded")==="true";')
        assert content('return [...document.querySelectorAll(".search-option")].find(r=>r.textContent.includes("Official research"))?.querySelector("img")?.src.startsWith("data:");')
        time.sleep(.2)
        (output/'night-home-suggestions.png').write_bytes(base64.b64decode(b.screenshot()))
        key('\ue015');assert content('return !!document.getElementById("query").getAttribute("aria-activedescendant");')
        key('\ue00c');assert content('return document.getElementById("suggestions").hidden && document.getElementById("query").value==="official";')
        type_query('slow');time.sleep(.2);type_query('fresh')
        wait_for(lambda:'fresh example' in results());time.sleep(1)
        assert 'slow example' not in results()
        content('document.querySelector("main").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));')
        assert content('return document.getElementById("suggestions").hidden;')
        chrome('Services.prefs.setBoolPref("browser.urlbar.suggest.searches",false);')
        before=len(Site.queries);type_query('privatepref');time.sleep(.8)
        assert len(Site.queries)==before
        chrome('Services.prefs.setBoolPref("browser.urlbar.suggest.searches",true);')
        type_query('choose');wait_for(lambda:'choose guide' in results())
        content('const row=[...document.querySelectorAll(".search-option")].find(r=>r.textContent.includes("choose guide"));row.click();')
        wait_for(lambda:chrome('return new URL(w.gBrowser.selectedBrowser.currentURI.spec).searchParams.get("q")==="choose guide";'))
        print('PASS: home uses native history and configured engine suggestions, cached icons, stale-query cancellation, keyboard dismissal and suggestion preference',flush=True)
        chrome('w.gURLBar.focus();')
        b.actions.sequence('key','address-open').key_down('\ue009').key_down('l').key_up('l').key_up('\ue009').perform()
        wait_for(lambda:chrome('return d.getElementById("urlbar").hasAttribute("night-address-expanded");'))
        time.sleep(.25)
        assert chrome('return d.getElementById("urlbar").getBoundingClientRect().width>500;')
        b.find_element('id','urlbar-input').send_keys('official')
        wait_for(lambda:chrome('return w.gURLBar.view.isOpen;'))
        time.sleep(.3)
        (output/'night-address-suggestions.png').write_bytes(base64.b64decode(b.screenshot()))
        key('\ue00c')
        wait_for(lambda:chrome('return !w.gURLBar.view.isOpen && !d.getElementById("urlbar").hasAttribute("night-address-expanded") && !w.gURLBar.focused;'))
        b.actions.sequence('key','address-reopen').key_down('\ue009').key_down('l').key_up('l').key_up('\ue009').perform()
        wait_for(lambda:chrome('return d.getElementById("urlbar").hasAttribute("night-address-expanded");'))
        chrome('w.gBrowser.selectedBrowser.focus();')
        wait_for(lambda:chrome('return !d.getElementById("urlbar").hasAttribute("night-address-expanded");'))
        (output/'search-result.json').write_text(json.dumps({'passed':True,'history':True,'engine_suggestions':True,'pref_respected':True,'stale_results_ignored':True,'escape_collapses':True,'blur_collapses':True}))
        print('PASS: sidebar address opening, Escape and outside focus restore compact layout',flush=True)
    finally:
        if not (output/'search-result.json').exists():
            try:
                b.set_context('chrome');(output/'search-failure.png').write_bytes(base64.b64decode(b.screenshot()))
                (output/'search-failure.json').write_text(json.dumps({'address':chrome('return {url:w.gBrowser.selectedBrowser.currentURI.spec,focused:w.gURLBar.focused,active:d.activeElement?.id,attrs:[...d.getElementById("urlbar").attributes].map(a=>[a.name,a.value])};'),'results':results(),'queries':Site.queries}))
            except Exception:pass
        b.cleanup();b.instance=None;server.shutdown()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
