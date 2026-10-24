import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from './stability-multiplayer.mjs';

test('mixed stability tests are local-only, staged and bounded', () => {
  assert.deepEqual(configuration([]).clients, [40, 80, 160, 300]);
  for (const clients of ['', '0', '1', '301', '40,40', '80,40', 'NaN'])
    assert.throws(() => configuration(['--clients', clients]));
  for (const duration of ['0', '9', '601', 'NaN'])
    assert.throws(() => configuration(['--duration', duration]));
  assert.throws(() => configuration(['--url', 'https://sdp-web1-multiplayer.onrender.com']));
  assert.throws(() => configuration(['--allow-remote']));
  assert.equal(configuration(['--clients', '40', '--duration', '10']).duration, 10);
});
