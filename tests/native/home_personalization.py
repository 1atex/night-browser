import argparse,base64,json,os
from pathlib import Path
from marionette_driver.marionette import Marionette
from smoke import wait_for

def run(binary,app_ini,output):
 output.mkdir(parents=True,exist_ok=True)
 b=Marionette(bin=binary,headless=os.name!='nt',prefs={'night.onboarding.completed':True},app_args=['-app',app_ini],gecko_log=str(output/'home-personalization.log'))
 def chrome(script,*args):
  b.set_context('chrome');return b.execute_script('const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;'+script,script_args=list(args))
 def content(script,*args):
  handle=chrome('const {NavigableManager}=ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");return NavigableManager.getIdForBrowser(w.gBrowser.selectedBrowser);');b.set_context('content');b.switch_to_window(handle,focus=False);return b.execute_script(script,script_args=list(args))
 def add(name,url):
  content('document.getElementById("home-link-name").value=arguments[0];document.getElementById("home-link-url").value=arguments[1];document.getElementById("home-link-form").requestSubmit();',name,url)
 try:
  b.start_session();b.set_window_rect(width=1280,height=900);wait_for(lambda:chrome('return !!w.gNightBrowser;'))
  assert chrome('return w.gNightBrowser.shell.workspaces.items.map(i=>i.id);')==['personal']
  chrome('w.gNightBrowser.shell.workspaces.newTab();');wait_for(lambda:content('return document.activeElement?.id==="query"&&!!document.querySelector("[data-add-link]");'))
  assert content('return document.querySelectorAll("#home-shortcuts a").length===0&&document.getElementById("home-tabs").hidden&&document.getElementById("home-island").hidden;')
  content('document.querySelector("[data-add-link]").click();');add('Documentation','https://example.com/docs')
  wait_for(lambda:content('return document.querySelector("#home-shortcuts a")?.textContent.includes("Documentation");'))
  content('document.querySelector("[data-link-action=edit]").click();');add('Reference','https://example.com/reference')
  wait_for(lambda:content('return document.querySelector("#home-shortcuts a")?.href==="https://example.com/reference";'))
  add('Unsafe','javascript:alert(1)');assert content('return !document.getElementById("home-link-error").hidden&&document.querySelectorAll("#home-shortcuts a").length===1;')
  content('document.querySelector("[data-gradient=dusk]").click();');wait_for(lambda:content('return getComputedStyle(document.documentElement).backgroundImage.includes("radial-gradient");'))
  content('document.querySelector("[data-gradient=custom]").click();const first=document.getElementById("home-gradient-first");first.value="#285f91";first.dispatchEvent(new Event("input"));first.dispatchEvent(new Event("change"));const intensity=document.getElementById("home-gradient-intensity");intensity.value=24;intensity.dispatchEvent(new Event("input"));intensity.dispatchEvent(new Event("change"));')
  wait_for(lambda:chrome('return JSON.parse(Services.prefs.getStringPref("night.home.gradient")).intensity===24;'))
  chrome('w.gNightBrowser.shell.workspaces.newTab();');wait_for(lambda:content('return document.activeElement?.id==="query"&&document.querySelector("#home-shortcuts a")?.textContent.includes("Reference")&&document.documentElement.style.getPropertyValue("--home-first")==="#285f91";'))
  assert content('return getComputedStyle(document.documentElement).animationName==="none";')
  b.set_context('chrome');(output/'night-home-personalized.png').write_bytes(base64.b64decode(b.screenshot()))
  content('document.getElementById("home-customize").open=true;document.querySelector("[data-link-action=remove]").click();');wait_for(lambda:content('return document.querySelectorAll("#home-shortcuts a").length===0;'))
  b.restart(in_app=True);wait_for(lambda:chrome('return !!w.gNightBrowser;'));chrome('w.gNightBrowser.shell.workspaces.newTab();');wait_for(lambda:content('return document.documentElement.style.getPropertyValue("--home-first")==="#285f91"&&!!document.querySelector("[data-add-link]");'))
  result={'passed':True,'neutral_fresh_profile':True,'shortcut_add_edit_remove':True,'unsafe_shortcut_rejected':True,'custom_gradient_persists_across_tabs_and_restart':True,'static_background':True};(output/'home-personalization-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
 finally:b.cleanup();b.instance=None
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--app-ini',required=True);p.add_argument('--output',required=True,type=Path);a=p.parse_args();run(a.binary,a.app_ini,a.output)
