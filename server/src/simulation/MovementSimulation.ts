import { CollisionManager } from '../../../src/player/CollisionManager';
import { simulateMovement, type MotionState, type WorldMovement } from '../../../shared/Movement';
import { SIMULATION_HZ, type MovementInput } from '../../../shared/MultiplayerProtocol';
import { PLAYER_HEIGHT } from '../../../shared/MultiplayerProtocol';

export class MovementSimulation {
  private readonly motion = new Map<string, MotionState>();
  // Reuse the existing pedestal boundary. A future world can implement this interface.
  constructor(private readonly world: WorldMovement = new CollisionManager()) {}

  add(id: string, position: { x: number; z: number; y?: number; groundY?: number }): void {
    const groundY = position.groundY ?? this.world.groundHeight?.(position.x, position.z, position.y === undefined ? 0 : position.y - PLAYER_HEIGHT) ?? 0;
    this.motion.set(id, { x: position.x, z: position.z, groundY, velocityX: 0, velocityZ: 0 });
  }

  step(id: string, input: MovementInput): MotionState | undefined {
    const motion = this.motion.get(id);
    if (motion) simulateMovement(motion, input, 1 / SIMULATION_HZ, this.world);
    return motion;
  }

  stop(id: string): void {
    const motion = this.motion.get(id);
    if (motion) motion.velocityX = motion.velocityZ = 0;
  }

  remove(id: string): void { this.motion.delete(id); }
  clear(): void { this.motion.clear(); }
}
