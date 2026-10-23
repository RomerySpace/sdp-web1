import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeCollider } from './optimize-collider.mjs';
import { surfaceValidator } from './validate-colliders.ts';
import { colliderOptimization } from '../../shared/ShooterCollisionAsset.ts';

test('planar interiors shrink while the border of an opening stays solid and unchanged', async () => {
  const vertices = [], indices = [], size = 12;
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++) vertices.push(x, 0, z);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    if (x >= 5 && x < 7 && z >= 5 && z < 7) continue;
    const a = z * (size + 1) + x, b = a + 1, c = a + size + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const original = { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices) };
  const reduced = await optimizeCollider(original, colliderOptimization);
  assert.ok(reduced.indices.length < original.indices.length * .6);
  assert.ok(reduced.error <= colliderOptimization.maxErrorMetres);
  const validator = await surfaceValidator(colliderOptimization.validationTolerance);
  try {
    assert.equal(validator.accepts(original, reduced), true);
    const displaced = { ...reduced, vertices: Float32Array.from(reduced.vertices, (v, i) => i % 3 === 1 ? v + .2 : v) };
    assert.equal(validator.accepts(original, displaced), false);
  } finally { validator.dispose(); }
});
