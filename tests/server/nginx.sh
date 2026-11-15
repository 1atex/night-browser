#!/usr/bin/env bash
set -euo pipefail
docker run --rm -i --entrypoint sh nginx:alpine -c 'cat > /etc/nginx/conf.d/default.conf; nginx -t' < services/together/deploy/nginx.http.conf
