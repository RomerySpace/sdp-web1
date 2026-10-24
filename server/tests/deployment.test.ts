import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { OriginPolicy } from '../src/config/OriginPolicy';
import { liveKitURLs } from '../src/config/LiveKitConfig';
import { Client, type Room } from '@colyseus/sdk';
import type { AdmissionUpdate } from '../../shared/Admission';

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
  const diagnosticToken = 'production_diagnostics_test_'.padEnd(48, 'x');
  const environment = { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://sdp.example',
    SDP_REGION: 'eu', SDP_VISITOR_CAPACITY: '7', RENDER_GIT_COMMIT: 'a'.repeat(40), SDP_DIAGNOSTICS_TOKEN: diagnosticToken };
  for (const key of ['LIVEKIT_URL', 'LIVEKIT_PUBLIC_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete environment[key as keyof typeof environment];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data.toString(); });
  child.stderr.on('data', (data) => { output += data.toString(); });
  const closed = once(child, 'exit');
  const url = `http://127.0.0.1:${port}`;
  const sessions: Room[] = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      try { ready = (await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Startup is asynchronous. */ }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    const regionalHealth = await fetch(`${url}/health`, { headers: { Origin: 'https://sdp.example' } });
    assert.equal(regionalHealth.headers.get('access-control-allow-origin'), 'https://sdp.example');
    const health = await regionalHealth.json() as { region: string; revision: string; visitorCapacity: number; roomCapacities: object };
    assert.equal(health.region, 'eu'); assert.equal(health.revision, 'a'.repeat(40)); assert.equal(health.visitorCapacity, 7);
    assert.deepEqual(health.roomCapacities, { limbo: 25, shooter: 15 });
    assert.ok(!JSON.stringify(health).includes(diagnosticToken));
    assert.equal((await fetch(`${url}/diagnostics`)).status, 404);
    assert.equal((await fetch(`${url}/diagnostics?token=${diagnosticToken}`)).status, 404);
    assert.equal((await fetch(`${url}/diagnostics`, { headers: { Authorization: 'Bearer wrong' } })).status, 404);
    const privateHealth = await fetch(`${url}/diagnostics`, { headers: { Authorization: `Bearer ${diagnosticToken}`, Origin: 'https://sdp.example' } });
    assert.equal(privateHealth.status, 200); assert.equal(privateHealth.headers.get('cache-control'), 'no-store');
    const details = await privateHealth.json() as { status: string; sample: { admission: { capacity: number } } };
    assert.equal(details.status, 'available'); assert.equal(details.sample.admission.capacity, 7);
    assert.ok(!JSON.stringify(details).includes(diagnosticToken));
    assert.equal((await fetch(`${url}/diagnostics`, { headers: { Authorization: `Bearer ${diagnosticToken}`, Origin: 'https://untrusted.example' } })).status, 403);
    const rejectedHealth = await fetch(`${url}/health`, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(rejectedHealth.status, 403);
    const headers = { Origin: 'https://sdp.example', 'Content-Type': 'application/json' };
    const preflight = await fetch(`${url}/matchmake/joinOrCreate/SDPLobby`, { method: 'OPTIONS', headers: {
      Origin: 'https://sdp.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://sdp.example');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    const allowed = await fetch(`${url}/matchmake/joinOrCreate/SDPAdmission`, { method: 'POST', headers, body: '{}' });
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
    const client = new Client(url), entry = await client.joinOrCreate('SDPAdmission'); sessions.push(entry);
    const ticket = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No admission status')), 2000);
      entry.onMessage<AdmissionUpdate>('queue:status', status => { if (status.ready) { clearTimeout(timer); resolve(status.token); } });
      entry.send('queue:sync');
    });
    const visitor = await client.joinOrCreate('SDPLimboRoom', { admissionToken: ticket, displayName: 'Private Visitor' }); sessions.push(visitor);
    visitor.onMessage('station:state', () => {}); await entry.leave();
    let counted = false;
    for (let attempt = 0; attempt < 70 && !counted; attempt++) {
      const response = await fetch(`${url}/diagnostics`, { headers: { Authorization: `Bearer ${diagnosticToken}` } });
      const body = await response.json() as { sample: { modes: { limbo: { online: number; rooms: number } } } };
      counted = body.sample.modes.limbo.online === 1 && body.sample.modes.limbo.rooms === 1;
      if (counted) for (const secret of [ticket, visitor.sessionId, visitor.roomId, 'Private Visitor']) assert.ok(!JSON.stringify(body).includes(secret));
      if (!counted) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(counted, 'Production diagnostics must count a real admitted visitor without exposing their identity.');
  } finally {
    for (const session of sessions) if (session.connection.isOpen) await session.leave();
    if (child.exitCode === null) child.kill('SIGTERM');
    await closed;
  }
});
