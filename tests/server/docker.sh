#!/usr/bin/env bash
set -euo pipefail
docker compose -f services/together/compose.yaml config --quiet
docker build -t night-together-check services/together
container="night-together-test-$$"
volume="night-together-test-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container" --read-only --cap-drop ALL --security-opt no-new-privileges:true -v "$volume:/data" night-together-check
for attempt in $(seq 1 30); do
  if docker exec "$container" node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)throw Error('health')}).catch(()=>process.exit(1))"; then break; fi
  [[ "$attempt" != 30 ]]
  sleep 1
done
docker exec "$container" node --input-type=module -e '
import {writeFile} from "node:fs/promises";
if(process.getuid()===0)throw Error("Container must not run as root");
const user=await fetch("http://127.0.0.1:8787/v1/register",{method:"POST",body:"{}"}).then(r=>r.json());
if(!user.token)throw Error("Registration failed");
await writeFile("/data/fixture.json",JSON.stringify(user));
'
docker restart "$container"
docker exec "$container" node --input-type=module -e '
import {readFile} from "node:fs/promises";
const user=JSON.parse(await readFile("/data/fixture.json","utf8"));
let state;
for(let i=0;i<30;i++){try{state=await fetch("http://127.0.0.1:8787/v1/state",{headers:{Authorization:`Bearer ${user.id}:${user.token}`}}).then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}
if(state?.id!==user.id)throw Error("Identity lost after restart");
console.log("PASS: non-root read-only container, named volume and identity persistence");
'
docker run --rm -i caddy:2-alpine caddy adapt --adapter caddyfile --config /dev/stdin --validate < services/together/deploy/Caddyfile
