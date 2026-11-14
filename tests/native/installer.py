import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import winreg
from zen_import import start, stop, WIN
from smoke import wait_for


def run(setup, output):
    output.mkdir(parents=True, exist_ok=True)
    data = Path(os.environ['LOCALAPPDATA'])/'NightBrowser'
    if data.exists():
        raise RuntimeError('Installer test requires an isolated Windows account without Night data')
    with tempfile.TemporaryDirectory(prefix='Night установка ') as directory:
        app = Path(directory)/'Night Browser'
        instance = None
        installed = False
        try:
            command = [str(setup.resolve()), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', f'/DIR={app}', f'/LOG={output.resolve() / "installer.log"}']
            subprocess.run(command, check=True, timeout=180)
            installed = True
            assert (app/'installed.marker').exists()
            assert (app/'unins000.exe').exists()
            assert not (app/'profile').exists()
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\NightBrowserHTML\shell\open\command') as key:
                assert winreg.QueryValueEx(key, '')[0] == f'"{app / "Night.exe"}" --url "%1"'
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\RegisteredApplications') as key:
                assert winreg.QueryValueEx(key, 'Night Browser')[0].endswith('NightBrowser\\Capabilities')
            instance = start([app/'Night.exe'], 2828, output/'installed-gecko.log')
            browser = instance[0]
            wait_for(lambda: browser.execute_script(f'return !!{WIN}?.gNightBrowser;'))
            profile = Path(browser.execute_script('return Services.dirsvc.get("ProfD",Ci.nsIFile).path;'))
            assert profile == data/'profile', profile
            assert browser.execute_script(f'return {WIN}.gBrowser.selectedBrowser.currentURI.spec;').endswith('/welcome.xhtml')
            browser.execute_script('Services.prefs.setBoolPref("night.onboarding.completed",true);Services.prefs.savePrefFile(null);')
            (profile/'keep-test.txt').write_text('profile survives upgrade and removal')
            stop(instance)
            instance = None
            subprocess.run(command, check=True, timeout=180)
            assert (profile/'keep-test.txt').read_text() == 'profile survives upgrade and removal'
            page = Path(directory)/'страница.html'
            page.write_text('<!doctype html><title>Installed URL handler</title><p>Local file</p>')
            instance = start([app/'Night.exe', '--url', page.as_uri()], 2828, output/'installed-url-gecko.log')
            browser = instance[0]
            wait_for(lambda: browser.execute_script(f'return [...{WIN}.gBrowser.tabs].some(t=>t.linkedBrowser.currentURI.spec===arguments[0]);', script_args=[page.as_uri()]))
            assert browser.execute_script('return Services.prefs.getBoolPref("night.onboarding.completed");')
            stop(instance)
            instance = None
            subprocess.run([str(app/'unins000.exe'), '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART'],check=True,timeout=90)
            wait_for(lambda: not (app/'Night.exe').exists(),timeout=30)
            assert (profile/'keep-test.txt').exists()
            try:
                winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Classes\NightBrowserHTML')
                raise AssertionError('Uninstall left browser registration')
            except FileNotFoundError:
                pass
            installed = False
            (output/'installer-result.json').write_text(json.dumps({'per_user_install':True,'url_registration':True,'profile_outside_app':True,'upgrade_preserves_profile':True,'unicode_url_launch':True,'uninstall_preserves_profile':True}))
            print('PASS: installer, registration, independent profile, upgrade, URL launch and uninstall',flush=True)
        finally:
            if instance:
                stop(instance)
            if installed and (app/'unins000.exe').exists():
                subprocess.run([str(app/'unins000.exe'),'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART'],timeout=90)
            shutil.rmtree(data,ignore_errors=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--setup',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('test-artifacts'))
    args=parser.parse_args()
    run(args.setup,args.output)
