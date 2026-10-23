import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { decodeCollisionAsset, encodeCollisionAsset, shooterCollisionFormat, type CollisionAsset } from '../../shared/ShooterCollisionAsset';

const asset = (): CollisionAsset => ({ version: shooterCollisionFormat, sourceHash: 'fixture', triangles: 1, sourceTriangles: 1,
  navigation: { version: 1, cellSize: .8, connectedCells: 300, zoneCoverage: 5, hub: [0, 0, 0], points: [[0, 0, 0]], components: [] },
  colliders: [{ vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) }] });
test('portable physics buffers round-trip exactly and reject malformed geometry', () => {
  const original = asset(), bytes = encodeCollisionAsset(original);
  assert.deepEqual(decodeCollisionAsset(bytes.buffer), original);
  assert.throws(() => decodeCollisionAsset(bytes.buffer.slice(0, -1)), /geometry|Truncated/);
  const invalid = asset(); invalid.colliders[0].indices[2] = 3;
  assert.throws(() => decodeCollisionAsset(encodeCollisionAsset(invalid).buffer), /index/);
  invalid.colliders[0].vertices[0] = NaN;
  assert.throws(() => decodeCollisionAsset(encodeCollisionAsset(invalid).buffer), /Nonfinite/);
  const wrongVersion = bytes.slice(); new DataView(wrongVersion.buffer).setUint32(4, 100, true);
  assert.throws(() => decodeCollisionAsset(wrongVersion.buffer), /Regenerate/);
});
test('client and server receive identical optimized surfaces and five connected spawn zones', async () => {
  const server = await readFile(new URL('../assets/dust2-colliders-v4.bin.gz', import.meta.url));
  const browser = await readFile(new URL('../../public/shooter/physics/dust2-colliders-v4.bin.gz', import.meta.url));
  assert.deepEqual(server, browser);
  const raw = Uint8Array.from(gunzipSync(server)), data = decodeCollisionAsset(raw.buffer);
  assert.equal(data.colliders.length, 76); assert.ok(data.triangles < data.sourceTriangles * .85);
  assert.equal(data.navigation.zoneCoverage, 5); assert.ok(data.navigation.connectedCells > 3000);
});
