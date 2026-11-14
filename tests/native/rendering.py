import argparse
import json
import statistics
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from marionette_driver.marionette import Marionette
from smoke import wait_for

WIN = "Services.wm.getMostRecentWindow('navigator:browser')"
PAGE = b'''<!doctype html><meta charset="utf-8"><title>Rendering workload</title><link rel="icon" href="data:,"><style>body{margin:0;font:14px system-ui;background:#161619;color:#eee}.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}.card{padding:8px;border:1px solid #333;border-radius:6px}.alternate .card:nth-child(3n){padding:12px;color:#abc}.card span{display:block}</style><main class="grid">''' + b''.join(f'<article class="card"><b>Item {i}</b><span>Local HTML and CSS workload</span></article>'.encode() for i in range(1200)) + b'''</main><script>window.measure=()=>{let start=performance.now(), checksum=0;for(let r=0;r<30;r++){let a=Array.from({length:5000},(_,i)=>({key:(i*7919+r)%5000,value:i}));a.sort((a,b)=>a.key-b.key);checksum+=a[300].value}const js=performance.now()-start;start=performance.now();for(let i=0;i<12;i++){document.body.classList.toggle('alternate');checksum+=document.querySelector('main').offsetHeight}return {js,styleLayout:performance.now()-start,checksum}};</script>'''

class Site(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)


def run(binary, app_ini, output, optimized):
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    browser = Marionette(prefs={'night.onboarding.completed': True, 'night.ui.animations': False}, bin=binary, headless=True, app_args=['-app', app_ini], gecko_log=str(output/'rendering-gecko.log'))
    def chrome(script, *args):
        browser.set_context('chrome')
        return browser.execute_script(f'const w={WIN},d=w.document,s=w.gNightBrowser.shell,b=w.gBrowser;'+script, script_args=list(args))
    try:
        browser.start_session()
        browser.timeout.script = 60
        browser.set_context('chrome')
        wait_for(lambda: browser.execute_script(f'return !!{WIN}?.gNightBrowser;'))
        chrome('''
          const {SessionStore}=ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs');
          const folders=Array.from({length:20},(_,i)=>({id:'f'+i,name:'Folder '+i,workspace:'bench',parentId:null,position:i,collapsed:false}));
          const tabs=Array.from({length:100},(_,i)=>({entries:[{url:arguments[0]+'/'+i,title:'Page '+i}],index:1,extData:{'night-workspace':'bench','night-folder':'f'+(i%20),'night-pinned':'true','night-title':'Page '+i}}));
          SessionStore.setWindowState(w,JSON.stringify({windows:[{tabs,selected:1,extData:{'night-workspaces':JSON.stringify({items:[{id:'bench',name:'Benchmark'}],active:'bench',folders})}}]}),true);
        ''', origin)
        wait_for(lambda: chrome("return b.tabs.length===100&&d.querySelectorAll('.night-tab').length===100&&[...b.tabs].filter(t=>t.hasAttribute('pending')).length===99;"))
        chrome("b.tabs[50].setAttribute('busy','true');b.tabs[50].dispatchEvent(new w.CustomEvent('TabAttrModified',{bubbles:true,detail:{changed:['busy']}}));")
        wait_for(lambda: chrome("const row=[...d.querySelectorAll('.night-tab')].find(n=>n.querySelector('.night-tab-title')?.textContent==='Page 50');return row?.hasAttribute('data-loading');"))
        chrome("b.tabs[50].removeAttribute('busy');b.tabs[50].dispatchEvent(new w.CustomEvent('TabAttrModified',{bubbles:true,detail:{changed:['busy']}}));")
        wait_for(lambda: chrome("const row=[...d.querySelectorAll('.night-tab')].find(n=>n.querySelector('.night-tab-title')?.textContent==='Page 50');return row&&!row.hasAttribute('data-loading');"))
        full = chrome('''
          const host=d.getElementById('night-sidebar');
          const observer=new w.MutationObserver(()=>{});observer.observe(host,{subtree:true,childList:true,characterData:true,attributes:true});
          const rounds=[];
          for(let r=0;r<7;r++){const start=w.performance.now();for(let i=0;i<20;i++)s.render();rounds.push((w.performance.now()-start)/20);}
          const mutations=observer.takeRecords().length;observer.disconnect();return {rounds,mutations};
        ''')
        event = browser.execute_async_script(f'''
          const done=arguments[arguments.length-1],w={WIN},d=w.document,b=w.gBrowser,s=w.gNightBrowser.shell;
          let mutations=0; const host=d.getElementById('night-sidebar'),observer=new w.MutationObserver(records=>{{mutations+=records.length;}});
          const target=b.tabs[50],other=d.querySelectorAll('.night-tab-title')[80],text=other.firstChild;
          observer.observe(host,{{subtree:true,childList:true,characterData:true,attributes:true}});
          const start=w.performance.now();
          for(let i=0;i<100;i++)target.dispatchEvent(new w.CustomEvent('TabAttrModified',{{bubbles:true,detail:{{changed:['busy']}}}}));
          w.requestAnimationFrame(()=>w.requestAnimationFrame(()=>{{const records=observer.takeRecords();observer.disconnect();done({{mutations:mutations+records.length,unrelatedTextPreserved:other.firstChild===text,elapsed:w.performance.now()-start}});}}));
        ''')
        if optimized:
            assert full['mutations'] <= 150, full
            assert event['unrelatedTextPreserved'] and event['mutations'] <= 15, event
        browser.set_context('content')
        browser.switch_to_window(browser.window_handles[0])
        content=[]
        for i in range(7):
            browser.navigate(origin+'/content?round='+str(i))
            wait_for(lambda: browser.execute_script('return typeof window.wrappedJSObject.measure==="function";'))
            content.append(browser.execute_script("return {...window.wrappedJSObject.measure(),navigation:performance.getEntriesByType('navigation')[0].toJSON()};"))
        results={'environment': 'headless local synthetic workload; not real-site or GPU results', 'tabs':100,'folders':20,'full_render_ms_median':statistics.median(full['rounds']), 'full_render_rounds':full['rounds'],'full_render_mutations':full['mutations'],'single_tab_event_burst':event,'content':content,'content_js_ms_median':statistics.median(x['js'] for x in content[1:]),'content_style_layout_ms_median':statistics.median(x['styleLayout'] for x in content[1:])}
        (output/'rendering.json').write_text(json.dumps(results,indent=2))
        print(json.dumps({k:v for k,v in results.items() if k!='content'},indent=2))
    finally:
        if browser.session: browser.quit()
        server.shutdown()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--optimized',action='store_true');a=p.parse_args();run(a.binary,a.app_ini,a.output,a.optimized)
