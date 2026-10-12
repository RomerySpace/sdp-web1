import { Client } from '@colyseus/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { LOBBY_NAME, MAX_PLAYERS, SIMULATION_HZ } from '../shared/MultiplayerProtocol.ts';
import { renderMetrics, statistics } from './load-test-metrics.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = () => new Date().toISOString();

export function configuration(args) {
  const { values } = parseArgs({ args, options: {
    url: { type: 'string', default: 'http://127.0.0.1:2567' },
    clients: { type: 'string', default: '25,50,100' },
    duration: { type: 'string', default: '120' }, warmup: { type: 'string', default: '15' },
    cooldown: { type: 'string', default: '15' }, output: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false }, 'render-service': { type: 'string' },
  } });
  const url = new URL(values.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use a plain HTTP(S) server origin without credentials or extra paths.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !values['allow-remote']) {
    throw new Error('Remote load tests require --allow-remote and permission from the server owner.');
  }
  const clients = values.clients.split(',').map(Number);
  if (!clients.length || clients.some((n, i) => !Number.isInteger(n) || n < 1 || n > 100 || (i && n <= clients[i - 1]))) {
    throw new Error('--clients must be increasing integers between 1 and 100.');
  }
  for (const name of ['duration', 'warmup', 'cooldown']) {
    values[name] = Number(values[name]);
    if (!Number.isInteger(values[name]) || values[name] < (name === 'duration' ? 5 : 0) || values[name] > 600) {
      throw new Error(`Invalid --${name}: use seconds between ${name === 'duration' ? 5 : 0} and 600.`);
    }
  }
  if (values['render-service'] && !process.env.RENDER_API_KEY) throw new Error('RENDER_API_KEY is required for Render metrics.');
  return { ...values, url: url.origin, clients };
}

