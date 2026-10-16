import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Scene, Vector3 } from 'three';
import type { NetworkPlayer } from '../../shared/MultiplayerProtocol';
import { PredictionHistory } from '../../src/modes/shooter/network/PredictionHistory';
import { MotionBuffer, SnapshotClock, type MotionSample } from '../../src/modes/shooter/network/SnapshotInterpolation';
import { RemoteShooterPlayers } from '../../src/modes/shooter/network/RemoteShooterPlayers';
const player = (seq: number, z: number): NetworkPlayer => ({ playerId: 'a', life: 1, lastProcessedInput: seq,
  x: 0, y: 0, z, yaw: 0, pitch: 0, connected: true });
const sample = (time: number, x: number): MotionSample => ({ time, x, y: 0, z: 0, yaw: 0, pitch: 0, height: 1.8 });
test('delayed acknowledgements compare matching input history, not the current predicted position', () => {
  const history = new PredictionHistory(); history.reset(1);
  for (let seq = 1; seq <= 30; seq++) history.record(seq, new Vector3(0, 0, -seq * .1));
  assert.equal(history.reconcile(player(10, -1)), undefined);
  assert.equal(history.corrections, 0); assert.equal(history.teleports, 0);
  const delta = history.reconcile(player(11, -.8))!;
  assert.ok(Math.abs(delta.z - .3) < .001);
  assert.equal(history.reconcile(player(11, -10)), undefined);
  assert.equal(history.reconcile(player(12, -.9)), undefined);
  assert.equal(history.corrections, 1);
  assert.equal(history.reconcile({ ...player(13, -100), life: 2 }), undefined);
  history.reset(2); assert.equal(history.reconcile({ ...player(14, -100), life: 2 }), undefined);
});
test('remote motion uses server timestamps, shortest yaw path and bounded gap extrapolation', () => {
  const motion = new MotionBuffer();
  motion.push({ ...sample(0, 0), yaw: Math.PI - .1 });
  motion.push({ ...sample(100, .6), yaw: -Math.PI + .1 });
  const middle = motion.sample(50)!;
  assert.ok(Math.abs(middle.x - .3) < .001); assert.ok(Math.abs(middle.yaw - Math.PI) < .001);
  assert.ok(Math.abs(motion.sample(150)!.x - .9) < .001);
  assert.ok(Math.abs(motion.sample(10000)!.x - 1.2) < .001);
  motion.push(sample(90, 1000)); assert.ok(motion.sample(10000)!.x < 2);
  motion.clear(); motion.push(sample(12000, 50)); assert.equal(motion.sample(12010)!.x, 50);
});
test('network jitter increases the buffer within limits without running the render clock backwards', () => {
  const clock = new SnapshotClock(); clock.receive(100, 1000);
  const before = clock.renderTime(1050);
  clock.receive(133, 1300);
  assert.ok(clock.interpolationMs > 70 && clock.interpolationMs <= 140);
  assert.ok(clock.renderTime(1060) >= before);
  assert.equal(clock.maxGapMs, 300);
  clock.reset(); clock.receive(0, 1500); assert.equal(clock.serverNow(1500), 0);
  assert.equal(clock.interpolationMs, 70);
});
test('remote muzzle follows look direction independently of the source model pose; hands follow grip and crouch', () => {
  const remotes = new RemoteShooterPlayers(new Scene(), new Group());
  try {
    const remotePlayer = { ...player(1, 0), playerId: 'remote', yaw: .8, pitch: .5, height: 1.8 };
    remotes.receive({ roomId: 'test', localPlayerId: 'self', tick: 1, receivedAt: 1000, serverTime: 1000, players: [remotePlayer] });
    remotes.update(1080); remotes.group.updateMatrixWorld(true);
    const avatar = remotes.group.children[0], model = avatar.getObjectByName('remote-weapon-model')!, mount = avatar.getObjectByName('remote-weapon-mount')!;
    const direction = new Vector3(0, 0, 1).transformDirection(model.matrixWorld);
    const expected = new Vector3(-Math.sin(.8) * Math.cos(.5), Math.sin(.5), -Math.cos(.8) * Math.cos(.5));
    assert.ok(direction.dot(expected) > .99999);
    const handMesh = avatar.getObjectByName('remote-right-hand')!;
    const hand = handMesh.position.clone();
    const grip = new Vector3(0, -.08, .12).applyEuler(mount.rotation).add(mount.position);
    assert.ok(hand.distanceTo(grip) < .00001);
    const standing = mount.position.y;
    remotes.receive({ roomId: 'test', localPlayerId: 'self', tick: 2, receivedAt: 1100, serverTime: 1100,
      players: [{ ...remotePlayer, crouching: true, height: 1.16 }] });
    for (let now = 1150; now <= 1600; now += 16) remotes.update(now);
    assert.ok(standing - mount.position.y > .5);
    remotes.group.updateMatrixWorld(true);
    const crouchedHand = handMesh.position.clone();
    const crouchedGrip = new Vector3(0, -.08, .12).applyEuler(mount.rotation).add(mount.position);
    assert.ok(crouchedHand.distanceTo(crouchedGrip) < .00001);
  } finally { remotes.dispose(); }
});
