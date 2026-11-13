import argparse
import configparser
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from omnijar import read_jar, write_jar
from windows_brand import brand_runtime

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
    if platform == "windows_x64":
        executable = target / "NightBrowser.exe"
        (target / "firefox.exe").rename(executable)
        brand_runtime(executable, ROOT / "src/night/branding/night.ico")
    browser = read_jar(target / "browser/omni.ja")
    toolkit = read_jar(target / "omni.ja")
    if any("ZenStartup" in name or "ZenPreloadedScripts" in name for name in browser):
        raise ValueError("Night requires an unmodified Firefox runtime")
    source = ROOT / "src/night"
    for module in source.glob("*.mjs"):
        browser[f"modules/night/{module.name}"] = module.read_bytes()
    for file in source.rglob("*"):
        if file.is_file() and file.suffix != ".mjs":
            browser[f"chrome/browser/content/browser/night/{file.relative_to(source).as_posix()}"] = file.read_bytes()
    preferences = "chrome/browser/content/browser/preferences/"
    browser[preferences + "advanced.xhtml"] = browser[preferences + "preferences.xhtml"]
    replace_once(browser, preferences + "advanced.xhtml", "</head>", '<link rel="stylesheet" href="chrome://browser/content/night/advanced.css" /></head>')
    browser[preferences + "preferences.xhtml"] = (source / "settings.xhtml").read_bytes()
    replace_once(browser, "chrome/browser/content/browser/browser.xhtml", "</head>",
                 '<link rel="stylesheet" href="chrome://browser/content/night/night.css" />\n'
                 '<script src="chrome://browser/content/night/bootstrap.js" defer="defer"></script>\n</head>')
    replace_once(toolkit, "moz-src/browser/components/tabbrowser/TabUnloader.sys.mjs",
                 "tab.undiscardable || tab.selected",
                 "tab.undiscardable || tab.selected || tab.ownerDocument?.defaultView?.gNightBrowser?.memory.shouldKeepLoaded(tab)")
    newtab = "chrome/browser/builtin-addons/newtab/prerendered/"
    for name in ["activity-stream.html", "activity-stream-noscripts.html"]:
        if newtab + name not in browser:
            raise ValueError("Firefox new-tab integration point changed")
        browser[newtab + name] = (source / "start.html").read_bytes()
    browser[newtab + "night-start.css"] = (source / "start.css").read_bytes()
    browser[newtab + "night-start.js"] = (source / "start.js").read_bytes()
    for name, data in list(browser.items()):
        if name.endswith("/branding/brand.ftl") or name.endswith("/branding/brand.properties"):
            text = data.decode("utf-8")
            text = re.sub(r"(?m)^(-?brand(?:ShorterName|ShortName|FullName|ProductName|-shorter-name|-short-name|-full-name|-product-name)\s*=).*$", r"\1 Night", text)
            text = re.sub(r"(?m)^(-?vendor(?:ShortName|-short-name)\s*=).*$", r"\1 Night", text)
            browser[name] = text.encode("utf-8")
    for name in list(browser):
        match = re.search(r"/branding/(?:icon|default|about-logo)(\d+)\.png$", name)
        if match and (source / f"branding/icon{match[1]}.png").exists():
            browser[name] = (source / f"branding/icon{match[1]}.png").read_bytes()
    icon_directory = target / "browser/chrome/icons/default"
    icon_directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / "branding/night.ico", icon_directory / "main-window.ico")
    for size in [16, 32, 48, 64, 128]:
        shutil.copy2(source / f"branding/icon{size}.png", icon_directory / f"default{size}.png")
    for name in list(browser):
        if "/branding/" in name and name.endswith(("about-logo.svg", "icon32.svg", "icon64.svg", "icon128.svg", "identity-icons-brand.svg")):
            browser[name] = (source / "branding/about-logo.svg").read_bytes()
    for name in list(toolkit):
        if name.endswith("global/in-content/common.css"):
            toolkit[name] += b"\n" + (source / "internal.css").read_bytes()
    defaults = json.loads((ROOT / "config/preferences.json").read_text())
    browser["defaults/preferences/00-night.js"] = "\n".join(
        f"pref({json.dumps(name)}, {json.dumps(value)});" for name, value in defaults.items()
    ).encode()
    write_jar(target / "browser/omni.ja", browser)
    write_jar(target / "omni.ja", toolkit)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    commit_time = int(subprocess.check_output(["git", "show", "-s", "--format=%ct", "HEAD"], cwd=ROOT, text=True).strip())
    build_id = datetime.fromtimestamp(commit_time, timezone.utc).strftime("%Y%m%d%H%M%S")
    config["App"]["BuildID"] = build_id
    config["App"].update({"Name": "Night", "Vendor": "Night", "RemotingName": "night-browser",
                          "Profile": "NightPreview",
                          "SourceRepository": "https://github.com/1atex/night-browser", "SourceStamp": revision})
    config["AppUpdate"]["URL"] = "https://updates.invalid/"
    config["XRE"]["EnableProfileMigrator"] = "0"
    config["Crash Reporter"]["Enabled"] = "0"
    with (target / "browser/application.ini").open("w", encoding="utf-8") as stream:
        config.write(stream, space_around_delimiters=False)
    distribution = target / "distribution"
    distribution.mkdir(exist_ok=True)
    (distribution / "policies.json").write_text(json.dumps({"policies": {
        "DisableAppUpdate": True, "DontCheckDefaultBrowser": True, "DisableTelemetry": True,
    }}, indent=2))
    shutil.copy2(ROOT / "LICENSE", output / "LICENSE")
    (output / "BUILD.json").write_text(json.dumps({
        "night_revision": revision, "night_version": json.loads((ROOT / "package.json").read_text())["version"], "night_build_id": build_id,
        "upstream": PIN, "platform": platform,
        "type": "Night shell and services on a pinned Mozilla Firefox native runtime",
        "source": f"https://github.com/1atex/night-browser/tree/{revision}",
    }, indent=2))
    (output / "README.txt").write_text(
        "Night Browser 0.3 Preview\n\n"
        "Распакуй всю папку в доступное для записи место и запусти Night.exe.\n"
        "Профиль хранится в папке profile рядом с Night.exe.\n"
        "Боковая панель: рабочие области, закреплённые вкладки, поиск.\n"
        "Правый клик по вкладке: закрепление, перенос в область, исключение из выгрузки.\n"
        "Alt+P: найти вкладку. Alt+B: скрыть панель. Alt+S: разделить экран.\n"
        "Кнопки внизу панели: split view, запросы, память, настройки.\n"
        "Перехват включается вручную для выбранной вкладки.\n\n"
        "Это тестовая portable-версия. Автоматическое обновление отключено.\n"
        "Нативное ядро: Mozilla Firefox / Gecko 160.0.\n"
        "Оболочка, рабочие области, управление памятью и сетевые инструменты: Night.\n"
        "Windows-приложение имеет ресурсы Night и пока не подписано.\n"
        "Night: https://github.com/1atex/night-browser\n"
        "Firefox source: " + PIN["source"] + "\n",
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
