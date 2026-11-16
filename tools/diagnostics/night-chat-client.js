(async () => {
  const report = {schema: 1, generatedAt: new Date().toISOString(), kind: 'night-chat-client', checks: {}, findings: []};
  const tasks = new Map(), observed = [], own = new Set(), sensitive=[];
  let serial = Date.now() * 1000, live = true;
  const observeStarted=performance.now();
  const cleanError = value => sensitive.reduce((text,secret)=>text.split(secret).join('[credential]'),String(value ?? '')).replace(/https?:\/\/[^\s]+/g, '[url]').replace(/\b[a-f0-9]{16,}\b/gi, '[id]').replace(/\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.%]*\b/gi, '[ip]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]').slice(0, 300);
  const safeURL = value => String(value).replace(/^(stuns?|turns?):(?:\/\/)?[^@]+@/i,'$1:[credentials]@').replace(/\/\/[^/@\s]+@/g, '//[credentials]@').replace(/([?&])(?!transport=)[^&]*/g, '$1[redacted]');
  const receive = event => {
    let value; try { value = JSON.parse(event.detail); } catch { return; }
    const item = tasks.get(value.id);
    if (item) { tasks.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(cleanError(value.error))) : item.resolve(value.result); }
    if (live && !own.has(value.id) && observed.length < 150) observed.push({direction: 'reply', ok: !value.error, error: value.error ? cleanError(value.error) : undefined});
  };
  const observe = event => {
    let value; try { value = JSON.parse(event.detail); } catch { return; }
    if (live && !own.has(value.id) && observed.length < 150) observed.push({direction: 'query', method: value.method, action: value.body?.type, signal: value.body?.signal?.kind});
  };
  const query = (method, body) => new Promise((resolve, reject) => {
    const id = ++serial; own.add(id);
    const timer = setTimeout(() => { tasks.delete(id); reject(Error('Night bridge timeout: ' + method)); }, 12000);
    tasks.set(id, {resolve, reject, timer});
    document.dispatchEvent(new CustomEvent('NightRoom:Query', {detail: JSON.stringify({id, method, body})}));
  });
  const attempt = async fn => { try { return {ok: true, value: await fn()}; } catch (error) { return {ok: false, error: cleanError(error)}; } };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  window.addEventListener('NightRoom:Reply', receive);
  document.addEventListener('NightRoom:Query', observe);
  try {
    report.checks.page = {origin: location.origin, path: location.pathname === '/room' ? '/room' : '[not room]', secureContext: window.isSecureContext, online: navigator.onLine, webrtcAvailable: typeof RTCPeerConnection === 'function', userAgent: navigator.userAgent};
    if (location.pathname !== '/room') throw Error('Открой именно страницу комнаты /room, затем повтори скрипт.');
    const stateResult = await attempt(() => query('status'));
    if (!stateResult.ok) { report.checks.bridge = stateResult; throw Error('Нет ответа Night bridge. Проверь версию Night, обычное окно и адрес сервера.'); }
    const state = stateResult.value.state;
    report.checks.bridge = {ok: true, connected: stateResult.value.connected, protocol: state?.protocol};
    if (!state?.room) throw Error('Этот профиль сейчас не состоит в комнате.');
    const members = [...state.room.members].sort(), alias = id => { const index = members.indexOf(id); return index < 0 ? 'former-member' : 'member-' + (index + 1); };
    report.checks.room = {self: alias(state.id), owner: alias(state.room.owner), members: members.length};
    const ui = () => ({status: cleanError(document.getElementById('room-status')?.textContent), chat: document.getElementById('chat-state')?.textContent, connectButton: document.getElementById('connect')?.textContent, members: [...document.querySelectorAll('#members [data-id]')].map(node => ({member: alias(node.dataset.id), state: node.dataset.state}))});
    report.checks.uiBefore = ui();
    const refresh = document.getElementById('rtc-refresh'), detail = document.getElementById('rtc-report');
    if (refresh && detail) {
      const before = detail.dataset.serial; refresh.click();
      for (let i = 0; i < 50 && detail.dataset.serial === before; i++) await delay(100);
      report.checks.activePeers = await attempt(async () => JSON.parse(detail.textContent || '[]').map(peer => ({member:alias(peer.id),state:peer.state,channel:peer.channel,route:peer.route,received:peer.received,sent:peer.sent,audio:peer.audio?.map(track=>({direction:track.direction,local:track.local,remote:track.remote}))})));
    }
    report.checks.roomAsset = await attempt(async () => {
      const response=await fetch('/room.js',{cache:'no-store'}),text=await response.text();
      return {status:response.status,hasPeerCode:text.includes('RTCPeerConnection'),hasCaptureModule:text.includes('MicrophoneSession'),note:'Current HTTP response, not proof of the already-loaded module version.'};
    });
    const ice = await attempt(() => query('rtc'));
    if (!ice.ok) { report.checks.rtcConfiguration = ice; throw Error('Не удалось получить ICE-конфигурацию.'); }
    const servers = ice.value.iceServers ?? [];
    for(const server of servers)for(const value of [server.username,server.credential])if(typeof value==='string'&&value)sensitive.push(value);
    report.checks.rtcConfiguration = {ok: true, servers: servers.map(server => ({urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).map(safeURL), credentialsPresent: !!server.username && !!server.credential, credentialExpiresInSeconds: /^\d+:/.test(server.username ?? '') ? Number(server.username.split(':')[0]) - Math.floor(Date.now() / 1000) : undefined}))};
    const signalSummary = await attempt(async () => {
      const batch = await query('signals', {after: 0});
      return {windowSeconds: 60, note: 'Empty history alone does not prove failure; signals expire.', count: batch.items.length, messages: batch.items.map(item => {
        const text = item.signal.description?.sdp ?? '', candidateTypes = {};
        for (const match of text.matchAll(/ typ (host|srflx|relay|prflx)\b/g)) candidateTypes[match[1]] = (candidateTypes[match[1]] ?? 0) + 1;
        return {from: alias(item.from), kind: item.signal.kind, descriptionType: item.signal.description?.type, ageSeconds: Math.round((Date.now() - item.at) / 1000), candidateTypes};
      })};
    });
    report.checks.recentSignals = signalSummary;
    const gather = async policy => {
      const result = {policy, counts: {}, firstSeenMs: {}, errors: [], timedOut: false, endOfCandidates: false}, started = performance.now();
      const pc = new RTCPeerConnection({iceServers: servers, iceTransportPolicy: policy});
      try {
        let complete;
        const done = new Promise(resolve => { complete = resolve; });
        pc.onicecandidate = event => {
          if (!event.candidate?.candidate) { result.endOfCandidates=true;complete();return; }
          const type = event.candidate.type ?? / typ (\w+)/.exec(event.candidate.candidate)?.[1] ?? 'unknown';
          const protocol = event.candidate.protocol ?? 'unknown', key = type + '/' + protocol;
          result.counts[key] = (result.counts[key] ?? 0) + 1;result.firstSeenMs[key]??=Math.round(performance.now()-started);
        };
        pc.onicecandidateerror = event => { if (result.errors.length < 20) result.errors.push({code: event.errorCode, text: cleanError(event.errorText), url: safeURL(event.url)}); };
        pc.createDataChannel('night-diagnostic');
        await pc.setLocalDescription(await pc.createOffer());
        let timer;
        await Promise.race([done, new Promise(resolve => { timer = setTimeout(() => { result.timedOut = true; resolve(); }, 14000); })]);
        clearTimeout(timer);await delay(0);result.gatheringState = pc.iceGatheringState;
        result.durationMs = Math.round(performance.now() - started);
        return result;
      } finally { pc.onicecandidate = null; pc.onicecandidateerror = null; pc.close(); }
    };
    const turnConfigured = servers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/.test(url)));
    const probes = await Promise.all([attempt(() => gather('all')), turnConfigured ? attempt(() => gather('relay')) : Promise.resolve({skipped: true, reason: 'TURN is not configured'})]);
    report.checks.iceGathering = probes[0]; report.checks.turnAllocation = probes[1];
    if(Object.values(probes[0].value?.firstSeenMs??{}).some(ms=>ms>6000))report.findings.push('An ICE candidate arrived after the current application six-second SDP snapshot. Late candidate signaling may be relevant.');
    await delay(Math.max(0,8000-(performance.now()-observeStarted)));
    report.checks.uiAfter = ui(); report.checks.observedBridge = observed;
    if (!turnConfigured) report.findings.push('TURN is not configured. Direct P2P may fail between these networks even when video HTTP sync works.');
    if (turnConfigured && !Object.keys(probes[1].value?.counts ?? {}).some(key => key.startsWith('relay/'))) report.findings.push('No relay candidate was obtained. Check TURN reachability, credentials and allocation errors.');
    if (Object.keys(probes[1].value?.counts ?? {}).some(key => key.startsWith('relay/'))) report.findings.push('TURN allocation succeeded from this PC. This alone does not prove the relay-to-peer media path.');
    if (report.checks.uiBefore.connectButton === 'Подключить чат') report.findings.push('Chat was not enabled when the report started. Both participants must click Connect chat.');
    if (members.length < 2) report.findings.push('Only one admitted participant is in the room.');
    if (report.checks.activePeers.value?.length === 0 && report.checks.uiBefore.connectButton !== 'Подключить чат' && members.length > 1) report.findings.push('No peer object is visible. Compare both reports, bridge responses and recent offers; this is not sufficient to diagnose NAT.');
  } catch (error) { report.error = cleanError(error); }
  finally {
    live = false; window.removeEventListener('NightRoom:Reply', receive); document.removeEventListener('NightRoom:Query', observe);
    for (const item of tasks.values()) { clearTimeout(item.timer); item.reject(Error('Diagnostic finished')); } tasks.clear();
    window.nightChatDiagnosticReport = report;
    const blob = new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'}), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'night-chat-client-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log('Night chat diagnostic: no tokens, credentials, SDP or candidate addresses are included.', report);
  }
  return report;
})()
