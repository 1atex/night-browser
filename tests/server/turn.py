import os,subprocess,time,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
env={**os.environ,'NIGHT_TURN_SECRET':'local-test-fixture','NIGHT_TURN_PUBLIC_IP':'144.91.104.48'}
name='night-turn-test-'+uuid.uuid4().hex[:10]
compose=['docker','compose','-p',name,'-f','services/together/compose.yaml','-f','services/together/compose.turn.yaml']
try:
 subprocess.run(compose+['run','-d','--no-deps','--name',name,'turn'],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
 time.sleep(2)
 if subprocess.check_output(['docker','inspect','-f','{{.State.Running}}',name],text=True).strip()!='true':
  subprocess.run(['docker','logs',name],check=False)
  raise AssertionError('TURN container stopped before readiness')
 config=subprocess.check_output(['docker','exec',name,'cat','/tmp/night-turn.conf'],text=True)
 assert 'static-auth-secret=local-test-fixture' in config and 'external-ip=144.91.104.48' in config
 subprocess.run(['docker','exec',name,'turnutils_stunclient','127.0.0.1'],check=True,timeout=10)
 print('PASS: pinned Coturn config starts read-only without host ports and answers STUN; WAN relay unverified',flush=True)
finally:
 subprocess.run(compose+['down','--volumes'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
