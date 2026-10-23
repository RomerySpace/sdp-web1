import { MeshoptSimplifier } from 'meshoptimizer';

export async function optimizeCollider(geometry, config) {
  await MeshoptSimplifier.ready;
  const unique = new Map(), positions = [], remap = new Uint32Array(geometry.vertices.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = geometry.vertices[i * 3], y = geometry.vertices[i * 3 + 1], z = geometry.vertices[i * 3 + 2];
    const key = `${x},${y},${z}`;
    let id = unique.get(key);
    if (id === undefined) { id = positions.length / 3; unique.set(key, id); positions.push(x, y, z); }
    remap[i] = id;
  }
  const indices = Uint32Array.from(geometry.indices, index => remap[index]);
  const [reduced, error] = MeshoptSimplifier.simplify(indices, Float32Array.from(positions), 3,
    Math.max(3, Math.floor(indices.length * config.targetRatio / 3) * 3), config.maxErrorMetres, ['LockBorder', 'ErrorAbsolute']);
  const used = new Map(), vertices = [], compact = new Uint32Array(reduced.length);
  for (let i = 0; i < reduced.length; i++) {
    const source = reduced[i]; let id = used.get(source);
    if (id === undefined) { id = vertices.length / 3; used.set(source, id); vertices.push(...positions.slice(source * 3, source * 3 + 3)); }
    compact[i] = id;
  }
  return { vertices: Float32Array.from(vertices), indices: compact, error };
}
