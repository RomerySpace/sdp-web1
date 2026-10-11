export const LOBBY_NAME = 'SDPLobby';
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
}

export interface NetworkPlayer {
  playerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  connected: boolean;
  lastProcessedInput: number;
}

export interface LobbySnapshot {
  roomId: string;
  localPlayerId: string;
  tick: number;
  receivedAt: number;
  players: readonly NetworkPlayer[];
}

export interface ConnectionStatus {
  state: 'connecting' | 'connected' | 'disconnected';
  online: number;
  capacity: number;
  roomId: string;
}

export function validateMovementInput(value: unknown): MovementInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 6 ||
    !Number.isSafeInteger(data.seq) || (data.seq as number) < 0 || (data.seq as number) > 0x7fffffff ||
    ![-1, 0, 1].includes(data.f as number) || ![-1, 0, 1].includes(data.r as number) ||
    typeof data.y !== 'number' || !Number.isFinite(data.y) || Math.abs(data.y) > Math.PI * 2 ||
    typeof data.p !== 'number' || !Number.isFinite(data.p) || Math.abs(data.p) > Math.PI / 2 ||
    typeof data.active !== 'boolean') return null;
  return {
    seq: data.seq as number, f: data.f as number, r: data.r as number,
    y: Math.atan2(Math.sin(data.y), Math.cos(data.y)),
    p: Math.max(-Math.PI / 2 + 0.03, Math.min(Math.PI / 2 - 0.03, data.p)),
    active: data.active,
  };
}
