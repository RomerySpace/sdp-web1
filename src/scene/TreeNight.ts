import { lobbyRetreat } from '../../shared/LobbyRetreat';
import { lobbyAmbience } from '../core/LobbyAmbience';

export function treeNightTarget(position: { x: number; y: number; z: number }, enabled: boolean): number {
  if (!enabled || position.y < -.5) return 0;
  const c = lobbyAmbience.treeNight;
  const distance = Math.hypot(position.x - lobbyRetreat.x, position.z - lobbyRetreat.z);
  const t = Math.max(0, Math.min(1, (c.outerRadius - distance) / (c.outerRadius - c.fullRadius)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
