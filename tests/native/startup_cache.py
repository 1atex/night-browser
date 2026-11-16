import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/preview'))
from omnijar import read_jar, write_jar
from zen_import import start, stop, WIN
from smoke import wait_for


def run(package, output):
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='Night cache ') as directory:
        app = Path(directory) / 'Night'
        shutil.copytree(package, app)
        (app / 'installed.marker').unlink(missing_ok=True)
        profile = app / 'profile'
        profile.mkdir()
        (profile / 'user.js').write_text('user_pref("night.onboarding.completed",true);\nuser_pref("marionette.port",2829);\n')
        (profile / 'keep-test.txt').write_text('Keep profile data across cache recovery')
        jar = app / 'runtime/browser/omni.ja'
        original = jar.read_bytes()
        entries = read_jar(jar)
        entries['chrome/browser/content/browser/night/bootstrap.js'] = b'window.nightLegacyCacheFixture = true;\n' + entries['chrome/browser/content/browser/night/bootstrap.js']
        entries['modules/night/NightWindows.sys.mjs'] = b'export const NightWindows = { init() {} };\n'
        write_jar(jar, entries)
        marker = profile / 'night-runtime.json'
        revision = json.loads((app / 'BUILD.json').read_text())['night_revision']
        binary = app / 'runtime/NightBrowser.exe'
        direct = [binary, '-app', app / 'runtime/browser/application.ini', '-profile', profile]
        instance = None
        def launch(command, label):
            nonlocal instance
            instance = start(command, 2829, output / (label + '-gecko.log'))
            b = instance[0]
            wait_for(lambda: b.execute_script(f'return !!{WIN}.gNightBrowser;'))
            return b
        def close():
            nonlocal instance
            stop(instance)
            instance = None
        def legacy(b):
            return b.execute_script(f'return !!{WIN}.nightLegacyCacheFixture;')
        try:
            b = launch(direct + ['-purgecaches'], 'cache-seed')
            assert legacy(b)
            b.execute_script('Services.prefs.setStringPref("night.test.saved-value","preserved");Services.prefs.savePrefFile(null);')
            b.execute_async_script('const done=arguments[arguments.length-1];ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs").PlacesUtils.bookmarks.insert({parentGuid:"unfiled_____",url:"https://example.invalid/preserved",title:"Preserved bookmark"}).then(()=>done(true),e=>done(String(e)));')
            time.sleep(12)
            close()
            assert not marker.exists()
            temporary = jar.with_suffix('.new')
            temporary.write_bytes(original)
            temporary.replace(jar)
            b = launch(direct, 'cache-stale')
            assert legacy(b), 'Fixture did not reproduce a stale startup cache'
            close()
            b = launch([app / 'Night.exe'], 'cache-recovered')
            assert not legacy(b), 'Launcher reused stale interface code'
            assert '-purgecaches' in instance[1].cmdline()
            wait_for(lambda: marker.exists() and json.loads(marker.read_text())['revision'] == revision)
            assert b.execute_script('return Services.prefs.getStringPref("night.test.saved-value");') == 'preserved'
            bookmark = b.execute_async_script('const done=arguments[arguments.length-1];ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs").PlacesUtils.bookmarks.fetch({url:"https://example.invalid/preserved"}).then(value=>done(value?.title),e=>done(String(e)));')
            assert bookmark == 'Preserved bookmark', bookmark
            close()
            previous_write = marker.stat().st_mtime_ns
            b = launch([app / 'Night.exe'], 'cache-normal')
            assert not legacy(b)
            assert '-purgecaches' not in instance[1].cmdline()
            assert marker.stat().st_mtime_ns == previous_write
            close()
            marker.write_text(json.dumps({'revision': '0' * 40, 'application': str(binary)}))
            b = launch([app / 'Night.exe'], 'cache-next-build')
            assert '-purgecaches' in instance[1].cmdline()
            wait_for(lambda: json.loads(marker.read_text())['revision'] == revision)
            close()
            assert (profile / 'keep-test.txt').read_text() == 'Keep profile data across cache recovery'
            (output / 'startup-cache-result.json').write_text(json.dumps({'stale_cache_reproduced': True, 'first_launcher_start_recovers': True, 'loaded_revision_acknowledged': True, 'ordinary_restart_retains_cache': True, 'changed_revision_purges_once': True, 'profile_preserved': True}))
            print('PASS: stale UI cache reproduced, launcher recovers once and preserves profile and subsequent startup cache', flush=True)
        finally:
            if instance:
                stop(instance)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--package', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    run(a.package, a.output)
