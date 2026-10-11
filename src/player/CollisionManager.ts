/** Circle vs. pedestal AABB, with axis-separated sliding and swept substeps.
 * The large radius is a soft, invisible drift limit, far inside the fog. */
export class CollisionManager {
  constructor(readonly radius = 0.28, readonly halfExtent = 1.2, readonly worldRadius = 160) {}

  private blocked(x: number, z: number): boolean {
    const closestX = Math.max(-this.halfExtent, Math.min(this.halfExtent, x));
    const closestZ = Math.max(-this.halfExtent, Math.min(this.halfExtent, z));
    return (x - closestX) ** 2 + (z - closestZ) ** 2 < this.radius ** 2;
  }

  move(position: { x: number; z: number }, dx: number, dz: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.radius * 0.5)));
    dx /= steps;
    dz /= steps;
    for (let i = 0; i < steps; i++) {
      if (!this.blocked(position.x + dx, position.z)) position.x += dx;
      if (!this.blocked(position.x, position.z + dz)) position.z += dz;
    }
    const distance = Math.hypot(position.x, position.z);
    if (distance > this.worldRadius) {
      position.x *= this.worldRadius / distance;
      position.z *= this.worldRadius / distance;
    }
  }
}
