import { gameplayConfig } from './GameplayConfig';
export function shotRecoil(shot: number, automatic: boolean, aiming: boolean): { pitch: number; yaw: number } {
  const c = gameplayConfig.combat, factor = aiming ? .75 : 1;
  const horizontal = [0, .15, -.2, .35, -.1, -.5, .3, .6, .2, -.4, -.7, -.25];
  return { pitch: (c.recoilPitch + (automatic ? Math.min(shot, 14) * c.recoilGrowth : .003)) * factor,
    yaw: automatic ? horizontal[shot % horizontal.length] * c.recoilYaw * factor : 0 };
}
