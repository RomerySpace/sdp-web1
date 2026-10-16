import { MathUtils } from 'three';

export interface AvatarGait { gaitPhase: number; gaitX: number; gaitZ: number }
export const avatarAnimation = { radiansPerMetre: 2.1, walkReach: .21, runReach: .32, response: 10 };

/** Only authoritative displacement advances the stride; clients cannot submit poses. */
export function advanceGait(gait: AvatarGait, dx: number, dz: number, yaw: number, grounded: boolean, dt: number): void {
  const distance = Math.hypot(dx, dz), speed = distance / Math.max(.001, dt);
  const moving = grounded && speed > .12 && speed < 9;
  if (moving) gait.gaitPhase += distance * avatarAnimation.radiansPerMetre;
  const reach = moving ? MathUtils.lerp(avatarAnimation.walkReach, avatarAnimation.runReach, MathUtils.clamp((speed - 3.8) / 2.2, 0, 1)) * Math.min(1, speed / 2) : 0;
  const x = moving ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / distance * reach : 0;
  const z = moving ? (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance * reach : 0;
  gait.gaitX = MathUtils.damp(gait.gaitX, x, avatarAnimation.response, dt);
  gait.gaitZ = MathUtils.damp(gait.gaitZ, z, avatarAnimation.response, dt);
}
