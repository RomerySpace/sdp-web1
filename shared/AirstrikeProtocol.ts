import { STREAK_TIERS } from './Streaks';

const flightAltitude = 30;
export const airstrikeConfig = {
  tiers: STREAK_TIERS, altitude: flightAltitude, approach: 4, fall: 1.35, departure: 4,
  radius: 10, coreRadius: 3, damage: 120, explosionDuration: 2.4, fragments: 80,
  maxActive: 4, requestInterval: 350, maxTargetHeight: flightAltitude,
};
export type StrikeSlot = 1 | 2 | 3;
export interface AirstrikeRequest { seq: number; life: number; slot: StrikeSlot; x: number; z: number }
export interface AirstrikeFlight {
  id: string; ownerId: string; ownerName: string; life: number; round: number;
  x: number; y: number; z: number; heading: number;
  startedAt: number; releasedAt: number; impactAt: number; finishedAt: number;
}
export interface AirstrikeResult { seq: number; roomId: string; accepted: boolean; message: string }
export const strikeBit = (slot: StrikeSlot): number => 1 << (slot - 1);
export function earnedStrikeMask(streak: number): number {
  return airstrikeConfig.tiers.reduce((mask, tier, i) => mask | (streak >= tier ? 1 << i : 0), 0);
}
export function blastDamage(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0 || distance >= airstrikeConfig.radius) return 0;
  const falloff = Math.max(0, (distance - airstrikeConfig.coreRadius) / (airstrikeConfig.radius - airstrikeConfig.coreRadius));
  return Math.round(airstrikeConfig.damage * (1 - falloff));
}
export function validateAirstrikeRequest(raw: unknown): AirstrikeRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).length !== 5 || !Number.isSafeInteger(v.seq) || (v.seq as number) < 0 || (v.seq as number) > 0x7fffffff ||
    !Number.isSafeInteger(v.life) || (v.life as number) < 1 || (v.life as number) > 0x7fffffff ||
    ![1, 2, 3].includes(v.slot as number) || typeof v.x !== 'number' || !Number.isFinite(v.x) ||
    typeof v.z !== 'number' || !Number.isFinite(v.z) || Math.abs(v.x) > 500 || Math.abs(v.z) > 500) return null;
  return { seq: v.seq as number, life: v.life as number, slot: v.slot as StrikeSlot, x: v.x, z: v.z };
}
