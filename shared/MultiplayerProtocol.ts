export const LOBBY_NAME = 'SDPLimboRoom';
export const MAX_PLAYERS = 25;
export const SIMULATION_HZ = 20;
export const PLAYER_HEIGHT = 1.7;

export interface MovementInput {
  seq: number;
  f: number;
  r: number;
  y: number;
  p: number;
  active: boolean;
  s?: boolean;
  j?: boolean;
  c?: boolean;
}

export interface NetworkPlayer {
  playerId: string;
  displayName?: string;
  automatic?: boolean;
  kills?: number;
  deaths?: number;
  streak?: number;
  strikes?: number;
  lastDamageAt?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  connected: boolean;
  lastProcessedInput: number;
  crouching?: boolean;
  sprinting?: boolean;
  grounded?: boolean;
  height?: number;
  lean?: number;
  ammo?: number;
  reserve?: number;
  reloading?: boolean;
  weaponSeq?: number;
  health?: number;
  dead?: boolean;
  life?: number;
  diedAt?: number;
  respawnAt?: number;
  bornAt?: number;
  protectedUntil?: number;
  spawnX?: number;
  spawnY?: number;
  spawnZ?: number;
}

export interface LobbySnapshot {
  roomId: string;
  localPlayerId: string;
  tick: number;
  receivedAt: number;
  players: readonly NetworkPlayer[];
  wallTime?: number;
  serverTime?: number;
  shooterEnabled?: boolean;
  killFeed?: readonly KillRecord[];
  match?: ShooterMatchSnapshot;
  airstrikes?: readonly import('./AirstrikeProtocol').AirstrikeFlight[];
}

export interface ConnectionStatus {
  state: 'connecting' | 'connected' | 'disconnected';
  online: number;
  capacity: number;
  roomId: string;
}
export function isMovementAxis(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1;
}

export function validateMovementInput(value: unknown): MovementInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['seq', 'f', 'r', 'y', 'p', 'active', 's', 'j', 'c'].includes(key)) ||
    (['s', 'j', 'c'].some(k => k in data && typeof data[k] !== 'boolean')) ||
    !Number.isSafeInteger(data.seq) || (data.seq as number) < 0 || (data.seq as number) > 0x7fffffff ||
    !isMovementAxis(data.f) || !isMovementAxis(data.r) ||
    typeof data.y !== 'number' || !Number.isFinite(data.y) || Math.abs(data.y) > Math.PI * 2 ||
    typeof data.p !== 'number' || !Number.isFinite(data.p) || Math.abs(data.p) > Math.PI / 2 ||
    typeof data.active !== 'boolean') return null;
  return {
    seq: data.seq as number, f: data.f as number, r: data.r as number,
    y: Math.atan2(Math.sin(data.y), Math.cos(data.y)),
    p: Math.max(-Math.PI / 2 + 0.03, Math.min(Math.PI / 2 - 0.03, data.p)),
    active: data.active,
    ...('s' in data ? { s: data.s as boolean } : {}),
    ...('j' in data ? { j: data.j as boolean } : {}),
    ...('c' in data ? { c: data.c as boolean } : {}),
  };
}
import type { KillRecord, ShooterMatchSnapshot } from './ShooterProtocol';
