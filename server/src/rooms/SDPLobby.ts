import { Room, ServerError, type Client } from '@colyseus/core';
import { roomDisplayName, validateDisplayName } from '../../../shared/PlayerIdentity';
import { randomUUID } from 'node:crypto';
import { validVoiceRequest, type RoomChatMessage } from '../../../shared/CommunicationProtocol';
import { ChatPolicy } from '../communication/ChatPolicy';
import { VoiceSessions } from '../communication/VoiceSessions';
import { MAX_PLAYERS, SIMULATION_HZ, validateMovementInput, type MovementInput } from '../../../shared/MultiplayerProtocol';
import { MovementSimulation } from '../simulation/MovementSimulation';
import { spawnPosition } from '../simulation/SpawnPositions';
import { LobbyState, VisitorState } from '../state/LobbyState';
import { lobbyRetreat, lobbySeatSlots, seatExits, validSeatRequest } from '../../../shared/LobbyRetreat';
import { lobbyGroundHeight } from '../../../shared/ListeningGarden';
import { CollisionManager } from '../../../src/player/CollisionManager';
import { AmbientStationSession } from '../communication/AmbientStationSession';
import { validStationCommand } from '../../../shared/AmbientStation';

interface VisitorInput { value: MovementInput; receivedAt: number; slot: number }
const INPUT_TIMEOUT_MS = 250;

export class SDPLobby extends Room<{ state: LobbyState }> {
  static async onAuth(_token: string, options: { displayName?: unknown } = {}): Promise<boolean> {
    if (options.displayName !== undefined && !validateDisplayName(options.displayName)) throw new ServerError(400, 'Invalid display name.');
    return true;
  }
  state = new LobbyState();
  maxClients = MAX_PLAYERS;
  maxMessagesPerSecond = 60;
  private readonly inputs = new Map<string, VisitorInput>();
  private readonly simulation = new MovementSimulation();
  private readonly seatingRequests = new Map<string, number>();
  private readonly seatingWorld = new CollisionManager();
  private accumulator = 0;
  private readonly chat = new ChatPolicy();
  private voice!: VoiceSessions;
  private readonly voiceRequests = new Map<string, number>();
  private station!: AmbientStationSession;
  private readonly stationSyncs = new Map<string, number>();

  onCreate(): void {
    this.station = new AmbientStationSession(this.roomId, state => this.broadcast('station:state', state), sound => this.broadcast('station:sound', sound));
    this.onMessage('station:command', (client, raw: unknown) => {
      const player = this.state.players.get(client.sessionId), now = Date.now();
      if (!player?.connected || !validStationCommand(raw)) return;
      if (raw.type === 'sync') {
        if (now - (this.stationSyncs.get(client.sessionId) ?? 0) < 2000) return;
        this.stationSyncs.set(client.sessionId, now);
        client.send('station:state', { ...this.station.state, serverNow: now }); return;
      }
      const notice = this.station.handle(client.sessionId, player, raw, now);
      if (notice) client.send('lobby:notice', notice);
    });
    this.voice = new VoiceSessions(this.roomId);
    this.onMessage('lobby:seat', (client, raw: unknown) => {
      const player = this.state.players.get(client.sessionId), now = this.clock.elapsedTime;
      if (!player?.connected || !validSeatRequest(raw)) return;
      if (raw.seat === -1) {
        if (!this.stand(client.sessionId) && player.seatIndex >= 0) client.send('lobby:notice', 'Please wait for space beside the bench.');
        return;
      }
      if (now - (this.seatingRequests.get(client.sessionId) ?? -1000) < 250) return;
      this.seatingRequests.set(client.sessionId, now);
      if (player.seatIndex >= 0) return;
      const seat = lobbySeatSlots[raw.seat];
      if (Math.hypot(player.x - seat.x, player.z - seat.z) > lobbyRetreat.interactionDistance || player.y - lobbyGroundHeight(player.x, player.z) > 1.8) {
        client.send('lobby:notice', 'Move closer to sit.'); return;
      }
      if ([...this.state.players.values()].some(other => other.connected && other.seatIndex === raw.seat)) {
        client.send('lobby:notice', 'That bench is occupied.'); return;
      }
      player.seatIndex = raw.seat; player.x = seat.x; player.z = seat.z; player.y = seat.groundY + lobbyRetreat.seatedEye; player.yaw = seat.yaw; player.crouching = false;
      const entry = this.inputs.get(client.sessionId);
      if (entry) { entry.value.active = false; entry.value.f = entry.value.r = 0; entry.value.y = seat.yaw; entry.value.p = 0; }
      this.simulation.add(client.sessionId, seat);
    });
    this.setPatchRate(1000 / SIMULATION_HZ);
    this.onMessage('chat:send', (client, raw: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
      const message = this.chat.accept(client.sessionId, raw, this.clock.elapsedTime);
      if (!message) { client.send('chat:error', 'Message is empty, too long, or sent too quickly.'); return; }
      const data: RoomChatMessage = {
        messageId: randomUUID(), senderId: client.sessionId, senderName: this.visitorName(client.sessionId),
        message, timestamp: Date.now(), roomId: this.roomId,
        position: { x: player.x, y: player.y, z: player.z },
      };
      this.broadcast('chat:message', data);
    });
    this.onMessage('voice:request', (client, raw: unknown) => {
      if (!this.state.players.get(client.sessionId)?.connected || !validVoiceRequest(raw)) return;
      const now = this.clock.elapsedTime;
      if (now - (this.voiceRequests.get(client.sessionId) ?? -2000) < 1000) {
        client.send('voice:access', { requestId: raw.requestId, error: 'Please wait before reconnecting voice.' }); return;
      }
      this.voiceRequests.set(client.sessionId, now);
      void this.voice.access(client.sessionId, this.visitorName(client.sessionId), raw.requestId)
        .then((access) => {
          if (this.state.players.get(client.sessionId)?.connected) client.send('voice:access', access);
          else void this.voice.remove(client.sessionId);
        }).catch(() => client.send('voice:access', { requestId: raw.requestId, error: 'Voice token could not be issued.' }));
    });
    this.onMessage('input', (client, raw: unknown) => {
      const entry = this.inputs.get(client.sessionId);
      const value = validateMovementInput(raw);
      if (!entry || !value || value.seq <= entry.value.seq || !this.state.players.get(client.sessionId)?.connected) return;
      entry.value = value;
      entry.receivedAt = this.clock.elapsedTime;
    });
    // Constant 50ms steps with bounded catch-up; packets cannot advance simulation time.
    this.setSimulationInterval((elapsedMs) => {
      this.accumulator = Math.min(this.accumulator + elapsedMs, 250);
      while (this.accumulator >= 1000 / SIMULATION_HZ) {
        this.updatePlayers();
        this.accumulator -= 1000 / SIMULATION_HZ;
      }
    }, 1000 / SIMULATION_HZ);
  }

