import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { CharacterController } from '../../src/modes/shooter/physics/CharacterController';
import { ShooterWorld } from '../src/simulation/ShooterWorld';
import { regionalHit, CombatSimulation, type CombatPose } from '../src/simulation/CombatSimulation';
import { validateShooterInput } from '../../shared/ShooterProtocol';
const controls = () => ({ keys: new Set<string>(), forward: 0, sideways: 0, yaw: 0, aiming: false, consume: () => false, clear() { this.keys.clear(); } });
const advance = (physics: PhysicsWorld, player: CharacterController, frames: number) => {
  for (let i = 0; i < frames; i++) { player.beforeStep(1 / 60, false); physics.step(); player.afterStep(); }
};
test('actual Dust 2 stairs: four routes ascend/descend walking, sprinting and crouching without jumping', async () => {
  const world = await ShooterWorld.create();
  const routes = [
    { name: 'short A', a: [40.8, 0, 8], b: [46.2, 2.4384, 8] },
    { name: 'tunnel', a: [27.6, -.4064, -29.5], b: [27.6, .8128, -34] },
    { name: 'side steps', a: [12, .036, -42], b: [15, .814, -42] },
    { name: 'high treads', a: [-2, 1.374, -56], b: [-2, 2.518, -58.3] },
  ];
  try {
    for (const route of routes) for (const reverse of [false, true]) for (const gait of ['walk', 'sprint', 'crouch']) {
      const [start, end] = reverse ? [route.b, route.a] : [route.a, route.b];
      const input = controls(); input.yaw = Math.atan2(start[0] - end[0], start[2] - end[2]);
      if (gait === 'sprint') input.keys.add('ShiftLeft');
      if (gait === 'crouch') input.keys.add('ControlLeft');
      const player = new CharacterController(world.physics, input, new Vector3(start[0], start[1] + .025, start[2]));
      try {
        advance(world.physics, player, 45); input.forward = 1;
        const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
        const speed = gait === 'sprint' ? 6 : gait === 'crouch' ? 2 : 3.8;
        const maxFrames = Math.ceil((length / speed + .9) * 60);
        let progress = 0;
        for (let i = 0; i < maxFrames && progress < length - .2; i++) {
          advance(world.physics, player, 1);
          progress = ((player.current.x - start[0]) * (end[0] - start[0]) + (player.current.z - start[2]) * (end[2] - start[2])) / length;
        }
        assert.ok(progress >= length - .2, `${route.name}, ${reverse ? 'down' : 'up'}, ${gait}: stopped at ${player.current.toArray()}`);
      } finally { player.dispose(); }
    }
  } finally { world.dispose(); }
});
test('steps do not climb tall walls or teleport into a low ceiling', async () => {
  for (const ceiling of [false, true]) {
    const physics = await PhysicsWorld.initialize(), input = controls();
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(8, .1, 8).setTranslation(0, -.1, 0));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2, ceiling ? .15 : 1.2, 1).setTranslation(0, ceiling ? .15 : 1.2, -2));
    if (ceiling) physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2, .1, 2).setTranslation(0, 1.97, -2));
    const player = new CharacterController(physics, input, new Vector3(0, .03, 0));
    try { advance(physics, player, 30); input.forward = 1; advance(physics, player, 160);
      assert.ok(player.current.z > -1.1); assert.ok(player.current.y < 1.03);
    } finally { player.dispose(); physics.dispose(); }
  }
});
test('lean translates both ways, clamps against walls, and resets on release/respawn', async () => {
  const physics = await PhysicsWorld.initialize(), input = controls();
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(8, .1, 8).setTranslation(0, -.1, 0));
  const player = new CharacterController(physics, input, new Vector3(0, .03, 0));
  try {
    advance(physics, player, 30); input.keys.add('KeyQ'); advance(physics, player, 45);
    assert.ok(player.lean < -.47); assert.ok(Math.abs(player.current.x) < .01);
    input.keys.clear(); input.keys.add('KeyE'); advance(physics, player, 45); assert.ok(player.lean > .47);
    const wall = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.1, 2, 3).setTranslation(.65, 2, 0));
    physics.world.updateSceneQueries(); advance(physics, player, 1); assert.ok(player.lean < .33);
    physics.world.removeCollider(wall, false); physics.world.updateSceneQueries(); advance(physics, player, 45); assert.ok(player.lean > .47);
    input.keys.clear(); advance(physics, player, 45); assert.ok(Math.abs(player.lean) < .001);
    input.keys.add('KeyE'); advance(physics, player, 45); player.respawn(); assert.equal(player.lean, 0);
  } finally { player.dispose(); physics.dispose(); }
});
test('lean input is bounded and visible head displacement is hittable', async () => {
  const input = { seq: 1, life: 1, f: 0, r: 0, y: 0, p: 0, s: false, c: false, j: false, a: false, active: true };
  for (const l of [-1, 0, 1]) assert.equal(validateShooterInput({ ...input, l })?.l, l);
  for (const l of [2, Infinity, NaN, '1']) assert.equal(validateShooterInput({ ...input, l }), null);
  const physics = await PhysicsWorld.initialize();
  try {
    const target: CombatPose = { id: 'target', life: 1, x: 0, y: 0, z: -5, height: 1.8, time: 1000, dead: false, connected: true, protectedUntil: 0 };
    const ray = new RAPIER.Ray({ x: .48, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 });
    assert.equal(regionalHit(target, ray, 10), null);
    assert.equal(regionalHit({ ...target, lean: .48 }, ray, 10)?.region, 'head');
  } finally { physics.dispose(); }
});
test('authoritative leaning shots use exposed eye and cannot cross a wall after a fast turn', async () => {
  const world = await ShooterWorld.create();
  try {
    const shooter: CombatPose = { id: 'shooter', life: 1, x: 0, y: 100, z: 0, height: 1.8, time: 1000, dead: false, connected: true, protectedUntil: 0 };
    const target = { ...shooter, id: 'target', x: .48, z: -5 };
    const combat = new CombatSimulation(); combat.record([{ ...target, time: 800 }, target]);
    assert.equal(combat.fire(world, shooter, 0, 0, 1000, 0, [target]), null);
    assert.equal(combat.fire(world, { ...shooter, lean: .48 }, 0, 0, 1000, 0, [target])?.region, 'head');
    world.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.04, 2, 4).setTranslation(.28, 101, -2));
    world.physics.world.updateSceneQueries();
    assert.equal(combat.fire(world, { ...shooter, lean: .48 }, 0, 0, 1000, 0, [target]), null);
  } finally { world.dispose(); }
});
