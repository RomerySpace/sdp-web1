import RAPIER from '@dimforge/rapier3d-compat';
import type { Vector3 } from 'three';
import { gameConfig } from '../config/gameConfig';
export { RAPIER };
export const identityRotation = { x: 0, y: 0, z: 0, w: 1 };
export class PhysicsWorld {
  readonly world: RAPIER.World;
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: gameConfig.player.gravity, z: 0 });
    this.world.timestep = gameConfig.physics.timestep;
    this.world.numSolverIterations = 6;
  }
  static async initialize(): Promise<PhysicsWorld> { await RAPIER.init(); return new PhysicsWorld(); }
  step(): void { this.world.gravity.y = gameConfig.player.gravity; this.world.step(); }
  ray(origin: Vector3, direction: Vector3, distance: number, exclude?: RAPIER.Collider): RAPIER.RayColliderIntersection | null {
    return this.world.castRayAndGetNormal(new RAPIER.Ray(origin, direction), distance, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude);
  }
  dispose(): void { this.world.free(); }
}
