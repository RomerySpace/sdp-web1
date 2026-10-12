import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShooterInput, validateWeaponAction } from '../../shared/ShooterProtocol';
import { ShooterWorld } from '../src/simulation/ShooterWorld';
const input = { seq: 1, life: 1, f: 1, r: 0, y: 0, p: 0, s: false, c: false, j: false, a: false, active: true };
test('Shooter accepts bounded inputs, never arbitrary positions or hit reports', () => {
  assert.deepEqual(validateShooterInput(input), input);
  assert.equal(validateShooterInput({ ...input, x: 100000 }), null);
  assert.equal(validateShooterInput({ ...input, f: 10 }), null);
  assert.equal(validateShooterInput({ ...input, y: Infinity }), null);
  assert.equal(validateShooterInput({ ...input, j: 'true' }), null);
  assert.deepEqual(validateWeaponAction({ seq: 1, life: 1, action: 'fire' }), { seq: 1, life: 1, action: 'fire' });
  assert.equal(validateWeaponAction({ seq: 1, life: 1, action: 'fire', hit: 'other-player' }), null);
});
test('authoritative physics settles on actual Dust 2 geometry and assigns separated spawns', async () => {
  const world = await ShooterWorld.create();
  try {
    const a = world.add('a', 0), b = world.add('b', 1);
    assert.ok(a.spawn.distanceTo(b.spawn) > .6);
    for (let i = 0; i < 60; i++) world.step(() => false);
    assert.equal(a.grounded, true); assert.equal(b.grounded, true);
    const before = a.current.clone(); world.input('a', input);
    for (let i = 0; i < 60; i++) world.step(() => false);
    assert.ok(a.current.distanceTo(before) > .5);
    assert.ok(a.current.distanceTo(before) < 4.1);
    assert.ok(Number.isFinite(a.current.y)); world.remove('a'); assert.equal(world.player('a'), undefined);
  } finally { world.dispose(); }
});
