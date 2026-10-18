export const ambientStation = {
  x: -34, z: -26, width: 3.2, depth: 1.15, height: 1.04,
  interactionDistance: 3, fullRadius: 5, hearingRadius: 30,
  tracks: 4, loopBeats: 16, stepsPerBeat: 4, maxNotes: 64,
  leadMs: 180, leaseMs: 20000, idleMs: 120000, maxHeldMs: 10000,
  benches: [
    { x: -40, z: -24, yaw: Math.atan2(-6, 2) },
    { x: -28, z: -24, yaw: Math.atan2(6, 2) },
    { x: -34, z: -19, yaw: 0 },
    { x: -40, z: -28, yaw: Math.atan2(-6, -2) },
    { x: -28, z: -28, yaw: Math.atan2(6, -2) },
    { x: -34, z: -33, yaw: Math.PI },
  ],
} as const;
export const stationPresets = ['pad', 'glass', 'grain', 'drone'] as const;
export type StationPreset = typeof stationPresets[number];
export interface StationNote { id: number; note: number; step: number; duration: number; velocity: number; firstAt: number }
export interface StationTrack {
  preset: StationPreset; gain: number; tone: number; space: number; echo: number;
  muted: boolean; recording: boolean; notes: StationNote[];
}
export interface StationSnapshot {
  roomId: string; revision: number; serverNow: number; ownerId: string; ownerName: string;
  leaseExpiresAt: number; playing: boolean; startedAt: number; bpm: number; tracks: StationTrack[];
}
export interface StationSound { roomId: string; track: number; note: number; velocity: number; on: boolean; at: number }
export type StationCommand = { type: 'claim' | 'release' | 'heartbeat' | 'sync' }
  | { type: 'transport'; playing: boolean }
  | { type: 'tempo'; bpm: number }
  | { type: 'clear'; track: number }
  | { type: 'record' | 'mute'; track: number; enabled: boolean }
  | { type: 'preset'; track: number; preset: StationPreset }
  | { type: 'parameter'; track: number; key: 'gain' | 'tone' | 'space' | 'echo'; value: number }
  | { type: 'note'; track: number; note: number; velocity: number; on: boolean };

export function createStation(roomId: string): StationSnapshot {
  return { roomId, revision: 0, serverNow: 0, ownerId: '', ownerName: '', leaseExpiresAt: 0,
    playing: false, startedAt: 0, bpm: 72,
    tracks: stationPresets.map(preset => ({ preset, gain: .55, tone: .45, space: .65, echo: .25, muted: false, recording: false, notes: [] })) };
}
export function stationStepMs(bpm: number): number { return 60000 / bpm / ambientStation.stepsPerBeat; }
export function stationPhase(state: StationSnapshot, now: number): number {
  const length = ambientStation.loopBeats * ambientStation.stepsPerBeat;
  return ((now - state.startedAt) / stationStepMs(state.bpm) % length + length) % length;
}
export function validStationCommand(raw: unknown): raw is StationCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  const fields = (...keys: string[]) => Object.keys(r).length === keys.length + 1 && Object.keys(r).every(k => k === 'type' || keys.includes(k));
  const track = Number.isInteger(r.track) && Number(r.track) >= 0 && Number(r.track) < ambientStation.tracks;
  const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  switch (r.type) {
    case 'claim': case 'release': case 'heartbeat': case 'sync': return fields();
    case 'transport': return fields('playing') && typeof r.playing === 'boolean';
    case 'tempo': return fields('bpm') && Number.isInteger(r.bpm) && Number(r.bpm) >= 50 && Number(r.bpm) <= 110;
    case 'clear': return track && fields('track');
    case 'record': case 'mute': return track && fields('track', 'enabled') && typeof r.enabled === 'boolean';
    case 'preset': return track && fields('track', 'preset') && stationPresets.includes(r.preset as StationPreset);
    case 'parameter': return track && fields('track', 'key', 'value') && typeof r.key === 'string' && ['gain', 'tone', 'space', 'echo'].includes(r.key) && unit(r.value);
    case 'note': return track && fields('track', 'note', 'velocity', 'on') && Number.isInteger(r.note) && Number(r.note) >= 24 && Number(r.note) <= 96 && unit(r.velocity) && typeof r.on === 'boolean';
    default: return false;
  }
}

/** Computer MIDI keyboard: white A-L, black W/E/T/Y/U/O; Z/X change octave. */
export const stationKeyboard: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14,
};
