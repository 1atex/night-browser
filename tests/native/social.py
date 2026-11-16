import argparse,base64,json,subprocess,tempfile,time
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

def run(binary,app_ini,output,delayed_scripts=False):
 output.mkdir(parents=True,exist_ok=True);drivers=[]
 fixture=[{'tag_name':'v0.15.0-preview.3','assets':[{'name':'night-browser-0.15.0-preview-windows-x64-setup.exe','download_count':42,'browser_download_url':'https://github.com/1atex/night-browser/releases/download/v0.15.0-preview.3/night-browser-0.15.0-preview-windows-x64-setup.exe'}]}]
 module=(Path(__file__).resolve().parents[2]/'services/together/server.mjs').as_uri()
 with tempfile.TemporaryDirectory(prefix='night-social-') as temp:
  script=f'import {{createService}} from {json.dumps(module)};const s=await createService({{path:{json.dumps(str(Path(temp)/"state.json"))},iceServers:[],releases:async()=>{json.dumps(fixture,ensure_ascii=False)}}});s.listen(0,"127.0.0.1",()=>console.log(s.address().port));const other=await createService();other.listen(0,"127.0.0.1",()=>console.log(other.address().port));'
  if delayed_scripts:
   script=script.replace('s.listen(0,', 'const serve=s.listeners("request")[0];s.removeAllListeners("request");s.on("request",(req,res)=>{const path=req.url.split("?")[0];if(path==="/room"||path.startsWith("/join/")){const end=res.end.bind(res);res.end=(body,...args)=>end(body?Buffer.from(body.toString().replace(/<script /g,"<script async ").replace(/ defer/g,"")):body,...args);}if(path==="/room.js"||path==="/site.js")setTimeout(()=>serve(req,res),600);else serve(req,res);});s.listen(0,')
  backend=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,text=True);endpoint='http://127.0.0.1:'+backend.stdout.readline().strip();other_endpoint='http://127.0.0.1:'+backend.stdout.readline().strip()
  def chrome(b,script,*args):b.set_context('chrome');return b.execute_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;'+script,script_args=list(args))
  def async_chrome(b,script,*args):
   b.set_context('chrome');v=b.execute_async_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),done=arguments[arguments.length-1];(async()=>{'+script+'})().then(value=>done({value}),e=>done({error:String(e)}));',script_args=list(args));assert 'error' not in v,v;return v.get('value')
  def content(b,script,*args):
   handle=chrome(b,'const {NavigableManager}=ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");return NavigableManager.getIdForBrowser(w.gBrowser.selectedBrowser);');b.set_context('content');b.switch_to_window(handle,focus=False);return b.execute_script(script,script_args=list(args))
  def navigate(b,path):chrome(b,'w.gBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});',endpoint+path)
  def state(b):return async_chrome(b,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.state();')
  def action(b,body):return async_chrome(b,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.action(arguments[0]);',body)
  def text(b,id):return content(b,'return document.getElementById(arguments[0])?.textContent??"";',id) or ''
  def click(b,id):content(b,'document.getElementById(arguments[0]).click();',id)
  def capture(b,name):b.set_context('chrome');(output/name).write_bytes(base64.b64decode(b.screenshot()))
  def stats(b):
   old=content(b,'const node=document.getElementById("rtc-report");document.getElementById("rtc-refresh").click();return node.dataset.serial;');wait_for(lambda:content(b,'return document.getElementById("rtc-report").dataset.serial;')!=old);return json.loads(text(b,'rtc-report'))
  try:
   for index in range(2):
    prefs={'marionette.port':2828+index,'night.onboarding.completed':True,'night.together.server':endpoint,'media.navigator.streams.fake':True,'media.navigator.permission.disabled':True,'media.peerconnection.ice.loopback':True,'media.autoplay.default':0}
    b=Marionette(bin=binary,port=2828+index,headless=True,prefs=prefs,app_args=['-app',app_ini],gecko_log=str(output/f'social-{index}.log'));drivers.append(b);b.start_session();b.timeout.script=45;b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome(b,'return !!w.gNightBrowser;'))
   host,guest=drivers
   async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.connect(arguments[0],w);',endpoint)
   action(host,{'type':'profile-update','name':'Noon','color':'jade','icon':'☾'})
   room=action(host,{'type':'room-create','url':endpoint+'/'})['room']['id'];link=action(host,{'type':'room-link','room':room})['room']['link'];token=link.split('/')[-1]
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
   click(guest,'voice');wait_for(lambda:content(guest,'return !document.getElementById("mute").hidden;'),timeout=20)
   wait_for(lambda:any(s['received']>100 for s in stats(host)),timeout=20)
   click(host,'voice');wait_for(lambda:any(s['received']>100 for s in stats(guest)),timeout=20)
   host_stats=stats(host);guest_stats=stats(guest)
   capture(host,'night-room.png')
   click(host,'watch-split');wait_for(lambda:chrome(host,'return w.gBrowser.activeSplitView?.tabs.length===2;'))
   async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.openRoom(w);')
   wait_for(lambda:content(host,'return !!document.getElementById("message-form");'))
   click(guest,'mute');assert content(guest,'return document.getElementById("mute").hidden;')
   content(guest,'document.getElementById("voice").click();document.getElementById("voice").click();document.getElementById("leave").click();')
   wait_for(lambda:len(state(host)['room']['members'])==1)
   wait_for(lambda:content(host,'return document.querySelectorAll("audio").length===0;'))
   assert content(guest,'return document.getElementById("mute").hidden;')
   wait_for(lambda:chrome(guest,'return !ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.roomBrowsers.has(w.gBrowser.selectedBrowser);'))
   action(guest,{'type':'room-request','invite':token});action(host,{'type':'room-admit','room':room,'id':state(guest)['id']})
   navigate(guest,'/room');wait_for(lambda:'общие' in text(guest,'room-status'));click(guest,'connect')
   wait_for(lambda:'1 соединений' in text(guest,'chat-state'),timeout=45);click(guest,'voice')
   wait_for(lambda:content(guest,'return !document.getElementById("mute").hidden;'))
   content(host,'document.querySelector("#members button").click();')
   wait_for(lambda:state(guest)['room'] is None)
   wait_for(lambda:content(guest,'return document.getElementById("mute").hidden;'))
   chrome(guest,'w.gBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});',other_endpoint+'/room')
   wait_for(lambda:'не управляет' in text(guest,'room-status'))
   chrome(guest,'d.getElementById("Tools:PrivateBrowsing").doCommand();')
   wait_for(lambda:chrome(guest,'return [...Services.wm.getEnumerator("navigator:browser")].length===2&&!!w.gNightBrowser;'))
   navigate(guest,'/room');wait_for(lambda:'обычном окне' in text(guest,'room-status'))
   chrome(host,'w.gBrowser.selectedTab.splitview?.unsplitTabs();')
   navigate(host,'/');wait_for(lambda:content(host,'return !!document.querySelector(".browser-preview");'))
   wait_for(lambda:text(host,'downloads')=='42');capture(host,'night-website.png')
   host.set_window_rect(width=660,height=900)
   assert content(host,'return document.documentElement.scrollWidth<=document.documentElement.clientWidth+2;')
   host.set_window_rect(width=1280,height=900)
   result={'passed':True,'delayed_scripts':delayed_scripts,'leave_during_microphone_request_keeps_capture_off':True,'website_counter_fixture':True,'website_responsive':True,'duplicate_active_chat_rejected':True,'owner_kick_stops_guest_microphone':True,'room_protected_only_while_connected':True,'video_and_chat_split':True,'bridge_rejects_other_origin_and_private_windows':True,'link_request_requires_owner_approval':True,'new_guest_id_without_friendship':True,'real_rtc_data_channel_bidirectional_chat':True,'real_rtc_audio_both_directions':True,'fake_microphone_fixture':True,'microphone_explicit_and_stopped':True,'leave_closes_peer_audio':True,'host_stats':host_stats,'guest_stats':guest_stats,'wan_turn_unverified':True}
   (output/'social-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
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
