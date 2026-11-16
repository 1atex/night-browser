import argparse
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def package(output):
    paths = subprocess.check_output(['git', 'ls-files', '-z', 'services/together'], cwd=ROOT).decode().split('\0')
    paths = [path for path in paths if path and (ROOT / path).is_file()]
    paths.append('docs/night/TOGETHER.md')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            info = zipfile.ZipInfo(path)
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, (ROOT / path).read_bytes())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        for path in ['services/together/compose.yaml', 'services/together/server.mjs', 'services/together/Dockerfile', 'services/together/.dockerignore', 'services/together/deploy/Caddyfile']:
            assert path in archive.namelist(), path

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    package(parser.parse_args().output)
