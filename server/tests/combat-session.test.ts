import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { SHOOTER_ROOM, type CombatEvent } from '../../shared/ShooterProtocol';
import type { ShooterState } from '../src/state/ShooterState';
import type { LobbyState } from '../src/state/LobbyState';
async function waitFor(predicate: () => boolean, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() >= end) throw new Error('Authoritative state timed out.'); await new Promise(r => setTimeout(r, 20)); }
}
async function host(enabled: boolean) {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(r => reservation.close(() => r()));
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development', ENABLE_SHOOTER_TEST: String(enabled) };
  for (const key of ['LIVEKIT_URL', 'LIVEKIT_PUBLIC_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete env[key];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; child.stdout.on('data', bytes => log += bytes.toString()); child.stderr.on('data', bytes => log += bytes.toString());
  const exited = once(child, 'exit'), url = `http://127.0.0.1:${port}`;
  const close = async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; };
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) })).ok) return { url, close }; } catch { /* Starting. */ }
      if (child.exitCode !== null) break; await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(log || 'Test server did not start.');
  } catch (error) { await close(); throw error; }
}
test('disabled feature rejects matchmaking and advertises the restriction in Limbo', { timeout: 15000 }, async () => {
  const server = await host(false); const client = new Client(server.url);
  try {
    await assert.rejects(() => client.joinOrCreate(SHOOTER_ROOM), /disabled/i);
    const limbo = await client.joinOrCreate<{ state: LobbyState }>('SDPLimboRoom');
    try { await waitFor(() => !!limbo.state.players); assert.equal(limbo.state.shooterEnabled, false); }
    finally { await limbo.leave(); }
    await assert.rejects(() => client.create(SHOOTER_ROOM), /disabled/i);
  } finally { await server.close(); }
});
test('real server controls fire rate, health, dead input, respawn and stale-life replay', { timeout: 20000 }, async () => {
  const server = await host(true), client = new Client(server.url);
  const a = await client.joinOrCreate<{ state: ShooterState }>(SHOOTER_ROOM), b = await client.joinOrCreate<{ state: ShooterState }>(SHOOTER_ROOM);
  const events: CombatEvent[] = [];
  for (const room of [a, b]) {
    room.onMessage('combat:ping', (nonce: string) => room.send('combat:pong', nonce));
    room.onMessage('combat:event', (event: CombatEvent) => { if (room === a) events.push(event); });
    room.onMessage('weapon:event', () => {});
  }
  let timer: ReturnType<typeof setInterval> | undefined, seq = 0;
  try {
    assert.equal(a.roomId, b.roomId); await waitFor(() => !!a.state.players?.get(b.sessionId));
    const own = () => a.state.players.get(a.sessionId)!, target = () => a.state.players.get(b.sessionId)!;
    const yaw = Math.atan2(-(target().x - own().x), -(target().z - own().z));
    const pitch = Math.atan2(target().y + 1.14 - (own().y + 1.7), Math.hypot(target().x - own().x, target().z - own().z));
    timer = setInterval(() => a.send('shooter:input', { seq: ++seq, life: own().life, f: 0, r: 0, y: yaw, p: pitch, s: false, c: false, j: false, a: false, active: true }), 50);
    await waitFor(() => a.state.serverTime > target().protectedUntil + 250);
    a.send('weapon:action', { seq: 1, life: 1, action: 'fire', hit: b.sessionId, damage: 1000 });
    await new Promise(r => setTimeout(r, 100)); assert.equal(target().health, 100); assert.equal(own().ammo, 30);
    a.send('weapon:action', { seq: 2, life: 1, action: 'fire' });
    a.send('weapon:action', { seq: 3, life: 1, action: 'fire' });
    await waitFor(() => target().health === 50); assert.equal(own().ammo, 29);
    await new Promise(r => setTimeout(r, 180)); a.send('weapon:action', { seq: 4, life: 1, action: 'fire' });
    await waitFor(() => target().dead); const death = target().diedAt, x = target().x, z = target().z;
    b.send('shooter:input', { seq: 500, life: 1, f: 1, r: 1, y: 0, p: 0, s: true, c: false, j: true, a: true, active: true });
    b.send('weapon:action', { seq: 500, life: 1, action: 'fire' }); b.send('weapon:action', { seq: 501, life: 1, action: 'reload' });
    await new Promise(r => setTimeout(r, 300)); assert.equal(target().ammo, 30); assert.equal(target().reloading, false);
    assert.equal(target().x, x); assert.equal(target().z, z);
    await waitFor(() => target().life === 2); assert.ok(target().bornAt - death >= 3000); assert.ok(target().bornAt - death < 3250);
    assert.equal(target().health, 100); assert.equal(target().dead, false); assert.equal(target().ammo, 30);
    b.send('weapon:action', { seq: 502, life: 1, action: 'fire' });
    b.send('shooter:input', { seq: 501, life: 1, f: 1, r: 0, y: 0, p: 0, s: false, c: false, j: false, a: false, active: true });
    await new Promise(r => setTimeout(r, 100)); assert.equal(target().ammo, 30); assert.ok(target().lastProcessedInput < 500);
    assert.equal(events.filter(e => e.type === 'death').length, 1); assert.equal(events.filter(e => e.type === 'respawn').length, 1);
  } finally { if (timer) clearInterval(timer); await a.leave(); await b.leave(); await server.close(); }
});
test('real sessions synchronize chosen names, regional damage, interrupted regeneration, streaks and automatic fire', { timeout: 35000 }, async () => {
  const server = await host(true), client = new Client(server.url);
  const a = await client.joinOrCreate<ShooterState>(SHOOTER_ROOM, { displayName: 'Burst One' });
  const b = await client.joinOrCreate<ShooterState>(SHOOTER_ROOM, { displayName: 'Target Two' });
  const events: CombatEvent[] = [];
  for (const room of [a, b]) {
    room.onMessage('combat:ping', (nonce: string) => room.send('combat:pong', nonce));
    room.onMessage('combat:event', (event: CombatEvent) => { if (room === a) events.push(event); });
    room.onMessage('weapon:event', () => {});
  }
  let timer: ReturnType<typeof setInterval> | undefined, seq = 0, action = 0, head = false;
  try {
    await waitFor(() => !!a.state.players?.get(b.sessionId));
    const own = () => a.state.players.get(a.sessionId)!, target = () => a.state.players.get(b.sessionId)!;
    assert.equal(own().displayName, 'Burst One'); assert.equal(target().displayName, 'Target Two');
    await assert.rejects(() => client.joinById(a.roomId, { displayName: '<script>bad</script>' }), /Invalid display name/);
    timer = setInterval(() => {
      const dx = target().x - own().x, dz = target().z - own().z;
      a.send('shooter:input', { seq: ++seq, life: own().life, f: 0, r: 0, y: Math.atan2(-dx, -dz),
        p: Math.atan2(target().y + (head ? 1.65 : 1.14) - (own().y + 1.7), Math.hypot(dx, dz)), s: false, c: false, j: false, a: false, active: true });
    }, 33);
    const fire = () => a.send('weapon:action', { seq: ++action, life: own().life, action: 'fire' });
    await waitFor(() => a.state.serverTime > target().protectedUntil + 250);
    fire(); await waitFor(() => target().health === 50);
    assert.equal(events.find(e => e.type === 'damage')?.region, 'torso');
    await waitFor(() => target().health >= 58, 9500);
    assert.ok(target().health < 70, 'Recovery must be progressive, not instant.');
    const before = target().health; fire(); await waitFor(() => target().health < before);
    const secondDamageAt = target().lastDamageAt, damaged = target().health;
    assert.equal(before - damaged, 50);
    await waitFor(() => a.state.serverTime > secondDamageAt + 6600, 7200);
    assert.equal(target().health, damaged, 'New damage must reset the seven-second recovery timer.');
    await waitFor(() => target().health > damaged, 1200);
    head = true; await new Promise(r => setTimeout(r, 160)); fire();
    await waitFor(() => target().dead);
    assert.equal(events.filter(e => e.type === 'damage').at(-1)?.region, 'head');
    assert.equal(own().kills, 1); assert.equal(own().streak, 1); assert.equal(target().deaths, 1); assert.equal(target().streak, 0);
    assert.equal(a.state.killFeed[0].attackerName, 'Burst One'); assert.equal(a.state.killFeed[0].victimName, 'Target Two');
    await waitFor(() => target().life === 2); assert.equal(target().health, 100);
    clearInterval(timer); timer = undefined;
    a.send('weapon:action', { seq: ++action, life: own().life, action: 'mode' });
    await waitFor(() => own().automatic);
    a.send('shooter:input', { seq: ++seq, life: own().life, f: 0, r: 0, y: 0, p: 1, s: false, c: false, j: false, a: false, active: true });
    await new Promise(r => setTimeout(r, 50)); const ammo = own().ammo;
    fire(); fire(); await waitFor(() => own().ammo === ammo - 1);
    await new Promise(r => setTimeout(r, 120)); fire(); await waitFor(() => own().ammo === ammo - 2);
    assert.ok(own().pitch > 1, 'Authoritative automatic fire must also apply rising aim recoil.');
  } finally { if (timer) clearInterval(timer); await a.leave(); await b.leave(); await server.close(); }
});
