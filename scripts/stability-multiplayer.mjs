import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem } from 'node:os';
import { Client } from '@colyseus/sdk';
import { statistics } from './load-test-metrics.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const end = performance.now() + timeout;
  while (!check()) { if (performance.now() > end) throw new Error(message); await sleep(20); }
}
export function configuration(args) {
  const { values } = parseArgs({ args, options: { clients: { type: 'string', default: '40,80,160,300' },
    duration: { type: 'string', default: '60' }, profile: { type: 'boolean', default: false }, output: { type: 'string', default: '.local/stability-mixed.json' } } });
  const clients = values.clients.split(',').map(Number), duration = Number(values.duration);
  if (clients.some((n, i) => !Number.isInteger(n) || n < 2 || n > 300 || i && n <= clients[i - 1])) throw new Error('Use increasing client counts between 2 and 300.');
  if (!Number.isInteger(duration) || duration < 10 || duration > 600) throw new Error('Duration must be between 10 and 600 seconds.');
  return { clients, duration, output: values.output, profile: values.profile };
}

async function phase(count, duration, profile) {
  const env = { ...process.env, SDP_TEST_CAPACITY: String(count), ENABLE_SHOOTER_TEST: 'true' };
  for (const key of Object.keys(env)) if (/LIVEKIT|RENDER_API|VERCEL_TOKEN/.test(key)) delete env[key];
  const child = fork(fileURLToPath(new URL('./stability-fixture.mjs', import.meta.url)), [], {
    cwd: fileURLToPath(new URL('../server', import.meta.url)), execArgv: [
      ...(profile ? ['--cpu-prof', `--cpu-prof-dir=${fileURLToPath(new URL('../.local', import.meta.url))}`] : []), '--import', 'tsx'], env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const bots = [], groups = [], samples = [], ack = { LIMBO: [], SHOOTER: [] }, gaps = { LIMBO: [], SHOOTER: [] };
  const joins = [], checks = [], log = [], pendingSamples = new Map();
  let fatal, closing = false, measuring = false, request = 0, timer, receivedBytes = 0, weaponEvents = 0, chatDeliveries = 0;
  let disconnects = 0, sentInputs = 0, ticks, started, lastSample;
  const expectedChat = new Map();
  const weaponActions = { fire: 0, reload: 0, mode: 0 };
  const result = { clients: count, checks, samples, exclusions: ['browser rendering/FPS', 'LiveKit voice', 'WAN latency', 'Render hardware', 'long soak'] };
  const abort = message => { fatal ??= message; };
  const interrupted = () => abort('Test interrupted; remaining stages will not run.');
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  child.stdout.on('data', chunk => log.push(String(chunk)));
  child.stderr.on('data', chunk => log.push(String(chunk)));
  child.on('exit', code => { if (!closing) abort(`Server child exited (${code}).`); });
  child.on('message', message => { if (message.type === 'sample') { pendingSamples.get(message.request)?.(message); pendingSamples.delete(message.request); } });
  const sample = () => new Promise((resolve, reject) => {
    if (!child.connected) { reject(new Error('Server metrics channel is closed.')); return; }
    const id = ++request, timeout = setTimeout(() => { pendingSamples.delete(id); reject(new Error('Server metrics timed out.')); }, 10000);
    pendingSamples.set(id, message => { clearTimeout(timeout); resolve(message); });
    child.send({ type: 'sample', request: id, rooms: groups.map(g => g.roomId) });
  });
  const bind = (bot, room) => {
    bot.room = room; bot.lastState = performance.now(); room.reconnection.enabled = false;
    room.onLeave(code => { if (!closing && !bot.reconnecting) { disconnects++; abort(`Unexpected disconnect ${code}.`); } });
    room.onError(code => { if (!closing && !bot.reconnecting) abort(`Room error ${code}.`); });
    room.onMessage('*', (type, message) => {
      if (type === 'combat:ping') room.send('combat:pong', message);
      if (type === 'chat:error') abort(`Rejected chat: ${message}`);
      if (type === 'weapon:event' && measuring) {
        if (message.roomId !== room.roomId) abort('Shot escaped its room.');
        weaponEvents++; if (message.action in weaponActions) weaponActions[message.action]++;
      }
      if (type === 'chat:message' && message.message.startsWith('STABILITY ')) {
        const expected = expectedChat.get(message.message);
        if (!expected || room.roomId !== expected.roomId) abort('Chat escaped its room.');
        else { expected.delivered++; chatDeliveries++; }
      }
    });
    room.connection.transport.ws.addEventListener('message', event => {
      if (measuring) receivedBytes += event.data.byteLength ?? Buffer.byteLength(event.data);
    });
    room.onStateChange(state => {
      const now = performance.now(), own = state.players?.get(room.sessionId);
      if (measuring && bot.lastState) gaps[bot.mode].push(now - bot.lastState);
      bot.lastState = now;
      if (!own) return;
      if (bot.previous && Math.hypot(own.x - bot.previous.x, own.z - bot.previous.z) > .0001) bot.moved = true;
      bot.previous = { x: own.x, z: own.z };
      const sent = bot.pending.get(own.lastProcessedInput);
      if (measuring && sent && own.lastProcessedInput > bot.ack) ack[bot.mode].push(now - sent);
      bot.ack = own.lastProcessedInput;
      for (const seq of bot.pending.keys()) if (seq <= bot.ack) bot.pending.delete(seq);
    });
  };
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local backend did not start.')), 20000);
      child.on('message', message => { if (message.type === 'ready') { clearTimeout(timeout); resolve(message.port); } });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Backend startup failed.')); });
    });
    const sdk = new Client(`http://127.0.0.1:${port}`), shooters = Math.max(1, Math.round(count * 15 / 40));
    const populate = async (mode, size, total) => {
      let group;
      for (let i = 0; i < total; i++) {
        if (fatal) throw new Error(fatal);
        const began = performance.now(), name = `Load ${mode[0]} ${i}`;
        const queue = await sdk.joinOrCreate('SDPAdmission', { displayName: name });
        let token;
        try {
          const ready = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Admission did not grant a place.')), 10000);
            queue.onMessage('queue:status', update => { if (update.ready) { clearTimeout(timeout); resolve(update.token); } });
          });
          queue.send('queue:sync'); token = await ready;
        } finally { await queue.leave(); }
        const options = { admissionToken: token, displayName: name };
        const room = i % size ? await sdk.joinById(group.roomId, options) : await sdk.create(mode === 'LIMBO' ? 'SDPLimboRoom' : 'SDPShooterRoom', options);
        if (!(i % size)) { group = { roomId: room.roomId, mode, size: Math.min(size, total - i) }; groups.push(group); }
        const bot = { mode, room, seq: 0, ack: -1, action: 0, nextInput: 0, nextFire: 0, pending: new Map(), reconnecting: false, moved: false };
        bind(bot, room); bots.push(bot); joins.push(performance.now() - began);
        if (!(i % size) && (await sample()).rssMiB > 1536) throw new Error('Server RSS exceeded the local safety budget during room creation.');
      }
    };
    timer = setInterval(() => {
      const now = performance.now();
      for (const [index, bot] of bots.entries()) {
        if (fatal || bot.reconnecting || !bot.room.connection.isOpen || now < bot.nextInput) continue;
        const own = bot.room.state.players?.get(bot.room.sessionId); if (!own) continue;
        const shooter = bot.mode === 'SHOOTER', t = now / 1000, yaw = Math.atan2(Math.sin(t * .4 + index), Math.cos(t * .4 + index));
        bot.nextInput = now + (shooter ? 32 : 49); bot.pending.set(++bot.seq, now);
        if (bot.pending.size > 300) { abort('Input backlog exceeded safety limit.'); continue; }
        const base = { seq: bot.seq, f: 1, r: 0, y: yaw, p: .1 * Math.sin(t), active: true };
        bot.room.send(shooter ? 'shooter:input' : 'input', shooter ? { ...base, life: own.life, s: index % 2 === 0, c: Math.floor(t) % 9 === 0, j: Math.floor(t * 2) % 11 === 0, a: false } : base);
        if (measuring) sentInputs++;
        if (shooter && !own.dead && now > bot.nextFire) {
          bot.nextFire = now + 250;
          bot.room.send('weapon:action', { seq: ++bot.action, life: own.life, action: own.ammo ? 'fire' : 'reload' });
        }
      }
    }, 8);
    await populate('LIMBO', 25, count - shooters);
    await populate('SHOOTER', 15, shooters);
    console.log(`[STABILITY] ${count} clients joined across ${groups.length} rooms. Warming up.`);
    await sleep(3000);
    for (const group of groups) {
      const bot = bots.find(b => b.room.roomId === group.roomId);
      await until(() => bot.room.state.online === group.size, 'Population did not synchronize.');
    }
    checks.push('room populations obey 25 Limbo / 15 Shooter limits');
    ticks = await sample(); lastSample = performance.now(); started = performance.now(); measuring = true;
    let reconnected = false, lastChat = -Infinity;
    while (!fatal && performance.now() - started < duration * 1000) {
      const now = performance.now();
      if (now - lastSample > 2000) {
        const value = await sample(); samples.push(value); lastSample = performance.now();
        if (value.rssMiB > 1536) abort('Server RSS exceeded local 1536 MiB safety budget.');
        if (value.loopMaxMs > 3000) abort('Server event loop stalled for over three seconds.');
      }
      if (bots.some(b => !b.reconnecting && now - b.lastState > 3000)) abort('A client received no state for over three seconds.');
      if (now - lastChat > 10000) {
        lastChat = now;
        for (const group of groups) {
          const bot = bots.find(b => b.room.roomId === group.roomId && !b.reconnecting);
          const text = `STABILITY ${count} ${group.roomId} ${Math.floor(now)}`;
          expectedChat.set(text, { roomId: group.roomId, delivered: 0, expected: group.size });
          bot.room.send('chat:send', text);
        }
      }
      if (!reconnected && now - started > duration * 350) {
        reconnected = true;
        for (const mode of ['LIMBO', 'SHOOTER']) {
          const bot = bots.find(b => b.mode === mode), oldId = bot.room.sessionId, oldRoom = bot.room.roomId;
          bot.reconnecting = true;
          const token = bot.room.reconnectionToken; bot.room.connection.close(4010); await sleep(600);
          const restored = await sdk.reconnect(token); bind(bot, restored);
          assert.equal(restored.sessionId, oldId); assert.equal(restored.roomId, oldRoom);
          await until(() => !!restored.state.players?.get(oldId)?.connected, `${mode} reconnection did not synchronize.`);
          bot.pending.clear(); bot.reconnecting = false; checks.push(`${mode} cut recovered in the same room with the same identity`);
        }
      }
      await sleep(100);
    }
    await sleep(300); measuring = false;
    const end = await sample(), elapsed = (end.at - ticks.at) / 1000;
    const rates = end.rooms.map(room => ({ mode: groups.find(g => g.roomId === room.id).mode,
      hz: ((room.tick - ticks.rooms.find(r => r.id === room.id).tick) >>> 0) / elapsed }));
    for (const message of expectedChat.values()) if (message.delivered !== message.expected) abort('Chat delivery lost or crossed rooms');
    if (!weaponActions.fire || !weaponActions.reload) abort('Missing authoritative fire or reload events');
    if (!ack.LIMBO.length || !ack.SHOOTER.length) abort('No input acknowledgements');
    if (rates.some(r => r.hz < (r.mode === 'SHOOTER' ? 60 : 20) * .9)) abort('Simulation ran below 90% of target');
    checks.push('chat stayed within each room and reached all recipients', 'authoritative shots and reloads continued under movement load');
    Object.assign(result, { status: fatal ? 'failed' : 'passed', failure: fatal, durationSeconds: elapsed,
      rooms: groups.map(({ mode, size }) => ({ mode, players: size })), disconnects, inputsSent: sentInputs,
      inputAckMs: { LIMBO: statistics(ack.LIMBO), SHOOTER: statistics(ack.SHOOTER) },
      stateGapMs: { LIMBO: statistics(gaps.LIMBO), SHOOTER: statistics(gaps.SHOOTER) },
      simulationHz: rates, joinMs: statistics(joins), serverRssMiB: statistics(samples.map(s => s.rssMiB)),
      serverCpuOneCorePercent: statistics(samples.map(s => s.cpuOneCorePercent)),
      serverLoopP95Ms: statistics(samples.map(s => s.loopP95Ms)), receivedMiB: receivedBytes / 1024 ** 2,
      weaponEventDeliveries: weaponEvents, weaponActions, chatDeliveries, movingClients: bots.filter(b => b.moved).length });
  } catch (error) { Object.assign(result, { status: 'failed', failure: error.message, serverLogTail: log.join('').slice(-2500) }); }
  finally {
    closing = true; measuring = false; clearInterval(timer);
    await Promise.all(bots.map(async bot => {
      try { await Promise.race([bot.room.leave(), sleep(2000)]); }
      catch { /* A failed server may already have closed the socket. */ }
      finally { bot.room.connection?.close(); }
    }));
    try {
      const remaining = await sample();
      result.cleanup = { connectedTestSockets: bots.filter(b => b.room.connection.isOpen).length, remainingServerPlayers: remaining.rooms.reduce((sum, room) => sum + room.players, 0) };
      if (result.cleanup.connectedTestSockets || result.cleanup.remainingServerPlayers) Object.assign(result, { status: 'failed', failure: 'Server player cleanup was incomplete.' });
    } catch { result.cleanup = { confirmed: false }; result.status = 'failed'; }
    if (child.connected) child.send({ type: 'stop' });
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); }); clearTimeout(kill);
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  }
  return result;
}
export async function main(args = process.argv.slice(2)) {
  const config = configuration(args), report = { startedAt: new Date().toISOString(),
    host: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: totalmem() / 1024 ** 3, node: process.version, platform: process.platform, arch: process.arch },
    profilerEnabled: config.profile, methodology: 'isolated loopback Colyseus server child per stage; actual admission, movement, Rapier physics, shots, chat and reconnects; synthetic SDK clients in a separate process', phases: [] };
  await mkdir(fileURLToPath(new URL('../.local', import.meta.url)), { recursive: true });
  for (const count of config.clients) {
    const result = await phase(count, config.duration, config.profile); report.phases.push(result);
    await writeFile(config.output, JSON.stringify(report, null, 2));
    console.log(`[STABILITY] ${count}: ${result.status}; ACK p95 Limbo=${result.inputAckMs?.LIMBO.p95}ms Shooter=${result.inputAckMs?.SHOOTER.p95}ms; RSS max=${result.serverRssMiB?.max}MiB; ${result.failure ?? 'OK'}`);
    if (result.status !== 'passed') { process.exitCode = 1; break; }
  }
  report.finishedAt = new Date().toISOString(); await writeFile(config.output, JSON.stringify(report, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
