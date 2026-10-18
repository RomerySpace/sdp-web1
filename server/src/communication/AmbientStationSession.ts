import { ambientStation, createStation, stationPhase, stationStepMs, validStationCommand, type StationSnapshot, type StationSound } from '../../../shared/AmbientStation';

interface Visitor { x: number; y: number; z: number; connected: boolean; displayName: string; seatIndex: number }
interface Held { track: number; note: number; at: number; recorded?: number }
export class AmbientStationSession {
  readonly state: StationSnapshot;
  private readonly held = new Map<string, Held>();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private lastActivity = 0;
  private nextNote = 0;
  constructor(roomId: string, private readonly changed: (state: StationSnapshot) => void, private readonly sound: (sound: StationSound) => void) {
    this.state = createStation(roomId);
  }
  private near(player?: Visitor): boolean {
    return !!player?.connected && player.seatIndex < 0 && player.y < 2 && Math.hypot(player.x - ambientStation.x, player.z - ambientStation.z) <= ambientStation.interactionDistance + .2;
  }
  private publish(now: number): void { this.state.serverNow = now; this.state.revision++; this.changed(this.state); }
  handle(id: string, player: Visitor | undefined, raw: unknown, now: number): string | undefined {
    if (!player?.connected || !validStationCommand(raw)) return;
    let rate = this.rates.get(id);
    if (!rate || now - rate.at >= 1000) { rate = { at: now, count: 0 }; this.rates.set(id, rate); }
    if (++rate.count > 32) return;
    this.tick(now, this.state.ownerId === id ? player : undefined, false);
    if (raw.type === 'sync') return;
    if (raw.type === 'release') { if (id === this.state.ownerId) this.release(now); return; }
    if (raw.type === 'claim') {
      if (!this.near(player)) return 'Move closer to the instrument.';
      if (this.state.ownerId && this.state.ownerId !== id) return 'The instrument is occupied.';
      this.state.ownerId = id; this.state.ownerName = player.displayName;
      this.lastActivity = now; this.state.leaseExpiresAt = now + ambientStation.leaseMs; this.publish(now); return;
    }
    if (this.state.ownerId !== id || !this.near(player)) return 'The instrument is occupied or out of reach.';
    this.state.leaseExpiresAt = now + ambientStation.leaseMs;
    if (raw.type === 'heartbeat') return;
    this.lastActivity = now;
    if (raw.type === 'note') {
      const key = `${raw.track}:${raw.note}`, previous = this.held.get(key);
      if (!raw.on) { if (previous) this.noteOff(key, previous, now); return; }
      if (previous || this.held.size >= 8) return;
      const at = now + ambientStation.leadMs, track = this.state.tracks[raw.track];
      let recorded: number | undefined;
      if (track.recording && track.notes.length < ambientStation.maxNotes) {
        recorded = ++this.nextNote;
        track.notes.push({ id: recorded, note: raw.note, velocity: raw.velocity, step: Math.round(stationPhase(this.state, at)) % 64, duration: 1, firstAt: at });
        this.publish(now);
      }
      this.held.set(key, { track: raw.track, note: raw.note, at, recorded });
      this.sound({ roomId: this.state.roomId, track: raw.track, note: raw.note, velocity: raw.velocity, on: true, at }); return;
    }
    if (raw.type === 'transport' || raw.type === 'preset' || raw.type === 'clear') this.allOff(now);
    switch (raw.type) {
      case 'transport':
        this.state.playing = raw.playing;
        if (raw.playing) this.state.startedAt = now + ambientStation.leadMs;
        else this.state.tracks.forEach(t => t.recording = false);
        break;
      case 'tempo': if (this.state.playing) return 'Stop the loop before changing tempo.'; this.state.bpm = raw.bpm; break;
      case 'record':
        this.state.tracks[raw.track].recording = raw.enabled;
        if (raw.enabled && !this.state.playing) { this.state.playing = true; this.state.startedAt = now + ambientStation.leadMs; }
        break;
      case 'mute': this.state.tracks[raw.track].muted = raw.enabled; break;
      case 'clear': this.state.tracks[raw.track].notes = []; break;
      case 'preset': this.state.tracks[raw.track].preset = raw.preset; break;
      case 'parameter': this.state.tracks[raw.track][raw.key] = raw.value; break;
    }
    this.publish(now);
  }
  private noteOff(key: string, note: Held, now: number): void {
    this.held.delete(key);
    this.sound({ roomId: this.state.roomId, track: note.track, note: note.note, velocity: 0, on: false, at: now + ambientStation.leadMs });
    const recorded = this.state.tracks[note.track].notes.find(n => n.id === note.recorded);
    if (recorded) { recorded.duration = Math.max(1, Math.min(64, Math.round((now + ambientStation.leadMs - note.at) / stationStepMs(this.state.bpm)))); this.publish(now); }
  }
  private allOff(now: number): void { for (const [key, note] of this.held) this.noteOff(key, note, now); }
  release(now: number): void {
    this.allOff(now); this.state.ownerId = this.state.ownerName = ''; this.state.leaseExpiresAt = 0;
    this.state.tracks.forEach(t => t.recording = false); this.publish(now);
  }
  remove(id: string, now: number): void { this.rates.delete(id); if (this.state.ownerId === id) this.release(now); }
  tick(now: number, owner?: Visitor, checkPosition = true): void {
    if (this.state.ownerId && (now > this.state.leaseExpiresAt || now - this.lastActivity > ambientStation.idleMs || (checkPosition && !this.near(owner)))) this.release(now);
    for (const [key, note] of this.held) if (now + ambientStation.leadMs - note.at >= ambientStation.maxHeldMs) this.noteOff(key, note, now);
  }
}
