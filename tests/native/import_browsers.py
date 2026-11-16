import argparse,base64,hashlib,json,subprocess,tempfile
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

def run(binary,app_ini,output):
 output.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='night-browser-import-') as temporary:
  root=Path(temporary)
  for project in ['Chrome','Edge','Brave']:
   directory=root/project;profile=directory/'Default';profile.mkdir(parents=True)
   (directory/'Local State').write_text(json.dumps({'profile':{'info_cache':{'Default':{'name':project+' fixture'}}}}))
   roots={name:{'type':'folder','name':name,'children':[]} for name in ['bookmark_bar','other','synced']};roots['bookmark_bar']['children']=[{'id':'1','type':'url','name':project+' import fixture','url':'https://import.example.test/'+project.lower(),'date_added':'13300000000000000'}]
   (profile/'Bookmarks').write_text(json.dumps({'version':1,'roots':roots}))
  original={str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in root.rglob('*') if path.is_file()}
  b=Marionette(bin=binary,port=2828,headless=True,prefs={'marionette.port':2828,'night.onboarding.completed':True},app_args=['-app',app_ini],gecko_log=str(output/'imports.log'))
  def chrome(script,*args):b.set_context('chrome');return b.execute_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;'+script,script_args=list(args))
  def async_chrome(script,*args):
   b.set_context('chrome');value=b.execute_async_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),done=arguments[arguments.length-1];(async()=>{'+script+'})().then(value=>done({value}),error=>done({error:String(error)}));',script_args=list(args));assert 'error' not in value,value;return value.get('value')
  def content(script):b.set_context('content');return b.execute_script(script)
  try:
   b.start_session();b.timeout.script=45;b.set_window_rect(width=1200,height=900);wait_for(lambda:chrome('return !!w.gNightBrowser;'))
   crypto=async_chrome('const C=ChromeUtils.importESModule("resource:///modules/night/NoticeCrypto.mjs");const a=await C.createNoticeIdentity(w.crypto),b=await C.createNoticeIdentity(w.crypto),from="a".repeat(16),to="b".repeat(16),box=await C.encryptNotice(a.privateKey,b.publicKey,{from,to,text:"Привет другу"},w.crypto);const text=await C.decryptNotice(b.privateKey,a.publicKey,box,to,w.crypto);let tamper=false;try{await C.decryptNotice(b.privateKey,a.publicKey,{...box,at:box.at+1},to,w.crypto);}catch{tamper=true;}return {roundtrip:text==="Привет другу",tamper,fingerprint:(await C.noticeFingerprint(a.publicKey,w.crypto)).length===64};')
   assert all(crypto.values()),crypto
   os_storage=async_chrome('if(Services.appinfo.OS!=="WINNT")return {tested:false};const {OSKeyStore}=ChromeUtils.importESModule("resource://gre/modules/OSKeyStore.sys.mjs");const value="Night test key material",box=await OSKeyStore.encrypt(value);return {tested:true,encrypted:!box.includes(value),decrypted:(await OSKeyStore.decrypt(box,"night-import-fixture"))===value};')
   if os_storage['tested']:assert os_storage['encrypted'] and os_storage['decrypted']
   chrome('const {ChromeMigrationUtils}=ChromeUtils.importESModule("moz-src:///browser/components/migration/ChromeMigrationUtils.sys.mjs");ChromeMigrationUtils.getDataPath=async project=>PathUtils.join(arguments[0],project||"Chrome");',str(root))
   imported=[]
   for key,project in [('chrome','Chrome'),('chromium-edge','Edge'),('brave','Brave')]:
    value=async_chrome('const {NightBrowserImport:I}=ChromeUtils.importESModule("resource:///modules/night/NightBrowserImport.sys.mjs");const source=await I.inspect(arguments[0]);if(!source.available)throw Error(JSON.stringify(source));const result=await I.migrate(w,arguments[0],source.profiles[0].id,["BOOKMARKS"]);const {PlacesUtils}=ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");return {source:source.source.name,success:result.results.every(r=>r.success),found:(await PlacesUtils.bookmarks.search({url:arguments[1]})).length>0};',key,'https://import.example.test/'+project.lower());assert value['success'] and value['found'],value;imported.append(value)
   chrome('w.openPreferences("import");');wait_for(lambda:content('return !!document.getElementById("browser-import-source");'))
   content('const select=document.getElementById("browser-import-source");select.value="chrome";select.dispatchEvent(new Event("change"));')
   wait_for(lambda:content('return !!document.getElementById("other-browser-profile");'))
   b.set_context('chrome');(output/'night-browser-import.png').write_bytes(base64.b64decode(b.screenshot()))
   chrome('d.getElementById("Tools:PrivateBrowsing").doCommand();');wait_for(lambda:chrome('return [...Services.wm.getEnumerator("navigator:browser")].length===2&&!!w.gNightBrowser;'))
   rejected=async_chrome('try{await ChromeUtils.importESModule("resource:///modules/night/NightBrowserImport.sys.mjs").NightBrowserImport.migrate(w,"chrome","Default",["BOOKMARKS"]);return false;}catch(error){return String(error).includes("обычном");}');assert rejected
   after={str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in root.rglob('*') if path.is_file()};assert after==original
   result={'passed':True,'native_chrome_edge_brave_bookmarks':imported,'source_files_unchanged':True,'private_import_rejected':True,'night_source_picker':True,'native_notice_crypto':crypto,'windows_os_key_storage':os_storage,'fixture_note':'Synthetic Chromium profile folders read by native Gecko migrators; this does not verify app-bound Chrome password decryption or every installed browser.'};(output/'browser-import-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
  finally:b.cleanup();b.instance=None
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