export async function runPhase(client, count, config, runId, interrupted) {
  const bots = [], groups = [], timers = [];
  const acknowledgements = [], pings = [], intervals = [], health = [], joinTimes = [];
  const metricErrors = new Set();
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  let measuring = false, closing = false, failure = null, measureStart = 0, measurementStart = null;
  let receivedBytes = 0, sentInputs = 0, patches = 0, moved = 0, disconnects = 0, chatReceived = 0;
  let measurementEnd = null, elapsed = 0, metricsBusy = false;
  const chatSent = new Map();
  const abort = (reason) => { failure ??= reason; };
  const resources = async () => {
    if (!config['render-service'] || !measurementStart) return null;
    try { return await renderMetrics(config['render-service'], measurementStart, measurementEnd || iso()); }
    catch (error) { metricErrors.add(error.message); return null; }
  };
  const cleanup = { confirmed: false, remainingTestSockets: null, error: null };
  try {
    console.log(`[LOAD] Ramp: ${count} clients, ${Math.ceil(count / MAX_PLAYERS)} test rooms.`);
    for (let index = 0; index < count; index++) {
      if (interrupted()) throw new Error('Test interrupted.');
      const start = performance.now();
      const group = groups[Math.floor(index / MAX_PLAYERS)];
      // Explicit room IDs keep the benchmark out of existing visitors' rooms.
      const room = group ? await client.joinById(group.roomId) : await client.create(LOBBY_NAME);
      room.reconnection.enabled = false;
      const bot = { room, index, seq: 0, ack: 0, pending: new Map(), lastState: performance.now(),
        previous: null, lastPosition: null, moved: false, received: new Set(), lastChat: -Infinity };
      bots.push(bot);
      if (!group) groups.push(room);
      joinTimes.push(performance.now() - start);
      room.onLeave((code) => { if (!closing) { disconnects++; abort(`Unexpected client departure (${code}).`); } });
      room.onError((code) => { if (!closing) abort(`Room error (${code}).`); });
      room.onMessage('*', (type, message) => {
        if (type === 'chat:error') abort('Server rejected a benchmark chat message.');
        if (type !== 'chat:message' || !message.message?.startsWith(`SDP_LOAD_${runId}_`)) return;
        const expected = chatSent.get(message.message);
        if (!expected || message.roomId !== room.roomId || message.senderId !== expected.sender) {
          abort('Chat sender or room isolation was incorrect.'); return;
        }
        if (!bot.received.has(message.messageId)) { bot.received.add(message.messageId); expected.delivered++; chatReceived++; }
      });
      room.connection.transport.ws.addEventListener('message', (event) => {
        if (measuring) receivedBytes += event.data.byteLength ?? Buffer.byteLength(event.data);
      });
      room.onStateChange((state) => {
        const now = performance.now();
        bot.lastState = now;
        const local = state.players?.get(room.sessionId);
        if (!local) return;
        if (measuring) {
          patches++;
          if (groups.includes(room) && bot.previous) intervals.push(now - bot.previous.time);
          if (bot.lastPosition && Math.hypot(local.x - bot.lastPosition.x, local.z - bot.lastPosition.z) > 0.0001) {
            moved++; bot.moved = true;
          }
          const sentAt = bot.pending.get(local.lastProcessedInput);
          if (local.lastProcessedInput > bot.ack && sentAt >= measureStart) acknowledgements.push(now - sentAt);
        }
        bot.ack = local.lastProcessedInput;
        for (const seq of bot.pending.keys()) if (seq <= bot.ack) bot.pending.delete(seq);
        bot.previous = { time: now, tick: state.tick };
        bot.lastPosition = { x: local.x, z: local.z };
      });
      const movementStarted = performance.now();
      timers.push(setInterval(() => {
        if (closing || failure || !room.connection.isOpen) return;
        const t = (performance.now() - movementStarted) / 1000;
        const heading = t * 0.4 + index * 0.17;
        bot.pending.set(++bot.seq, performance.now());
        room.send('input', { seq: bot.seq, f: 1, r: 0, y: Math.atan2(Math.sin(heading), Math.cos(heading)),
          p: 0.12 * Math.sin(t * 0.25), active: true });
        if (measuring) sentInputs++;
        if (bot.pending.size > SIMULATION_HZ * 5) abort('Input acknowledgement backlog exceeds five seconds.');
      }, 1000 / SIMULATION_HZ));
      await sleep(80);
      if (failure) throw new Error(failure);
    }
    console.log(`[LOAD] Warm-up: ${config.warmup}s.`);
    await sleep(config.warmup * 1000);
    for (const room of groups) {
      const own = bots.filter((bot) => bot.room.roomId === room.roomId);
      if (room.state.online !== own.length || [...room.state.players.keys()].some((id) => !own.some((bot) => bot.room.sessionId === id))) {
        throw new Error('A visitor entered a test room or its population did not synchronize.');
      }
    }
    if (failure) throw new Error(failure);
    const tickStarts = groups.map((room) => ({ room, tick: room.state.tick }));
    measurementStart = iso(); measureStart = performance.now(); measuring = true; loopDelay.enable();
    timers.push(setInterval(() => {
      for (const room of groups) room.ping((ms) => { if (measuring) pings.push(ms); });
    }, 2000));
    timers.push(setInterval(async () => {
      const now = performance.now();
      if (bots.some((bot) => now - bot.lastState > 3000)) abort('No state updates for over three seconds.');
      if ([...chatSent.values()].some((message) => now - message.time > 3000 && message.delivered !== message.expected)) {
        abort('A benchmark chat did not reach every client within three seconds.');
      }
      try {
        const start = performance.now();
        const response = await fetch(`${config.url}/health`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (measuring) health.push(performance.now() - start);
      } catch { if (!closing) abort('Server health check failed during load.'); }
    }, 5000));
    timers.push(setInterval(async () => {
      if (metricsBusy) return;
      metricsBusy = true;
      const snapshot = await resources();
      metricsBusy = false;
      if (!closing && snapshot?.memoryPercent.max > 85) abort('Server memory exceeded 85% of its limit.');
    }, 30000));
    console.log(`[LOAD] Measuring ${count} clients for ${config.duration}s at ${SIMULATION_HZ} inputs/s/client.`);
    let nextLog = 15;
    while (performance.now() - measureStart < config.duration * 1000 && !failure && !interrupted()) {
      const now = performance.now();
      const seconds = (now - measureStart) / 1000;
      for (const room of groups) {
        const bot = bots.find((bot) => bot.room === room);
        if (now - bot.lastChat < 15000) continue;
        bot.lastChat = now;
        const message = `SDP_LOAD_${runId}_${count}_${bot.index}_${Math.floor(seconds)}`;
        chatSent.set(message, { time: now, sender: room.sessionId, delivered: 0,
          expected: bots.filter((candidate) => candidate.room.roomId === room.roomId).length });
        room.send('chat:send', message);
      }
      if (seconds >= nextLog) {
        console.log(`[LOAD] ${count} clients | ${Math.floor(seconds)}s | input ACK p95 ${statistics(acknowledgements).p95}ms | disconnects ${disconnects}`);
        nextLog += 15;
      }
      await sleep(250);
    }
    elapsed = (performance.now() - measureStart) / 1000;
    measurementEnd = iso(); measuring = false;
    if (interrupted()) abort('Test interrupted.');
    const tickRates = tickStarts.map(({ room, tick }) => ((room.state.tick - tick) >>> 0) / elapsed);
    const resourceUsage = await resources();
    const results = {
      clients: count, rooms: groups.length, roomPopulations: groups.map((room) => room.state.online),
      startedAt: measurementStart, endedAt: measurementEnd, durationSeconds: Math.round(elapsed * 100) / 100,
      inputsSent: sentInputs, inputsPerClientPerSecond: Math.round(sentInputs / elapsed / count * 100) / 100,
      inputAcknowledgementMs: statistics(acknowledgements), websocketPingMs: statistics(pings),
      stateUpdateGapMs: statistics(intervals), observedSimulationHz: statistics(tickRates),
      healthResponseMs: statistics(health), joinMs: statistics(joinTimes), disconnects,
      movingClients: bots.filter((bot) => bot.moved).length, movementUpdates: moved, statePatches: patches,
      receivedApplicationMiB: Math.round(receivedBytes / 1024 ** 2 * 100) / 100,
      chatMessagesSent: chatSent.size, chatDeliveries: chatReceived,
      expectedChatDeliveries: [...chatSent.values()].reduce((sum, message) => sum + message.expected, 0),
      clientEventLoopP95Ms: Math.round(loopDelay.percentile(95) / 1e6 * 100) / 100,
    };
    if (!failure && (!acknowledgements.length || results.movingClients !== count || tickRates.some((hz) => hz < SIMULATION_HZ * 0.9))) {
      abort('Not every client moved or the observed simulation fell below 90% of its target.');
    }
    return { ...results, status: failure ? 'aborted' : 'completed', failure,
      resources: resourceUsage, metricErrors: [...metricErrors], cleanup };
  } catch (error) {
    failure ??= error.message;
    return { clients: count, rooms: groups.length, status: 'aborted', failure, startedAt: measurementStart,
      endedAt: iso(), disconnects, metricErrors: [...metricErrors], cleanup };
  } finally {
    measuring = false; closing = true;
    for (const timer of timers) clearInterval(timer);
    loopDelay.disable();
    const leave = async (room) => {
      room.reconnection.enabled = false;
      const timeout = setTimeout(() => room.connection?.close(), 3000);
      try { await Promise.race([room.leave(), sleep(4000)]); }
      catch { /* The socket may have closed during a safety abort. */ }
      finally { clearTimeout(timeout); room.connection?.close(); }
    };
    await Promise.all(bots.filter((bot) => !groups.includes(bot.room)).map((bot) => leave(bot.room)));
    const deadline = performance.now() + 5000;
    while (groups.some((room) => room.connection.isOpen && room.state.online !== 1) && performance.now() < deadline) await sleep(100);
    const followersRemoved = groups.every((room) => room.connection.isOpen && room.state.online === 1 && room.state.players.size === 1);
    await Promise.all(groups.map(leave));
    cleanup.remainingTestSockets = bots.filter((bot) => bot.room.connection.isOpen).length;
    cleanup.confirmed = followersRemoved && cleanup.remainingTestSockets === 0;
    if (!cleanup.confirmed) cleanup.error = 'Not all removals could be confirmed before final socket closure.';
    console.log(`[LOAD] Cleanup: ${cleanup.remainingTestSockets} test sockets remain; removals confirmed: ${cleanup.confirmed}.`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const config = configuration(args);
  const runId = Date.now().toString(36);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = path.resolve(config.output || path.join(root, '.local', `load-test-${runId}.json`));
  const report = { server: config.url, createdAt: iso(), clientsRequested: config.clients,
    methodology: { measurementSecondsPerPhase: config.duration, warmupSeconds: config.warmup,
      inputsPerSecond: SIMULATION_HZ, capacityPerRoom: MAX_PLAYERS, chatIntervalSecondsPerRoom: 15,
      renderMetricResolutionSeconds: 30, roomAssignment: 'new rooms with explicit IDs; no existing visitor rooms',
      excludes: ['Three.js rendering', 'LiveKit voice load', 'multiple client locations', 'long-running stability'] }, phases: [] };
  await mkdir(path.dirname(output), { recursive: true });
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const response = await fetch(`${config.url}/health`, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Initial health check: HTTP ${response.status}.`);
    const health = await response.json();
    if (health.capacity !== MAX_PLAYERS || health.simulationHz !== SIMULATION_HZ || health.room !== LOBBY_NAME) {
      throw new Error('The destination is not the expected SDP multiplayer server.');
    }
    const client = new Client(config.url);
    for (const count of config.clients) {
      if (stopped) break;
      const result = await runPhase(client, count, config, runId, () => stopped);
      report.phases.push(result);
      console.log(`[LOAD] RESULT ${JSON.stringify(result, (key, value) => key === 'raw' ? undefined : value)}`);
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
      if (result.status !== 'completed' || !result.cleanup.confirmed) { process.exitCode = 1; break; }
      if (count !== config.clients.at(-1)) { console.log(`[LOAD] Cooldown: ${config.cooldown}s.`); await sleep(config.cooldown * 1000); }
    }
  } finally {
    report.finishedAt = iso();
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    console.log(`[LOAD] Report: ${output}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[LOAD] ${error.message}`); process.exitCode = 1; });
}
