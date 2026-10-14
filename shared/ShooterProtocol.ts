export const SHOOTER_ROOM = 'SDPShooterRoom';
export const SHOOTER_HZ = 60;
export const SHOOTER_PATCH_HZ = 30;
export const shooterNetworkConfig = {
  inputHz: 30, inputTimeoutMs: 400,
  interpolationMs: 70, maxInterpolationMs: 140, extrapolationMs: 100,
  historySize: 120, correctionTolerance: .12, teleportDistance: 3,
  correctionResponse: 14,
};
export interface ShooterInput {
  seq: number; life: number; f: number; r: number; y: number; p: number;
  s: boolean; c: boolean; j: boolean; a: boolean; active: boolean; l?: number;
}
export interface CharacterInput {
  readonly keys: Set<string>; readonly forward: number; readonly sideways: number;
  yaw: number; aiming: boolean; consume(code: string): boolean; clear(): void;
}
export type HitRegion = 'arm' | 'leg' | 'torso' | 'head' | 'foot';
export interface KillRecord { id: string; attackerId: string; victimId: string; attackerName: string; victimName: string; region: HitRegion; timestamp: number }
export interface RoundScore { playerId: string; displayName: string; kills: number; deaths: number; streak: number }
export interface ShooterMatchSnapshot {
  lighting?: 'day' | 'night';
  phase: 'waiting' | 'playing' | 'results'; round: number; endsAt: number; nextRoundAt: number; results: readonly RoundScore[];
}
export function rankRound(scores: readonly RoundScore[]): RoundScore[] {
  return [...scores].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.playerId.localeCompare(b.playerId));
}
export function roundWinners(scores: readonly RoundScore[]): RoundScore[] {
  const ranked = rankRound(scores), first = ranked[0];
  return first ? ranked.filter(p => p.kills === first.kills && p.deaths === first.deaths) : [];
}
export interface WeaponAction { seq: number; life: number; action: 'fire' | 'reload' | 'mode' }
export interface WeaponEvent extends WeaponAction { playerId: string; roomId: string; timestamp: number }
export interface CombatEvent { type: 'damage' | 'death' | 'respawn'; roomId: string; playerId: string;
  life: number; timestamp: number; health: number; damage?: number; attackerId?: string; region?: HitRegion }
export function validateShooterInput(raw: unknown): ShooterInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).length !== ('l' in v ? 12 : 11) || ('l' in v && !isMovementAxis(v.l)) || !Number.isSafeInteger(v.life) || (v.life as number) < 1 || (v.life as number) > 0x7fffffff ||
    !Number.isSafeInteger(v.seq) || (v.seq as number) < 0 || (v.seq as number) > 0x7fffffff ||
    !isMovementAxis(v.f) || !isMovementAxis(v.r) ||
    typeof v.y !== 'number' || !Number.isFinite(v.y) || Math.abs(v.y) > Math.PI * 2 ||
    typeof v.p !== 'number' || !Number.isFinite(v.p) || Math.abs(v.p) > 1.5 ||
    !['s', 'c', 'j', 'a', 'active'].every(k => typeof v[k] === 'boolean')) return null;
  return { ...('l' in v ? { l: v.l as number } : {}), seq: v.seq as number, life: v.life as number, f: v.f as number, r: v.r as number,
    y: Math.atan2(Math.sin(v.y as number), Math.cos(v.y as number)), p: v.p as number,
    s: v.s as boolean, c: v.c as boolean, j: v.j as boolean, a: v.a as boolean, active: v.active as boolean };
}
export function validateWeaponAction(raw: unknown): WeaponAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 3 && Number.isSafeInteger(v.life) && (v.life as number) >= 1 && (v.life as number) <= 0x7fffffff &&
    Number.isSafeInteger(v.seq) && (v.seq as number) >= 0 && (v.seq as number) <= 0x7fffffff &&
    (v.action === 'fire' || v.action === 'reload' || v.action === 'mode') ? { seq: v.seq as number, life: v.life as number, action: v.action } : null;
}
import { isMovementAxis } from './MultiplayerProtocol';
