import argparse,base64,json,os,shutil,subprocess,tempfile,threading,zipfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import psutil
from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons
from smoke import wait_for

class Page(BaseHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><title>Profile fixture</title><p>Independent accounts</p>')

def run(package,output):
    output.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Page);threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}'
    env={**os.environ,'MOZ_MARIONETTE':'1','MOZ_REMOTE_ALLOW_SYSTEM_ACCESS':'1','MOZ_DISABLE_LAUNCHER_PROCESS':'1'}
    env.pop('MOZ_HEADLESS',None)
    instances=[];result={}
    def chrome(b,script,*args):
        b.set_context('chrome');return b.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;"+script,script_args=list(args))
    def async_chrome(b,script,*args):
        b.set_context('chrome');result=b.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(value=>done({value}),error=>done({error:String(error)}));',script_args=list(args));assert 'error' not in result,result;return result.get('value')
    def content(b,script,*args):
        b.set_context('content');return b.execute_script(script,script_args=list(args))
    def prefs(profile,port):
        profile.mkdir(parents=True,exist_ok=True)
        (profile/'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k,v in {'marionette.port':port,'night.onboarding.completed':True}.items()))
    def connect(port):
        b=Marionette(host='127.0.0.1',port=port);b.raise_for_port(timeout=60);b.start_session();b.timeout.script=60
        wait_for(lambda:chrome(b,'return !!w.gNightBrowser;'),timeout=60)
        process=psutil.Process(chrome(b,'return Services.appinfo.processID;'));instances.append((b,process));return b
    def stop(b):
        process=next(p for item,p in instances if item is b)
        chrome(b,'Services.tm.dispatchToMainThread(()=>Services.startup.quit(Ci.nsIAppStartup.eForceQuit));');b.delete_session(send_request=False);process.wait(timeout=30);instances.remove((b,process))
    with tempfile.TemporaryDirectory(prefix='night-profiles-',ignore_cleanup_errors=True) as temp:
        root=Path(temp)/'Night профили';shutil.copytree(package,root,ignore=shutil.ignore_patterns('profile','profiles','night-active-profile','night-profile.json'))
        launcher=root/'Night.exe';prefs(root/'profile',2828)
        def launch(*args):
            run=subprocess.run([str(launcher),*args],env=env,timeout=50);assert run.returncode==0,(args,run.returncode)
        try:
            launch('--profile-id','default');a=connect(2828)
            context=chrome(a,'return ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs").NightProfiles.context;')
            assert context['managed'] and context['id']=='default',context
            a.set_context('content');a.navigate(url+'/personal')
            content(a,"document.cookie='account=personal; Max-Age=86400; path=/';localStorage.setItem('account','personal');")
            async_chrome(a,'''const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
              await PlacesUtils.bookmarks.insert({parentGuid:PlacesUtils.bookmarks.toolbarGuid,url:arguments[0]+'/personal-bookmark',title:'Personal bookmark'});
              const login=Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
              login.init('https://profiles.example.test','https://profiles.example.test',null,'personal-user','fixture-secret','user','pass');await Services.logins.addLoginAsync(login);
              Services.prefs.setStringPref('night.ui.palette','graphite');''',url)
            addon=Path(temp)/'fixture.xpi'
            with zipfile.ZipFile(addon,'w') as z:z.writestr('manifest.json',json.dumps({'manifest_version':2,'name':'Profile fixture','version':'1.0','browser_specific_settings':{'gecko':{'id':'profile-fixture@example.test'}}}))
            Addons(a).install(str(addon),temp=True)
            id=async_chrome(a,'const {NightProfiles}=ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs");return NightProfiles.create("Рабочий", "midnight");')
            async_chrome(a,'await ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs").NightProfiles.customize(arguments[0],{color:"jade",icon:"🎧"});',id)
            prefs(root/'profiles'/id/'profile',2829)
            chrome(a,'d.getElementById("night-profile-button").click();')
            wait_for(lambda:chrome(a,'return d.getElementById("night-profiles-panel").state==="open";'))
            a.set_context('chrome');(output/'night-profile-switcher.png').write_bytes(base64.b64decode(a.screenshot()))
            chrome(a,'d.querySelector(`[data-profile-id="${arguments[0]}"]`).click();',id)
            b=connect(2829)
            assert chrome(b,'return ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs").NightProfiles.context.id;')==id
            assert chrome(b,'return Services.prefs.getStringPref("night.ui.palette");')=='midnight'
            b.set_context('content');b.navigate('about:preferences#accounts')
            wait_for(lambda:content(b,'return !!document.querySelector(`[data-profile-editor="${arguments[0]}"]`);',id))
            content(b,'const editor=document.querySelector(`[data-profile-editor="${arguments[0]}"]`);[...editor.previousElementSibling.querySelectorAll("button")].find(b=>b.textContent==="Настроить").click();editor.querySelector("input").value="Рабочий";editor.querySelectorAll("select")[0].value="sky";editor.querySelectorAll("select")[1].value="☾";[...editor.querySelectorAll("button")].find(b=>b.textContent==="Сохранить профиль").click();',id)
            wait_for(lambda:chrome(b,'return d.getElementById("night-profile-button").textContent==="☾";'))
            b.set_context('content');b.navigate(url+'/work')
            assert content(b,'return document.cookie;')==''
            assert content(b,"return localStorage.getItem('account');") is None
            isolated=async_chrome(b,'''const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
              const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
              return {logins:(await Services.logins.getAllLogins()).length,bookmark:await PlacesUtils.bookmarks.fetch({url:arguments[0]+'/personal-bookmark'}),addon:!!await AddonManager.getAddonByID('profile-fixture@example.test'),sync:Services.prefs.getBoolPref('identity.fxaccounts.enabled')};''',url)
            assert isolated=={'logins':0,'bookmark':None,'addon':False,'sync':False},isolated
            content(b,"document.cookie='account=work; Max-Age=86400; path=/';localStorage.setItem('account','work');")
            async_chrome(b,'const {NightProfiles}=ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs");await NightProfiles.rename(arguments[0],"Рабочий проект");',id)
            async_chrome(b,'await ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs").NightProfiles.open("default",Services.wm.getMostRecentWindow("navigator:browser"));')
            custom=async_chrome(b,'return (await ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs").NightProfiles.list()).find(p=>p.id===arguments[0]);',id)
            assert custom['color']=='sky' and custom['icon']=='☾' and custom['name']=='Рабочий проект',custom
            photo=async_chrome(b,'const w=Services.wm.getMostRecentWindow("navigator:browser"),A=ChromeUtils.importESModule("resource:///modules/night/NightAvatar.sys.mjs").NightAvatar,response=await fetch("chrome://browser/content/night/branding/icon128.png"),avatar=await A.encode(w,new Uint8Array(await response.arrayBuffer()));await ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs").NightProfiles.customize(arguments[0],{avatar});return avatar;',id)
            wait_for(lambda:chrome(b,'return d.getElementById("night-profile-button").querySelector("img")?.complete;'))
            assert (root/'night-active-profile').read_text()=='default'
            assert chrome(a,'return [...Services.wm.getEnumerator("navigator:browser")].length;')==1
            assert content(a,'return document.cookie;')=='account=personal'
            assert content(a,"return localStorage.getItem('account');")=='personal'
            assert chrome(a,'return Services.prefs.getStringPref("night.ui.palette");')=='graphite'
            launch('--profile-id',id,'--url',url+'/external')
            wait_for(lambda:chrome(b,'return w.gBrowser.tabs.some(t=>t.linkedBrowser.currentURI.spec===arguments[0]);',url+'/external'))
            assert not chrome(a,'return w.gBrowser.tabs.some(t=>t.linkedBrowser.currentURI.spec===arguments[0]);',url+'/external')
            assert (root/'night-active-profile').read_text()==id
            assert subprocess.run([str(launcher),'--profile-id','../profile'],env=env,timeout=10).returncode!=0
            assert subprocess.run([str(launcher),'--profile-id','0'*32],env=env,timeout=10).returncode!=0
            stop(a);stop(b)
            launch();b=connect(2829)
            assert chrome(b,'return ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs").NightProfiles.context.id;')==id
            b.set_context('content');b.navigate(url+'/restored')
            assert content(b,'return document.cookie;')=='account=work'
            assert content(b,"return localStorage.getItem('account');")=='work'
            assert chrome(b,'return d.getElementById("night-profile-button").querySelector("img")?.src;')==photo
            stop(b)
            result={'passed':True,'uploaded_avatar_persists':True,'existing_default_preserved':True,'passwords_bookmarks_cookies_storage_extensions_isolated':True,'separate_palette':True,'switch_reuses_window':True,'external_url_uses_selected_profile':True,'last_profile_restored':True,'invalid_profiles_rejected':True}
            (output/'profiles-result.json').write_text(json.dumps(result,indent=2));print('PASS: Windows profiles isolate data, reuse windows and restore the last profile',flush=True)
        finally:
            for b,_ in instances[:]:
                try:stop(b)
                except Exception:pass
            server.shutdown();server.server_close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--package',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.package,a.output)
