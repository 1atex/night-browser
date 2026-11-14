import argparse
import base64
import json
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

WIN = "Services.wm.getMostRecentWindow('navigator:browser')"
WELCOME = 'chrome://browser/content/night/welcome.xhtml'


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    browser = Marionette(prefs={"browser.startup.preXulSkeletonUI": True}, bin=binary, headless=True, app_args=['-app', app_ini], gecko_log=str(output/'onboarding-gecko.log'))
    def chrome(script):
        browser.set_context('chrome')
        return browser.execute_script(f'const w={WIN},d=w.document,b=w.gBrowser;' + script)
    def page(script):
        browser.set_context('content')
        return browser.execute_script(script)
    try:
        browser.start_session()
        browser.set_window_rect(width=1440, height=960)
        wait_for(lambda: chrome(f'return !!w.gNightBrowser && b.selectedBrowser.currentURI.spec==="{WELCOME}";'))
        wait_for(lambda: page('return !!document.querySelector("#next")?.onclick;'))
        assert chrome('return d.documentElement.hasAttribute("night-browser")&&!d.documentElement.hasAttribute("night-starting");')
        assert not chrome('return Services.prefs.getBoolPref("browser.startup.preXulSkeletonUI");')
        (output/'night-onboarding.png').write_bytes(base64.b64decode(browser.screenshot()))
        page('document.querySelector("[data-palette=graphite]").click();document.querySelector("#layout").value="top";document.querySelector("#layout").dispatchEvent(new Event("change"));document.querySelector("#next").click();')
        assert page('return !document.querySelector("#migration").hidden&&document.querySelector("#import").disabled;')
        page('document.querySelector("#skip").click();')
        assert page('return !document.querySelector("#ready").hidden;')
        page('document.querySelector("#finish").click();')
        wait_for(lambda: chrome('return b.selectedBrowser.currentURI.spec==="about:home";'))
        assert chrome('return Services.prefs.getBoolPref("night.onboarding.completed")&&Services.prefs.getStringPref("night.ui.palette")==="graphite"&&Services.prefs.getStringPref("night.ui.navigation-layout")==="top";')
        if chrome('return Services.appinfo.OS==="WINNT";'):
            chrome('Services.prefs.setStringPref("night.ui.navigation-layout","sidebar");')
            rect = chrome('return d.querySelector("#night-window-controls").getBoundingClientRect().toJSON();')
            assert rect['x'] > 1200 and rect['y'] <= 5, rect
            browser.actions.sequence('pointer','caption').pointer_move(x=700,y=400,origin='viewport').perform()
            wait_for(lambda: chrome('return w.getComputedStyle(d.querySelector("#night-window-controls > div, #night-window-controls > .night-caption-buttons")).opacity==="0";'))
            browser.actions.sequence('pointer','caption').pointer_move(x=round(rect['x']+30),y=3,origin='viewport').perform()
            wait_for(lambda: chrome('return w.getComputedStyle(d.querySelector("#night-window-controls > .night-caption-buttons")).opacity==="1";'))
            assert chrome('return d.querySelector("#night-window-controls [data-action=close]").getBoundingClientRect().width>0;')
            (output/'night-window-controls.png').write_bytes(base64.b64decode(browser.screenshot()))
            chrome('Services.prefs.setBoolPref("night.ui.window-controls-autohide",false);')
            browser.actions.sequence('pointer','caption').pointer_move(x=700,y=400,origin='viewport').perform()
            assert chrome('return w.getComputedStyle(d.querySelector("#night-window-controls > .night-caption-buttons")).opacity==="1";')
        browser.restart(in_app=True)
        wait_for(lambda: chrome('return !!w.gNightBrowser;'))
        assert chrome(f'return ![...b.tabs].some(t=>t.linkedBrowser.currentURI.spec==="{WELCOME}")&&Services.prefs.getBoolPref("night.onboarding.completed");')
        (output/'onboarding-result.json').write_text(json.dumps({'first_run':True,'choices_persist':True,'import_requires_consent':True,'completed_once':True,'controls_hover_and_always_visible':chrome('return Services.appinfo.OS==="WINNT";')}))
        print('PASS: first-run choices, import consent, completion and restart', flush=True)
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
