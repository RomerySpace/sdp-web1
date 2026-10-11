import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { certificatePath, keyPath, ensureTools, ensureCertificates, rootCAPath } from './setup-lan.mjs';
import { projectRoot, localDirectory, lanIP, port } from './lan-utils.mjs';

for (const file of ['server/.env', '.env.local']) {
  const path = resolve(projectRoot, file);
  if (existsSync(path)) process.loadEnvFile(path);
}
const children = [];
let vite;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await vite?.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

function launch(command, args, options) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.push(child);
  child.once('error', (error) => { console.error('[SDP]', error.message); void stop(1); });
  child.once('exit', (code) => { if (!stopping) { console.error(`[SDP] A service stopped (${code}). Restart npm run dev:lan.`); void stop(1); } });
  return child;
}
async function available(portNumber) {
  await new Promise((resolvePromise, reject) => {
    const server = createNetServer();
    server.once('error', () => reject(new Error(`Port ${portNumber} is busy. Stop the previous SDP services or configure SDP_WEB_PORT / PORT / LIVEKIT_PORT in .env.local.`)));
    server.listen(portNumber, '0.0.0.0', () => server.close(resolvePromise));
  });
}
async function waitFor(url) {
  for (let i = 0; i < 100 && !stopping; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Service is starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`Service did not start: ${url}`);
}

try {
  const ip = lanIP();
  const webPort = port(process.env.SDP_WEB_PORT, 5173);
  const backendPort = port(process.env.PORT, 2567);
  const livekitPort = port(process.env.LIVEKIT_PORT, 7880);
  const rtcTCP = port(process.env.LIVEKIT_RTC_TCP_PORT, 7881);
  const rtcUDP = port(process.env.LIVEKIT_RTC_UDP_PORT, 7882);
  for (const value of [webPort, backendPort, livekitPort, rtcTCP]) await available(value);
  const { mkcert, livekit } = await ensureTools();
  await ensureCertificates(mkcert);
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  const credentialsPath = resolve(localDirectory, 'livekit-credentials.json');
  let credentials;
  if (existsSync(credentialsPath)) credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  else {
    credentials = { key: `sdp_${randomBytes(12).toString('hex')}`, secret: randomBytes(48).toString('base64url') };
    await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
  }
  const key = process.env.LIVEKIT_API_KEY || credentials.key;
  const secret = process.env.LIVEKIT_API_SECRET || credentials.secret;
  if (!key || !secret || secret.length < 32) throw new Error('Local LiveKit requires an API key and a secret of at least 32 characters.');
  const configPath = resolve(localDirectory, 'livekit.yaml');
  // JSON is a YAML subset; use a structured serializer for credentials and configuration.
  await writeFile(configPath, JSON.stringify({
    port: livekitPort, bind_addresses: ['0.0.0.0'], keys: { [key]: secret },
    rtc: { tcp_port: rtcTCP, udp_port: rtcUDP, use_external_ip: false, node_ip: ip, enable_loopback_candidate: true, stun_servers: [] },
    room: { max_participants: 25, empty_timeout: 15, departure_timeout: 5 },
    logging: { level: 'warn' },
  }, null, 2), { mode: 0o600 });
  launch(livekit, ['--config', configPath], { cwd: projectRoot });
  await waitFor(`http://127.0.0.1:${livekitPort}`);
  launch(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: resolve(projectRoot, 'server'),
    env: { ...process.env, HOST: '0.0.0.0', PORT: String(backendPort),
      LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret,
      LIVEKIT_URL: `http://127.0.0.1:${livekitPort}`, LIVEKIT_PUBLIC_URL: '/voice' },
  });
  await waitFor(`http://127.0.0.1:${backendPort}/health`);
  process.env.SDP_LAN = '1';
  process.env.SDP_WEB_PORT = String(webPort);
  process.env.SDP_BACKEND_PORT = String(backendPort);
  process.env.SDP_LIVEKIT_PORT = String(livekitPort);
  vite = await createServer({ root: projectRoot, mode: 'lan' });
  await vite.listen();
  console.log(`\n[SDP] LOCAL:   https://localhost:${webPort}/`);
  console.log(`[SDP] NETWORK: https://${ip}:${webPort}/`);
  console.log(`[SDP] Frontend ${webPort} HTTPS | Colyseus ${backendPort} via /multiplayer WSS`);
  console.log(`[SDP] VOICE SERVER READY: LiveKit ${livekitPort} via /voice WSS | encrypted WebRTC TCP ${rtcTCP}, UDP ${rtcUDP}`);
  console.log(`[SDP] Trust ${rootCAPath} on BOTH computers. No certificate bypass. See LAN.md.`);
  console.log('[SDP] Keep this terminal open. Ctrl+C stops all three services.\n');
} catch (error) { console.error(`[SDP] ${error.message}`); await stop(1); process.exitCode = 1; }
