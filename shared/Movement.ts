import type { MovementInput } from './MultiplayerProtocol';
import { gameplayConfig } from './GameplayConfig';

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
  const speed = MOVEMENT_SPEED * (input.s && length > 0 ? gameplayConfig.limbo.sprintMultiplier : 1);
  const x = (sideways * Math.cos(input.y) - forward * Math.sin(input.y)) * speed;
  const z = (-forward * Math.cos(input.y) - sideways * Math.sin(input.y)) * speed;
  const response = length > 0 ? (input.s ? gameplayConfig.limbo.sprintAcceleration : gameplayConfig.limbo.walkAcceleration) : gameplayConfig.limbo.deceleration;
  const smoothing = 1 - Math.exp(-dt * response);
  state.velocityX += (x - state.velocityX) * smoothing;
  state.velocityZ += (z - state.velocityZ) * smoothing;
  world.move(state, state.velocityX * dt, state.velocityZ * dt);
}
