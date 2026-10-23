export const shooterCollisionFormat = 4;
export const shooterCollisionAsset = '/shooter/physics/dust2-colliders-v4.bin.gz';
export const colliderOptimization = { targetRatio: .25, maxErrorMetres: .005, validationTolerance: .015 } as const;
export interface CollisionGeometry { vertices: Float32Array; indices: Uint32Array }
export interface SpawnNavigationData { version: number; cellSize: number; connectedCells: number; zoneCoverage: number;
  hub: number[]; points: number[][]; components: { cells: number; outdoor: number; zones: number }[] }
export interface CollisionAsset {
  version: number; sourceHash: string; triangles: number; sourceTriangles: number;
  navigation: SpawnNavigationData; colliders: CollisionGeometry[];
}
const magic = 0x53445043;

export function encodeCollisionAsset(asset: CollisionAsset): Uint8Array<ArrayBuffer> {
  const { colliders, ...metadata } = asset;
  const json = new TextEncoder().encode(JSON.stringify(metadata)), padded = (json.length + 3) & ~3;
  const result = new Uint8Array(16 + padded + colliders.reduce((sum, g) => sum + 8 + g.vertices.byteLength + g.indices.byteLength, 0));
  const view = new DataView(result.buffer);
  view.setUint32(0, magic, true); view.setUint32(4, shooterCollisionFormat, true);
  view.setUint32(8, json.length, true); view.setUint32(12, colliders.length, true); result.set(json, 16);
  let offset = 16 + padded;
  for (const g of colliders) {
    view.setUint32(offset, g.vertices.length, true); view.setUint32(offset + 4, g.indices.length, true); offset += 8;
    for (const value of g.vertices) { view.setFloat32(offset, value, true); offset += 4; }
    for (const value of g.indices) { view.setUint32(offset, value, true); offset += 4; }
  }
  return result;
}

export function decodeCollisionAsset(buffer: ArrayBuffer): CollisionAsset {
  if (buffer.byteLength < 16 || buffer.byteLength > 64 * 1048576) throw new Error('Invalid collision asset size.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== magic || view.getUint32(4, true) !== shooterCollisionFormat) throw new Error('Regenerate Shooter physics assets.');
  const length = view.getUint32(8, true), count = view.getUint32(12, true);
  if (length > 1048576 || 16 + length > buffer.byteLength || !count || count > 512) throw new Error('Invalid collision asset header.');
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, length))) as Omit<CollisionAsset, 'colliders'>;
  if (metadata.version !== shooterCollisionFormat || typeof metadata.sourceHash !== 'string' || !metadata.sourceHash ||
    !Number.isInteger(metadata.triangles) || metadata.triangles < 1 || metadata.sourceTriangles < metadata.triangles ||
    metadata.navigation?.version !== 1 || !Array.isArray(metadata.navigation.points) || !metadata.navigation.points.length ||
    metadata.navigation.points.length > 1024 || metadata.navigation.points.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))) {
    throw new Error('Invalid collision asset metadata.');
  }
  let offset = 16 + ((length + 3) & ~3), triangles = 0;
  const colliders: CollisionGeometry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 8 > buffer.byteLength) throw new Error('Truncated collision asset.');
    const nv = view.getUint32(offset, true), ni = view.getUint32(offset + 4, true); offset += 8;
    if (!nv || !ni || nv % 3 || ni % 3 || offset + (nv + ni) * 4 > buffer.byteLength) throw new Error('Invalid collision geometry.');
    const vertices = new Float32Array(nv), indices = new Uint32Array(ni);
    for (let j = 0; j < nv; j++, offset += 4) {
      vertices[j] = view.getFloat32(offset, true);
      if (!Number.isFinite(vertices[j])) throw new Error('Nonfinite collision vertex.');
    }
    for (let j = 0; j < ni; j++, offset += 4) {
      indices[j] = view.getUint32(offset, true);
      if (indices[j] >= nv / 3) throw new Error('Invalid collision index.');
    }
    triangles += ni / 3; colliders.push({ vertices, indices });
  }
  if (offset !== buffer.byteLength || triangles !== metadata.triangles) throw new Error('Collision asset length mismatch.');
  return { ...metadata, colliders };
}
