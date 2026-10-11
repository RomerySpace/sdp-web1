import { MAX_PLAYERS, PLAYER_HEIGHT } from '../../../shared/MultiplayerProtocol';

export function spawnPosition(slot: number) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PLAYERS) throw new Error('Invalid spawn slot');
  const yaw = slot * Math.PI * 2 / MAX_PLAYERS;
  return { x: Math.sin(yaw) * 9, y: PLAYER_HEIGHT, z: Math.cos(yaw) * 9, yaw, pitch: Math.atan2(0.08, 9) };
}
