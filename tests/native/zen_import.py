import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psutil
from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons
from smoke import wait_for


class Page(BaseHTTPRequestHandler):
    def do_GET(self):
        content = b'<!doctype html><title>Import fixture</title><p>Night import fixture</p>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_args):
        pass


ENV = {**os.environ, 'MOZ_HEADLESS': '1', 'MOZ_MARIONETTE': '1', 'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS': '1', 'MOZ_DISABLE_LAUNCHER_PROCESS': '1'}
WIN = "Services.wm.getMostRecentWindow('navigator:browser')"


def start(command, port, log):
    output = log.open('ab')
    process = subprocess.Popen([str(item) for item in command], env=ENV, stdout=output, stderr=subprocess.STDOUT)
    browser = Marionette(host='127.0.0.1', port=port)
    browser.raise_for_port(timeout=70)
    browser.start_session()
    browser.timeout.script = 60
    browser.set_context('chrome')
    pid = browser.execute_script('return Services.appinfo.processID;')
    wait_for(lambda: browser.execute_script(f'return !!{WIN}?.gBrowserInit?.delayedStartupFinished;'), timeout=60)
    return browser, psutil.Process(pid), process, output


def stop(instance):
    browser, process, starter, output = instance
    try:
        browser.set_context('chrome')
        browser.execute_script('Services.tm.dispatchToMainThread(() => Services.startup.quit(Ci.nsIAppStartup.eForceQuit));')
        browser.delete_session(send_request=False)
        process.wait(timeout=30)
        starter.wait(timeout=15)
    finally:
        output.close()


def hashes(root):
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in root.rglob('*') if path.is_file() and path.name not in ['parent.lock', '.parentlock', 'lock']}


