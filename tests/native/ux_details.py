import argparse,base64,json,os,subprocess,tempfile
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

def run(binary,app_ini,output):
 output.mkdir(parents=True,exist_ok=True);module=(Path(__file__).resolve().parents[2]/'services/together/server.mjs').as_uri()
 with tempfile.TemporaryDirectory(prefix='night-ux-') as temp:
  node=subprocess.Popen(['node','--input-type=module','-e',f'import {{createService}} from {json.dumps(module)};const s=await createService({{path:{json.dumps(str(Path(temp)/"state.json"))},releases:async()=>[{{tag_name:"v0.18.0-preview.1",assets:[{{name:"night-browser-0.18.0-preview-windows-x64-setup.exe",download_count:42,browser_download_url:"https://github.com/1atex/night-browser/releases/download/v0.18.0-preview.1/night-browser-0.18.0-preview-windows-x64-setup.exe"}}]}}]}});s.listen(0,"127.0.0.1",()=>console.log(s.address().port));'],stdout=subprocess.PIPE,text=True);endpoint='http://127.0.0.1:'+node.stdout.readline().strip()
  b=Marionette(bin=binary,port=2828,headless=os.name!="nt",prefs={'night.onboarding.completed':True,'night.together.server':endpoint},app_args=['-app',app_ini],gecko_log=str(output/'ux-details.log'))
  def chrome(script,*args):b.set_context('chrome');return b.execute_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;'+script,script_args=list(args))
  def call(script,*args):
   b.set_context('chrome');v=b.execute_async_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),T=ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether,done=arguments[arguments.length-1];(async()=>{'+script+'})().then(v=>done({value:v}),e=>done({error:String(e),stack:e.stack}));',script_args=list(args));assert 'error' not in v,v;return v.get('value')
  def content(script,*args):
   handle=chrome('const {NavigableManager}=ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");return NavigableManager.getIdForBrowser(w.gBrowser.selectedBrowser);');b.set_context('content');b.switch_to_window(handle,focus=False);return b.execute_script(script,script_args=list(args))
  def navigate(url):chrome('w.gBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});',url)
  def shot(name):
   call('await new Promise(resolve=>w.setTimeout(resolve,250));');b.set_context('chrome');(output/name).write_bytes(base64.b64decode(b.screenshot()))
  try:
   b.start_session();b.timeout.script=40;b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome('return !!w.gNightBrowser;'));call('await T.connect(arguments[0],w);',endpoint)
   avatar=call('const {NightAvatar}=ChromeUtils.importESModule("resource:///modules/night/NightAvatar.sys.mjs");const canvas=w.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");canvas.width=300;canvas.height=180;canvas.getContext("2d").fillRect(0,0,300,180);const bytes=Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]),c=>c.charCodeAt(0));const value=await NightAvatar.encode(w,bytes);await T.action({type:"profile-avatar",avatar:value});return {data:value,state:await T.state()};')
   assert avatar['data'].startswith('data:image/png;base64,') and avatar['state']['self']['avatar'].startswith('/avatars/')
   rejected=call('try{await ChromeUtils.importESModule("resource:///modules/night/NightAvatar.sys.mjs").NightAvatar.encode(w,new TextEncoder().encode("<svg/>"));return false;}catch{return true;}');assert rejected
   person=call('const credentials=await T.credentials(),other=await T.request(credentials.endpoint,"/v1/register",{body:{}});await T.action({type:"friend-request",id:other.id});await T.request(credentials.endpoint,"/v1/action",{credentials:{...other,endpoint:credentials.endpoint},body:{type:"friend-accept",id:credentials.id}});await T.state();return other.id;')
   chrome('Services.prefs.setBoolPref("night.together.notices",true);')
   call('await ChromeUtils.importESModule("resource:///modules/night/NightFriendNoticesView.sys.mjs").NightFriendNoticeViews.open(w,arguments[0]);',person)
   wait_for(lambda:chrome('return d.getElementById("night-friend-notices")?.matches(":popover-open");'))
   b.set_context('chrome');b.find_element('id','night-notice-text').send_keys('Draft survives recipient selection');chooser=b.find_element('id','night-notice-recipient');chooser.click();chooser.send_keys('\ue013\ue015\ue007')
   assert chrome('return d.getElementById("night-friend-notices").matches(":popover-open")&&d.getElementById("night-notice-text").value==="Draft survives recipient selection";')
   call('ChromeUtils.importESModule("resource:///modules/night/NightFriendNoticesView.sys.mjs").NightFriendNoticeViews.views.get(w).close();')
   assert chrome('return ["night-split-button","night-network-button","night-tools-button","night-settings-button"].every(id=>d.getElementById(id).textContent==="");')
   footer_geometry=[]
   for density in ['comfortable','compact']:
    for width in [240,320,420]:
     for tools in [True,False]:
      chrome('Services.prefs.setStringPref("night.ui.density",arguments[0]);Services.prefs.setIntPref("night.ui.sidebar-width",arguments[1]);Services.prefs.setBoolPref("night.ui.show-tools",arguments[2]);',density,width,tools)
      wait_for(lambda:chrome('return d.getElementById("night-menu-button").parentElement.matches(".night-footer-actions");'))
      geometry=chrome('const row=d.querySelector(".night-footer-actions"),outer=row.getBoundingClientRect(),buttons=[...row.children].filter(n=>w.getComputedStyle(n).display!=="none");return {outer:{left:outer.left,right:outer.right},buttons:buttons.map(n=>{const r=n.getBoundingClientRect();return {id:n.id,left:r.left,right:r.right,center:r.y+r.height/2};})};')
      centers=[item['center'] for item in geometry['buttons']];assert max(centers)-min(centers)<1,geometry
      assert all(item['left']>=geometry['outer']['left']-.5 and item['right']<=geometry['outer']['right']+.5 for item in geometry['buttons']),geometry
      assert all(left['right']<=right['left'] for left,right in zip(geometry['buttons'],geometry['buttons'][1:])),geometry
      footer_geometry.append({'density':density,'width':width,'tools':tools,**geometry})
   chrome('Services.prefs.setStringPref("night.ui.density","comfortable");Services.prefs.setIntPref("night.ui.sidebar-width",320);Services.prefs.setBoolPref("night.ui.show-tools",true);')
   b.set_context('chrome');(output/'night-footer.png').write_bytes(base64.b64decode(b.screenshot(element=b.find_element('css selector','.night-footer-actions'),scroll=False)))
   b.find_element('id','night-menu-button').click();wait_for(lambda:chrome('return d.getElementById("night-main-menu").state==="open";'));chrome('d.getElementById("night-main-menu").hidePopup();')
   chrome('Services.prefs.setStringPref("night.ui.navigation-layout","top");');wait_for(lambda:chrome('return d.getElementById("night-menu-button").parentElement.id==="PanelUI-button";'))
   chrome('Services.prefs.setStringPref("night.ui.navigation-layout","sidebar");');wait_for(lambda:chrome('return d.getElementById("night-menu-button").parentElement.matches(".night-footer-actions");'))

   chrome('w.gNightBrowser.shell.workspaces.setEmoji("🧪");');assert chrome('const {SessionStore}=ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");return JSON.parse(SessionStore.getCustomWindowValue(w,"night-workspaces")).items.find(i=>i.id===w.gNightBrowser.shell.workspaces.active).emoji;')=='🧪'
   navigate('chrome://browser/content/night/changes.html');wait_for(lambda:content('return document.querySelectorAll(".release").length>=2;'));assert content('return document.querySelector("time[datetime]")&&document.querySelectorAll(".release li").length>5;');shot('night-changes.png')
   navigate('about:preferences#updates');wait_for(lambda:content('return !!document.getElementById("night-update-check");'));chrome('ChromeUtils.importESModule("resource:///modules/night/NightUpdates.sys.mjs").NightUpdates.update({phase:"downloading",received:5242880,total:10485760});');assert content('return document.getElementById("night-update-progress").value;')==50;shot('night-update-progress.png')
   navigate(endpoint+'/');wait_for(lambda:content('return document.getElementById("downloads")?.textContent==="42";'));assert content('return !/тво[её]|свой ритм|меньше шума/i.test(document.body.innerText);');shot('night-website.png')
   for width in [360,660,1280]:b.set_window_rect(width=width,height=900);assert content('return document.documentElement.scrollWidth<=document.documentElement.clientWidth+2;')
   result={'passed':True,'actual_image_crop_and_avatar_upload':True,'svg_rejected':True,'recipient_selection_preserves_popup_and_draft':True,'footer_centers_aligned':True,'footer_menu_click_and_layout_switch':True,'footer_geometry':footer_geometry,'workspace_emoji_saved':True,'structured_release_history':True,'download_progress_rendered':True,'website_counter_and_responsive':True};(output/'ux-details-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
  finally:b.cleanup();b.instance=None;node.terminate();node.wait(timeout=10)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',required=True,type=Path);a=p.parse_args();run(a.binary,a.app_ini,a.output)
