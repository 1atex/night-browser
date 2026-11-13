import argparse
import ctypes
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from marionette_driver.marionette import Marionette

from smoke import wait_for


def run(launcher):
    with tempfile.TemporaryDirectory(prefix="night-launcher-") as temporary:
        package = Path(temporary) / "Night проверка пути"
        shutil.copytree(launcher.resolve().parent, package)
        environment = {**os.environ, "MOZ_HEADLESS": "1", "MOZ_MARIONETTE": "1"}
        process = subprocess.Popen([str(package / "Night.exe")], env=environment)
        browser = Marionette(host="127.0.0.1", port=2828)
        connected = False
        handle = None
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        try:
            assert process.wait(timeout=15) == 0
            browser.raise_for_port(timeout=60)
            browser.start_session()
            connected = True
            browser.set_context("chrome")
            wait_for(lambda: browser.execute_script("return !!Services.wm.getMostRecentWindow('navigator:browser')?.gNightBrowser;"), timeout=45)
            state = browser.execute_script("""
              return {name: Services.appinfo.name, profile: Services.dirsvc.get("ProfD", Ci.nsIFile).path, pid: Services.appinfo.processID};
            """)
            handle = kernel.OpenProcess(0x00100000, False, state["pid"])
            assert state["name"] == "Night", state
            assert Path(state["profile"]).resolve() == (package / "profile").resolve(), state
            print("PASS: Night.exe launches Night with its own portable profile from a Unicode path", flush=True)
        finally:
            if connected:
                browser.execute_script("Services.tm.dispatchToMainThread(() => Services.startup.quit(Ci.nsIAppStartup.eForceQuit));")
                browser.delete_session(send_request=False)
            if handle:
                try:
                    assert kernel.WaitForSingleObject(handle, 15000) == 0, "Night did not close"
                finally:
                    kernel.CloseHandle(handle)
            browser.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", type=Path, required=True)
    run(parser.parse_args().launcher)
