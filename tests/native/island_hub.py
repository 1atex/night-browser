import argparse
import base64
import ctypes
import json
import os
import sqlite3
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from marionette_driver.marionette import Marionette
from island import Point
from smoke import wait_for

WIN = "[...Services.wm.getEnumerator('navigator:browser')].find(w=>!ChromeUtils.importESModule('resource://gre/modules/PrivateBrowsingUtils.sys.mjs').PrivateBrowsingUtils.isWindowPrivate(w))"
ICON = 'data:image/svg+xml,' + '%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="16"%3E%3Crect width="16" height="16" fill="%23acb9cf"/%3E%3C/svg%3E'

class Site(BaseHTTPRequestHandler):
    visits = []
    posts = []
    def log_message(self, *_): pass
    def do_GET(self):
        Site.visits.append(self.path)
        body = ('<!doctype html><title>Research source</title><p id="selection">A useful research excerpt</p><a href="/saved">Save this link</a>').encode()
        self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        Site.posts.append({'body': body, 'header': self.headers.get('X-Night')})
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')

def run(binary, app_ini, island, output):
    output.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='night-hub-'))
    config = root/'NightIsland'; config.mkdir()
    (config/'settings.json').write_text(json.dumps({'browser_downloads': True, 'weather': False, 'update_check': False, 'activity_track': False, 'capture_self_hidden': False, 'capture_hidden': False, 'character': 'none', 'game_mode': False, 'island_animations': False}))
    report = output.resolve()/'hub-state.json'
    env = os.environ | {'APPDATA':str(root),'NI_INSTANCE':root.name,'NI_DEBUG_TAB':'Browser','NI_BROWSER_TEST_OUTPUT':str(report)}
    u = ctypes.windll.user32
    u.ClientToScreen.argtypes=[ctypes.c_void_p,ctypes.POINTER(Point)]
    u.SetForegroundWindow.argtypes=[ctypes.c_void_p]
    u.PostMessageW.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_ssize_t]
    server=ThreadingHTTPServer(('127.0.0.1',0),Site)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    prefs={'night.onboarding.completed':True,'night.network.enabled':True, **{f'night.island.{key}':True for key in ['tabs','pocket','activity','requests']}}
    b=Marionette(bin=binary,headless=False,prefs=prefs,app_args=['-app',app_ini],gecko_log=str(output/'hub-gecko.log'))
    process=None
    def state():
        try:return json.loads(report.read_text(encoding="utf-8"))
        except (ValueError,OSError):return {'state':{}}
    def chrome(script,args=None):
        b.set_context('chrome')
        return b.execute_script(f'const w={WIN};const {{NightIsland}}=ChromeUtils.importESModule("resource:///modules/night/NightIsland.sys.mjs");'+script,script_args=args or [])
    def click(rect):
        s=state();l,t,r,d=rect;p=Point(round((l+r)/2),round((t+d)/2))
        u.ClientToScreen(s['hwnd'],ctypes.byref(p));u.SetForegroundWindow(s['hwnd']);u.SetCursorPos(p.x,p.y)
        time.sleep(.15);u.mouse_event(2,0,0,0,0);u.mouse_event(4,0,0,0,0)
    def action(kind, ident, number):
        button=wait_for(lambda:next((x for x in state().get('hub_buttons',[]) if x['kind']==kind and x['id']==ident and x['action']==number),None))
        click(button['rect'])
    def panel(name):
        assert chrome('return NightIsland.openPanel(arguments[0]);',[name])
        wait_for(lambda:state().get('tab')==name.capitalize() and state().get('expanded'))
        time.sleep(.55)
    def keys(*codes):
        for c in codes:u.keybd_event(c,0,0,0)
        for c in reversed(codes):u.keybd_event(c,0,2,0)
    def query(text):
        keys(0x11,0x12,0x42)
        wait_for(lambda:state().get('command',{}).get('open'),timeout=30)
        hwnd=state()['hwnd'];u.SetForegroundWindow(hwnd)
        for c in text:u.PostMessageW(hwnd,0x102,ord(c),0)
        wait_for(lambda:not state()['state'].get('searching',True) and text in state().get('command',{}).get('query',''))
    def stop():
        u.PostMessageW(state()['hwnd'],0x10,0,0);process.wait(timeout=15)
        wait_for(lambda:chrome('return !NightIsland.ready;'))
    def shot(name):
        hwnd=state()['hwnd']
        ps=r'''Add-Type -AssemblyName System.Drawing
Add-Type 'using System;using System.Runtime.InteropServices;public class HubShot{[StructLayout(LayoutKind.Sequential)]public struct R{public int l,t,r,b;}[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);}'
$r=New-Object HubShot+R;[HubShot]::GetWindowRect([IntPtr]HWND,[ref]$r)|Out-Null
$b=New-Object Drawing.Bitmap(($r.r-$r.l),($r.b-$r.t));$g=[Drawing.Graphics]::FromImage($b);$g.CopyFromScreen($r.l,$r.t,0,0,$b.Size);$b.Save('DEST',[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$b.Dispose()'''
        subprocess.run(['powershell','-NoProfile','-Command',ps.replace('HWND',str(hwnd)).replace('DEST',str((output/name).resolve()).replace("'","''"))],check=True,capture_output=True)
    try:
        process=subprocess.Popen([str(island)],env=env)
        b.start_session();b.timeout.script=30;b.set_window_rect(x=20,y=300,width=900,height=460);b.navigate(origin+'/source')
        wait_for(lambda:chrome('return NightIsland.ready;'),timeout=45)
        wait_for(lambda:state()['state'].get('features',{}).get('tabs'))
        assert chrome('return NightIsland.entries.size===0;')
        chrome('''const s=w.gNightBrowser.shell.workspaces;w.hubOriginal=w.gBrowser.selectedTab;
          const space=s.create('Research'),parent=s.createFolder('Projects'),child=s.createFolder('Nested',parent);
          const {SessionStore}=ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs');
          w.hubSleep=w.gBrowser.addTab('about:blank',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipLoad:true});
          SessionStore.setTabState(w.hubSleep,JSON.stringify({entries:[{url:arguments[0]+'/sleep',title:'Sleeping research'}],index:1,extData:{'night-workspace':space,'night-folder':child,'night-favicon':arguments[1]}}));
          s.switchTo('personal',w.hubOriginal);''',[origin,ICON])
        wait_for(lambda:chrome('return w.hubSleep.hasAttribute("pending");'))
        query('Sleeping')
        tab=wait_for(lambda:next((x for x in state()['state'].get('tabs',[]) if x['title']=='Sleeping research'),None))
        assert tab['sleeping'] and tab['path']=='Research / Projects / Nested',tab
        assert len(tab['icon'])==1368,tab
        assert '/sleep' not in Site.visits
        shot('night-island-tab-search.png')
        item=next(x for x in state()['command']['items'] if x['title']=='Sleeping research');click(item['rect'])
        wait_for(lambda:chrome('return w.gBrowser.selectedTab===w.hubSleep && !w.hubSleep.hasAttribute("pending");'))
        wait_for(lambda:'/sleep' in Site.visits)
        wait_for(lambda:chrome('return NightIsland.hub.query===null;'))
        print('PASS: native global search, cached favicon, folder path and lazy tab activation',flush=True)
        chrome('w.hubPrivate=w.OpenBrowserWindow({private:true});')
        wait_for(lambda:chrome('return !!w.hubPrivate?.gNightBrowser;'))
        assert chrome('return !NightIsland.hub.windows.has(w.hubPrivate);')
        chrome('w.hubPrivate.close();')
        b.switch_to_window(b.window_handles[-1])
        b.set_context('content')
        b.execute_script("const r=document.createRange();r.selectNodeContents(document.getElementById('selection'));getSelection().removeAllRanges();getSelection().addRange(r);")
        b.actions.sequence('pointer','mouse').click(b.find_element('id','selection'),button=2).perform()
        wait_for(lambda:chrome('return w.document.getElementById("contentAreaContextMenu").state==="open";'))
        chrome('w.document.getElementById("night-island-save").doCommand();w.document.getElementById("contentAreaContextMenu").hidePopup();')
        saved=wait_for(lambda:next((x for x in state().get('pocket',[]) if x['text']=='A useful research excerpt'),None))
        assert saved['source']==origin+'/sleep',saved
        panel('pocket');shot('night-island-pocket.png')
        action('pocket',saved['id'],3)
        wait_for(lambda:not state().get('pocket'))
        click(state()['undo']);wait_for(lambda:len(state().get('pocket',[]))==1)
        action('pocket',saved['id'],2)
        wait_for(lambda:state().get('tab')=='Note')
        stop();process=subprocess.Popen([str(island)],env=env)
        wait_for(lambda:chrome('return NightIsland.ready;'),timeout=45)
        panel('pocket')
        wait_for(lambda:len(state().get('pocket',[]))==1)
        print('PASS: context selection, persistent Pocket, remove/undo and conversion to note; private window excluded',flush=True)
        panel('pocket')
        b.set_context('content')
        start=b.execute_script("const r=document.querySelector('a').getBoundingClientRect();return {x:mozInnerScreenX+r.x+r.width/2,y:mozInnerScreenY+r.y+r.height/2};")
        current=state();p=Point(100,150);u.ClientToScreen(current['hwnd'],ctypes.byref(p))
        u.SetCursorPos(round(start['x']),round(start['y']));time.sleep(.2);u.mouse_event(2,0,0,0,0)
        for i in range(1,31):
            u.SetCursorPos(round(start['x']+(p.x-start['x'])*i/30),round(start['y']+(p.y-start['y'])*i/30));time.sleep(.03)
        time.sleep(.4);u.mouse_event(4,0,0,0,0)
        wait_for(lambda:any(x['url']==origin+'/saved' for x in state().get('pocket',[])),timeout=20)
        print('PASS: native OLE link drag from browser to persistent Pocket',flush=True)
        chrome('w.gBrowser.selectedTab.setAttribute("soundplaying","true");NightIsland.hub.schedule();')
        active=wait_for(lambda:next((x for x in state()['state'].get('activity',[]) if 'audio' in x['activity']),None))
        panel('browser');action('activity',active['id'],1)
        wait_for(lambda:chrome('return w.gBrowser.selectedTab.hasAttribute("muted");'))
        print('PASS: native activity card controls tab audio',flush=True)
        chrome('w.gNightBrowser.toggle();')
        wait_for(lambda:chrome('return !!w.document.querySelector(".night-capture input");'))
        chrome('w.document.querySelector(".night-capture input").checked=true;w.document.querySelector(".night-capture button").click();')
        for decision in [1,0,2]:
            b.set_context('content')
            b.execute_script("window.wrappedJSObject.fetch('/echo',{method:'POST',body:'unchanged',headers:{'X-Night':'original'}}).catch(()=>{});")
            request=wait_for(lambda:next(iter(state()['state'].get('requests',[])),None))
            assert request['method']=='POST' and request['host']==f'127.0.0.1:{server.server_port}'
            before=len(Site.posts)
            panel('browser');shot('night-island-request.png');action('request',request['id'],decision)
            if decision==0:
                wait_for(lambda:chrome('return w.document.activeElement?.closest(".night-editor")!==null;'))
                action('request',request['id'],2)
            wait_for(lambda:not state()['state'].get('requests'))
            if decision==1:
                wait_for(lambda:len(Site.posts)==before+1)
                assert Site.posts[-1]=={'body':'unchanged','header':'original'}
            else:assert len(Site.posts)==before
        print('PASS: native forward preserves original upload; edit focuses editor; reject sends nothing',flush=True)
        chrome('w.gNightBrowser.close();')
        (output/'hub-result.json').write_text(json.dumps({'passed':True,'posts':Site.posts,'pocket':saved,'lazy_search':True,'private_excluded':True,'source':chrome('return ChromeUtils.importESModule("resource:///modules/night/NightBuild.sys.mjs").revision;')},ensure_ascii=False,indent=2))
    finally:
        if process and process.poll() is None:
            try:stop()
            except Exception:process.terminate();process.wait(timeout=10)
        try:b.cleanup();b.instance=None
        except Exception:pass
        server.shutdown()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--island',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();run(a.binary,a.app_ini,a.island,a.output)
