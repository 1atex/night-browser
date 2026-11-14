import argparse
import json
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    browser = Marionette(bin=binary, headless=True, app_args=['-app',app_ini],gecko_log=str(output/'preallocation-gecko.log'))
    try:
        browser.start_session()
        browser.set_context('chrome')
        browser.timeout.script=30
        wait_for(lambda: browser.execute_script("return !!Services.wm.getMostRecentWindow('navigator:browser')?.gNightBrowser;"))
        assert browser.execute_script("return Services.prefs.getIntPref('dom.ipc.processPrelaunch.fission.number');") == 1
        def count():
            return browser.execute_async_script("const done=arguments[arguments.length-1];ChromeUtils.requestProcInfo().then(p=>done(p.children.filter(c=>c.type==='preallocated').length));")
        wait_for(lambda: count()==1)
        browser.set_context('content')
        browser.navigate('about:preferences#memory')
        wait_for(lambda: browser.execute_script("return !!document.querySelector('[data-pref=\"dom.ipc.processPrelaunch.enabled\"]');"))
        browser.execute_script("document.querySelector('[data-pref=\"dom.ipc.processPrelaunch.enabled\"]').click();")
        browser.set_context('chrome')
        wait_for(lambda: count()==0)
        assert not browser.execute_script("return Services.prefs.getBoolPref('dom.ipc.processPrelaunch.enabled');")
        browser.restart(in_app=True)
        browser.set_context('chrome')
        assert not browser.execute_script("return Services.prefs.getBoolPref('dom.ipc.processPrelaunch.enabled');")
        assert count()==0
        browser.execute_script("Services.prefs.setBoolPref('dom.ipc.processPrelaunch.enabled',true);")
        wait_for(lambda: count()==1)
        (output/'preallocation-result.json').write_text(json.dumps({'default_reserve':1,'disabled_reserve':0,'setting_survives_restart':True,'reenabled_reserve':1},indent=2))
        print('PASS: one preallocated process, settings switch removes reserve, restart and reenable',flush=True)
    finally:
        browser.cleanup()
        browser.instance=None


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--binary',required=True)
    parser.add_argument('--app-ini',required=True)
    parser.add_argument('--output',type=Path,default=Path('test-artifacts'))
    args=parser.parse_args()
    run(args.binary,args.app_ini,args.output)
