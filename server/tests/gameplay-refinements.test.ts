import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthRecovery } from '../src/simulation/HealthRecovery';
import { regionalHit, type CombatPose } from '../src/simulation/CombatSimulation';
import { deriveSpawnNavigation } from '../src/simulation/SpawnNavigation';
import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { gameplayConfig } from '../../shared/GameplayConfig';
import { validateDisplayName, roomDisplayName } from '../../shared/PlayerIdentity';
import { shotRecoil } from '../../shared/WeaponRecoil';

test('recovery waits seven seconds, heals progressively, resets on damage and never heals dead players', () => {
  const recovery = new HealthRecovery(), player = { health: 50, lastDamageAt: 1000, dead: false, connected: true };
  for (let i = 0; i < 420; i++) recovery.step(player, 1000 + i * 1000 / 60, 1 / 60);
  assert.equal(Number(player.health), 50);
  for (let i = 0; i < 60; i++) recovery.step(player, 8000 + i * 1000 / 60, 1 / 60);
  assert.equal(Number(player.health), 60);
  player.health -= 25; player.lastDamageAt = 9000; recovery.interrupt();
  recovery.step(player, 15999, 1 / 60); assert.equal(Number(player.health), 35);
  for (let i = 0; i < 60; i++) recovery.step(player, 16000 + i * 1000 / 60, 1 / 60);
  assert.equal(Number(player.health), 45);
  player.dead = true; recovery.step(player, 40000, 1); assert.equal(Number(player.health), 45);
  player.dead = false; player.connected = false; recovery.step(player, 40000, 1); assert.equal(Number(player.health), 45);
  player.connected = true;
  for (let i = 0; i < 600; i++) recovery.step(player, 40000 + i * 1000 / 60, 1 / 60);
  assert.equal(player.health, 100);
});
test('regional shapes distinguish head, torso, arms, legs and feet in the shared avatar pose', async () => {
  await RAPIER.init();
  const pose: CombatPose = { id: 'target', life: 1, x: 0, y: 0, z: -5, height: 1.8, time: 1000,
    dead: false, connected: true, protectedUntil: 0, yaw: 0, pitch: 0 };
  for (const [x, y, region] of [[0, 1.65, 'head'], [0, 1.1, 'torso'], [-.29, 1.38, 'arm'], [.14, .35, 'leg'], [.14, .04, 'foot']] as const) {
    const hit = regionalHit(pose, new RAPIER.Ray({ x, y, z: 0 }, { x: 0, y: 0, z: -1 }), 10);
    assert.equal(hit?.region, region, `Expected ${region} at ${x},${y}`);
    assert.ok(hit!.distance > 4);
  }
  assert.deepEqual(gameplayConfig.combat.regionDamage, { arm: 25, leg: 25, torso: 50, head: 100, foot: 12 });
  assert.equal(regionalHit({ ...pose, height: 1.16 }, new RAPIER.Ray({ x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 }), 10), null);
});
test('names are bounded plain text, unique within a room, and recoil rises with automatic bursts', () => {
  assert.equal(validateDisplayName('  Álvaro  SDP '), 'Álvaro SDP');
  for (const name of ['<script>x</script>', 'a', 'a'.repeat(21), 'name\u202e']) assert.equal(validateDisplayName(name), null);
  assert.equal(roomDisplayName('Visitor', ['visitor'], 'Fallback'), 'Visitor #2');
  assert.ok(shotRecoil(10, true, false).pitch > shotRecoil(0, true, false).pitch);
  assert.ok(shotRecoil(0, true, true).pitch < shotRecoil(0, true, false).pitch);
});
test('spawn connectivity excludes sealed ground-level courtyards as well as rooftops', async () => {
  const physics = await PhysicsWorld.initialize();
  try {
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(20, .1, 20).setTranslation(0, -.1, 0));
    for (const x of [0, -10]) {
      for (const sign of [-1, 1]) {
        physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.2, 2, 3.2).setTranslation(x + sign * 3, 2, 0));
        physics.world.createCollider(RAPIER.ColliderDesc.cuboid(3.2, 2, .2).setTranslation(x, 2, sign * 3));
      }
    }
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(3.2, .1, 3.2).setTranslation(-10, 4, 0));
    physics.world.updateSceneQueries();
    const navigation = deriveSpawnNavigation(physics, { minX: -20, minZ: -20, maxX: 20, maxZ: 20 });
    assert.ok(navigation.connectedCells > 500); assert.ok(navigation.points.length >= 30);
    for (const [x, y, z] of navigation.points) {
      assert.ok(y < .1);
      for (const roomX of [0, -10]) assert.ok(Math.abs(x - roomX) > 3.2 || Math.abs(z) > 3.2, `Sealed spawn: ${x},${y},${z}`);
    }
  } finally { physics.dispose(); }
});
