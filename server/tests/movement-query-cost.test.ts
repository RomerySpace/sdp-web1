import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CharacterController } from '../../src/modes/shooter/physics/CharacterController';
import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { gameConfig } from '../../src/modes/shooter/config/gameConfig';

test('open ground avoids recursive motor queries while retaining gravity and continuous movement', async () => {
  const physics = await PhysicsWorld.initialize();
  const input = { keys: new Set<string>(), forward: 0, sideways: 0, yaw: 0, aiming: false, consume: () => false, clear() {} };
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(100, .1, 100).setTranslation(0, -.1, 0));
  const player = new CharacterController(physics, input, new Vector3(0, .03, 0));
  const original = player.motor.computeColliderMovement.bind(player.motor); let motorQueries = 0;
  player.motor.computeColliderMovement = (...args) => { motorQueries++; return original(...args); };
  const step = () => { player.beforeStep(1 / 60, false); physics.step(); player.afterStep(); };
  try {
    for (let i = 0; i < 60; i++) step();
    assert.equal(player.grounded, true); input.forward = 1;
    for (let i = 0; i < 120; i++) step();
    assert.ok(player.current.z < -gameConfig.player.walkSpeed, 'Walking must continue at its configured speed');
    assert.equal(player.grounded, true); assert.ok(Math.abs(player.current.y - player.height / 2) < .05);
    assert.equal(motorQueries, 0, 'Open ground must not run the recursive obstacle motor');
  } finally { player.dispose(); physics.dispose(); }
});

test('a thin wall still invokes obstacle resolution and cannot be crossed while sprinting or crouching', async () => {
  const physics = await PhysicsWorld.initialize();
  const input = { keys: new Set<string>(), forward: 0, sideways: .15, yaw: 0, aiming: false, consume: () => false, clear() {} };
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(100, .1, 100).setTranslation(0, -.1, 0));
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 3, .015).setTranslation(0, 3, -4));
  const player = new CharacterController(physics, input, new Vector3(0, .03, 0));
  const original = player.motor.computeColliderMovement.bind(player.motor); let motorQueries = 0;
  player.motor.computeColliderMovement = (...args) => { motorQueries++; return original(...args); };
  const step = () => { player.beforeStep(1 / 60, false); physics.step(); player.afterStep(); };
  try {
    for (let i = 0; i < 60; i++) step(); input.forward = 1; input.keys.add('ShiftLeft');
    for (let i = 0; i < 240; i++) {
      if (i === 120) input.keys.add('ControlLeft');
      step(); assert.ok(player.current.z > -4 + gameConfig.player.radius - .06, 'Capsule crossed the wall');
    }
    assert.ok(motorQueries > 0); assert.equal(player.crouching, true);
    assert.ok(player.current.x > .2, 'Sliding along the wall should remain possible');
  } finally { player.dispose(); physics.dispose(); }
});
