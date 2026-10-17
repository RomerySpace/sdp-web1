import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import type { ShooterState } from '../src/state/ShooterState';
import type { WeaponEvent } from '../../shared/ShooterProtocol';
import { validateShooterInput } from '../../shared/ShooterProtocol';
import { gameplayConfig } from '../../shared/GameplayConfig';
import { airstrikeFixture } from './airstrike-fixture';
import { Vector3 } from 'three';
import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { CharacterController } from '../../src/modes/shooter/physics/CharacterController';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out waiting for state'); await sleep(20); }
}
test('shooter jump has a short grounded flight and preserves the configured clearance', async () => {
  const physics = await PhysicsWorld.initialize(); let jump = false;
  const input = { keys: new Set<string>(), forward: 0, sideways: 0, yaw: 0, aiming: false,
    consume: (code: string) => { if (code !== 'Space' || !jump) return false; jump = false; return true; }, clear() {} };
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(10, .1, 10).setTranslation(0, -.1, 0));
  const player = new CharacterController(physics, input, new Vector3(0, .02, 0));
  const step = () => { player.beforeStep(1 / 60, false); physics.step(); player.afterStep(); };
  try {
    for (let i = 0; i < 45; i++) step(); assert.equal(player.grounded, true);
    const baseline = player.current.y; let height = 0, frames = 0; jump = true; step();
    assert.equal(player.tookOff, true);
    while (!player.grounded && frames < 120) { step(); frames++; height = Math.max(height, player.current.y - baseline); }
    assert.ok(height > 1 && height < 1.25, `Apex: ${height}`);
    assert.ok(frames / 60 > .5 && frames / 60 < .8, `Flight: ${frames / 60}`);
    assert.equal(player.grounded, true);
  } finally { player.dispose(); physics.dispose(); }
});
test('real server caps an automatic magazine, preserves infinite reserve, traces walls and isolates flashlight state', { timeout: 20000 }, async () => {
  const fixture = await airstrikeFixture(), client = new Client(`http://127.0.0.1:${fixture.port}`);
  const a = await client.joinOrCreate<ShooterState>('SDPShooterRoom'), b = await client.joinById<ShooterState>(a.roomId);
  const shots: WeaponEvent[] = [];
  let timer: ReturnType<typeof setInterval> | undefined, seq = 0, action = 0, light = true;
  for (const room of [a, b]) {
    room.onMessage('combat:ping', nonce => room.send('combat:pong', nonce)); room.onMessage('combat:event', () => {});
    room.onMessage('weapon:event', (event: WeaponEvent) => { if (room === b && event.action === 'fire') shots.push(event); });
  }
  try {
    await waitFor(() => !!a.state.players?.get(a.sessionId));
    const own = () => a.state.players.get(a.sessionId)!;
    const input = () => ({ seq: ++seq, life: own().life, f: 0, r: 0, y: 0, p: -1, s: false, c: false, j: false, a: false, t: light, active: true });
    assert.ok(validateShooterInput(input())); assert.equal(validateShooterInput({ ...input(), t: 123 }), null);
    timer = setInterval(() => a.send('shooter:input', input()), 33);
    await waitFor(() => !!b.state.players?.get(a.sessionId)?.flashlight);
    assert.equal(b.state.players.get(b.sessionId)!.flashlight, false);
    light = false; await waitFor(() => !b.state.players.get(a.sessionId)!.flashlight);
    a.send('weapon:action', { seq: ++action, life: own().life, action: 'mode' });
    await waitFor(() => own().automatic);
    for (let i = 0; i < 34; i++) { a.send('weapon:action', { seq: ++action, life: own().life, action: 'fire' }); await sleep(120); }
    await waitFor(() => own().ammo === 0); assert.equal(shots.length, 30);
    for (const event of shots) {
      assert.equal(event.origin?.length, 3); assert.equal(event.target?.length, 3);
      assert.ok(event.target!.every(Number.isFinite));
      assert.ok(Math.hypot(...event.target!.map((n, i) => n - event.origin![i])) <= gameplayConfig.combat.range + .001);
      assert.ok(Math.hypot(...event.target!.map((n, i) => n - event.origin![i])) < 4, 'Downward tracer must stop at the map floor');
    }
    const reserve = own().reserve;
    a.send('weapon:action', { seq: ++action, life: own().life, action: 'reload' });
    await waitFor(() => own().reloading); assert.equal(own().ammo, 0);
    await waitFor(() => !own().reloading); assert.equal(own().ammo, 30); assert.equal(own().reserve, reserve);
    assert.ok(a.state.matchEndsAt - a.state.serverTime > 400000);
    light = true; await waitFor(() => !!b.state.players.get(a.sessionId)!.flashlight);
    clearInterval(timer); timer = undefined;
    await waitFor(() => !b.state.players.get(a.sessionId)!.flashlight);
  } finally { if (timer) clearInterval(timer); await a.leave(); await b.leave(); await fixture.server.gracefullyShutdown(false); }
});
