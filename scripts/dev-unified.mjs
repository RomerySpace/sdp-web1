import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { ensureTools } from './setup-lan.mjs';
import { projectRoot, localDirectory, lanIP, port } from './lan-utils.mjs';

for (const file of ['server/.env', '.env.local']) if (existsSync(resolve(projectRoot, file))) process.loadEnvFile(resolve(projectRoot, file));
const webPort = port(process.env.SDP_WEB_PORT, 5373), backendPort = port(process.env.PORT, 2587);
const voicePort = port(process.env.LIVEKIT_PORT, 7980);
const children = []; let vite; let stopping = false;
async function stop(code = 0) {
  if (stopping) return; stopping = true; await vite?.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
function launch(command, args, env, cwd = projectRoot) {
  const child = spawn(command, args, { stdio: 'inherit', env, cwd }); children.push(child);
  child.once('error', error => { console.error(error.message); void stop(1); });
  child.once('exit', code => { if (!stopping) { console.error(`[SDP] Service stopped (${code}).`); void stop(1); } });
}
async function available(value) {
  await new Promise((ok, fail) => { const server = createNetServer(); server.once('error', () => fail(new Error(`Port ${value} is busy. Set SDP_WEB_PORT / PORT / LIVEKIT_PORT.`))); server.listen(value, '0.0.0.0', () => server.close(ok)); });
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Starting. */ }
    await new Promise(ok => setTimeout(ok, 200));
  }
  throw new Error(`Service did not start: ${url}`);
}
try {
  await available(webPort); await available(backendPort);
  if (!existsSync(resolve(projectRoot, 'server/assets/dust2-colliders.json.gz'))) execFileSync(process.execPath,
    ['scripts/build-shooter-collisions.mjs'], { cwd: resolve(projectRoot, 'server'), stdio: 'inherit' });
  const env = { ...process.env, HOST: '0.0.0.0', PORT: String(backendPort) };
  let voiceStatus = 'UNCONFIGURED';
  if (env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL) voiceStatus = 'EXTERNAL CONFIGURED (browser connection must be verified)';
  else if (process.env.SDP_LOCAL_VOICE !== '0') {
    try {
      await available(voicePort);
      const tcp = port(process.env.LIVEKIT_RTC_TCP_PORT, 7981), udp = port(process.env.LIVEKIT_RTC_UDP_PORT, 7982);
      await available(tcp);
      const { livekit } = await ensureTools();
      const key = `sdp_${randomBytes(12).toString('hex')}`, secret = randomBytes(48).toString('base64url');
      await mkdir(localDirectory, { recursive: true, mode: 0o700 });
      const config = resolve(localDirectory, `unified-livekit-${voicePort}.json`);
      await writeFile(config, JSON.stringify({ port: voicePort, bind_addresses: ['0.0.0.0'], keys: { [key]: secret },
        rtc: { tcp_port: tcp, udp_port: udp, use_external_ip: false, node_ip: lanIP(), enable_loopback_candidate: true, stun_servers: [] },
        room: { max_participants: 25, empty_timeout: 15, departure_timeout: 5 }, logging: { level: 'warn' } }), { mode: 0o600 });
      launch(livekit, ['--config', config], process.env); await waitFor(`http://127.0.0.1:${voicePort}`);
      Object.assign(env, { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, LIVEKIT_URL: `http://127.0.0.1:${voicePort}`, LIVEKIT_PUBLIC_URL: '/voice' });
      voiceStatus = `LOCAL SERVER READY ${voicePort} (browser connection must be verified)`;
    } catch (error) { console.warn(`[SDP] Local voice unavailable: ${error.message}. See UNIFIED-SDP.md.`); }
  }
  launch(process.execPath, ['--import', 'tsx', '--watch', 'src/index.ts'], env, resolve(projectRoot, 'server'));
  await waitFor(`http://127.0.0.1:${backendPort}/health`);
  Object.assign(process.env, { SDP_WEB_PORT: String(webPort), SDP_BACKEND_PORT: String(backendPort),
    SDP_LIVEKIT_PORT: String(voicePort), VITE_SDP_SERVER_URL: '/multiplayer' });
  vite = await createServer({ root: projectRoot, mode: 'unified' }); await vite.listen();
  console.log(`\n[SDP] UNIFIED LOCAL: http://localhost:${webPort}/`);
  console.log(`[SDP] NETWORK VIEW: http://${lanIP()}:${webPort}/ (LAN microphone requires npm run dev:lan HTTPS)`);
  console.log(`[SDP] Frontend ${webPort} | Backend ${backendPort} | Voice ${voiceStatus}`);
  console.log(`[SDP] DEV SHOOTER: http://localhost:${webPort}/?debugMode=shooter\n`);
} catch (error) { console.error(`[SDP] ${error.message}`); await stop(1); }
