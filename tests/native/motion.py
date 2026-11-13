import argparse
import json
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for


def run(binary, app_ini, output):
    output.mkdir(parents=True, exist_ok=True)
    browser=Marionette(bin=binary,headless=True,app_args=['-app',app_ini],gecko_log=str(output/'motion-gecko.log'))
    try:
        browser.start_session()
        browser.set_context('chrome')
        wait_for(lambda:browser.execute_script("return !!Services.wm.getMostRecentWindow('navigator:browser')?.gNightBrowser;"))
        result=browser.execute_async_script("""
          const done=arguments[arguments.length-1];
          (async()=>{
            const w=Services.wm.getMostRecentWindow('navigator:browser'),s=w.gNightBrowser.shell;
            Services.prefs.setBoolPref('night.ui.animations',true);
            Services.prefs.setIntPref('ui.prefersReducedMotion',0);
            await new Promise(r=>w.setTimeout(r,350));
            const active=()=>w.document.getElementById('night-sidebar').getAnimations({subtree:true}).filter(a=>a.playState==='running').length;
            const tab=s.workspaces.newTab('about:blank');s.render();
            const opening=active();
            await new Promise(r=>w.setTimeout(r,350));
            const idle=active();
            const item=s.workspaces.create('Motion');s.render();
            const switching=active();
            await new Promise(r=>w.setTimeout(r,350));
            Services.prefs.setBoolPref('night.ui.animations',false);
            s.workspaces.newTab('about:blank');s.render();
            const disabled=active();
            Services.prefs.setBoolPref('night.ui.animations',true);
            Services.prefs.setIntPref('ui.prefersReducedMotion',1);
            await new Promise(r=>w.setTimeout(r,50));
            s.workspaces.newTab('about:blank');s.render();
            const reduced=active();
            Services.prefs.clearUserPref('ui.prefersReducedMotion');
            return {opening,idle,switching,disabled,reduced};
          })().then(done,e=>done({error:String(e)}));
        """)
        assert result['opening']>0 and result['switching']>0,result
        assert result['idle']==0 and result['disabled']==0 and result['reduced']==0,result
        (output/'motion.json').write_text(json.dumps(result,indent=2))
        print('PASS: tab/workspace motion runs only during interactions; no idle animations; disabled and reduced-motion modes respected',flush=True)
    finally:
        browser.cleanup();browser.instance=None


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--binary',required=True)
    parser.add_argument('--app-ini',required=True)
    parser.add_argument('--output',type=Path,default=Path('test-artifacts'))
    args=parser.parse_args();run(args.binary,args.app_ini,args.output)
