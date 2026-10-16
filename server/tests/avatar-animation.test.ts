import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceGait } from '../../shared/AvatarAnimation';
import { AvatarLayout } from '../../shared/AvatarLayout';
import { RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { regionalHit, type CombatPose } from '../src/simulation/CombatSimulation';

test('stride follows actual travel: running is faster, blocked and airborne players do not step', () => {
  const walk = { gaitPhase: 0, gaitX: 0, gaitZ: 0 }, run = { ...walk };
  for (let i = 0; i < 60; i++) {
    advanceGait(walk, 0, -3.8 / 60, 0, true, 1 / 60);
    advanceGait(run, 0, -6 / 60, 0, true, 1 / 60);
  }
  assert.ok(run.gaitPhase > walk.gaitPhase * 1.5); assert.ok(Math.abs(run.gaitZ) > Math.abs(walk.gaitZ) * 1.4);
  const phase = run.gaitPhase;
  for (let i = 0; i < 120; i++) advanceGait(run, 0, 0, 0, true, 1 / 60);
  assert.equal(run.gaitPhase, phase); assert.ok(Math.abs(run.gaitZ) < .00001);
  advanceGait(run, 0, -.1, 0, false, 1 / 60); assert.equal(run.gaitPhase, phase);
});

test('standing and crouched articulated knees and feet remain finite, grounded and hittable', async () => {
  await RAPIER.init(); const layout = new AvatarLayout();
  for (const height of [1.8, 1.16]) for (const phase of [0, .5, 1.5, 3, 4.5]) {
    const gait = { gaitPhase: phase, gaitX: .04, gaitZ: -.28 };
    layout.update(height, 0, 0, 0, gait);
    for (let i = 0; i < 2; i++) {
      assert.ok(layout.feet[i].center.y >= .0499);
      assert.ok(layout.legs[i].height < .42); assert.ok(layout.shins[i].height < .42);
      assert.ok(layout.knees[i].toArray().every(Number.isFinite));
    }
    const target: CombatPose = { id: 'animated', life: 1, x: 0, y: 0, z: -5, height, time: 1000,
      dead: false, connected: true, protectedUntil: 0, ...gait };
    // Aim at the exposed knee; a rear leg may correctly be occluded by the torso.
    const knee = layout.knees[0].z < layout.knees[1].z ? layout.knees[0] : layout.knees[1];
    const hit = regionalHit(target, new RAPIER.Ray({ x: knee.x, y: knee.y, z: -10 }, { x: 0, y: 0, z: 1 }), 10);
    assert.equal(hit?.region, 'leg');
  }
});
