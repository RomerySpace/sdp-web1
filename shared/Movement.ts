import type { MovementInput } from './MultiplayerProtocol';

export const MOVEMENT_SPEED = 3;
export interface MotionState { x: number; z: number; velocityX: number; velocityZ: number }
export interface WorldMovement {
  move(position: { x: number; z: number }, dx: number, dz: number): void;
}

export function simulateMovement(state: MotionState, input: MovementInput, dt: number, world: WorldMovement): void {
  if (!input.active) { state.velocityX = state.velocityZ = 0; return; }
  let forward = input.f, sideways = input.r;
  const length = Math.hypot(forward, sideways);
  if (length) { forward /= length; sideways /= length; }
  const x = (sideways * Math.cos(input.y) - forward * Math.sin(input.y)) * MOVEMENT_SPEED;
  const z = (-forward * Math.cos(input.y) - sideways * Math.sin(input.y)) * MOVEMENT_SPEED;
  const smoothing = 1 - Math.exp(-dt * (length > 0 ? 7 : 10));
  state.velocityX += (x - state.velocityX) * smoothing;
  state.velocityZ += (z - state.velocityZ) * smoothing;
  world.move(state, state.velocityX * dt, state.velocityZ * dt);
}
