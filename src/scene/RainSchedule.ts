import { lobbyAmbience } from '../core/LobbyAmbience';

const random = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** The same UTC cycle gives visitors a common weather rhythm without extra messages. */
export function rainIntensity(seconds: number): number {
  const c = lobbyAmbience.rain, cycle = Math.floor(seconds / c.cycleSeconds);
  const phase = seconds - cycle * c.cycleSeconds;
  const start = c.clearMin + random(cycle) * (c.clearMax - c.clearMin);
  const duration = c.durationMin + random(cycle + 73) * (c.durationMax - c.durationMin);
  const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
  return smooth((phase - start) / c.fadeSeconds) * smooth((start + duration - phase) / c.fadeSeconds);
}
