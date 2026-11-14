import argparse
import base64
import ctypes
import json
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

WIN = "Services.wm.getMostRecentWindow('navigator:browser')"
PAYLOAD = b'Night download integration\n' * 262144

class Site(BaseHTTPRequestHandler):
    delay = 0.12
    def log_message(self, *_): pass
    def do_GET(self):
        start = int(self.headers.get('Range', 'bytes=0-').split('=')[1].split('-')[0])
        self.send_response(206 if start else 200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(PAYLOAD)-start))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('ETag', '"night-integration"')
        if start: self.send_header('Content-Range', f'bytes {start}-{len(PAYLOAD)-1}/{len(PAYLOAD)}')
        self.end_headers()
        try:
            for offset in range(start, len(PAYLOAD), 65536):
                self.wfile.write(PAYLOAD[offset:offset+65536]); self.wfile.flush(); time.sleep(Site.delay)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError): pass

class Point(ctypes.Structure):
    _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]


def run(binary, app_ini, island, output):
    output.mkdir(parents=True, exist_ok=True)
    user32 = ctypes.windll.user32
    user32.ClientToScreen.argtypes = [ctypes.c_void_p, ctypes.POINTER(Point)]
    user32.SetForegroundWindow.argtypes = [ctypes.c_void_p]
    user32.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
    report = output.resolve()/'island-state.json'
    root = Path(tempfile.mkdtemp(prefix='night-island-integration-'))
    config = root/'NightIsland';config.mkdir()
    (config/'settings.json').write_text(json.dumps({'browser_downloads': True, 'weather': False, 'update_check': False, 'activity_track': False, 'capture_self_hidden': False, 'capture_hidden': False, 'character': 'none', 'game_mode': False}))
    env = os.environ | {'APPDATA': str(root), 'NI_INSTANCE': root.name, 'NI_DEBUG_TAB': 'Downloads', 'NI_BROWSER_TEST_OUTPUT': str(report)}
    server = ThreadingHTTPServer(('127.0.0.1', 0), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    process = None
    browser = Marionette(prefs={'night.onboarding.completed': True, 'night.island.downloads': True}, bin=binary, headless=True, app_args=['-app', app_ini], gecko_log=str(output/'island-gecko.log'))
    def state():
        try: return json.loads(report.read_text())
        except (OSError, ValueError): return {'state': {'items': [], 'connected': False}}
    def chrome(script):
        browser.set_context('chrome')
        return browser.execute_script(f'const w={WIN};const {{NightIsland}}=ChromeUtils.importESModule("resource:///modules/night/NightIsland.sys.mjs");'+script)
    def command(name, action):
        current = state()
        item = next(x for x in current['state']['items'] if x['name'] == name)
        button = next(b for b in current['buttons'] if b['id'] == item['id'] and b['action'] == action)
        left, top, right, bottom = button['rect']
        point = Point(round((left+right)/2),round((top+bottom)/2))
        user32.ClientToScreen(current['hwnd'],ctypes.byref(point))
        user32.SetForegroundWindow(current['hwnd']);user32.SetCursorPos(point.x,point.y)
        time.sleep(0.15);user32.mouse_event(2,0,0,0,0);user32.mouse_event(4,0,0,0,0)
    def find(name, desired):
        return next((i for i in state()['state']['items'] if i['name']==name and i['state']==desired), None)
    def launch(): return subprocess.Popen([island],env=env)
    def close_island():
        hwnd = state().get('hwnd')
        if hwnd:user32.PostMessageW(hwnd,0x10,0,0)
        process.wait(timeout=15)
    def snapshot(filename):
        hwnd = state()['hwnd']
        script = r'''Add-Type -AssemblyName System.Drawing
Add-Type 'using System;using System.Runtime.InteropServices;public class Shot{[StructLayout(LayoutKind.Sequential)]public struct R{public int l,t,r,b;}[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);}'
$r=New-Object Shot+R;[Shot]::GetWindowRect([IntPtr]HWND,[ref]$r)|Out-Null
$b=New-Object Drawing.Bitmap(($r.r-$r.l),($r.b-$r.t));$g=[Drawing.Graphics]::FromImage($b);$g.CopyFromScreen($r.l,$r.t,0,0,$b.Size);$b.Save('DEST',[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$b.Dispose()'''
        script=script.replace('HWND',str(hwnd)).replace('DEST',str((output/filename).resolve()).replace("'","''"))
        subprocess.run(['powershell','-NoProfile','-Command',script],check=True,capture_output=True)
    try:
        process = launch()
        browser.start_session();browser.timeout.script=30
        wait_for(lambda: chrome('return NightIsland.status === "connected";'),timeout=45)
        wait_for(lambda: state()['state']['connected'])
        browser.set_context('content')
        browser.navigate('about:preferences#integrations')
        wait_for(lambda: browser.execute_script("return document.getElementById('island-status')?.textContent === 'Island подключён';"))
        assert browser.execute_script("return document.getElementById('island-retry').hidden && document.getElementById('island-setup').hidden;")
        browser.set_context('chrome')
        browser.set_window_rect(width=1200,height=850)
        (output/'night-island-settings.png').write_bytes(base64.b64decode(browser.screenshot()))
        browser.execute_async_script(f'''
          const done=arguments[arguments.length-1],w={WIN};
          (async()=>{{const {{Downloads}}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');w.integrationDownloads={{}};
          for(const [name,isPrivate] of [['sample.zip',false],['private.zip',true]]){{
            const folder=PathUtils.join(PathUtils.tempDir,'night-'+Date.now());await IOUtils.makeDirectory(folder);
            const download=await Downloads.createDownload({{source:{{url:{json.dumps(origin+'/download')},isPrivate}},target:{{path:PathUtils.join(folder,name),partFilePath:PathUtils.join(folder,name+'.part')}},tryToKeepPartialData:true}});
            w.integrationDownloads[name]=download;await (await Downloads.getList(isPrivate?Downloads.PRIVATE:Downloads.PUBLIC)).add(download);download.start().catch(()=>{{}});
          }}return true;}})().then(done,e=>done({{error:String(e)}}));
        ''')
        wait_for(lambda: find('sample.zip','active'))
        time.sleep(0.7)
        assert all(i['name']!='private.zip' for i in state()['state']['items'])
        snapshot('night-island-active.png')
        chrome('''w.integrationSend=NightIsland.send;NightIsland.send=function(text){
          const frame=JSON.parse(text);if(frame.type==='result')w.setTimeout(()=>w.integrationSend.call(this,text),1600);
          else w.integrationSend.call(this,text);
        };''')
        command('sample.zip','pause')
        wait_for(lambda: bool(state()['state'].get('pending')))
        seen = chrome('return NightIsland.seen.size;')
        command('sample.zip','pause')
        assert chrome('return NightIsland.seen.size;') == seen
        wait_for(lambda: not state()['state'].get('pending'))
        chrome('NightIsland.send=w.integrationSend;delete w.integrationSend;')
        wait_for(lambda: find('sample.zip','paused'))
        assert chrome('return w.integrationDownloads["sample.zip"].canceled && w.integrationDownloads["sample.zip"].hasPartialData;')
        snapshot('night-island-downloads.png')
        command('sample.zip','resume')
        wait_for(lambda: find('sample.zip','active'))
        chrome('Services.prefs.setBoolPref("night.island.downloads",false);')
        wait_for(lambda: not state()['state']['connected'])
        assert chrome('return !NightIsland.worker && !NightIsland.enabled && NightIsland.entries.size===0;')
        wait_for(lambda: chrome('return NightIsland.transports.size===0;'))
        chrome('Services.prefs.setBoolPref("night.island.downloads",true);')
        wait_for(lambda: chrome('return NightIsland.status === "connected";'))
        wait_for(lambda: find('sample.zip','active'))
        command('sample.zip','cancel')
        wait_for(lambda: find('sample.zip','cancelled'))
        assert chrome('return w.integrationDownloads["sample.zip"].canceled && !w.integrationDownloads["sample.zip"].hasPartialData;')
        close_island()
        wait_for(lambda: chrome('return NightIsland.status === "waiting";'))
        browser.set_context('content')
        wait_for(lambda: browser.execute_script("return document.getElementById('island-status').textContent === 'Ожидаем Island';"))
        assert browser.execute_script("return !document.getElementById('island-retry').hidden && !document.getElementById('island-setup').hidden;")
        process=launch()
        browser.find_element('id','island-retry').click()
        wait_for(lambda: chrome('return NightIsland.status === "connected";'),timeout=40)
        Site.delay=0.002
        chrome('w.integrationDownloads["sample.zip"].start().catch(()=>{});')
        wait_for(lambda: find('sample.zip','complete'),timeout=30)
        assert 'reveal' in find('sample.zip','complete')['actions']
        command('sample.zip','reveal')
        time.sleep(0.5)
        assert not state()['state']['error']
        assert chrome('return w.integrationDownloads["sample.zip"].succeeded;')
        (output/'island-result.json').write_text(json.dumps({'real_island':True,'versioned_handshake':True,'download_progress':True,'native_pointer_pause_resume_cancel':True,'private_excluded':True,'disable_disconnects':True,'reconnect_after_restart':True,'complete_reveal':True,'pending_prevents_repeat':True,'connection_settings':True,'manual_reconnect':True}))
        print('PASS: actual Island pipe, native buttons, private exclusion, disconnect/reconnect and download lifecycle')
    finally:
        if not (output/'island-result.json').exists():
            (output/'island-failure-state.json').write_text(json.dumps(state()))
            try:
                snapshot('night-island-failure.png')
                details=chrome('return {status:NightIsland.status,ready:NightIsland.ready,items:[...NightIsland.entries].map(([id,d])=>({id,stopped:d.stopped,canceled:d.canceled,partial:d.hasPartialData,bytes:d.currentBytes,keep:d.tryToKeepPartialData})),seen:[...NightIsland.seen]};')
                (output/'island-failure-browser.json').write_text(json.dumps(details))
            except Exception:pass
        if browser.session:browser.quit()
        browser.cleanup();browser.instance=None
        if process and process.poll() is None:
            try:close_island()
            except Exception:process.terminate();process.wait(timeout=10)
        server.shutdown()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--island',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.island,a.output)
