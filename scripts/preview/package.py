import argparse
import configparser
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

from omnijar import read_jar, write_jar

ROOT = Path(__file__).resolve().parents[2]
PIN = json.loads((Path(__file__).parent / "runtime.json").read_text())


def replace_once(entries, name, before, after):
    content = entries[name].decode("utf-8")
    if content.count(before) != 1:
        raise ValueError(f"Unexpected integration point: {name}")
    entries[name] = content.replace(before, after).encode("utf-8")


def package(runtime, output, archive, platform):
    digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    if digest != PIN[platform]["sha256"]:
        raise ValueError("Upstream archive checksum mismatch")
    config = configparser.ConfigParser(interpolation=None)
    config.optionxform = str
    config.read(runtime / "application.ini")
    if config["App"]["SourceStamp"] != PIN["revision"] or config["Gecko"]["MaxVersion"] != PIN["gecko"]:
        raise ValueError("Upstream runtime does not match the source revision")
    if output.exists():
        raise ValueError(f"Output must be a new directory: {output}")
    output.mkdir(parents=True)
    target = output / "runtime"
    shutil.copytree(runtime, target)
    browser = read_jar(target / "browser/omni.ja")
    toolkit = read_jar(target / "omni.ja")
    source = ROOT / "src/zen/night"
    for module in source.glob("*.mjs"):
        browser[f"modules/night/{module.name}"] = module.read_bytes()
    browser["chrome/browser/content/browser/night/night.css"] = (source / "night.css").read_bytes()
    browser["chrome/browser/content/browser/ZenPreloadedScripts.js"] = (ROOT / "src/zen/common/ZenPreloadedScripts.js").read_bytes()
    browser["chrome/browser/content/browser/ZenStartup.mjs"] = (ROOT / "src/zen/common/modules/ZenStartup.mjs").read_bytes()
    replace_once(browser, "chrome/browser/content/browser/browser.xhtml",
                 '<script type="text/javascript" src="chrome://browser/content/ZenPreloadedScripts.js"></script>',
                 '<link rel="stylesheet" type="text/css" href="chrome://browser/content/night/night.css" />\n'
                 '<script type="text/javascript" src="chrome://browser/content/ZenPreloadedScripts.js"></script>')
    replace_once(toolkit, "moz-src/browser/components/tabbrowser/TabUnloader.sys.mjs",
                 "tab.undiscardable || tab.selected || tab.zenModeActive",
                 "tab.undiscardable || tab.selected || tab.linkedBrowser?.zenModeActive || tab.ownerGlobal?.gNightBrowser?.memory.shouldKeepLoaded(tab)")
    for name, data in list(browser.items()):
        if name.endswith("/branding/brand.ftl") or name.endswith("/branding/brand.properties"):
            text = data.decode("utf-8")
            text = re.sub(r"(?m)^(-?brand(?:ShorterName|ShortName|FullName|ProductName|-shorter-name|-short-name|-full-name|-product-name)\s*=).*$", r"\1 Night", text)
            text = re.sub(r"(?m)^(-?vendor(?:ShortName|-short-name)\s*=).*$", r"\1 Night", text)
            browser[name] = text.encode("utf-8")
    defaults = {}
    current = None
    for line in (ROOT / "prefs/zen/night.yaml").read_text().splitlines():
        if line.startswith("- name: "):
            current = line.removeprefix("- name: ")
        elif line.startswith("  value: "):
            defaults[current] = json.loads(line.removeprefix("  value: "))
    defaults.update({
        "night.preview": True,
        "night.network.enabled": True,
        "zen.welcome-screen.seen": True,
        "browser.aboutwelcome.enabled": False,
        "browser.shell.checkDefaultBrowser": False,
        "browser.startup.homepage": "about:blank",
        "browser.startup.homepage_override.mstone": "ignore",
        "browser.startup.firstrunSkipsHomepage": False,
        "app.update.auto": False,
    })
    browser["defaults/preferences/night.js"] = "\n".join(
        f"pref({json.dumps(name)}, {json.dumps(value)});" for name, value in defaults.items()
    ).encode()
    write_jar(target / "browser/omni.ja", browser)
    write_jar(target / "omni.ja", toolkit)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    config["App"].update({"Name": "Night", "Vendor": "Night", "RemotingName": "night-preview",
                          "Profile": "NightPreview", "Version": "0.1.0a1",
                          "SourceRepository": "https://github.com/1atex/night-browser", "SourceStamp": revision})
    config["AppUpdate"]["URL"] = "https://updates.invalid/"
    config["XRE"]["EnableProfileMigrator"] = "0"
    with (target / "browser/application.ini").open("w", encoding="utf-8") as stream:
        config.write(stream, space_around_delimiters=False)
    distribution = target / "distribution"
    distribution.mkdir(exist_ok=True)
    (distribution / "policies.json").write_text(json.dumps({"policies": {
        "DisableAppUpdate": True, "DontCheckDefaultBrowser": True, "DisableTelemetry": True,
    }}, indent=2))
    shutil.copy2(ROOT / "LICENSE", output / "LICENSE")
    (output / "BUILD.json").write_text(json.dumps({
        "night_revision": revision, "upstream": PIN, "platform": platform,
        "type": "Night preview using an unchanged prebuilt Zen native engine and Night chrome modules",
        "source": f"https://github.com/1atex/night-browser/tree/{revision}",
    }, indent=2))
    (output / "README.txt").write_text(
        "Night Browser 0.1 Preview\n\n"
        "Распакуй всю папку в доступное для записи место и запусти Night.exe.\n"
        "Профиль хранится в папке profile рядом с Night.exe.\n"
        "Night → Память: таймер выгрузки и исключения.\n"
        "Night → Запросы: захват и перехват включаются кнопкой Начать.\n\n"
        "Это тестовая portable-версия. Автоматическое обновление отключено.\n"
        "Нативное ядро: Zen 1.24.2b / Gecko 160.0, без изменений бинарного кода.\n"
        "Интерфейс и модули Night упакованы из исходников этого репозитория.\n"
        "Некоторые значки и системные сведения пока сохраняют брендинг Zen.\n"
        "Night: https://github.com/1atex/night-browser\n"
        "Upstream source: https://github.com/zen-browser/desktop/tree/" + PIN["revision"] + "\n",
        encoding="utf-8-sig")
    print(f"Packaged Night preview: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--platform", choices=["windows_x64", "linux_x64"], required=True)
    args = parser.parse_args()
    package(args.runtime, args.output, args.archive, args.platform)
