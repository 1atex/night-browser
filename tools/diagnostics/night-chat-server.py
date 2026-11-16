import argparse
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import socket
import struct
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


def command(args, timeout=15, include_stderr=False):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return result.returncode, result.stdout + (result.stderr if include_stderr else '')
    except (OSError, subprocess.TimeoutExpired):
        return -1, ''


def http_probe(url):
    started = time.monotonic()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Night-Chat-Diagnostic/1'}), timeout=12) as response:
            body = response.read(1048576)
            result = {'ok': True, 'status': response.status, 'contentType': response.headers.get('Content-Type'), 'server': response.headers.get('Server'), 'durationMs': round((time.monotonic() - started) * 1000)}
            if url.endswith('/health'):
                try:
                    result['healthOK'] = json.loads(body).get('ok') is True
                except (ValueError, AttributeError):
                    result['healthOK'] = False
            else:
                result['sha256'] = hashlib.sha256(body).hexdigest()
                if url.endswith('/room.js'):
                    result['hasPeerCode'] = b'RTCPeerConnection' in body
                    result['hasCaptureModule'] = b'MicrophoneSession' in body
            return result
    except urllib.error.HTTPError as error:
        return {'ok': False, 'status': error.code}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {'ok': False, 'errorType': type(error).__name__, 'reasonType': type(getattr(error, 'reason', error)).__name__}


def stun_probe(host='127.0.0.1', port=3478):
    transaction = secrets.token_bytes(12)
    packet = struct.pack('!HHI12s', 1, 0, 0x2112A442, transaction)
    started = time.monotonic()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
            udp.settimeout(2)
            udp.sendto(packet, (host, port))
            for _ in range(3):
                reply, _ = udp.recvfrom(4096)
                if len(reply) >= 20 and reply[4:8] == b'\x21\x12\xa4\x42' and reply[8:20] == transaction:
                    return {'ok': reply[:2] == b'\x01\x01', 'responseType': reply[:2].hex(), 'durationMs': round((time.monotonic() - started) * 1000), 'scope': 'server loopback only, not internet reachability'}
        return {'ok': False, 'reason': 'Unexpected STUN response'}
    except OSError as error:
        return {'ok': False, 'errorType': type(error).__name__, 'scope': 'server loopback only'}


def environment(container):
    return dict(item.split('=', 1) for item in container.get('Config', {}).get('Env', []) if '=' in item)


def container_summary(container):
    bindings = container.get('HostConfig', {}).get('PortBindings') or {}
    return {'status': container.get('State', {}).get('Status'), 'health': container.get('State', {}).get('Health', {}).get('Status'), 'restarts': container.get('RestartCount'), 'image': container.get('Config', {}).get('Image'), 'readOnly': container.get('HostConfig', {}).get('ReadonlyRootfs'), 'ports': {key: [{'ip': value.get('HostIp'), 'port': value.get('HostPort')} for value in values or []] for key, values in bindings.items()}}


def log_categories(text):
    patterns = {'bindFailure': r'cannot.*bind|address already in use', 'permissionDenied': r'permission denied|operation not permitted', 'authFailure': r'wrong.*credential|wrong.*password|unauthorized|authentication.*fail', 'staleNonce': r'stale nonce', 'allocationFailure': r'allocation.*fail|allocation.*mismatch|quota.*exceed', 'forbiddenPeer': r'forbidden|peer.*denied', 'tlsFailure': r'tls.*error|ssl.*error', 'fatal': r'fatal'}
    return {name: len(re.findall(pattern, text, re.I)) for name, pattern in patterns.items()}


def safe_turn_url(value):
    if '@' in value or re.search(r'[\s\r\n]', value):
        return '[invalid or embedded credentials redacted]'
    return re.sub(r'([?&])(?!transport=)[^&]*', r'\1[redacted]', value)


