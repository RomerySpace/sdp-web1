import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import type { CollisionGeometry } from '../../shared/ShooterCollisionAsset';

export async function surfaceValidator(tolerance: number) {
  const original = await PhysicsWorld.initialize(), candidate = await PhysicsWorld.initialize();
  let probes = 0;
  return {
    get probes() { return probes; },
    accepts(source: CollisionGeometry, reduced: CollisionGeometry): boolean {
      const a = original.world.createCollider(RAPIER.ColliderDesc.trimesh(source.vertices, source.indices));
      const b = candidate.world.createCollider(RAPIER.ColliderDesc.trimesh(reduced.vertices, reduced.indices));
      try {
        original.world.updateSceneQueries(); candidate.world.updateSceneQueries();
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < source.vertices.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis], source.vertices[i]); max[axis] = Math.max(max[axis], source.vertices[i]); }
        let seed = 781;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) for (let i = 0; i < 64; i++) {
          const xyz = min.map((value, index) => value + random() * (max[index] - value));
          xyz[axis] = sign > 0 ? min[axis] - 1 : max[axis] + 1;
          const direction = [0, 0, 0]; direction[axis] = sign;
          const ray = new RAPIER.Ray({ x: xyz[0], y: xyz[1], z: xyz[2] }, { x: direction[0], y: direction[1], z: direction[2] });
          const range = max[axis] - min[axis] + 2;
          const first = original.world.castRay(ray, range, true), second = candidate.world.castRay(ray, range, true);
          probes++;
          if (!!first !== !!second || first && second && Math.abs(first.toi - second.toi) > tolerance) return false;
        }
        return true;
      } finally { original.world.removeCollider(a, true); candidate.world.removeCollider(b, true); }
    },
    dispose(): void { original.dispose(); candidate.dispose(); },
  };
}
