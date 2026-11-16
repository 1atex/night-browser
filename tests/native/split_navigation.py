import argparse,base64,json,os,threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from marionette_driver.marionette import Marionette
from smoke import wait_for
class Page(BaseHTTPRequestHandler):
 def log_message(self,*_):pass
 def do_GET(self):
  body=f'<!doctype html><title>Split {self.path}</title><style>body{{background:#18241f;color:white}}</style><h1>Page {self.path}</h1>'.encode();self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
def run(binary,app_ini,output):
 output.mkdir(parents=True,exist_ok=True);server=ThreadingHTTPServer(('127.0.0.1',0),Page);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 b=Marionette(bin=binary,port=2828,headless=os.name!="nt",prefs={'night.onboarding.completed':True},app_args=['-app',app_ini],gecko_log=str(output/'split.log'))
 def chrome(script,*args):b.set_context('chrome');return b.execute_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;'+script,script_args=list(args))
 def info():return chrome('return {selected:w.gBrowser.selectedBrowser.currentURI.spec,active:w.gBrowser.activeSplitView?.tabs.map(t=>t.linkedBrowser.currentURI.spec)??null,panels:[...w.gBrowser.tabpanels.children].map(p=>({id:p.id,hidden:p.hidden,split:p.hasAttribute("splitview"),r:{width:p.getBoundingClientRect().width,height:p.getBoundingClientRect().height},display:w.getComputedStyle(p).display})),tabs:[...w.gBrowser.tabs].map(t=>({url:t.linkedBrowser.currentURI.spec,selected:t.selected,split:!!t.splitview}))};')
 try:
  b.start_session();b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome('return !!w.gNightBrowser;'))
  for name in ['left','right','single']:chrome('w.gBrowser.addTrustedTab(arguments[0]);',base+'/'+name)
  wait_for(lambda:chrome('return [...w.gBrowser.tabs].filter(t=>t.label.startsWith("Split /")).length===3;'))
  chrome('w.gBrowser.selectedTab=[...w.gBrowser.tabs].find(t=>t.label==="Split /left");w.gNightBrowser.shell.split([...w.gBrowser.tabs].find(t=>t.label==="Split /right"));')
  wait_for(lambda:chrome('return w.gBrowser.activeSplitView?.tabs.length===2;'))
  b.set_context('chrome');b.execute_async_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),done=arguments[arguments.length-1],tab=[...w.gBrowser.tabs].find(t=>t.label==="Split /single");w.gBrowser.explicitUnloadTabs([tab]).then(done);')
  wait_for(lambda:chrome('return [...w.gBrowser.tabs].find(t=>t.label==="Split /single").hasAttribute("pending");'))
  chrome('const row=[...d.querySelectorAll(".night-tab")].find(n=>n.querySelector(".night-tab-title").textContent==="Split /single");row.querySelector(".night-tab-main").click();')
  wait_for(lambda:chrome('return w.gBrowser.selectedTab.label==="Split /single";'));print(json.dumps(info()),flush=True)
  wait_for(lambda:chrome('return !w.gBrowser.activeSplitView&&!w.gBrowser.tabpanels.hasAttribute("splitview");'))
  wait_for(lambda:chrome('return !w.gBrowser.selectedTab.hasAttribute("pending")&&!!w.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal;'))
  assert chrome('const r=w.gBrowser.selectedBrowser.getBoundingClientRect();return r.width>800&&r.height>400;')
  b.set_context('chrome');(output/'night-split-navigation.png').write_bytes(base64.b64decode(b.screenshot()))
  chrome('w.gBrowser.selectedTab=[...w.gBrowser.tabs].find(t=>t.label==="Split /left");');wait_for(lambda:chrome('return w.gBrowser.activeSplitView?.tabs.length===2;'))
  assert chrome('return w.gBrowser.tabpanels.splitViewPanels.length===2;')
  (output/'split-navigation-result.json').write_text(json.dumps({'passed':True,'single_page_visible':True,'sleeping_tab_restored':True,'split_pair_preserved':True,'ordinary_tab_clears_split_layout':True}))
 finally:b.cleanup();b.instance=None;server.shutdown();server.server_close()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
