import type { MovementInput } from './MultiplayerProtocol';
import { gameplayConfig } from './GameplayConfig';

export const MOVEMENT_SPEED = 3;
export interface MotionState { x: number; z: number; velocityX: number; velocityZ: number; elevation?: number; verticalSpeed?: number; jumpHeld?: boolean }
export interface WorldMovement {
  move(position: { x: number; z: number }, dx: number, dz: number): void;
  groundHeight?(x: number, z: number): number;
}

export function simulateMovement(state: MotionState, input: MovementInput, dt: number, world: WorldMovement): void {
  const jump = Boolean(input.active && input.j);
  let elevation = state.elevation ?? 0, vy = state.verticalSpeed ?? 0;
  const groundBefore = world.groundHeight?.(state.x, state.z) ?? 0;
  const airborne = elevation > 0 || (jump && !state.jumpHeld);
  if (jump && !state.jumpHeld && elevation <= 0) vy = gameplayConfig.limbo.jumpSpeed;
  state.jumpHeld = jump;
  vy -= gameplayConfig.limbo.gravity * dt;
  elevation += vy * dt;
  if (!input.active) {
    state.velocityX = state.velocityZ = 0;
    state.elevation = Math.max(0, elevation); state.verticalSpeed = state.elevation > 0 ? vy : 0;
    return;
  }
  let forward = input.f, sideways = input.r;
  const length = Math.hypot(forward, sideways);
  if (length > 1) { forward /= length; sideways /= length; }
  const speed = MOVEMENT_SPEED * (input.c ? .55 : 1) * (!input.c && input.s && length > 0 ? gameplayConfig.limbo.sprintMultiplier : 1);
  const x = (sideways * Math.cos(input.y) - forward * Math.sin(input.y)) * speed;
  const z = (-forward * Math.cos(input.y) - sideways * Math.sin(input.y)) * speed;
  const response = length > 0 ? (input.s ? gameplayConfig.limbo.sprintAcceleration : gameplayConfig.limbo.walkAcceleration) : gameplayConfig.limbo.deceleration;
  const smoothing = 1 - Math.exp(-dt * response);
  state.velocityX += (x - state.velocityX) * smoothing;
  state.velocityZ += (z - state.velocityZ) * smoothing;
  world.move(state, state.velocityX * dt, state.velocityZ * dt);
  const groundAfter = world.groundHeight?.(state.x, state.z) ?? 0;
  state.elevation = airborne ? Math.max(0, elevation + groundBefore - groundAfter) : 0;
  state.verticalSpeed = state.elevation > 0 ? vy : 0;
}
