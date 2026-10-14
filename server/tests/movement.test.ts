import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollisionManager } from '../../src/player/CollisionManager';
import { simulateMovement, type MotionState } from '../../shared/Movement';
import { MAX_PLAYERS, validateMovementInput, type MovementInput } from '../../shared/MultiplayerProtocol';
import { MovementSimulation } from '../src/simulation/MovementSimulation';
import { spawnPosition } from '../src/simulation/SpawnPositions';

const input: MovementInput = { seq: 1, f: 1, r: 0, y: 0, p: 0, active: true };

test('inputs reject positions, nonfinite numbers, invalid axes and invalid sequences', () => {
  assert.deepEqual(validateMovementInput(input), input);
  for (const invalid of [
    null, [], {}, { ...input, x: 200 }, { ...input, f: 2 }, { ...input, f: '1' },
    { ...input, r: Infinity }, { ...input, y: NaN }, { ...input, y: 1e50 },
    { ...input, p: Math.PI }, { ...input, active: 1 }, { ...input, seq: -1 }, { ...input, seq: 1.5 },
  ]) assert.equal(validateMovementInput(invalid), null);
});

test('fixed server steps limit speed, normalize diagonals, and stop paused input', () => {
  const simulation = new MovementSimulation();
  simulation.add('straight', { x: 20, z: 20 });
  simulation.add('diagonal', { x: 20, z: 20 });
  let straight: MotionState | undefined, diagonal: MotionState | undefined;
  for (let i = 0; i < 20; i++) {
    straight = simulation.step('straight', input);
    diagonal = simulation.step('diagonal', { ...input, r: 1 });
  }
  assert.ok(20 - straight!.z <= 3);
  assert.ok(Math.hypot(diagonal!.x - 20, diagonal!.z - 20) <= 3);
  assert.ok(Math.abs(Math.hypot(diagonal!.x - 20, diagonal!.z - 20) - (20 - straight!.z)) < 1e-6);
  const before = straight!.z;
  simulation.step('straight', { ...input, active: false });
  assert.equal(straight!.z, before);
  assert.equal(straight!.velocityZ, 0);
  simulation.remove('straight');
  assert.equal(simulation.step('straight', input), undefined);
  simulation.clear();
});
test('analog joystick inputs retain proportional speed and cannot exceed the validated speed cap', () => {
  assert.equal(validateMovementInput({ ...input, f: .5, r: -.25 })?.f, .5);
  for (const axis of [NaN, Infinity, -Infinity, 1.001, -1.001, '0.5']) assert.equal(validateMovementInput({ ...input, f: axis }), null);
  const simulation = new MovementSimulation(); simulation.add('full', { x: 20, z: 20 }); simulation.add('half', { x: 20, z: 20 });
  let full!: MotionState, half!: MotionState;
  for (let i = 0; i < 40; i++) { full = simulation.step('full', input)!; half = simulation.step('half', { ...input, f: .5 })!; }
  assert.ok(Math.abs((20 - half.z) / (20 - full.z) - .5) < 1e-6);
  assert.ok(Math.abs(full.velocityZ) <= 3); assert.ok(Math.abs(half.velocityZ) <= 1.5);
  simulation.clear();
});

test('shared local and server movement agree and preserve pedestal collisions', () => {
  const simulation = new MovementSimulation();
  simulation.add('visitor', { x: 0, z: 9 });
  const local: MotionState = { x: 0, z: 9, velocityX: 0, velocityZ: 0 };
  const world = new CollisionManager();
  let server: MotionState | undefined;
  for (let i = 0; i < 120; i++) {
    server = simulation.step('visitor', input);
    simulateMovement(local, input, 1 / 20, world);
  }
  assert.deepEqual(local, server);
  assert.ok(local.z >= 1.48 && local.z < 1.6);
});

test('all 25 server-owned spawns are separated, face the centre and avoid the pedestal', () => {
  const points = Array.from({ length: MAX_PLAYERS }, (_, i) => spawnPosition(i));
  assert.equal(points[0].x, 0);
  assert.equal(points[0].z, 9);
  for (let i = 0; i < points.length; i++) {
    assert.ok(Math.hypot(points[i].x, points[i].z) > 6);
    assert.equal(points[i].y, 1.7);
    for (let j = i + 1; j < points.length; j++) {
      assert.ok(Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z) > 1);
    }
  }
});

test('validated sprint is capped at 2.25x, normalizes diagonals and retains pedestal collisions', () => {
  assert.equal(validateMovementInput({ ...input, s: 2 }), null);
  const simulation = new MovementSimulation(); simulation.add('sprint', { x: 20, z: 20 });
  let state: MotionState | undefined;
  for (let i = 0; i < 40; i++) state = simulation.step('sprint', { ...input, s: true, r: 1 });
  assert.ok(Math.hypot(state!.velocityX, state!.velocityZ) <= 6.75);
  assert.ok(Math.hypot(state!.x - 20, state!.z - 20) > 7);
  simulation.add('pedestal', { x: 0, z: 9 });
  for (let i = 0; i < 120; i++) state = simulation.step('pedestal', { ...input, s: true });
  assert.ok(state!.z >= 1.48);
});
