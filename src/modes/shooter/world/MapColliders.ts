import type { BufferGeometry } from 'three';
import { RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld';
import { gameConfig } from '../config/gameConfig';

export const yieldFrame = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
/** Geometry is already baked to world space, identical to the visible batches. */
export async function buildMapColliders(physics: PhysicsWorld, geometries: BufferGeometry[], progress: (text: string) => void): Promise<number> {
  let count = 0;
  for (let gi = 0; gi < geometries.length; gi++) {
    const g = geometries[gi], pos = g.getAttribute('position'), idx = g.index!;
    const limit = gameConfig.map.colliderTriangleLimit * 3;
    for (let start = 0; start < idx.count; start += limit) {
      const vertices: number[] = [], indices: number[] = [], remap = new Map<number, number>();
      const end = Math.min(start + limit, idx.count);
      for (let i = start; i < end; i += 3) {
        const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
        const abx = pos.getX(b)-pos.getX(a), aby = pos.getY(b)-pos.getY(a), abz = pos.getZ(b)-pos.getZ(a);
        const acx = pos.getX(c)-pos.getX(a), acy = pos.getY(c)-pos.getY(a), acz = pos.getZ(c)-pos.getZ(a);
        if (Math.hypot(aby*acz-abz*acy, abz*acx-abx*acz, abx*acy-aby*acx) < 1e-9) continue;
        for (const source of [a, b, c]) {
          if (!remap.has(source)) { remap.set(source, vertices.length / 3); vertices.push(pos.getX(source), pos.getY(source), pos.getZ(source)); }
          indices.push(remap.get(source)!);
        }
      }
      if (indices.length) {
        physics.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(0).setRestitution(0));
        count++;
      }
      progress(`Reconstructing solid surfaces · ${Math.round((gi + 1) / geometries.length * 100)}%`);
      await yieldFrame();
    }
  }
  physics.world.updateSceneQueries();
  return count;
}
