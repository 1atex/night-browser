import argparse,base64,json,os,subprocess,tempfile,time
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

def run(binary,app_ini,output,delayed_scripts=False):
 output.mkdir(parents=True,exist_ok=True);drivers=[]
 fixture=[{'tag_name':'v0.15.0-preview.3','assets':[{'name':'night-browser-0.15.0-preview-windows-x64-setup.exe','download_count':42,'browser_download_url':'https://github.com/1atex/night-browser/releases/download/v0.15.0-preview.3/night-browser-0.15.0-preview-windows-x64-setup.exe'}]}]
 module=(Path(__file__).resolve().parents[2]/'services/together/server.mjs').as_uri()
 with tempfile.TemporaryDirectory(prefix='night-broadcast-') as temp:
  script=f'import {{createService}} from {json.dumps(module)};const s=await createService({{path:{json.dumps(str(Path(temp)/"state.json"))},iceServers:[],releases:async()=>{json.dumps(fixture,ensure_ascii=False)}}});s.listen(0,"127.0.0.1",()=>console.log(s.address().port));const other=await createService();other.listen(0,"127.0.0.1",()=>console.log(other.address().port));'
  if delayed_scripts:
   script=script.replace('s.listen(0,', 'const serve=s.listeners("request")[0];s.removeAllListeners("request");s.on("request",(req,res)=>{const path=req.url.split("?")[0];if(path==="/room"||path.startsWith("/join/")){const end=res.end.bind(res);res.end=(body,...args)=>end(body?Buffer.from(body.toString().replace(/<script /g,"<script async ").replace(/ defer/g,"")):body,...args);}if(path==="/room.js"||path==="/site.js")setTimeout(()=>serve(req,res),600);else serve(req,res);});s.listen(0,')
  script=script.replace('s.listen(0,', 'const original=s.listeners("request")[0];s.removeAllListeners("request");s.on("request",(req,res)=>{const path=req.url.split("?")[0];if(path==="/fixture.webm"){import("node:fs/promises").then(fs=>fs.readFile(new URL("../../tests/native/fixtures/watch.webm",'+json.dumps(module)+'))).then(body=>{res.writeHead(200,{"Content-Type":"video/webm"});res.end(body);});return;}if(path==="/fixture-video"){res.writeHead(200,{"Content-Type":"text/html","Content-Security-Policy":"default-src \'self\'; script-src \'self\'; style-src \'self\'; media-src \'self\'"});res.end(\'<!doctype html><title>Shared video fixture</title><video width="640" height="360" controls preload="auto" src="/fixture.webm"></video>\');return;}original(req,res);});s.listen(0,')
  backend=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,text=True);endpoint='http://127.0.0.1:'+backend.stdout.readline().strip();other_endpoint='http://127.0.0.1:'+backend.stdout.readline().strip()
  def chrome(b,script,*args):b.set_context('chrome');return b.execute_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;'+script,script_args=list(args))
  def async_chrome(b,script,*args):
   b.set_context('chrome');v=b.execute_async_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),done=arguments[arguments.length-1];(async()=>{'+script+'})().then(value=>done({value}),e=>done({error:String(e),stack:e.stack}));',script_args=list(args));assert 'error' not in v,v;return v.get('value')
  def content(b,script,*args):
   handle=chrome(b,'const {NavigableManager}=ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");return NavigableManager.getIdForBrowser(w.gBrowser.selectedBrowser);');b.set_context('content');b.switch_to_window(handle,focus=False);return b.execute_script(script,script_args=list(args))
  def navigate(b,path):chrome(b,'w.gBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});',endpoint+path)
  def state(b):return async_chrome(b,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.state();')
  def action(b,body):return async_chrome(b,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.action(arguments[0]);',body)
  def text(b,id):return content(b,'return document.getElementById(arguments[0])?.textContent??"";',id) or ''
  def click(b,id):content(b,'document.getElementById(arguments[0]).click();',id)
  def capture(b,name):
   b.set_context('chrome');(output/name).write_bytes(base64.b64decode(b.screenshot()))
   if os.name=='nt' and name=='night-together-controls.png':
    script=r'''Add-Type -AssemblyName System.Drawing
Add-Type 'using System;using System.Runtime.InteropServices;public class RoomShot{[StructLayout(LayoutKind.Sequential)]public struct R{public int l,t,r,b;}[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);}'
$r=New-Object RoomShot+R;[RoomShot]::GetWindowRect([RoomShot]::GetForegroundWindow(),[ref]$r)|Out-Null
$b=New-Object Drawing.Bitmap(($r.r-$r.l),($r.b-$r.t));$g=[Drawing.Graphics]::FromImage($b);$g.CopyFromScreen($r.l,$r.t,0,0,$b.Size);$b.Save('DEST',[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$b.Dispose()'''
    subprocess.run(['powershell','-NoProfile','-Command',script.replace('DEST',str((output/name).resolve()).replace("'","''"))],check=True,capture_output=True)

  def stats(b):
   old=content(b,'const node=document.getElementById("rtc-report");document.getElementById("rtc-refresh").click();return node.dataset.serial;');wait_for(lambda:content(b,'return document.getElementById("rtc-report").dataset.serial;')!=old);return json.loads(text(b,'rtc-report'))
  try:
   for index in range(2):
    prefs={'marionette.port':2828+index,'night.onboarding.completed':True,'night.together.server':endpoint,'media.navigator.streams.fake':True,'media.navigator.permission.disabled':True,'media.peerconnection.ice.loopback':True,'media.autoplay.default':0,'full-screen-api.allow-trusted-requests-only':False,'full-screen-api.warning.timeout':0}
    b=Marionette(bin=binary,port=2828+index,headless=os.name!='nt',prefs=prefs,app_args=['-app',app_ini],gecko_log=str(output/f'social-{index}.log'));drivers.append(b);b.start_session();b.timeout.script=45;b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome(b,'return !!w.gNightBrowser;'))
   host,guest=drivers
   async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.connect(arguments[0],w);',endpoint)
   action(host,{'type':'profile-update','name':'Noon','color':'jade','icon':'☾'})
   room=action(host,{'type':'room-create','url':endpoint+'/fixture-video'})['room']['id'];link=action(host,{'type':'room-link','room':room})['room']['link'];token=link.split('/')[-1]
   navigate(guest,'/join/'+token)
   wait_for(lambda:content(guest,'return document.getElementById("join-form")&&!document.getElementById("join-form").hidden;'),timeout=30)
   content(guest,'document.getElementById("join-name").value="Друг";document.getElementById("join-form").requestSubmit();')
   wait_for(lambda:len(state(host)['room']['requests'])==1,timeout=20)
   assert state(guest)['room'] is None
   navigate(host,'/room');wait_for(lambda:'общие' in text(host,'room-status'),timeout=30)
   wait_for(lambda:content(host,'return document.querySelectorAll("#requests button").length===2;'))
   content(host,'document.querySelector("#requests button").click();')
   wait_for(lambda:state(guest)['room'] is not None)
   wait_for(lambda:content(guest,'return !document.getElementById("enter-room").hidden;'))
   capture(guest,'night-invite.png')
   navigate(guest,'/room');wait_for(lambda:'общие' in text(guest,'room-status'))
   click(host,'connect');click(guest,'connect')
   wait_for(lambda:'1 соединений' in text(host,'chat-state') and '1 соединений' in text(guest,'chat-state'),timeout=45)
   assert chrome(host,'return w.gNightBrowser.memory.shouldKeepLoaded(w.gBrowser.selectedTab);')
   chrome(host,'w.gBrowser.selectedTab=w.gBrowser.addTrustedTab(arguments[0]+"/room");',endpoint)
   wait_for(lambda:'общие' in text(host,'room-status'));click(host,'connect')
   wait_for(lambda:'другой вкладке' in text(host,'room-status'))
   chrome(host,'w.gBrowser.removeTab(w.gBrowser.selectedTab,{animate:false});')
   async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.openRoom(w);')
   wait_for(lambda:'1 соединений' in text(host,'chat-state'))
   content(guest,'document.getElementById("message").value="Привет из второго браузера";document.getElementById("message-form").requestSubmit();')
   wait_for(lambda:'Привет из второго браузера' in text(host,'messages'))
   content(host,'document.getElementById("message").value="Пауза общая";document.getElementById("message-form").requestSubmit();')
   wait_for(lambda:'Пауза общая' in text(guest,'messages'))
   async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.watch(w);')
   wait_for(lambda:content(host,'return document.querySelector("video")?.readyState>=3;'))
   content(host,'document.querySelector("video").loop=true;document.querySelector("video").play();')
   wait_for(lambda:async_chrome(host,'return !!ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.watchSession?.actor;'))
   async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.startCast(w);')
   assert state(host)['room']['mode']=='cast'
   async_chrome(guest,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.watch(w);')
   wait_for(lambda:content(guest,'return !!document.getElementById("cast-video")?.srcObject;'),timeout=40)
   def cast_stats():
    old=content(guest,'const node=document.getElementById("rtc-report");document.getElementById("rtc-refresh").click();return node.dataset.serial;');wait_for(lambda:content(guest,'return document.getElementById("rtc-report").dataset.serial;')!=old);return json.loads(text(guest,'cast-report'))
   wait_for(lambda:cast_stats().get('videoBytes',0)>1000 and cast_stats().get('audioBytes',0)>100,timeout=35)
   report=cast_stats();assert report['frames']>0,report
   assert chrome(host,'return d.getElementById("night-cast-indicator").matches(":popover-open");')
   async_chrome(guest,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.control({type:"video-toggle"});')
   wait_for(lambda:content(host,'return document.querySelector("video").paused;'),timeout=12)
   async_chrome(guest,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.control({type:"video-seek",position:8});')
   wait_for(lambda:content(host,'return Math.abs(document.querySelector("video").currentTime-8)<.5;'),timeout=12)
   async_chrome(guest,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.control({type:"video-toggle"});')
   wait_for(lambda:content(host,'return !document.querySelector("video").paused;'))
   capture(guest,'night-broadcast-receiver.png')
   async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.stopCast();')
   wait_for(lambda:state(guest)['room']['mode']=='local')
   wait_for(lambda:async_chrome(host,'return !ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.castSession;'))
   assert chrome(host,'return !d.getElementById("night-cast-indicator").matches(":popover-open");')
   host.set_context('content');drm=host.execute_async_script('''const done=arguments[arguments.length-1];navigator.requestMediaKeySystemAccess("org.w3.clearkey",[{initDataTypes:["webm"],videoCapabilities:[{contentType:'video/webm; codecs="vp8"'}]}]).then(a=>a.createMediaKeys()).then(keys=>document.querySelector("video").setMediaKeys(keys)).then(()=>done({available:true}),error=>done({available:false,reason:String(error)}));''')
   if drm['available']:
    rejected=async_chrome(host,'try{await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.startCast(w);return false;}catch(error){return String(error).includes("DRM");}')
    assert rejected and state(host)['room']['mode']=='local'
   result={'passed':True,'actual_video_audio_rtp':report,'viewer_controls_owner_player':True,'explicit_stop':True,'drm_guard':drm,'drm_bypass':False,'local_two_clients_only':True}
   (output/'broadcast-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result),flush=True)
  except Exception:
   for i,b in enumerate(drivers):
    try:capture(b,f'social-failure-{i}.png');(output/f'social-failure-{i}.json').write_text(json.dumps({'text':content(b,'return document.body.innerText;'),'state':state(b),'rtc':stats(b) if content(b,'return !!document.getElementById("rtc-report");') else None},ensure_ascii=False))
    except Exception:pass
   raise
  finally:
   for b in reversed(drivers):
    try:b.cleanup();b.instance=None
    except Exception:pass
   backend.terminate();backend.wait(timeout=10)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--delayed-scripts',action='store_true');a=p.parse_args();run(a.binary,a.app_ini,a.output,a.delayed_scripts)
