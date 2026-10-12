import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShooterInput, validateWeaponAction } from '../../shared/ShooterProtocol';
import { ShooterWorld } from '../src/simulation/ShooterWorld';
import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { findSpawn } from '../../src/modes/shooter/physics/CharacterController';
import { gameConfig } from '../../src/modes/shooter/config/gameConfig';
const input = { seq: 1, life: 1, f: 1, r: 0, y: 0, p: 0, s: false, c: false, j: false, a: false, active: true };
test('Shooter accepts bounded inputs, never arbitrary positions or hit reports', () => {
  assert.deepEqual(validateShooterInput(input), input);
  assert.equal(validateShooterInput({ ...input, x: 100000 }), null);
  assert.equal(validateShooterInput({ ...input, f: 10 }), null);
  assert.equal(validateShooterInput({ ...input, y: Infinity }), null);
  assert.equal(validateShooterInput({ ...input, j: 'true' }), null);
  assert.equal(validateShooterInput({ ...input, f: .5, r: -.25 })?.r, -.25);
  for (const axis of [NaN, Infinity, -Infinity, 1.001, -1.001, '0.5']) assert.equal(validateShooterInput({ ...input, r: axis }), null);
  assert.deepEqual(validateWeaponAction({ seq: 1, life: 1, action: 'fire' }), { seq: 1, life: 1, action: 'fire' });
  assert.equal(validateWeaponAction({ seq: 1, life: 1, action: 'fire', hit: 'other-player' }), null);
});
test('analog Shooter movement uses the same Rapier controller locally and on the server', async () => {
  const physics = await PhysicsWorld.initialize();
  const { CharacterController } = await import('../../src/modes/shooter/physics/CharacterController');
  const { Vector3 } = await import('three');
  const makeInput = (forward: number) => ({ forward, sideways: 0, yaw: 0, aiming: false, keys: new Set<string>(), consume: () => false, clear: () => {} });
  try {
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(30, .1, 30).setTranslation(0, -.1, 0));
    const full = new CharacterController(physics, makeInput(1), new Vector3(-4, 0, 0));
    const half = new CharacterController(physics, makeInput(.5), new Vector3(4, 0, 0));
    for (let i = 0; i < 120; i++) { full.beforeStep(1 / 60, false); half.beforeStep(1 / 60, false); physics.step(); full.afterStep(); half.afterStep(); }
    assert.ok(Math.abs(half.velocity.z) > gameConfig.player.walkSpeed * .45);
    assert.ok(Math.abs(half.velocity.z) < gameConfig.player.walkSpeed * .55);
    assert.ok(Math.abs(full.velocity.z) <= gameConfig.player.walkSpeed + .01);
    full.dispose(); half.dispose();
  } finally { physics.dispose(); }
});
test('ground search stays below roofs and refuses unsupported floors', async () => {
  const physics = await PhysicsWorld.initialize(), seed = gameConfig.player.spawn;
  try {
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(8, .1, 8).setTranslation(seed.x, -.1, seed.z));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(8, .1, 8).setTranslation(seed.x, 6, seed.z));
    physics.world.updateSceneQueries();
    const spawn = findSpawn(physics);
    assert.ok(spawn.y < .1, `Unexpected rooftop spawn: ${spawn.y}`);
    assert.throws(() => findSpawn(physics, { ...seed, x: 1000 }), /No safe floor/);
  } finally { physics.dispose(); }
});
test('all 25 initial spawns and repeated respawns stay on separated ground-level map floors', async () => {
  const world = await ShooterWorld.create();
  try {
    for (let i = 0; i < 25; i++) {
      const p = world.add(String(i), i);
      assert.ok(p.spawn.y > -.1 && p.spawn.y < 1, `Initial spawn ${i}: ${p.spawn.toArray()}`);
      for (let j = 0; j < i; j++) assert.ok(p.spawn.distanceTo(world.player(String(j))!.spawn) > .7);
    }
    for (let i = 0; i < 60; i++) world.step(() => false);
    for (let i = 0; i < 25; i++) {
      world.freeze(String(i));
      const p = world.respawn(String(i));
      assert.ok(p.spawn.y > -.1 && p.spawn.y < 1, `Respawn ${i}: ${p.spawn.toArray()}`);
      for (let j = 0; j < 25; j++) if (i !== j) assert.ok(Math.hypot(p.spawn.x - world.player(String(j))!.current.x,
        p.spawn.z - world.player(String(j))!.current.z) > .7);
      for (let tick = 0; tick < 20; tick++) world.step(() => false);
      assert.equal(p.grounded, true);
    }
  } finally { world.dispose(); }
});
test('authoritative physics settles on actual Dust 2 geometry and assigns separated spawns', async () => {
  const world = await ShooterWorld.create();
  try {
    const a = world.add('a', 0), b = world.add('b', 1);
    assert.ok(a.spawn.distanceTo(b.spawn) > .6);
    for (let i = 0; i < 60; i++) world.step(() => false);
    assert.equal(a.grounded, true); assert.equal(b.grounded, true);
    const before = a.current.clone(); world.input('a', { ...input, y: Math.PI });
    for (let i = 0; i < 60; i++) world.step(() => false);
    assert.ok(a.current.distanceTo(before) > .5);
    assert.ok(a.current.distanceTo(before) < 4.1);
    assert.ok(Number.isFinite(a.current.y)); world.remove('a'); assert.equal(world.player('a'), undefined);
  } finally { world.dispose(); }
});