def main():
    parser = argparse.ArgumentParser(description='Read-only Night Together/RTC server diagnostic. No sudo, restarts or config changes.')
    parser.add_argument('--path', default='/home/noon/night-together/services/together')
    parser.add_argument('--origin', default='https://browser.night-watchers.com')
    parser.add_argument('--public-ip', default='144.91.104.48')
    parser.add_argument('--output', default='night-chat-server-report.json')
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.origin)
    if origin.scheme not in ['http', 'https'] or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ['', '/']:
        parser.error('--origin must be an HTTP(S) origin without credentials, path or query')
    origin_url = args.origin.rstrip('/')
    report = {'schema': 1, 'kind': 'night-chat-server', 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'checks': {}, 'findings': []}
    checks, findings = report['checks'], report['findings']
    checks['deploymentFiles'] = {name: (Path(args.path) / name).is_file() for name in ['compose.yaml', 'compose.proxy.yaml', 'compose.turn.yaml', 'server.mjs', 'web.mjs', 'public/room.js', 'public/microphone.mjs']}
    checks['http'] = {name: http_probe(url) for name, url in [('localHealth', 'http://127.0.0.1:8787/health'), ('publicHealth', origin_url + '/health'), ('publicRoomCode', origin_url + '/room.js'), ('publicCaptureModule', origin_url + '/microphone.mjs')]}
    code, output = command(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=night-together'])
    if code != 0:
        checks['docker'] = {'ok': False, 'reason': 'Docker is unavailable for this user; run as noon with the same Docker context as the deployment.'}
    else:
        ids = output.split()
        containers = []
        if ids:
            code, output = command(['docker', 'inspect', *ids])
            if code == 0:
                try:
                    containers = json.loads(output)
                except ValueError:
                    pass
        by_service = {}
        for item in containers:
            labels = item.get('Config', {}).get('Labels') or {}
            service = labels.get('com.docker.compose.service')
            if labels.get('com.docker.compose.oneoff') == 'True':
                continue
            if service:
                by_service[service] = item
        checks['docker'] = {'ok': True, 'services': {key: container_summary(value) for key, value in by_service.items()}}
        backend, turn = by_service.get('together'), by_service.get('turn')
        if not backend:
            findings.append('Together container not found under project night-together. Check the Docker context/project name.')
        else:
            backend_env = environment(backend)
            urls = [value.strip() for value in backend_env.get('NIGHT_TURN_URL', '').split(',') if value.strip()]
            checks['turnConfiguration'] = {'backendSecretPresent': bool(backend_env.get('NIGHT_TURN_SECRET')), 'backendUrls': [safe_turn_url(url) for url in urls], 'turnContainerPresent': bool(turn)}
            if not urls or not backend_env.get('NIGHT_TURN_SECRET'):
                findings.append('The running backend does not provide TURN credentials. HTTP video sync can work while direct WebRTC fails between networks.')
            if urls and not turn:
                findings.append('TURN URLs are configured but no local turn service exists; verify that the configured external relay is intentional.')
            if turn:
                turn_env = environment(turn)
                checks['turnConfiguration']['containerSecretPresent'] = bool(turn_env.get('NIGHT_TURN_SECRET'))
                checks['turnConfiguration']['secretsMatch'] = bool(backend_env.get('NIGHT_TURN_SECRET') and turn_env.get('NIGHT_TURN_SECRET')) and hmac.compare_digest(backend_env['NIGHT_TURN_SECRET'].encode(), turn_env['NIGHT_TURN_SECRET'].encode())
                checks['turnConfiguration']['publicIPMatchesArgument'] = turn_env.get('NIGHT_TURN_PUBLIC_IP') == args.public_ip
                code, contents = command(['docker', 'exec', turn['Id'], 'cat', '/tmp/night-turn.conf'])
                config = {}
                if code == 0:
                    for line in contents.splitlines():
                        key, _, value = line.partition('=')
                        config[key] = value
                    checks['turnConfiguration']['generatedSecretMatchesBackend'] = bool(config.get('static-auth-secret') and backend_env.get('NIGHT_TURN_SECRET')) and hmac.compare_digest(config['static-auth-secret'].encode(), backend_env['NIGHT_TURN_SECRET'].encode())
                    checks['turnConfiguration']['generatedIPMatchesArgument'] = config.get('external-ip', '').split('/')[0] == args.public_ip
                else:
                    checks['turnConfiguration']['generatedConfigReadable'] = False
                bindings = turn.get('HostConfig', {}).get('PortBindings') or {}
                relay_ports = [port for port in range(49160, 49201) if bindings.get(str(port) + '/udp')]
                checks['turnPorts'] = {'udp3478Published': bool(bindings.get('3478/udp')), 'tcp3478Published': bool(bindings.get('3478/tcp')), 'relayUDPPublished': len(relay_ports), 'relayUDPExpected': 41, 'localSTUN': stun_probe()}
                code, logs = command(['docker', 'logs', '--tail', '250', turn['Id']], include_stderr=True)
                checks['turnLogCategories'] = log_categories(logs) if code == 0 else {'readable': False}
                for key in ['secretsMatch', 'generatedSecretMatchesBackend', 'publicIPMatchesArgument', 'generatedIPMatchesArgument']:
                    if checks['turnConfiguration'].get(key) is False:
                        findings.append('TURN configuration mismatch: ' + key + '. The running containers may not match the intended environment.')
                if turn.get('State', {}).get('Status') != 'running':
                    findings.append('The TURN container is not running.')
                if len(relay_ports) != 41:
                    findings.append('The configured relay UDP range is not fully published.')
            try:
                addresses = sorted({entry[4][0] for entry in socket.getaddrinfo(origin.hostname, None)})
                checks['originDNS'] = {'addresses': addresses}
                if any(re.match(r'^turns?:(?://)?' + re.escape(origin.hostname) + r'(?::|\?|$)', url) for url in urls) and (checks['http']['publicHealth'].get('server') or '').lower() == 'cloudflare':
                    findings.append('TURN uses the website hostname behind Cloudflare. HTTP proxying does not forward TURN; use the direct relay IP or a separate DNS-only hostname.')
            except OSError:
                checks['originDNS'] = {'resolved': False}
    if checks['http']['localHealth'].get('healthOK') and not checks['http']['publicHealth'].get('healthOK'):
        findings.append('Local API works but public health does not. Inspect the existing reverse proxy/TLS/DNS path.')
    if not checks['http']['publicCaptureModule'].get('ok') or not checks['http']['publicRoomCode'].get('hasPeerCode'):
        findings.append('The public room code does not match the expected chat deployment. Check whether the server archive was rebuilt/recreated.')
    report['limits'] = ['No configuration, users, rooms, firewall rules or containers were changed.', 'Server-side loopback tests cannot prove inbound internet UDP or the client-to-peer relay path.', 'HTTP video sync and WebRTC chat use different network paths.', 'No raw logs, container environment, state.json, tokens, credentials or SDP are included.']
    target = Path(args.output)
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print('Report saved:', target)
    for finding in findings:
        print('-', finding)


if __name__ == '__main__':
    main()
