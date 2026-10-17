import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { RecoilRecovery } from '../../shared/RecoilRecovery';
import { shotRecoil } from '../../shared/WeaponRecoil';
import { gameplayConfig } from '../../shared/GameplayConfig';
import { rainIntensity } from '../../src/scene/RainSchedule';
import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { CharacterController } from '../../src/modes/shooter/physics/CharacterController';
import { gameConfig } from '../../src/modes/shooter/config/gameConfig';

test('recoil settles between taps, preserves deliberate compensation and keeps full automatic kick', () => {
  const recoil = new RecoilRecovery(), kick = shotRecoil(0, false, false).pitch;
  recoil.add(kick, 0);
  assert.equal(recoil.update(.1).pitch, 0);
  let returned = 0;
  for (let i = 0; i < 18; i++) returned -= recoil.update(1 / 60).pitch;
  assert.ok(returned > kick * .75 && returned < kick);
  recoil.reset(); recoil.add(kick, 0);
  assert.equal(recoil.update(.5, -kick).pitch, 0, 'Do not pull down after the player compensates');
  recoil.reset();
  for (let i = 0; i < 10; i++) { recoil.add(kick, 0); assert.equal(recoil.update(.1).pitch, 0); }
  assert.ok(recoil.pitch > kick * 8);
  assert.ok(gameplayConfig.combat.recoilReset < .3);
});

test('rain episodes are deterministic, intermittent, bounded and fade continuously', () => {
  for (let cycle = 0; cycle < 20; cycle++) {
    let wet = 0, dry = 0, previous = 0;
    for (let t = 0; t < 160; t += .1) {
      const now = cycle * 160 + t, intensity = rainIntensity(now);
      assert.ok(intensity >= 0 && intensity <= 1); assert.equal(intensity, rainIntensity(now));
      assert.ok(Math.abs(intensity - previous) < .03); previous = intensity;
      if (intensity > .99) wet++; if (intensity === 0) dry++;
    }
    assert.ok(wet > 80 && dry > 900);
  }
});

const controls = () => ({ keys: new Set<string>(), forward: 0, sideways: 0, yaw: 0, aiming: false, jump: false,
  consume(code: string) { if (code !== 'Space' || !this.jump) return false; this.jump = false; return true; }, clear() { this.keys.clear(); } });
async function floor() {
  const physics = await PhysicsWorld.initialize();
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(10, .1, 10).setTranslation(0, -.1, 0));
  return physics;
}
test('jump follows gravity without an apex hold, and a landing-buffered press jumps once', async () => {
  const physics = await floor(), input = controls();
  const player = new CharacterController(physics, input, new Vector3(0, .02, 0));
  const step = () => { player.beforeStep(1 / 60, false); physics.step(); player.afterStep(); };
  try {
    for (let i = 0; i < 45; i++) step();
    input.jump = true; step(); let queued = false, launches = 1, previousVy = player.velocity.y;
    for (let i = 0; i < 110; i++) {
      if (!queued && player.velocity.y < -3 && player.current.y - player.height / 2 < .25) { input.jump = true; queued = true; }
      step();
      if (player.tookOff) launches++;
      else if (!player.grounded && player.current.y - player.height / 2 > .15) {
        assert.ok(Math.abs(player.velocity.y - previousVy - gameConfig.player.gravity / 60) < .02, 'Ballistic acceleration');
      }
      previousVy = player.velocity.y;
    }
    assert.ok(queued); assert.equal(launches, 2);
  } finally { player.dispose(); physics.dispose(); }
});
test('duck jump clears a higher box without climbing an unreachable wall or passing a ceiling', async () => {
  for (const height of [1.45, 2.2]) {
    const physics = await floor(), input = controls();
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2, height / 2, 1).setTranslation(0, height / 2, -2));
    const player = new CharacterController(physics, input, new Vector3(0, .02, -.64));
    const step = () => { player.beforeStep(1 / 60, false); physics.step(); player.afterStep(); };
    try {
      for (let i = 0; i < 40; i++) step(); input.jump = true; input.forward = 1;
      let maxFeet = 0, crossed = false;
      for (let i = 0; i < 85; i++) {
        if (i === 4) input.keys.add('ControlLeft');
        step(); maxFeet = Math.max(maxFeet, player.current.y - player.height / 2);
        if (player.current.z < -1.2 && player.current.y - player.height / 2 > height - .05) crossed = true;
      }
      if (height < 2) assert.ok(crossed, `Duck jump must clear box: ${player.current.toArray()}, feet peak ${maxFeet}`);
      else { assert.equal(crossed, false); assert.ok(player.current.z > -1); }
    } finally { player.dispose(); physics.dispose(); }
  }
});