  onJoin(client: Client, options: { displayName?: unknown } = {}): void {
    if (options.displayName !== undefined && !validateDisplayName(options.displayName)) throw new ServerError(400, 'Invalid display name.');
    const occupied = new Set(Array.from(this.inputs.values(), (entry) => entry.slot));
    let slot = 0;
    while (occupied.has(slot)) slot++;
    const spawn = spawnPosition(slot);
    const player = new VisitorState();
    player.displayName = roomDisplayName(options.displayName, [...this.state.players.values()].map(p => p.displayName), `VISITOR ${String(slot + 1).padStart(2, '0')}`);
    Object.assign(player, spawn);
    this.state.players.set(client.sessionId, player);
    this.state.online++;
    this.inputs.set(client.sessionId, {
      slot, receivedAt: this.clock.elapsedTime,
      value: { seq: -1, f: 0, r: 0, y: spawn.yaw, p: spawn.pitch, active: false },
    });
    this.simulation.add(client.sessionId, spawn);
  }

  onDrop(client: Client): void {
    this.station.remove(client.sessionId, Date.now()); this.stationSyncs.delete(client.sessionId);
    this.stand(client.sessionId, true);
    void this.voice.remove(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player?.connected) { player.connected = false; this.state.online--; }
    this.simulation.stop(client.sessionId);
    const entry = this.inputs.get(client.sessionId);
    if (entry) entry.value.active = false;
    this.allowReconnection(client, 5);
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player && !player.connected) { player.connected = true; this.state.online++; }
  }

  onLeave(client: Client): void {
    this.station.remove(client.sessionId, Date.now()); this.stationSyncs.delete(client.sessionId);
    this.seatingRequests.delete(client.sessionId);
    void this.voice.remove(client.sessionId);
    this.voiceRequests.delete(client.sessionId);
    this.chat.remove(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player?.connected) this.state.online--;
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.simulation.remove(client.sessionId);
  }

  private updatePlayers(): void {
    this.state.wallTime = Date.now();
    this.station.tick(this.state.wallTime, this.state.players.get(this.station.state.ownerId));
    for (const [id, entry] of this.inputs) {
      const player = this.state.players.get(id);
      if (!player?.connected) continue;
      if (this.clock.elapsedTime - entry.receivedAt > INPUT_TIMEOUT_MS) entry.value.active = false;
      if (player.seatIndex >= 0 && entry.value.active && (entry.value.f !== 0 || entry.value.r !== 0 || entry.value.j)) this.stand(id);
      if (player.seatIndex >= 0) {
        player.yaw = entry.value.y; player.pitch = entry.value.p; player.lastProcessedInput = Math.max(0, entry.value.seq); continue;
      }
      const position = this.simulation.step(id, entry.value)!;
      player.x = position.x;
      player.z = position.z;
      player.y = lobbyGroundHeight(position.x, position.z) + 1.7 + (position.elevation ?? 0);
      player.crouching = Boolean(entry.value.active && entry.value.c);
      player.yaw = entry.value.y;
      player.pitch = entry.value.p;
      player.lastProcessedInput = Math.max(0, entry.value.seq);
    }
    this.state.tick = (this.state.tick + 1) >>> 0;
  }

  private visitorName(id: string): string { return this.state.players.get(id)?.displayName ?? 'VISITOR'; }

  private stand(id: string, force = false): boolean {
    const player = this.state.players.get(id);
    if (!player || player.seatIndex < 0) return false;
    const exits = seatExits(player.seatIndex);
    const position = exits.find(exit => this.seatingWorld.canOccupy(exit.x, exit.z) && [...this.state.players].every(([otherId, other]) => otherId === id || !other.connected || Math.hypot(other.x - exit.x, other.z - exit.z) >= .6)) ?? (force ? exits[0] : undefined);
    if (!position) return false;
    player.seatIndex = -1; player.x = position.x; player.z = position.z; player.y = lobbyGroundHeight(position.x, position.z) + 1.7;
    this.simulation.add(id, position); return true;
  }

  async onDispose(): Promise<void> {
    this.inputs.clear(); this.simulation.clear(); this.chat.clear(); this.voiceRequests.clear(); this.seatingRequests.clear();
    await this.voice.dispose();
  }
}
