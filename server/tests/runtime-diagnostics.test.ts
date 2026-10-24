import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationSampler, RuntimeDiagnostics, diagnosticsAuthorization, type SimulationReading } from '../src/monitoring/RuntimeDiagnostics';
import { Admission } from '../src/communication/Admission';

test('simulation diagnostics measure actual active ticks, wrap counters and discard departed rooms', () => {
  const sampler = new SimulationSampler();
  const room: SimulationReading = { id: 'private-room-id', mode: 'shooter', tick: 100, online: 2, players: 3, targetHz: 60 };
  assert.equal(sampler.sample([room], 0).shooter.measuredRooms, 0);
  const normal = sampler.sample([{ ...room, tick: 400 }], 5000).shooter;
  assert.equal(normal.simulationHzMean, 60); assert.equal(normal.slowRooms, 0);
  assert.equal(normal.reservedPlayers, 1); assert.equal(normal.online, 2);
  const slow = sampler.sample([{ ...room, tick: 550 }], 10000).shooter;
  assert.equal(slow.simulationHzMin, 30); assert.equal(slow.slowRooms, 1);
  assert.ok(!JSON.stringify(slow).includes(room.id));
  sampler.sample([], 15000);
  assert.equal(sampler.sample([room], 20000).shooter.measuredRooms, 0);
  sampler.sample([{ ...room, tick: 0xfffffff0 }], 25000);
  assert.equal(sampler.sample([{ ...room, tick: 44 }], 26000).shooter.simulationHzMean, 60);
  sampler.sample([{ ...room, online: 0 }], 27000);
  assert.equal(sampler.sample([room], 28000).shooter.measuredRooms, 0);
});

test('diagnostics are disabled without a secret and only accept the exact bearer header', () => {
  assert.equal(diagnosticsAuthorization('')('Bearer anything'), false);
  assert.throws(() => diagnosticsAuthorization('short'), /32-128/);
  assert.throws(() => diagnosticsAuthorization('x'.repeat(32) + '\n'), /32-128/);
  const token = 'private_test_'.padEnd(48, 'x'), authorized = diagnosticsAuthorization(token);
  assert.equal(authorized(undefined), false);
  assert.equal(authorized(token), false);
  assert.equal(authorized(`Bearer ${token}wrong`), false);
  assert.equal(authorized(`Bearer ${token}`), true);
  assert.equal(authorized('x'.repeat(1000)), false);
});

test('admission diagnostics expose aggregate counts only and exclude expired reservations', () => {
  const a = new Admission(); a.capacity = 1;
  const now = Date.now(), admitted = a.request(null, 'private-watcher', now);
  const waiting = a.request(null, 'second-watcher', now);
  a.unwatch(waiting, 'second-watcher', now);
  assert.deepEqual(a.diagnostics(now), { capacity: 1, admitted: 1, waiting: 0, reservedWaiting: 1 });
  assert.equal(a.diagnostics(now + 121000).reservedWaiting, 0);
  assert.ok(!JSON.stringify(a.diagnostics(now)).includes(admitted));
  assert.ok(!JSON.stringify(a.diagnostics(now)).includes('watcher'));
});

test('runtime samples are bounded aggregates with CPU, memory and an explicit sampling age', async () => {
  const diagnostics = new RuntimeDiagnostics({ region: 'eu', revision: 'test' }, async () => [], () => ({ capacity: 25 }));
  try {
    assert.equal(diagnostics.read().status, 'warming-up');
    await diagnostics.sample();
    const value = diagnostics.read();
    assert.equal(value.status, 'available');
    const sample = value.sample as { cpuPercentOneCore: number; memoryMiB: { rss: number }; region: string };
    assert.ok(Number.isFinite(sample.cpuPercentOneCore)); assert.ok(sample.memoryMiB.rss > 0);
    assert.equal(sample.region, 'eu'); assert.ok(value.sampleAgeSeconds! >= 0);
  } finally { diagnostics.dispose(); }
});
