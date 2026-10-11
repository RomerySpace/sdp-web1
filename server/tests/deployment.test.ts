import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { OriginPolicy } from '../src/config/OriginPolicy';
import { liveKitURLs } from '../src/config/LiveKitConfig';

test('online origins are explicit and reject other Vercel projects and opaque origins', () => {
  const origins = new OriginPolicy('https://sdp.example, https://preview.example/', true);
  assert.equal(origins.allows('https://sdp.example'), true);
  assert.equal(origins.allows('https://preview.example'), true);
  assert.equal(origins.allows('https://sdp.example.evil.test'), false);
  assert.equal(origins.allows('https://other.vercel.app'), false);
  assert.equal(origins.allows('null'), false);
  assert.equal(origins.allows(undefined), true);
  assert.equal(origins.corsOrigin('https://other.vercel.app'), 'null');
  assert.throws(() => new OriginPolicy('', true), /ALLOWED_ORIGINS/);
  assert.throws(() => new OriginPolicy('http://sdp.example', true), /HTTPS/);
  assert.throws(() => new OriginPolicy('https://sdp.example/path', true), /exact/);
});

test('development still accepts local and LAN browser origins without extra configuration', () => {
  const origins = new OriginPolicy('', false);
  assert.equal(origins.allows('https://172.20.10.2:5173'), true);
  assert.equal(origins.allows('http://localhost:5173'), true);
  assert.deepEqual(liveKitURLs({}), { apiURL: 'http://127.0.0.1:7880', publicURL: '/voice' });
  assert.deepEqual(liveKitURLs({ LIVEKIT_URL: 'http://127.0.0.1:7880', LIVEKIT_PUBLIC_URL: '/voice' }),
    { apiURL: 'http://127.0.0.1:7880', publicURL: '/voice' });
});

test('LiveKit Cloud maps its secure websocket URL to HTTPS for backend room management', () => {
  assert.deepEqual(liveKitURLs({ NODE_ENV: 'production', LIVEKIT_URL: 'wss://project.livekit.cloud' }),
    { apiURL: 'https://project.livekit.cloud', publicURL: 'wss://project.livekit.cloud' });
  assert.throws(() => liveKitURLs({ NODE_ENV: 'production', LIVEKIT_API_KEY: 'test' }), /LIVEKIT_URL/);
  assert.throws(() => liveKitURLs({ NODE_ENV: 'production', LIVEKIT_URL: 'http://project.livekit.cloud' }), /HTTPS/);
  assert.throws(() => liveKitURLs({ NODE_ENV: 'production', LIVEKIT_URL: 'https://project.livekit.cloud', LIVEKIT_PUBLIC_URL: '/voice' }));
  assert.throws(() => liveKitURLs({ LIVEKIT_URL: 'https://user:password@project.livekit.cloud' }), /credentials/);
});

test('production matchmaking and WebSocket upgrades enforce the same allowed origins', { timeout: 20000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  const environment = { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://sdp.example' };
  for (const key of ['LIVEKIT_URL', 'LIVEKIT_PUBLIC_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete environment[key as keyof typeof environment];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data.toString(); });
  child.stderr.on('data', (data) => { output += data.toString(); });
  const closed = once(child, 'exit');
  const url = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      try { ready = (await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Startup is asynchronous. */ }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    const headers = { Origin: 'https://sdp.example', 'Content-Type': 'application/json' };
    const preflight = await fetch(`${url}/matchmake/joinOrCreate/SDPLobby`, { method: 'OPTIONS', headers: {
      Origin: 'https://sdp.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://sdp.example');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    const allowed = await fetch(`${url}/matchmake/joinOrCreate/SDPLobby`, { method: 'POST', headers, body: '{}' });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://sdp.example');
    const denied = await fetch(`${url}/matchmake/joinOrCreate/SDPLobby`, {
      method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: '{}',
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), 'null');

    async function upgrade(origin: string): Promise<number> {
      return new Promise((resolve, reject) => {
        const upgradeRequest = request(url, { headers: {
          Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        } });
        upgradeRequest.on('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode!); });
        upgradeRequest.on('response', (response) => { response.resume(); resolve(response.statusCode!); });
        upgradeRequest.on('error', reject);
        upgradeRequest.setTimeout(2000, () => upgradeRequest.destroy(new Error('WebSocket upgrade timed out.')));
        upgradeRequest.end();
      });
    }
    assert.equal(await upgrade('https://sdp.example'), 101);
    assert.equal(await upgrade('https://untrusted.example'), 401);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await closed;
  }
});
