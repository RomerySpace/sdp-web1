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
  private accumulator = 0;
  private readonly chat = new ChatPolicy();
  private voice!: VoiceSessions;
  private readonly voiceRequests = new Map<string, number>();

  onCreate(): void {
    this.voice = new VoiceSessions(this.roomId);
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
    for (const [id, entry] of this.inputs) {
      const player = this.state.players.get(id);
      if (!player?.connected) continue;
      if (this.clock.elapsedTime - entry.receivedAt > INPUT_TIMEOUT_MS) entry.value.active = false;
      const position = this.simulation.step(id, entry.value)!;
      player.x = position.x;
      player.z = position.z;
      player.y = 1.7 + (position.elevation ?? 0);
      player.crouching = Boolean(entry.value.active && entry.value.c);
      player.yaw = entry.value.y;
      player.pitch = entry.value.p;
      player.lastProcessedInput = Math.max(0, entry.value.seq);
    }
    this.state.tick = (this.state.tick + 1) >>> 0;
  }

  private visitorName(id: string): string { return this.state.players.get(id)?.displayName ?? 'VISITOR'; }

  async onDispose(): Promise<void> {
    this.inputs.clear(); this.simulation.clear(); this.chat.clear(); this.voiceRequests.clear();
    await this.voice.dispose();
  }
}