def run(package, zen, extension, output):
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}'
    instances = []
    temporary = tempfile.TemporaryDirectory(prefix='night-import-', ignore_cleanup_errors=True)
    try:
        root = Path(temporary.name)
        night = root / 'Night переезд'
        source = root / 'Zen личное'
        shutil.copytree(package, night)
        source.mkdir()
        source.joinpath('user.js').write_text('\n'.join(f'user_pref({json.dumps(key)}, {json.dumps(value)});' for key,value in {
            'marionette.port': 2829, 'browser.aboutwelcome.enabled': False, 'browser.preonboarding.enabled': False,
            'browser.bypassAutoTriggerActions': True, 'termsofuse.bypassNotification': True,
            'browser.shell.checkDefaultBrowser': False, 'zen.welcome-screen.seen': True,
            'browser.startup.page': 3, 'zen.workspaces.continue-where-left-off': True,
        }.items()))
        source_instance = start([zen, '-no-remote', '-profile', source], 2829, output/'zen-import-source.log')
        instances.append(source_instance)
        browser = source_instance[0]
        wait_for(lambda: browser.execute_script(f'return !!{WIN}?.gZenWorkspaces?.workspaceEnabled;'), timeout=60)
        browser.set_context('content')
        browser.navigate(url+'/original')
        browser.execute_script("document.cookie='night_fixture=cookie-value; Max-Age=86400; path=/'; localStorage.setItem('night-fixture','stored-value');")
        browser.set_context('chrome')
        result = browser.execute_async_script(f"""
          const done=arguments[arguments.length-1];
          (async()=>{{
            const {{PlacesUtils}}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
            await PlacesUtils.bookmarks.insert({{parentGuid:PlacesUtils.bookmarks.toolbarGuid,url:arguments[0]+'/bookmark',title:'Night import bookmark'}});
            const login=Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
            login.init('https://import.example.test','https://import.example.test',null,'fixture-user','fixture-password','user','pass');
            await Services.logins.addLoginAsync(login);
            const w={WIN};
            const space=await w.gZenWorkspaces.createAndSaveWorkspace('Night import work');
            const tab=w.gBrowser.addTrustedTab(arguments[0]+'/workspace');
            tab.setAttribute('zen-workspace-id',space.uuid);
            w.gBrowser.selectedTab=tab;
            return {{space:space.uuid,version:Services.appinfo.platformVersion}};
          }})().then(done,e=>done({{error:String(e)}}));
        """, script_args=[url])
        assert 'error' not in result, result
        Addons(browser).install(str(extension), temp=False)
        locked = subprocess.run([str(night/'Night.exe'), '--copy-zen', str(source), 'import-stage-'+'a'*32], timeout=30)
        assert locked.returncode != 0, 'Copy accepted an open Zen profile'
        assert not (night/('import-stage-'+'a'*32)).exists()
        stop(source_instance)
        instances.remove(source_instance)
        assert source.joinpath('zen-sessions.jsonlz4').exists(), 'Zen did not save its own session format'
        source.joinpath('chrome').mkdir(exist_ok=True)
        source.joinpath('chrome/userChrome.css').write_text('fixture: never load this in Night;')
        original = hashes(source)
        target_instance = start([night/'Night.exe'], 2828, output/'zen-import-target.log')
        instances.append(target_instance)
        target = target_instance[0]
        wait_for(lambda: target.execute_script(f'return !!{WIN}?.gNightBrowser;'))
        (night/'profile'/'keep-before-import.txt').write_text('preserve Night backup')
        target.execute_script("ChromeUtils.importESModule('resource:///modules/night/NightImport.sys.mjs');")
        prepared = target.execute_async_script("const done=arguments[arguments.length-1];const {NightImport}=ChromeUtils.importESModule('resource:///modules/night/NightImport.sys.mjs');NightImport.stage(arguments[0]).then(done,e=>done({error:String(e),stack:e.stack}));", script_args=[str(source)])
        (output/'zen-import-stage.json').write_text(json.dumps(prepared,ensure_ascii=False,indent=2),encoding='utf-8')
        assert 'error' not in prepared, prepared
        assert prepared['phase'] == 'ready' and prepared['tabs'] >= 2, prepared
        assert hashes(source) == original, 'Import modified source data'
        assert (night/'profile'/'keep-before-import.txt').exists(), 'Live Night profile changed before restart'
        target.set_context('content')
        target.navigate('about:preferences#import')
        wait_for(lambda: target.execute_script("return document.body.textContent.includes('Данные готовы к переносу');"))
        target.set_context('chrome')
        (output/'night-import-ready.png').write_bytes(base64.b64decode(target.screenshot()))
        stop(target_instance)
        instances.remove(target_instance)
        imported_instance = start([night/'Night.exe'], 2828, output/'zen-import-result.log')
        instances.append(imported_instance)
        imported = imported_instance[0]
        wait_for(lambda: imported.execute_script(f'return !!{WIN}?.gNightBrowser;'))
        state = imported.execute_async_script(f"""
          const done=arguments[arguments.length-1];
          (async()=>{{
            const {{PlacesUtils}}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
            const {{AddonManager}}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
            const bookmark=await PlacesUtils.bookmarks.fetch({{url:arguments[0]+'/bookmark'}});
            const logins=await Services.logins.getAllLogins();
            const addon=await AddonManager.getAddonByID('uBlock0@raymondhill.net');
            const w={WIN};
            return {{bookmark:bookmark?.title,login:logins.some(l=>l.username==='fixture-user'&&l.password==='fixture-password'),addon:!!addon?.isActive,spaces:w.gNightBrowser.shell.workspaces.items.map(x=>x.name),tabs:[...w.gBrowser.tabs].map(t=>t.linkedBrowser.currentURI.spec),zenStyle:Services.prefs.getBoolPref('toolkit.legacyUserProfileCustomizations.stylesheets',false),signatureRequired:Services.prefs.getBoolPref('xpinstall.signatures.required',true)}};
          }})().then(done,e=>done({{error:String(e)}}));
        """, script_args=[url])
        assert state['bookmark'] == 'Night import bookmark', state
        assert state['login'] and state['addon'] and state['signatureRequired'], state
        assert 'Night import work' in state['spaces'] and not state['zenStyle'], state
        imported.set_context('content')
        imported.navigate(url+'/restored')
        assert imported.execute_script("return document.cookie.includes('night_fixture=cookie-value') && localStorage.getItem('night-fixture')==='stored-value';")
        assert (night/prepared['backup']/'keep-before-import.txt').read_text() == 'preserve Night backup'
        assert not (night/'profile'/'chrome').exists()
        assert not (night/'profile'/'user.js').exists()
        assert hashes(source) == original
        stop(imported_instance)
        instances.remove(imported_instance)
        (output/'zen-import-result.json').write_text(json.dumps({'source':'Zen 1.24.2b','gecko':result['version'],'copied_files':prepared['files'],'tabs':prepared['tabs'],'workspaces':prepared['workspaces'],'source_unchanged':True,'backup_preserved':True,'password_decrypted':True,'cookies_and_storage':True,'signed_extension_active':True,'locked_source_rejected':True},indent=2))
        print('PASS: actual Zen profile; encrypted login, bookmark, cookies/localStorage, signed extension, workspaces and tabs; source unchanged, live-profile lock and Night backup',flush=True)
    finally:
        for instance in reversed(instances):
            try: stop(instance)
            except Exception: pass
        temporary.cleanup()
        server.shutdown()
        server.server_close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--package',type=Path,required=True)
    parser.add_argument('--zen',type=Path,required=True)
    parser.add_argument('--extension',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('test-artifacts'))
    args=parser.parse_args()
    run(args.package,args.zen,args.extension,args.output)
