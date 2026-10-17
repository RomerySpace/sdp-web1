import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const input = process.argv[2];
if (!input) throw new Error('Usage: node server/scripts/prepare-lobby-tree.mjs /path/to/tree.glb');
const target = new URL('../../public/models/tree.glb', import.meta.url);
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({ 'draco3d.decoder': await draco.createDecoderModule(), 'draco3d.encoder': await draco.createEncoderModule() });
const document = await io.read(resolve(input));
await MeshoptSimplifier.ready;
let before = 0, after = 0;
for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
  const positions = primitive.getAttribute('POSITION'), indices = primitive.getIndices();
  if (!positions || !indices) continue;
  const original = new Uint32Array(indices.getArray()); before += original.length / 3;
  const foliage = primitive.getMaterial()?.getName().includes('Hojas');
  const reduced = foliage ? original : MeshoptSimplifier.simplify(original, positions.getArray(), 3, Math.max(3, Math.floor(original.length * .12 / 3) * 3), .02)[0];
  const referenced = [...new Set(reduced)], remap = new Map(referenced.map((old, index) => [old, index]));
  for (const semantic of primitive.listSemantics()) {
    if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(semantic)) { primitive.setAttribute(semantic, null); continue; }
    const accessor = primitive.getAttribute(semantic), array = accessor.getArray(), size = accessor.getElementSize();
    const compact = new array.constructor(referenced.length * size);
    referenced.forEach((old, index) => compact.set(array.subarray(old * size, (old + 1) * size), index * size));
    accessor.setArray(compact);
  }
  indices.setArray(Uint32Array.from(reduced, old => remap.get(old))); after += reduced.length / 3;
}
let leaves;
for (const material of document.getRoot().listMaterials()) {
  const foliage = material.getName().includes('Hojas');
  if (foliage) {
    leaves = material.getBaseColorTexture();
    const { data, info } = await sharp(leaves.getImage()).resize({ width: 512, height: 512, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255;
    leaves.setImage(await sharp(data, { raw: info }).png().toBuffer()).setMimeType('image/png');
    material.setAlphaMode('MASK').setAlphaCutoff(.45);
  } else material.setBaseColorTexture(null);
  material.setBaseColorFactor(foliage ? [.96, .975, .985, 1] : [.88, .91, .93, 1]);
  material.setMetallicFactor(0).setRoughnessFactor(.96).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
}
for (const texture of document.getRoot().listTextures()) if (texture !== leaves) texture.dispose();
const used = new Set(document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives().flatMap(primitive => [primitive.getIndices(), ...primitive.listAttributes()])));
for (const accessor of document.getRoot().listAccessors()) if (!used.has(accessor)) accessor.dispose();
for (const extension of document.getRoot().listExtensionsUsed()) extension.dispose();
document.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
document.getRoot().setExtras({ ...document.getRoot().getExtras(), adaptation: 'SDP: simplified geometry, white materials and alpha-tested foliage; original author hanandess, CC BY 4.0.' });
await mkdir(new URL('../../public/models/', import.meta.url), { recursive: true });
await io.write(target.pathname, document);
console.log(JSON.stringify({ beforeTriangles: before, afterTriangles: after, bytes: (await stat(target)).size }));
