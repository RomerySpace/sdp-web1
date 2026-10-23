import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { optimizeCollider } from './optimize-collider.mjs';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import { Matrix4, Vector3 } from 'three';
import { tsImport } from 'tsx/esm/api';

const source = new URL('../../public/shooter/MAP/dust2plainmap.glb', import.meta.url);
const target = new URL('../assets/dust2-colliders-v4.bin.gz', import.meta.url);
const publicTarget = new URL('../../public/shooter/physics/dust2-colliders-v4.bin.gz', import.meta.url);
const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  'draco3d.decoder': await draco.createDecoderModule(),
});
const document = await io.read(source.pathname);
const colliders = [];
const buckets = new Map();
const cellSize = 24, triangleLimit = 16000;
let triangles = 0;
for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || /blocklight|_shadow_meshset|mesh_overlay/.test(`${node.getParentNode()?.getName()}/${node.getName()}/${mesh.getName()}`.toLowerCase())) continue;
  const matrix = new Matrix4().fromArray(node.getWorldMatrix());
  const skin = node.getSkin();
  const inverseBinds = skin?.getInverseBindMatrices();
  const bones = skin?.listJoints().map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix())
    .multiply(new Matrix4().fromArray(inverseBinds ? inverseBinds.getElement(index, []) : new Matrix4().elements)));
  for (const primitive of mesh.listPrimitives()) {
    if (primitive.getMode() !== 4) continue;
    const positions = primitive.getAttribute('POSITION');
    if (!positions) continue;
    const joints = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
    const vertices = new Float32Array(positions.getCount() * 3);
    const point = new Vector3(), base = new Vector3(), blended = new Vector3();
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let index = 0; index < positions.getCount(); index++) {
      base.fromArray(positions.getElement(index, [])); point.copy(base);
      if (bones && joints && weights) {
        const js = joints.getElement(index, []), ws = weights.getElement(index, []);
        blended.set(0, 0, 0);
        for (let k = 0; k < 4; k++) if (ws[k]) blended.addScaledVector(point.copy(base).applyMatrix4(bones[js[k]]), ws[k]);
        point.copy(blended);
      }
      point.applyMatrix4(matrix).toArray(vertices, index * 3); min.min(point); max.max(point);
    }
    const accessor = primitive.getIndices();
    const indices = accessor ? Uint32Array.from(accessor.getArray()) : Uint32Array.from({ length: positions.getCount() }, (_, i) => i);
    if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    const center = min.add(max).multiplyScalar(.5);
    const key = `${Math.floor(center.x / cellSize)}/${Math.floor(center.z / cellSize)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ vertices, indices });
  }
}
// Keep spatial partitions and real openings intact before simplifying interiors.
for (const geometries of buckets.values()) {
  let v = [], idx = [];
  const flush = () => {
    if (idx.length) { colliders.push({ vertices: v, indices: idx }); triangles += idx.length / 3; }
    v = []; idx = [];
  };
  for (const { vertices, indices } of geometries) {
    const remap = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const a = new Vector3().fromArray(vertices, indices[i] * 3), b = new Vector3().fromArray(vertices, indices[i + 1] * 3), c = new Vector3().fromArray(vertices, indices[i + 2] * 3);
      if (b.sub(a).cross(c.sub(a)).length() < 1e-9) continue;
      if (idx.length >= triangleLimit * 3) { flush(); remap.clear(); }
      for (const original of indices.subarray(i, i + 3)) {
        if (!remap.has(original)) { remap.set(original, v.length / 3); v.push(...vertices.subarray(original * 3, original * 3 + 3)); }
        idx.push(remap.get(original));
      }
    }
  }
  flush();
}
await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
await mkdir(new URL('../../public/shooter/physics/', import.meta.url), { recursive: true });
const { encodeCollisionAsset, shooterCollisionFormat, colliderOptimization } = await tsImport('../../shared/ShooterCollisionAsset.ts', import.meta.url);
const { surfaceValidator } = await tsImport('./validate-colliders.ts', import.meta.url);
const validator = await surfaceValidator(colliderOptimization.validationTolerance);
const optimized = [];
let sourceBytes = 0, optimizedBytes = 0, fallbackCount = 0, maxError = 0;
try {
  for (const g of colliders) {
    const sourceGeometry = { vertices: Float32Array.from(g.vertices), indices: Uint32Array.from(g.indices) };
    sourceBytes += sourceGeometry.vertices.byteLength + sourceGeometry.indices.byteLength;
    let reduced = await optimizeCollider(sourceGeometry, colliderOptimization);
    if (!validator.accepts(sourceGeometry, reduced)) { reduced = { ...sourceGeometry, error: 0 }; fallbackCount++; }
    optimized.push({ vertices: reduced.vertices, indices: reduced.indices });
    optimizedBytes += reduced.vertices.byteLength + reduced.indices.byteLength; maxError = Math.max(maxError, reduced.error);
  }
} finally { validator.dispose(); }
console.log('[SDP] Validating connected outdoor spawn routes');
const { buildSpawnNavigation } = await tsImport('../src/simulation/SpawnNavigation.ts', import.meta.url);
const navigation = await buildSpawnNavigation(optimized);
const sourceTriangles = triangles;
triangles = optimized.reduce((sum, g) => sum + g.indices.length / 3, 0);
const data = gzipSync(encodeCollisionAsset({ version: shooterCollisionFormat, sourceHash, triangles, sourceTriangles,
  colliders: optimized, navigation }));
await writeFile(publicTarget, data);
await writeFile(target, data);
console.log(`[SDP] Dust 2: ${colliders.length} colliders, ${triangles} triangles, ${(data.length / 1048576).toFixed(2)} MiB. Source ${sourceHash}`);
console.log(`[SDP] Physics: ${sourceTriangles} -> ${triangles} triangles; ${sourceBytes} -> ${optimizedBytes} bytes; ${validator.probes} surface probes, ${fallbackCount} conservative fallbacks; maximum simplification error ${maxError}m.`);
console.log(`[SDP] Spawns: ${navigation.points.length} outdoor points, ${navigation.connectedCells} connected cells, ${navigation.zoneCoverage} map zones. Hub ${navigation.hub}`);
