import argparse,base64,json,subprocess,tempfile,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from marionette_driver.marionette import Marionette
from smoke import wait_for

RESOURCE_RELEASE=threading.Event()
FIXTURE=Path(__file__).parent/'fixtures/watch.webm'
class Page(BaseHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        if self.path.startswith('/held-resource'):
            RESOURCE_RELEASE.wait(40);self.send_response(204);self.end_headers();return
        if self.path.startswith('/clip.webm'):
            body=FIXTURE.read_bytes();kind='video/webm'
        else:
            body=b'<!doctype html><title>Shared video fixture</title><style>body{background:#111;color:white}video{width:640px;height:360px}</style><video controls preload="auto" src="/clip.webm"></video><img hidden loading="eager" src="/held-resource">';kind='text/html'
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

def run(binary,app_ini,output):
    output.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Page);threading.Thread(target=server.serve_forever,daemon=True).start()
    video=f'http://127.0.0.1:{server.server_port}/watch'
    module=(Path(__file__).resolve().parents[2]/'services/together/server.mjs').as_uri()
    temp=tempfile.TemporaryDirectory(prefix='night-watch-');data=Path(temp.name)/'state.json'
    def backend(port=0):
        script=f'import {{createService}} from {json.dumps(module)};const s=await createService({{path:{json.dumps(str(data))}}});s.listen({port},"127.0.0.1",()=>console.log(s.address().port));'
        process=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,text=True)
        return process,int(process.stdout.readline())
    node,port=backend();endpoint=f'http://127.0.0.1:{port}'
    drivers=[];result={}
    def chrome(b,script,*args):
        b.set_context('chrome');return b.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;"+script,script_args=list(args))
    def async_chrome(b,script,*args):
        b.set_context('chrome');value=b.execute_async_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),done=arguments[arguments.length-1];(async()=>{'+script+'})().then(value=>done({value}),e=>done({error:String(e)}));',script_args=list(args));assert 'error' not in value,value;return value.get('value')
    def content(b,script,*args):
        handle=chrome(b,'const {NavigableManager}=ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");return NavigableManager.getIdForBrowser(w.gBrowser.selectedBrowser);')
        b.set_context('content');b.switch_to_window(handle,focus=False);return b.execute_script(script,script_args=list(args))
    def click(b,label):content(b,'const button=[...document.querySelectorAll("button")].find(b=>b.textContent===arguments[0]);if(!button)throw Error(arguments[0]);button.click();',label)
    def state(b):return async_chrome(b,'return ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.state();')
    def player(b):return content(b,'const v=document.querySelector("video");return v?{time:v.currentTime,paused:v.paused,rate:v.playbackRate,ready:v.readyState}:null;')
    def capture(b,name):
        b.set_context('chrome');(output/name).write_bytes(base64.b64decode(b.screenshot()))
    try:
        for index in range(2):
            b=Marionette(bin=binary,port=2828+index,headless=True,prefs={'marionette.port':2828+index,'night.onboarding.completed':True,'night.together.server':endpoint,'media.autoplay.default':0},app_args=['-app',app_ini],gecko_log=str(output/f'watch-{index}.log'))
            drivers.append(b);b.start_session();b.timeout.script=40;b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome(b,'return !!w.gNightBrowser;'))
            async_chrome(b,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.connect(arguments[0],w);',endpoint)
        host,guest=drivers
        a,b=state(host)['id'],state(guest)['id']
        async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.action({type:"friend-request",id:arguments[0]});',b)
        async_chrome(guest,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.action({type:"friend-accept",id:arguments[0]});',a)
        chrome(host,'w.openPreferences("together");')
        wait_for(lambda:content(host,'return !!document.getElementById("together-profile-name");'))
        content(host,'document.getElementById("together-profile-name").value="Noon";document.getElementById("together-profile-color").value="jade";document.getElementById("together-profile-icon").value="☾";')
        click(host,'Сохранить имя и аватар');wait_for(lambda:state(guest)['friends'][0]['name']=='Noon')
        assert state(guest)['friends'][0]['icon']=='☾'
        def panel_click(driver,label):chrome(driver,'const button=[...d.querySelectorAll("#night-together-panel button")].find(b=>b.textContent===arguments[0]);if(!button)throw Error(arguments[0]);button.click();',label)
        chrome(host,'d.getElementById("night-together-watch").click();')
        wait_for(lambda:chrome(host,'return !!d.getElementById("night-together-create-url");'))
        chrome(host,'d.getElementById("night-together-create-url").value=arguments[0];',video);panel_click(host,'Создать комнату')
        wait_for(lambda:state(host)['room'] is not None);wait_for(lambda:chrome(host,'return !!d.getElementById("night-together-invite");'));panel_click(host,'Пригласить')
        chrome(guest,'d.getElementById("night-together-watch").click();')
        wait_for(lambda:chrome(guest,'return [...d.querySelectorAll("#night-together-panel button")].some(b=>b.textContent==="Войти");'))
        panel_click(guest,'Войти');wait_for(lambda:state(guest)['room'] is not None)
        wait_for(lambda:chrome(guest,'return !!d.getElementById("night-together-start");'))
        panel_click(host,'Смотреть');panel_click(guest,'Смотреть')
        wait_for(lambda:player(host) and player(host)['ready']>=3,timeout=30)
        wait_for(lambda:player(guest) and player(guest)['ready']>=3,timeout=30)
        tabs=chrome(host,'return w.gBrowser.tabs.length;')
        async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.watch(w);return true;')
        assert chrome(host,'return w.gBrowser.tabs.length;')==tabs
        assert chrome(host,'return w.gBrowser.selectedTab.hasAttribute("busy");') and chrome(guest,'return w.gBrowser.selectedTab.hasAttribute("busy");')
        control_start=time.monotonic();content(host,'document.querySelector("video").play();')
        wait_for(lambda:not player(guest)['paused'] and player(guest)['time']>1,timeout=8)
        busy_control_seconds=time.monotonic()-control_start
        assert chrome(host,'return w.gBrowser.selectedTab.hasAttribute("busy");') and chrome(guest,'return w.gBrowser.selectedTab.hasAttribute("busy");')
        RESOURCE_RELEASE.set()
        wait_for(lambda:abs(player(host)['time']-player(guest)['time'])<1.3,timeout=20)
        drift=abs(player(host)['time']-player(guest)['time']);assert drift<1.3,drift
        content(guest,'document.querySelector("video").classList.add("ad-showing");')
        wait_for(lambda:state(host)['room']['readiness']['hold'] is not None,timeout=10)
        wait_for(lambda:player(host)['paused'],timeout=10)
        assert not player(guest)['paused']
        content(guest,'document.querySelector("video").classList.remove("ad-showing");')
        wait_for(lambda:state(host)['room']['readiness']['hold'] is None,timeout=10)
        wait_for(lambda:not player(host)['paused'] and not player(guest)['paused'],timeout=10)
        wait_for(lambda:abs(player(host)['time']-player(guest)['time'])<1.3)
        content(host,'document.querySelector("video").pause();')
        wait_for(lambda:player(guest)['paused'],timeout=10)
        wait_for(lambda:abs(player(host)['time']-player(guest)['time'])<.5)
        content(host,'document.querySelector("video").currentTime=14;document.querySelector("video").playbackRate=1.5;')
        wait_for(lambda:abs(player(guest)['time']-14)<.4 and abs(player(guest)['rate']-1.5)<.01,timeout=10)
        content(host,'document.querySelector("video").play();')
        wait_for(lambda:not player(guest)['paused'] and player(guest)['time']>14.2)
        content(guest,'document.querySelector("video").pause();')
        wait_for(lambda:player(host)['paused'],timeout=10)
        time.sleep(2);assert player(guest)['paused']
        content(guest,'document.querySelector("video").currentTime=8;document.querySelector("video").play();')
        wait_for(lambda:not player(host)['paused'] and 7<player(host)['time']<12,timeout=10)
        next_video=video.replace('/watch','/next')
        room_id=state(host)['room']['id']
        async_chrome(host,'await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.action({type:"room-source",room:arguments[0],url:arguments[1]});',room_id,next_video)
        wait_for(lambda:chrome(host,'return w.gBrowser.selectedBrowser.currentURI.spec===arguments[0];',next_video) and chrome(guest,'return w.gBrowser.selectedBrowser.currentURI.spec===arguments[0];',next_video),timeout=15)
        wait_for(lambda:player(host) and player(host)['ready']>=3 and player(guest) and player(guest)['ready']>=3,timeout=30)
        content(host,'document.querySelector("video").currentTime=14;document.querySelector("video").play();')
        wait_for(lambda:not player(guest)['paused'] and player(guest)['time']>13,timeout=15)
        capture(host,'night-watch-host.png');capture(guest,'night-watch-guest.png')
        node.terminate();node.wait(timeout=10)
        wait_for(lambda:player(host)['paused'] and player(guest)['paused'],timeout=15)
        assert player(host)['time']>10 and player(guest)['time']>10
        node,_=backend(port)
        wait_for(lambda:state(host)['self']['name']=='Noon')
        content(host,'document.querySelector("video").play();')
        wait_for(lambda:not player(guest)['paused'],timeout=15)
        chrome(guest,'w.gBrowser.removeTab(w.gBrowser.selectedTab,{animate:false});')
        wait_for(lambda:chrome(guest,'return !ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.watchSession;'))
        async_chrome(host,'ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.stopWatch();')
        chrome(guest,'d.getElementById("Tools:PrivateBrowsing").doCommand();')
        wait_for(lambda:chrome(guest,'return [...Services.wm.getEnumerator("navigator:browser")].length===2&&!!w.gNightBrowser;'))
        private=async_chrome(guest,'try{await ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.watch(w);return false;}catch{return true;}')
        assert private
        result={'ad_fixture_holds_and_resumes_both':True,'passed':True,'quick_panel_create_invite_join_watch':True,'controls_while_page_still_loading':True,'busy_control_seconds':round(busy_control_seconds,3),'actual_video_play_pause_seek_rate':True,'host_changes_video':True,'guest_follows_host':True,'guest_can_pause_play_seek':True,'drift_seconds':round(drift,3),'disconnect_pauses_without_reset':True,'server_restart_preserves_id_and_name':True,'tab_close_stops_sync':True,'private_excluded':True,'social_profile_visible_to_friend':True,'autoplay_note':'Fixture explicitly allows autoplay; real websites may require pressing Play once.'}
        (output/'watch-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
    except Exception:
        for i,b in enumerate(drivers):
            try:
                capture(b,f'watch-failure-{i}.png');(output/f'watch-failure-{i}.json').write_text(json.dumps(chrome(b,'const {NightTogether:T}=ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs");return {url:w.gBrowser.selectedBrowser.currentURI.spec,status:T.watchStatus,error:T.watchError,intent:T.watchSession?.intent,revision:T.watchSession?.revision,sample:T.watchSession?.sample,actor:!!T.watchSession?.actor,running:T.watchSession?.running};'),ensure_ascii=False))
            except Exception:pass
        raise
    finally:
        RESOURCE_RELEASE.set()
        for b in reversed(drivers):
            try:b.cleanup();b.instance=None
            except Exception:pass
        node.terminate();node.wait(timeout=10);server.shutdown();server.server_close();temp.cleanup()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
