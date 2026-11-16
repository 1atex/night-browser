import argparse,base64,json,subprocess,urllib.request
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

def run(binary,app_ini,output):
    output.mkdir(parents=True,exist_ok=True)
    module=(Path(__file__).resolve().parents[2]/'services/together/server.mjs').as_uri()
    server=subprocess.Popen(['node','--input-type=module','-e',f'import {{createService}} from {json.dumps(module)};const server=await createService();server.listen(0,"127.0.0.1",()=>console.log(server.address().port));'],stdout=subprocess.PIPE,text=True)
    port=int(server.stdout.readline());endpoint=f'http://127.0.0.1:{port}'
    def request(route,user=None,body=None):
        req=urllib.request.Request(endpoint+route,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':f'Bearer {user["id"]}:{user["token"]}'} if user else {})})
        return json.load(urllib.request.urlopen(req,timeout=10))
    friend=request('/v1/register',body={})
    b=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True,'night.together.server':''},app_args=['-app',app_ini],gecko_log=str(output/'updates-together-gecko.log'))
    def chrome(script,*args):
        b.set_context('chrome');return b.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;"+script,script_args=list(args))
    def content(script,*args):
        b.set_context('content');return b.execute_script(script,script_args=list(args))
    def click(label):content('const button=[...document.querySelectorAll("button")].find(b=>b.textContent===arguments[0]);if(!button)throw new Error(arguments[0]);button.click();',label)
    try:
        b.start_session();b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome('return !!w.gNightBrowser;'))
        b.set_context('content');b.navigate('about:preferences#updates');wait_for(lambda:content('return !!document.getElementById("night-update-check");'))
        assert content('return document.body.textContent.includes("Night 0.18.0");')
        chrome('Services.prefs.setStringPref("night.updates.seen-version","0.12.0");ChromeUtils.importESModule("resource:///modules/night/NightUpdates.sys.mjs").NightUpdates.startup(w);')
        wait_for(lambda:chrome('return w.gBrowser.tabs.some(t=>t.linkedBrowser.currentURI.spec.endsWith("/night/changes.html"));'))
        count=chrome('return w.gBrowser.tabs.length;')
        chrome('ChromeUtils.importESModule("resource:///modules/night/NightUpdates.sys.mjs").NightUpdates.startup(w);')
        assert chrome('return w.gBrowser.tabs.length;')==count
        b.set_context('content');b.navigate('about:preferences#together');b.switch_to_window(b.current_window_handle);wait_for(lambda:content('return !!document.querySelector("input[type=url]");'))
        content('document.querySelector("input[type=url]").value=arguments[0];',endpoint);click('Получить мой ID')
        wait_for(lambda:content('return document.body.textContent.includes("Мой ID");'))
        b.set_context('chrome');creds=b.execute_async_script('const done=arguments[arguments.length-1];ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs").NightTogether.credentials().then(done);')
        assert not content('return document.body.textContent;').__contains__(creds['token'])
        content('document.querySelector("input[maxlength]").value=arguments[0];',friend['id']);click('Добавить друга')
        wait_for(lambda:content('return document.body.textContent.includes("Ожидаем подтверждения");'))
        request('/v1/action',friend,{'type':'friend-accept','id':creds['id']});click('Обновить список')
        wait_for(lambda:content('return [...document.querySelectorAll(".setting-label p")].some(e=>e.textContent===arguments[0]);',friend['id']))
        content('document.querySelector("input[type=url]").value="https://www.youtube.com/watch?v=fixture";');click('Создать комнату')
        wait_for(lambda:content('return document.body.textContent.includes("1 участник");'))
        click('Пригласить')
        wait_for(lambda:len(request('/v1/state',friend)['invitations'])==1)
        b.set_context('chrome');(output/'night-together.png').write_bytes(base64.b64decode(b.screenshot()))
        (output/'updates-together-result.json').write_text(json.dumps({'passed':True,'changes_once':True,'friend_consent':True,'credentials_not_displayed':True,'room_invitation':True}))
        print('PASS: update UI, one-time changelog and real friend/room server flow',flush=True)
    except Exception:
        try:
            (output/'updates-together-failure.txt').write_text(content('return document.body.textContent;'),encoding='utf-8')
        except Exception:pass
        raise
    finally:
        b.cleanup();b.instance=None;server.terminate();server.wait(timeout=10)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
