import argparse,base64,json,time
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

PAGES=['about:addons','about:logins','about:downloads','about:preferences','about:processes','about:support','about:config','about:privatebrowsing','about:sessionrestore','about:neterror?e=dnsNotFound&u=https%3A//example.invalid/&d=Not%20found','chrome://browser/content/preferences/advanced.xhtml']

def run(binary,app_ini,output):
    output.mkdir(parents=True,exist_ok=True)
    b=Marionette(bin=binary,headless=True,prefs={'night.onboarding.completed':True},app_args=['-app',app_ini],gecko_log=str(output/'surfaces-gecko.log'))
    def chrome(script,*args):
        b.set_context('chrome');return b.execute_script("const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;"+script,script_args=list(args))
    def content(script,*args):
        b.set_context('content');return b.execute_script(script,script_args=list(args))
    def shot(name):
        b.set_context('chrome');(output/name).write_bytes(base64.b64decode(b.screenshot()))
    result={}
    try:
        b.start_session();b.set_window_rect(width=1280,height=900)
        wait_for(lambda:chrome('return !!w.gNightBrowser;'))
        for index,page in enumerate(PAGES):
            b.set_context('content')
            try:b.navigate(page)
            except Exception as error:
                if 'Reached error page' not in str(error):raise
            wait_for(lambda:content('return document.documentElement.hasAttribute("night-surface");'))
            chrome('Services.prefs.setStringPref("night.ui.palette","midnight");')
            wait_for(lambda:content('return document.documentElement.dataset.palette==="midnight";'))
            colors=content('const r=document.documentElement,c=getComputedStyle(r);return {background:c.backgroundColor,font:c.fontFamily,accent:c.getPropertyValue("--color-accent-primary"),title:document.title};')
            assert colors['background']=='rgb(19, 27, 39)',(page,colors)
            assert 'Segoe UI' in colors['font'],(page,colors)
            chrome('Services.prefs.setStringPref("night.ui.palette","night");')
            wait_for(lambda:content('return getComputedStyle(document.documentElement).backgroundColor==="rgb(16, 16, 18)";'))
            if page=='about:logins':
                assert content('const root=document.querySelector("login-intro").shadowRoot;return getComputedStyle(root.querySelector(".illustration")).display==="none"&&!root.querySelector("[data-l10n-id=login-intro-instructions-fxa2]");')
            if page=='about:config':assert content('return !!document.querySelector("#warningButton");')
            result[page]=colors
            shot(f'night-surface-{index+1}.png')
        b.set_context('content');b.navigate('data:text/html,<title>Web content</title><p>Unmodified website</p>')
        assert content('return !document.documentElement.hasAttribute("night-surface")&&!getComputedStyle(document.documentElement).getPropertyValue("--night-page");')
        chrome('w.gFindBarPromise.then(bar=>bar.open());')
        wait_for(lambda:chrome('return w.gFindBar&&!w.gFindBar.hidden;'))
        assert chrome('return getComputedStyle(w.gFindBar).backgroundColor==="rgb(32, 32, 35)";')
        shot('night-findbar.png')
        chrome('w.gFindBar.close();w.gNightBrowser.toggle("network");')
        wait_for(lambda:chrome('return !!d.getElementById("night-tools");'))
        assert chrome('return getComputedStyle(d.getElementById("night-tools")).backgroundColor==="rgb(32, 32, 35)";')
        shot('night-workbench.png')
        chrome('w.gNightBrowser.close();')
        assert chrome('return ![...d.querySelectorAll("link")].some(link=>link.href.endsWith("/workbench.css"));')
        for name,command,uri in [
            ('library','w.PlacesCommandHook.showPlacesOrganizer("AllBookmarks");','chrome://browser/content/places/places.xhtml'),
            ('page-info','w.BrowserCommands.pageInfo();','chrome://browser/content/pageinfo/pageInfo.xhtml'),
            ('about','w.openDialog("chrome://browser/content/aboutDialog.xhtml", "", "chrome,centerscreen");','chrome://browser/content/aboutDialog.xhtml'),
        ]:
            chrome(command)
            wait_for(lambda:chrome('return [...Services.wm.getEnumerator(null)].some(win=>win.document.documentURI===arguments[0]&&win.document.documentElement.hasAttribute("night-surface"));',uri))
            state=chrome('const win=[...Services.wm.getEnumerator(null)].find(win=>win.document.documentURI===arguments[0]);return {background:win.getComputedStyle(win.document.documentElement).backgroundColor,font:win.getComputedStyle(win.document.documentElement).fontFamily};',uri)
            assert state['background']=='rgb(16, 16, 18)',(name,state)
            result[name]=state
            chrome('const win=[...Services.wm.getEnumerator(null)].find(win=>win.document.documentURI===arguments[0]);win.close();',uri)
        chrome('w.focus();')
        b.set_context('chrome')
        devtools=b.execute_async_script('''const done=arguments[arguments.length-1];(async()=>{
          const w=Services.wm.getMostRecentWindow('navigator:browser');
          const {DevToolsShim}=ChromeUtils.importESModule('chrome://devtools-startup/content/DevToolsShim.sys.mjs');
          const toolbox=await DevToolsShim.showToolboxForTab(w.gBrowser.selectedTab,{toolId:'webconsole'});
          w.surfaceToolbox=toolbox;
          return {surface:toolbox.doc.documentElement.hasAttribute('night-surface'),url:toolbox.doc.documentURI};
        })().then(done,e=>done({error:String(e)}));''')
        assert devtools.get("surface") is True,devtools
        shot('night-devtools.png')
        chrome('w.surfaceToolbox.destroy();delete w.surfaceToolbox;')
        result['devtools']=True
        result['website_untouched']=True;result['workbench_sheet_released']=True;result['passed']=True
        (output/'surfaces-result.json').write_text(json.dumps(result,indent=2,ensure_ascii=False));print('PASS: native surfaces follow Night palette, website styles untouched, workbench sheet released')
    finally:
        if not (output/'surfaces-result.json').exists():
            try:shot('surfaces-failure.png')
            except Exception:pass
        b.cleanup();b.instance=None

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.binary,a.app_ini,a.output)
