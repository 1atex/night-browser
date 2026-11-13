import argparse
import base64
import json
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    browser = Marionette(bin=binary, headless=True, app_args=['-app', app_ini], gecko_log=str(output / 'settings-gecko.log'), startup_timeout=60)
    try:
        browser.start_session()
        browser.set_window_rect(width=1440, height=960)
        browser.timeout.script = 30
        browser.set_context('chrome')
        wait_for(lambda: browser.execute_script("return !!Services.wm.getMostRecentWindow('navigator:browser')?.gNightBrowser;"))
        assert browser.execute_script("return Services.appinfo.appBuildID !== Services.appinfo.platformBuildID;")
        defaults = json.loads((Path(__file__).resolve().parents[2] / 'config/preferences.json').read_text())
        actual = browser.execute_script("""
          const branch = Services.prefs.getDefaultBranch('');
          return Object.fromEntries(Object.entries(arguments[0]).map(([key,value]) =>
            [key, typeof value === 'boolean' ? branch.getBoolPref(key) :
              typeof value === 'number' ? branch.getIntPref(key) : branch.getStringPref(key)]));
        """, script_args=[defaults])
        assert actual == defaults, {key: {'expected': value, 'actual': actual.get(key)} for key, value in defaults.items() if actual.get(key) != value}
        browser.set_context('content')
        browser.navigate('about:preferences#appearance')
        wait_for(lambda: browser.execute_script("return document.querySelector('h1')?.textContent === 'Внешний вид';"))
        browser.execute_script("document.querySelector('[data-palette=midnight]').click(); document.querySelector('[data-pref=\"night.ui.density\"]').value = 'compact'; document.querySelector('[data-pref=\"night.ui.density\"]').dispatchEvent(new Event('change'));")
        browser.set_context('chrome')
        state = browser.execute_script("const r = Services.wm.getMostRecentWindow('navigator:browser').document.documentElement; return {palette:r.getAttribute('night-palette'),density:r.getAttribute('night-density')};")
        assert state == {'palette':'midnight','density':'compact'}, state
        browser.set_context('content')
        browser.execute_script("document.querySelector('[data-palette=graphite]').click();")
        browser.set_context('chrome')
        browser.execute_async_script("const done=arguments[arguments.length-1];setTimeout(done,350);")
        (output / 'night-appearance.png').write_bytes(base64.b64decode(browser.screenshot()))
        browser.execute_script("Services.wm.getMostRecentWindow('navigator:browser').document.getElementById('night-tools-button').click();")
        browser.set_context('content')
        wait_for(lambda: browser.execute_script("return location.hash === '#memory' && !!document.querySelector('#idle-minutes');"))
        browser.execute_script("const input=document.getElementById('idle-minutes');input.value=7;input.dispatchEvent(new Event('change'));document.getElementById('site-exception').value='chatgpt.com';document.querySelector('.add-site').requestSubmit();")
        assert browser.execute_script("return document.querySelector('.metrics > :last-child strong').textContent;") == '7'
        browser.set_context('chrome')
        state = browser.execute_script("return {minutes:Services.prefs.getIntPref('night.memory.idle-minutes'),sites:Services.prefs.getStringPref('night.memory.excluded-sites')};")
        assert state['minutes'] == 7 and 'chatgpt.com' in state['sites'], state
        (output / 'night-memory.png').write_bytes(base64.b64decode(browser.screenshot()))
        browser.execute_script("Services.wm.getMostRecentWindow('navigator:browser').gNightBrowser.toggle('network');")
        (output / 'night-network.png').write_bytes(base64.b64decode(browser.screenshot()))
        browser.execute_script("Services.wm.getMostRecentWindow('navigator:browser').gNightBrowser.close();")
        browser.set_context('content')
        for section in ['tabs','privacy','search','import','about']:
            browser.navigate('about:preferences#'+section)
            wait_for(lambda: browser.execute_script("return document.querySelectorAll('#content .card').length > 0;"))
            if section == 'search': wait_for(lambda: browser.execute_script("return document.querySelector('#search-engine')?.options.length > 0;"))
            assert browser.execute_script("return document.querySelector('#status').textContent;") == ''
            if section == 'import':
                browser.set_context('chrome')
                browser.execute_async_script("const done=arguments[arguments.length-1];setTimeout(done,350);")
                (output / 'night-import.png').write_bytes(base64.b64decode(browser.screenshot()))
                browser.set_context('content')
        browser.navigate('about:preferences#appearance')
        wait_for(lambda: browser.execute_script("return !!document.querySelector('.theme-grid');"))
        browser.set_window_rect(width=980,height=760)
        assert browser.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;")
        browser.set_context('chrome')
        assert browser.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser');const r=w.document.getElementById('night-sidebar').getBoundingClientRect();return r.x>=0 && r.width>=196;")
        (output / 'night-small-window.png').write_bytes(base64.b64decode(browser.screenshot()))
        browser.set_context('content')
        browser.navigate('chrome://browser/content/preferences/advanced.xhtml#privacy')
        wait_for(lambda: browser.execute_script("return !!document.querySelector('#categories');"))
        assert browser.execute_script("return !document.querySelector('parsererror');")
        print('PASS: Night settings, live palette/density, memory persistence, every settings section, small-window layout and advanced preferences',flush=True)
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
