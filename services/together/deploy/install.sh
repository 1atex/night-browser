#!/usr/bin/env bash
set -euo pipefail
if [[ $(id -u) != 0 ]]; then echo 'Запусти: sudo bash services/together/deploy/install.sh'; exit 1; fi
cd "$(dirname "$0")/../../.."
if [[ $(pwd) != /opt/night-browser ]]; then echo 'Сначала распакуй архив в /opt/night-browser'; exit 1; fi
if [[ ! -f /etc/debian_version ]]; then echo 'Этот установщик рассчитан на Debian/Ubuntu с systemd.'; exit 1; fi
apt-get update
apt-get install -y curl ca-certificates xz-utils caddy
if [[ ! -x node/bin/node ]]; then
  case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo 'Архитектура не поддерживается'; exit 1;; esac
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  curl --fail --show-error --silent --location https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$work/SHASUMS256.txt"
  archive=$(awk -v arch="$arch" '$2 ~ "^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$" {print $2}' "$work/SHASUMS256.txt")
  [[ -n "$archive" && "$archive" != *$'\n'* ]] || { echo 'Не удалось определить Node 22'; exit 1; }
  curl --fail --show-error --silent --location "https://nodejs.org/dist/latest-v22.x/$archive" -o "$work/$archive"
  (cd "$work"; awk -v archive="$archive" '$2 == archive' SHASUMS256.txt | sha256sum --check -)
  mkdir -p node
  tar -xJf "$work/$archive" --strip-components=1 -C node
fi
node/bin/node --version
if ! id night-together >/dev/null 2>&1; then useradd --system --home-dir /var/lib/night-together --shell /usr/sbin/nologin night-together; fi
install -d -o night-together -g night-together -m 700 /var/lib/night-together
install -m 644 services/together/deploy/night-together.service /etc/systemd/system/night-together.service
if [[ -e /etc/caddy/night-browser.Caddyfile ]]; then
  echo 'Используем существующий /etc/caddy/night-browser.Caddyfile'
else
  cat > /etc/caddy/night-browser.Caddyfile <<'CADDY'
browser.night-watchers.com {
    reverse_proxy 127.0.0.1:8787
}
CADDY
fi
if ! grep -Fqx 'import /etc/caddy/night-browser.Caddyfile' /etc/caddy/Caddyfile; then
  cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup.$(date +%s)"
  printf '\nimport /etc/caddy/night-browser.Caddyfile\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now night-together
systemctl restart night-together
systemctl reload caddy
curl --fail --show-error http://127.0.0.1:8787/health
printf '\nПроверка снаружи: curl -f https://browser.night-watchers.com/health\n'
