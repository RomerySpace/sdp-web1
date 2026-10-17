import { lobbyRetreat } from '../../shared/LobbyRetreat';

/** Circle vs. pedestal and seating, with axis-separated sliding and swept substeps.
 * The large radius is a soft, invisible drift limit, far inside the fog. */
export class CollisionManager {
  constructor(readonly radius = 0.28, readonly halfExtent = 1.2, readonly worldRadius = 160) {}
  canOccupy(x: number, z: number): boolean { return Math.hypot(x, z) <= this.worldRadius && !this.blocked(x, z); }

  private blocked(x: number, z: number): boolean {
    const closestX = Math.max(-this.halfExtent, Math.min(this.halfExtent, x));
    const closestZ = Math.max(-this.halfExtent, Math.min(this.halfExtent, z));
    if ((x - closestX) ** 2 + (z - closestZ) ** 2 < this.radius ** 2) return true;
    if (Math.hypot(x - lobbyRetreat.x, z - lobbyRetreat.z) < lobbyRetreat.trunkRadius + this.radius) return true;
    return lobbyRetreat.seats.some(seat => {
      const dx = x - seat.x, dz = z - seat.z, c = Math.cos(seat.yaw), s = Math.sin(seat.yaw);
      const localX = c * dx - s * dz, localZ = s * dx + c * dz;
      const qx = Math.max(-lobbyRetreat.seatWidth / 2, Math.min(lobbyRetreat.seatWidth / 2, localX));
      const qz = Math.max(-lobbyRetreat.seatDepth / 2, Math.min(lobbyRetreat.seatDepth / 2, localZ));
      return (localX - qx) ** 2 + (localZ - qz) ** 2 < this.radius ** 2;
    });
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
