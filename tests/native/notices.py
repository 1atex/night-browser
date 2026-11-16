import argparse,json,os,subprocess,tempfile,time
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

def run(binary,app_ini,output):
 output.mkdir(parents=True,exist_ok=True);drivers=[]
 module=(Path(__file__).resolve().parents[2]/'services/together/server.mjs').as_uri()
 with tempfile.TemporaryDirectory(prefix='night-notices-') as temp:
  database=Path(temp)/'state.json'
  script=f'import {{createService}} from {json.dumps(module)};const s=await createService({{path:{json.dumps(str(database))},iceServers:[]}});s.listen(0,"127.0.0.1",()=>console.log(s.address().port));'
  backend=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,text=True);endpoint='http://127.0.0.1:'+backend.stdout.readline().strip()
  def chrome(b,script,*args):b.set_context('chrome');return b.execute_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;'+script,script_args=list(args))
  def call(b,script,*args):
   b.set_context('chrome');value=b.execute_async_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),done=arguments[arguments.length-1],T=ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether,N=ChromeUtils.importESModule("resource:///modules/night/NightFriendNotices.sys.mjs").NightFriendNotices;(async()=>{'+script+'})().then(value=>done({value}),e=>done({error:String(e),stack:e.stack}));',script_args=list(args));assert 'error' not in value,value;return value.get('value')
  try:
   for i in range(2):
    b=Marionette(bin=binary,port=2828+i,headless=os.name!='nt',prefs={'marionette.port':2828+i,'night.onboarding.completed':True,'night.together.server':endpoint},app_args=['-app',app_ini],gecko_log=str(output/f'notices-{i}.log'));drivers.append(b);b.start_session();b.timeout.script=45;wait_for(lambda:chrome(b,'return !!w.gNightBrowser;'));call(b,'await T.connect(arguments[0],w);',endpoint)
   host,guest=drivers;a=call(host,'return (await T.state()).id;');b=call(guest,'return (await T.state()).id;')
   call(host,'await T.action({type:"friend-request",id:arguments[0]});',b);call(guest,'await T.action({type:"friend-accept",id:arguments[0]});',a)
   if os.name!='nt':
    denied=call(host,'try{await N.enable();return false;}catch{return !Services.prefs.getBoolPref("night.together.notices",false)&&!await IOUtils.exists(PathUtils.join(PathUtils.profileDir,"night-notices.json"));}')
    assert denied
    result={'passed':True,'os_keystore_unavailable_fails_closed':True,'two_client_roundtrip_requires_windows':True};(output/'notices-result.json').write_text(json.dumps(result));print(json.dumps(result));return
   call(host,'await N.enable();');call(guest,'await N.enable();');call(host,'await T.state();')
   storage=call(host,'const value=await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir,"night-notices.json"));return {encrypted:!!value.box&&!value.box.includes(N.identity.privateKey.d),plaintext:JSON.stringify(value).includes(N.identity.privateKey.d)};')
   assert storage['encrypted'] and not storage['plaintext'],storage
   assert call(host,'const key=N.identity.publicKey;N.identity=null;N.data=null;return (await N.ensureIdentity()).publicKey===key;')
   chrome(guest,'Services.prefs.setBoolPref("night.together.notices",false);')
   call(host,'await ChromeUtils.importESModule("resource:///modules/night/NightFriendNoticesView.sys.mjs").NightFriendNoticeViews.open(w,arguments[0]);',b)
   chrome(host,'d.getElementById("night-notice-text").value="Private hello from Noon";d.getElementById("night-notice-send").click();')
   wait_for(lambda:chrome(host,'return d.getElementById("night-notice-text").value==="";'))
   assert 'Private hello from Noon' not in database.read_text()
   queued=call(guest,'return (await T.state()).notices;');assert len(queued)==1 and 'text' not in queued[0],queued
   chrome(guest,'Services.prefs.setBoolPref("night.together.notices",true);');call(guest,'await N.poll();')
   wait_for(lambda:call(guest,'return N.inbox.length;')==1)
   assert call(guest,'return N.inbox[0].text;')=='Private hello from Noon'
   assert call(guest,'return (await T.state()).notices.length;')==0
   call(guest,'await N.poll();');assert call(guest,'return N.inbox.length;')==1
   call(guest,'await N.send(arguments[0],"Reply encrypted");',a);call(host,'await N.poll();')
   wait_for(lambda:call(host,'return N.inbox.some(item=>item.text==="Reply encrypted");'))
   changed=call(guest,'const C=ChromeUtils.importESModule("resource:///modules/night/NoticeCrypto.mjs");const key=await C.createNoticeIdentity(w.crypto);await T.action({type:"notice-key",publicKey:key.publicKey});return key.publicKey;')
   chrome(host,'d.getElementById("night-notice-text").value="Keep this draft";d.getElementById("night-notice-send").click();')
   wait_for(lambda:chrome(host,'return d.getElementById("night-friend-notices").textContent.includes("Ключ друга изменился");'))
   assert chrome(host,'return d.getElementById("night-notice-text").value;')=='Keep this draft'
   call(guest,'await N.disable();');assert call(host,'return (await T.state()).friends[0].noticeKey;') is None
   call(host,'await T.disconnect();');assert not call(host,'return IOUtils.exists(PathUtils.join(PathUtils.profileDir,"night-notices.json"));')
   result={'passed':True,'os_keystore_real':True,'server_ciphertext_only':True,'offline_queue_and_ack':True,'bidirectional':True,'key_change_blocks_and_preserves_draft':True,'disable_unpublishes_key':True,'disconnect_removes_local_key_box':True,'operating_system':os.name}
   (output/'notices-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
  finally:
   for b in reversed(drivers):
    try:b.cleanup();b.instance=None
    except Exception:pass
   backend.terminate();backend.wait(timeout=10)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',required=True,type=Path);a=p.parse_args();run(a.binary,a.app_ini,a.output)
