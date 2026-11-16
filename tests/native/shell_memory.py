import argparse,json,statistics
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for


def run(binary, app_ini, output):
    output.mkdir(parents=True,exist_ok=True)
    browser=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True,'night.island.downloads':False},app_args=['-app',app_ini],gecko_log=str(output/'shell-memory-gecko.log'))
    def chrome(script):
        browser.set_context('chrome')
        return browser.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser');"+script)
    def measure():
        browser.set_context('chrome')
        return browser.execute_async_script('''const done=arguments[arguments.length-1];
          const mm=Cc['@mozilla.org/memory-reporter-manager;1'].getService(Ci.nsIMemoryReporterManager);
          mm.minimizeMemoryUsage(()=>done({heap:mm.heapAllocated,uss:mm.residentUnique,gcHeap:mm.JSMainRuntimeGCHeap,systemRealms:mm.JSMainRuntimeRealmsSystem}));''')
    try:
        browser.start_session();wait_for(lambda:chrome('return !!w.gNightBrowser;'))
        chrome('w.gNightBrowser.shell.workspaces.newTab("about:blank");')
        measure()
        rounds=[]
        for _ in range(5):
            before=measure()
            result=chrome('''
              const {RequestHistory,compareResponses}=ChromeUtils.importESModule('resource:///modules/night/RequestModel.mjs');
              const encoder=new TextDecoder();w.memoryHistory=new RequestHistory();
              for(let i=0;i<50;i++) {
                const bytes=new Uint8Array(65536);for(let n=0;n<bytes.length;n++)bytes[n]=33+(i+n*17)%90;
                w.memoryHistory.add({id:i,url:'https://fixture.invalid/'+i,method:'POST',headers:'X-Fixture: '+i,body:encoder.decode(bytes)});
              }
              const a={status:200,headers:'',body:'x\\n'.repeat(524287)}, b={...a,body:a.body+'y'};
              const start=w.performance.now();for(let i=0;i<10;i++)compareResponses(a,b);
              return {items:w.memoryHistory.items.length,textBytes:w.memoryHistory.items.reduce((n,x)=>n+2*(x.url.length+x.method.length+x.headers.length+x.body.length),0),compareMs:(w.performance.now()-start)/10};
            ''')
            retained=measure()
            chrome('w.memoryHistory.clear();delete w.memoryHistory;')
            released=measure()
            rounds.append({'before':before,'retained':retained,'released':released,**result})
        result={'environment':'Linux headless Gecko; synthetic 50 requests with 64 KiB distinct bodies. Forced collection only in measurement, never product code. Not whole-browser Windows memory.',
                'rounds':rounds,'history_heap_delta_median':statistics.median(r['retained']['heap']-r['before']['heap'] for r in rounds),
                'history_text_bytes':rounds[-1]['textBytes'],'retained_requests':rounds[-1]['items'],'compare_ms_median':statistics.median(r['compareMs'] for r in rounds)}
        (output/'shell-memory.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='rounds'},indent=2))
    finally:browser.cleanup();browser.instance=None

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
