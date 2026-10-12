import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuration } from './load-multiplayer.mjs';
import { statistics, summarizeResourceMetrics } from './load-test-metrics.mjs';

test('load tests require permission for remote origins and enforce bounded increasing stages', () => {
  assert.deepEqual(configuration([]).clients, [25, 50, 100]);
  assert.throws(() => configuration(['--url', 'https://example.com']), /allow-remote/);
  assert.equal(configuration(['--url', 'https://example.com', '--allow-remote']).url, 'https://example.com');
  for (const clients of ['0', '101', '25,25', '50,25', '25,no', '']) assert.throws(() => configuration(['--clients', clients]));
  assert.throws(() => configuration(['--duration', 'Infinity']));
  assert.throws(() => configuration(['--url', 'https://name:password@example.com', '--allow-remote']));
});

test('latency statistics preserve input samples and distinguish empty data', () => {
  const samples = [100, 10, 20, 30];
  assert.deepEqual(statistics(samples), { samples: 4, mean: 40, p50: 20, p95: 100, max: 100 });
  assert.deepEqual(samples, [100, 10, 20, 30]);
  assert.equal(statistics([]).p95, null);
});

test('Render utilization uses observed resource limits instead of guessed plan specs', () => {
  const series = (values) => [{ values: values.map((value) => ({ value })) }];
  const resources = summarizeResourceMetrics({ cpu: series([0.075]), 'cpu-limit': series([0.15]),
    memory: series([128 * 1024 ** 2]), 'memory-limit': series([512 * 1024 ** 2]) });
  assert.equal(resources.cpuPercent.mean, 50);
  assert.equal(resources.memoryMiB.mean, 128);
  assert.equal(resources.memoryPercent.mean, 25);
  assert.equal(summarizeResourceMetrics({}).cpuPercent.samples, 0);
});
