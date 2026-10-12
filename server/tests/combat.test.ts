import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatSimulation, hitboxDistance, type CombatPose } from '../src/simulation/CombatSimulation';
import { ShooterWorld } from '../src/simulation/ShooterWorld';
import { RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
test('Rapier head/body hitboxes follow posture rather than a model bounding box', async () => {
  await RAPIER.init();
  const p: CombatPose = { id: 'b', life: 1, x: 0, y: 0, z: -5, height: 1.8, time: 1000, dead: false, connected: true, protectedUntil: 0 };
  const ray = new RAPIER.Ray({ x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.ok(hitboxDistance(p, ray, 10)! > 4);
  assert.equal(hitboxDistance({ ...p, height: 1.16 }, ray, 10), null);
  assert.equal(hitboxDistance(p, ray, 3), null);
  assert.equal(hitboxDistance(p, new RAPIER.Ray({ x: .5, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }), 10), null);
});
test('server rays stop at geometry, rewind is bounded, dead and old lives cannot be hit', async () => {
  const world = await ShooterWorld.create();
  try {
    const a = world.add('a', 0), b = world.add('b', 1), now = 2000;
    const pose = (id: string, body: typeof a): CombatPose => ({ id, life: 1, x: body.spawn.x, y: body.spawn.y, z: body.spawn.z,
      height: 1.8, time: now - 100, dead: false, connected: true, protectedUntil: 0 });
    const shooter = pose('a', a), target = pose('b', b), combat = new CombatSimulation();
    combat.record([shooter, target]); combat.record([{ ...shooter, time: now }, { ...target, time: now }]);
    const yaw = Math.atan2(-(target.x - shooter.x), -(target.z - shooter.z));
    assert.equal(combat.fire(world, shooter, yaw, 0, now, 0, [shooter, target])?.playerId, 'b');
    assert.equal(combat.fire(world, shooter, yaw, 0, now, 0, [{ ...target, dead: true }]), null);
    assert.equal(combat.fire(world, shooter, yaw, 0, now, 0, [{ ...target, life: 2 }]), null);
    assert.equal(combat.fire(world, shooter, yaw, 0, now, 0, [{ ...target, protectedUntil: now + 10 }]), null);
    const wall = world.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.1, 2, .6).setTranslation(
      (shooter.x + target.x) / 2, shooter.y + 1, (shooter.z + target.z) / 2));
    world.physics.world.updateSceneQueries();
    assert.equal(combat.fire(world, shooter, yaw, 0, now, 0, [shooter, target]), null);
    world.physics.world.removeCollider(wall, true);
    world.physics.world.updateSceneQueries();
    // Also test an actual imported Dust 2 wall, not only the fixture cuboid.
    let foundMapWall = false;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
      const ray = new RAPIER.Ray({ x: shooter.x, y: shooter.y + 1.7, z: shooter.z }, { x: -Math.sin(angle), y: 0, z: -Math.cos(angle) });
      const wallDistance = world.wallDistance(ray, 220);
      if (wallDistance < 1 || wallDistance > 100) continue;
      const behind = { ...target, x: shooter.x - Math.sin(angle) * (wallDistance + 1), z: shooter.z - Math.cos(angle) * (wallDistance + 1), time: now };
      const geometryCombat = new CombatSimulation(); geometryCombat.record([{ ...behind, time: now - 100 }]); geometryCombat.record([behind]);
      assert.ok(hitboxDistance(behind, ray, 220)! > wallDistance);
      assert.equal(geometryCombat.fire(world, shooter, angle, 0, now, 0, [behind]), null);
      foundMapWall = true; break;
    }
    assert.ok(foundMapWall, 'Actual map geometry must block a shot.');
    world.freeze('b'); assert.equal(b.body.isEnabled(), false);
    const respawn = world.respawn('b'); assert.equal(respawn.body.isEnabled(), true);
    assert.ok(respawn.spawn.distanceTo(a.spawn) > 3);
  } finally { world.dispose(); }
});
