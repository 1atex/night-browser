import argparse
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

WIN = "Services.wm.getMostRecentWindow('navigator:browser')"


class Site(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *_args):
        pass

    def do_GET(self):
        Site.requests.append(self.path)
        body = b'<!doctype html><title>Project page</title><link rel="icon" href="data:,"><style>body{background:#11151b;color:#cdd3df;font:18px system-ui;margin:64px}h1{font-weight:500}p{color:#8a94a5}</style><h1>Projects</h1><p>Folders, spaces and saved tabs.</p>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    browser = Marionette(prefs={"night.onboarding.completed": True}, bin=binary, headless=True, app_args=['-app', app_ini], gecko_log=str(output/'sidebar-gecko.log'))

    def chrome(script, *args):
        browser.set_context('chrome')
        return browser.execute_script(f'const w={WIN},d=w.document,s=w.gNightBrowser.shell,b=w.gBrowser;' + script, script_args=list(args))

    def settle():
        browser.execute_async_script('const done=arguments[arguments.length-1];setTimeout(done,350);')

    try:
        browser.start_session()
        browser.timeout.script = 30
        browser.set_window_rect(width=1440, height=960)
        browser.set_context('chrome')
        wait_for(lambda: browser.execute_script(f'return !!{WIN}?.gNightBrowser?.shell;'))
        icon = 'data:image/png;base64,' + base64.b64encode((Path(__file__).resolve().parents[2]/'src/night/branding/icon32.png').read_bytes()).decode()
        chrome("""
          const {convertZenSession}=ChromeUtils.importESModule('resource:///modules/night/ZenImportModel.mjs');
          const {SessionStore}=ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs');
          const source={spaces:[{uuid:'work',name:'Работа'},{uuid:'home',name:'Личное'}],
            folders:[{id:'projects',name:'Проекты',workspaceId:'work'},{id:'api',name:'API',parentId:'projects',workspaceId:'work'},{id:'empty',name:'Архив',workspaceId:'work',collapsed:true}],
            tabs:Array.from({length:9},(_,i)=>({zenSyncId:'node-'+i,zenWorkspace:i===8?'home':'work',zenEssential:i<2,pinned:true,groupId:i>=4&&i<8?(i<6?'projects':'api'):undefined,image:arguments[1],zenStaticLabel:['Почта','Видео','Документация','Панель сервера','Задачи','Репозиторий','Разработка','Запросы','Дом'][i],entries:[{url:arguments[0]+'/'+i,title:'Saved '+i}],index:1}))};
          w.sidebarSource=source;
          const converted=convertZenSession({windows:[{tabs:[source.tabs[2]],selected:1,activeZenSpace:'work'}]},source);
          SessionStore.setWindowState(w,JSON.stringify(converted.session),true);
        """, origin, icon)
        wait_for(lambda: chrome("return b.tabs.length===9&&s.workspaces.active==='work'&&s.workspaces.folders.length===3&&[...b.tabs].filter(t=>t.hasAttribute('pending')).length===8;"))
        wait_for(lambda: chrome("return d.querySelectorAll('#night-pinned-tabs .night-tab').length===2&&d.querySelectorAll('.night-folder').length===3;"))
        settle()
        assert Site.requests == ['/2'], Site.requests
        assert chrome("return [...b.tabs].find(t=>t.linkedBrowser.currentURI.spec.endsWith('/8')).hidden && !d.getElementById('night-folder-tree').textContent.includes('Дом');")
        assert chrome("return [...d.querySelectorAll('.night-tab[data-sleeping] img')].every(i=>i.complete&&i.naturalWidth>0);")
        chrome("s.workspaces.toggleFolder('projects');")
        settle()
        assert chrome("return d.querySelector('[data-folder=projects] .night-folder-children').hidden;")
        chrome("s.workspaces.toggleFolder('projects');")
        assert Site.requests == ['/2'], Site.requests
        rect = chrome("return d.getElementById('night-sidebar-resizer').getBoundingClientRect().toJSON();")
        browser.actions.sequence('pointer', 'resize').pointer_move(x=round(rect['x']+2), y=500, origin='viewport').pointer_down(button=0).pointer_move(x=377, y=500, duration=250, origin='viewport').pointer_up(button=0).perform()
        width = chrome("return Services.prefs.getIntPref('night.ui.sidebar-width');")
        assert 370 <= width <= 385, width
        assert abs(chrome("return d.getElementById('night-sidebar').getBoundingClientRect().width;")-width)<1
        chrome("Services.prefs.setIntPref('night.ui.sidebar-width',320);")
        settle()
        (output/'night-sidebar-filled.png').write_bytes(base64.b64decode(browser.screenshot()))
        state = chrome("""
          const {SessionStore}=ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs');
          const tab=[...b.tabs].find(t=>SessionStore.getCustomTabValue(t,'night-node')==='node-3');
          s.render();
          const source=[...d.querySelectorAll('.night-tab')].find(row=>row.textContent.includes('Панель сервера'));
          const target=d.querySelector('[data-folder=api] .night-folder-main');
          const transfer=new w.DataTransfer();
          source.dispatchEvent(new w.DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
          target.dispatchEvent(new w.DragEvent('drop',{bubbles:true,dataTransfer:transfer,cancelable:true}));
          const nested=s.workspaces.folderOf(tab)==='api';
          s.workspaces.move('projects','home');
          const moved=s.workspaces.workspaceOf(tab)==='home'&&s.workspaces.folders.find(f=>f.id==='api').workspace==='home'&&tab.hidden;
          s.workspaces.move('projects','work');
          s.workspaces.move('projects','work','api');
          return {nested,moved,cyclePrevented:s.workspaces.folders.find(f=>f.id==='projects').parentId===null,pending:tab.hasAttribute('pending')};
        """)
        assert state == {'nested':True,'moved':True,'cyclePrevented':True,'pending':True}, state
        repaired = browser.execute_async_script(f"""
          const done=arguments[arguments.length-1],w={WIN};
          (async()=>{{
            const {{NightImport}}=ChromeUtils.importESModule('resource:///modules/night/NightImport.sys.mjs');
            const root=Services.dirsvc.get('ProfD',Ci.nsIFile).path;
            await IOUtils.writeJSON(PathUtils.join(root,'zen-sessions.jsonlz4'),w.sidebarSource,{{compress:true}});
            return await NightImport.repair(w);
          }})().then(done,e=>done({{error:String(e)}}));
        """)
        assert repaired.get('matched') == 9 and repaired.get('skipped') == 0, repaired
        assert Site.requests == ['/2'], Site.requests
        chrome("Services.prefs.setIntPref('browser.startup.page',3);Services.prefs.setBoolPref('browser.sessionstore.resume_session_once',true);")
        browser.restart(in_app=True)
        wait_for(lambda: chrome("return s.workspaces.folders.length===3&&b.tabs.length===9&&[...b.tabs].filter(t=>t.hasAttribute('pending')).length===8;"))
        settle()
        wait_for(lambda: Site.requests == ['/2','/2'])
        assert chrome("return d.querySelectorAll('#night-pinned-tabs .night-tab').length===2;")
        result = {'nested_folders':True,'scoped_and_global_pins':True,'saved_favicons_while_unloaded':True,'resize_with_pointer':True,'drag_into_folder':True,'move_folder_between_spaces':True,'cycle_guard':True,'repair_without_page_reloads':True,'background_pins_stay_unloaded_after_restart':True,'page_requests':Site.requests}
        (output/'sidebar-result.json').write_text(json.dumps(result,indent=2))
        print('PASS: nested import, saved icons, pointer resize, tab/folder moves, safe repair and lazy pinned restore',flush=True)
    finally:
        browser.cleanup()
        browser.instance=None
        server.shutdown()
        server.server_close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--binary',required=True)
    parser.add_argument('--app-ini',required=True)
    parser.add_argument('--output',type=Path,default=Path('test-artifacts'))
    args=parser.parse_args()
    run(args.binary,args.app_ini,args.output)
