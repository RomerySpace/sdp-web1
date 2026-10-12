import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import { Matrix4, Vector3 } from 'three';

const source = new URL('../../public/shooter/MAP/dust2plainmap.glb', import.meta.url);
const target = new URL('../assets/dust2-colliders.json.gz', import.meta.url);
const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  'draco3d.decoder': await draco.createDecoderModule(),
});
const document = await io.read(source.pathname);
const colliders = [];
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
    for (let index = 0; index < positions.getCount(); index++) {
      base.fromArray(positions.getElement(index, [])); point.copy(base);
      if (bones && joints && weights) {
        const js = joints.getElement(index, []), ws = weights.getElement(index, []);
        blended.set(0, 0, 0);
        for (let k = 0; k < 4; k++) if (ws[k]) blended.addScaledVector(point.copy(base).applyMatrix4(bones[js[k]]), ws[k]);
        point.copy(blended);
      }
      point.applyMatrix4(matrix).toArray(vertices, index * 3);
    }
    const accessor = primitive.getIndices();
    const indices = accessor ? Uint32Array.from(accessor.getArray()) : Uint32Array.from({ length: positions.getCount() }, (_, i) => i);
    if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    for (let start = 0; start < indices.length; start += 48000) {
      const remap = new Map(), v = [], idx = [];
      for (let i = start; i < Math.min(start + 48000, indices.length); i += 3) {
        const a = new Vector3().fromArray(vertices, indices[i] * 3), b = new Vector3().fromArray(vertices, indices[i + 1] * 3), c = new Vector3().fromArray(vertices, indices[i + 2] * 3);
        if (b.sub(a).cross(c.sub(a)).length() < 1e-9) continue;
        for (const original of indices.subarray(i, i + 3)) {
          if (!remap.has(original)) { remap.set(original, v.length / 3); v.push(...vertices.subarray(original * 3, original * 3 + 3)); }
          idx.push(remap.get(original));
        }
      }
      if (idx.length) { colliders.push({ vertices: v, indices: idx }); triangles += idx.length / 3; }
    }
  }
}
await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
const data = gzipSync(JSON.stringify({ version: 1, sourceHash, triangles, colliders }));
await writeFile(target, data);
console.log(`[SDP] Dust 2: ${colliders.length} colliders, ${triangles} triangles, ${(data.length / 1048576).toFixed(2)} MiB. Source ${sourceHash}`);
