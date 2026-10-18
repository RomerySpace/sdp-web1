import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { listeningGarden as garden, listeningGardenBenches, lobbyGroundHeight, listeningBenchDistance } from '../../shared/ListeningGarden';
import { PLAYER_HEIGHT } from '../../shared/MultiplayerProtocol';
import { createListeningBench } from '../../src/scene/ListeningBench';
import { lobbySeatSlots, seatExits } from '../../shared/LobbyRetreat';
import { simulateMovement, type MotionState } from '../../shared/Movement';
import { CollisionManager } from '../../src/player/CollisionManager';
import { createLobbyGround } from '../../src/scene/LobbyGround';

test('the hollow is broad, smooth, continuous and its rendered surface matches the authoritative floor without a hidden lid', () => {
  const geometry = createLobbyGround(), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld();
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  try {
    assert.equal(lobbyGroundHeight(garden.x, garden.z), -garden.depth);
    for (let x = -14; x <= 14; x += .7) for (let z = -14; z <= 14; z += .7) {
      const px = garden.x + x, pz = garden.z + z, height = lobbyGroundHeight(px, pz);
      ray.ray.origin.set(px, 5, pz);
      const hits = ray.intersectObject(mesh);
      assert.ok(hits.length > 0, 'No holes between the plane and depression');
      assert.ok(Math.abs(hits[0].point.y - height) < .004, 'Render floor must match physics, with no flat cover');
      assert.ok(hits[0].face!.normal.y > .9, 'Walkable upward-facing slope');
      assert.ok(Math.abs(lobbyGroundHeight(px + .01, pz) - height) < .005);
    }
    assert.equal(lobbyGroundHeight(0, 0), 0);
  } finally { geometry.dispose(); material.dispose(); }
});

test('all sunken seats and exits remain on the flat lower floor, with space in the centre and a wide open approach', () => {
  const world = new CollisionManager();
  for (const slot of lobbySeatSlots.slice(18)) {
    assert.equal(slot.groundY, -garden.depth);
    assert.equal(lobbyGroundHeight(slot.x, slot.z), slot.groundY);
    assert.ok(seatExits(lobbySeatSlots.indexOf(slot)).some(p => world.canOccupy(p.x, p.z)));
  }
  assert.equal(listeningGardenBenches.length, 12);
  for (let z = garden.z - garden.outerRadius - 1; z < garden.z; z += .1) assert.ok(world.canOccupy(garden.x, z));
});

test('walking follows the depression without artificial jumps; airborne motion preserves world-space gravity across the slope', () => {
  const world = new CollisionManager(), state: MotionState = { x: garden.x, z: garden.z - 14, velocityX: 0, velocityZ: 0 };
  const input = { seq: 1, active: true, f: -1, r: 0, y: 0, p: 0 };
  let previous = lobbyGroundHeight(state.x, state.z) + PLAYER_HEIGHT, min = 10;
  for (let step = 0; step < 160; step++) {
    simulateMovement(state, input, .05, world);
    const y = world.groundHeight(state.x, state.z) + PLAYER_HEIGHT + (state.elevation ?? 0);
    assert.equal(state.elevation, 0); assert.ok(Math.abs(y - previous) < .075);
    previous = y; min = Math.min(min, y);
  }
  assert.ok(min < .06);
  state.z = garden.z - 9; state.velocityZ = 3; state.elevation = .9; state.verticalSpeed = 2;
  const before = world.groundHeight(state.x, state.z) + state.elevation;
  simulateMovement(state, input, .05, world);
  const after = world.groundHeight(state.x, state.z) + state.elevation!;
  assert.ok(Math.abs(after - before - state.verticalSpeed! * .05) < 1e-8);
});

test('the long seat is gap-free across its whole arc and collisions block between reserved places, not the entrance', () => {
  const geometry = createListeningBench(), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material), world = new CollisionManager();
  mesh.updateMatrixWorld(); const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  try {
    for (let a = -garden.halfArc + .01; a < garden.halfArc; a += .015) {
      const x = Math.sin(a) * (garden.radius - .2), z = Math.cos(a) * (garden.radius - .2);
      ray.ray.origin.set(x, 2, z);
      const hit = ray.intersectObject(mesh)[0];
      assert.ok(hit && Math.abs(hit.point.y - .46) < .015, 'No seams or missing seat surface');
      assert.ok(listeningBenchDistance(x + garden.x, z + garden.z) < .21);
      assert.equal(world.canOccupy(x + garden.x, z + garden.z), false);
    }
    assert.ok(world.canOccupy(garden.x, garden.z - garden.radius));
    assert.equal(PLAYER_HEIGHT, 1.8);
  } finally { geometry.dispose(); material.dispose(); }
});
