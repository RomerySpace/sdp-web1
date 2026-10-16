import { Client, type Room } from '@colyseus/sdk';
import {
  LOBBY_NAME, MAX_PLAYERS, type ConnectionStatus, type LobbySnapshot,
  type MovementInput, type NetworkPlayer,
} from '../../shared/MultiplayerProtocol';
import type { MultiplayerConnection } from './MultiplayerConnection';
import type { ShooterInput, WeaponAction, WeaponEvent, CombatEvent } from '../../shared/ShooterProtocol';
import { validateChatText, type RoomChatMessage, type VoiceAccess } from '../../shared/CommunicationProtocol';
import { validateDisplayName } from '../../shared/PlayerIdentity';
import type { KillRecord, RoundScore, ShooterMatchSnapshot } from '../../shared/ShooterProtocol';
import type { AirstrikeFlight, AirstrikeRequest, AirstrikeResult } from '../../shared/AirstrikeProtocol';

function serverEndpoint(): string {
  const configured = import.meta.env.VITE_SDP_SERVER_URL;
  if (configured) {
    const url = new URL(configured, location.origin);
    if (location.protocol === 'https:' && ['http:', 'ws:'].includes(url.protocol)) {
      console.warn('[SDP] Ignoring an insecure server URL on HTTPS; using the same-origin secure proxy.');
    } else return url.toString();
  }
  return `${location.origin}/multiplayer`;
}

interface DecodedLobby {
  killFeed?: Iterable<KillRecord>;
  airstrikes?: Iterable<AirstrikeFlight>;
  players: { forEach(callback: (player: Omit<NetworkPlayer, 'playerId'>, id: string) => void): void };
  online: number;
  capacity: number;
  tick: number;
  wallTime?: number;
  serverTime?: number;
  shooterEnabled?: boolean;
  lighting?: 'day' | 'night';
  match?: ShooterMatchSnapshot['phase']; round?: number; matchEndsAt?: number; nextRoundAt?: number; results?: Iterable<RoundScore>;
}
interface LobbyRoomType { state: DecodedLobby; onJoin(client: unknown, options?: { displayName?: string }): void }
type LobbyRoom = Room<LobbyRoomType, DecodedLobby>;

export class ColyseusNetworkAdapter implements MultiplayerConnection {
  private readonly client: Client;
  private profileName = '';
  private room: LobbyRoom | undefined;
  private readonly states = new Set<(snapshot: LobbySnapshot) => void>();
  private readonly statuses = new Set<(status: ConnectionStatus) => void>();
  private readonly spawns = new Set<(player: NetworkPlayer) => void>();
  private currentStatus: ConnectionStatus = { state: 'disconnected', online: 0, capacity: MAX_PLAYERS, roomId: '' };
  private disposed = false;
  private joining = false;
  private generation = 0;
  private joinTask?: Promise<void>;
  private retryEnabled = true;
  roomType = LOBBY_NAME;
  private readonly weapons = new Set<(event: WeaponEvent) => void>();
  private readonly combatEvents = new Set<(event: CombatEvent) => void>();
  private readonly strikeResults = new Set<(result: AirstrikeResult) => void>();
  private needsSpawn = true;
  private retryTimer = 0;
  private retries = 0;
  private latestSnapshot: LobbySnapshot | undefined;
  private readonly messages = new Set<(message: RoomChatMessage) => void>();
  private readonly notices = new Set<(message: string) => void>();
  private readonly accessRequests = new Map<string, { resolve: (access: VoiceAccess) => void; reject: (error: Error) => void; timer: number }>();

  constructor(endpoint = serverEndpoint()) {
    this.client = new Client(endpoint);
    try { this.profileName = validateDisplayName(localStorage.getItem('sdp:displayName')) ?? ''; } catch {}
  }
  get displayName(): string { return this.profileName; }
  setDisplayName(raw: string): void {
    const name = validateDisplayName(raw); if (!name) throw new Error('Choose a name of 2-20 letters, numbers or spaces.');
    this.profileName = name;
    try { localStorage.setItem('sdp:displayName', name); } catch {}
  }

  get status(): ConnectionStatus { return this.currentStatus; }
  get snapshot(): LobbySnapshot | undefined { return this.latestSnapshot; }

  async connect(): Promise<void> {
    if (this.joinTask) return this.joinTask;
    const task = this.joinNetwork();
    this.joinTask = task;
    try { await task; } finally { if (this.joinTask === task) this.joinTask = undefined; }
  }

  private async joinNetwork(): Promise<void> {
    if (this.disposed || this.joining || this.room) return;
    const generation = this.generation;
    this.joining = true;
    this.setStatus('connecting');
    try {
      const preferredRoom = import.meta.env.DEV && this.roomType === LOBBY_NAME ? new URLSearchParams(location.search).get('room') : null;
      const room = preferredRoom
        ? await this.client.joinById<LobbyRoomType>(preferredRoom, { displayName: this.profileName || undefined })
        : await this.client.joinOrCreate<LobbyRoomType>(this.roomType, { displayName: this.profileName || undefined });
      if (this.disposed || generation !== this.generation) { await room.leave(); return; }
      this.room = room;
      this.needsSpawn = true;
      this.retries = 0;
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 6;
      room.reconnection.minDelay = 250;
      room.reconnection.maxDelay = 1000;
      room.reconnection.maxEnqueuedMessages = 0;
      room.onMessage<RoomChatMessage>('chat:message', (message) => {
        if (this.room !== room || message.roomId !== room.roomId) return;
        for (const callback of this.messages) callback(message);
      });
      room.onMessage<string>('chat:error', (message) => { if (this.room === room) for (const callback of this.notices) callback(message); });
      room.onMessage<WeaponEvent>('weapon:event', event => {
        if (this.room !== room || event.roomId !== room.roomId) return;
        for (const callback of this.weapons) callback(event);
      });
      room.onMessage<CombatEvent>('combat:event', event => {
        if (this.room !== room || event.roomId !== room.roomId) return;
        for (const callback of this.combatEvents) callback(event);
      });
      room.onMessage<string>('combat:ping', nonce => { if (this.room === room && room.connection.isOpen) room.send('combat:pong', nonce); });
      room.onMessage<AirstrikeResult>('strike:result', result => {
        if (this.room === room && result.roomId === room.roomId) for (const callback of this.strikeResults) callback(result);
      });
      room.onMessage<VoiceAccess>('voice:access', (access) => {
        const pending = this.accessRequests.get(access.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timer); this.accessRequests.delete(access.requestId);
        if (access.error) pending.reject(new Error(access.error));
        else if (access.identity !== room.sessionId || access.room !== `sdp-${room.roomId}` || !access.token || !access.url) pending.reject(new Error('Invalid voice session.'));
        else pending.resolve(access);
      });
      room.onStateChange((state) => this.receive(room, state));
      room.onDrop(() => {
        if (this.room !== room || this.disposed) return;
        this.rejectVoiceRequests();
        this.needsSpawn = true;
        this.setStatus('connecting');
        this.clearRemoteState();
      });
      room.onReconnect(() => {
        if (this.room === room && !this.disposed) this.receive(room, room.state);
      });
      room.onError(() => {
        if (this.room === room && !this.disposed) this.setStatus('disconnected');
      });
      room.onLeave(() => {
        if (this.room !== room) return;
        this.rejectVoiceRequests();
        this.room = undefined;
        this.setStatus('disconnected');
        this.clearRemoteState();
        this.scheduleRetry();
      });
      // Initial state can arrive before joinOrCreate resolves.
      if (room.state?.players) this.receive(room, room.state);
    } catch {
      if (!this.disposed && generation === this.generation) { this.setStatus('disconnected'); this.scheduleRetry(); }
    } finally { this.joining = false; }
  }

  private receive(room: LobbyRoom, state: DecodedLobby): void {
    if (this.room !== room || this.disposed || room.reconnection.isReconnecting || !state?.players) return;
    const players: NetworkPlayer[] = [];
    state.players.forEach((player, id) => players.push({
      displayName: player.displayName, automatic: player.automatic, kills: player.kills, deaths: player.deaths, streak: player.streak, strikes: player.strikes, lastDamageAt: player.lastDamageAt,
      playerId: id, x: player.x, y: player.y, z: player.z,
      yaw: player.yaw, pitch: player.pitch, connected: player.connected,
      lastProcessedInput: player.lastProcessedInput,
      crouching: player.crouching, sprinting: player.sprinting, grounded: player.grounded, height: player.height, lean: player.lean,
      gaitPhase: player.gaitPhase, gaitX: player.gaitX, gaitZ: player.gaitZ,
      ammo: player.ammo, reserve: player.reserve, reloading: player.reloading, weaponSeq: player.weaponSeq, health: player.health,
      dead: player.dead, life: player.life, diedAt: player.diedAt, respawnAt: player.respawnAt, bornAt: player.bornAt, protectedUntil: player.protectedUntil,
      spawnX: player.spawnX, spawnY: player.spawnY, spawnZ: player.spawnZ,
    }));
    const local = players.find((player) => player.playerId === room.sessionId);
    if (this.needsSpawn && local?.connected) {
      this.needsSpawn = false;
      for (const callback of this.spawns) callback(local);
    }
    this.setStatus('connected', state.online, state.capacity, room.roomId);
    const snapshot: LobbySnapshot = {
      roomId: room.roomId, localPlayerId: room.sessionId,
      tick: state.tick, receivedAt: performance.now(), players,
      wallTime: state.wallTime, serverTime: state.serverTime, shooterEnabled: state.shooterEnabled,
      airstrikes: Array.from(state.airstrikes ?? [], strike => ({ id: strike.id, ownerId: strike.ownerId, ownerName: strike.ownerName,
        life: strike.life, round: strike.round, x: strike.x, y: strike.y, z: strike.z, heading: strike.heading,
        startedAt: strike.startedAt, releasedAt: strike.releasedAt, impactAt: strike.impactAt, finishedAt: strike.finishedAt })),
      match: state.match ? { lighting: state.lighting, phase: state.match, round: state.round ?? 0, endsAt: state.matchEndsAt ?? 0, nextRoundAt: state.nextRoundAt ?? 0,
        results: Array.from(state.results ?? [], score => ({ playerId: score.playerId, displayName: score.displayName, kills: score.kills, deaths: score.deaths, streak: score.streak })) } : undefined,
      killFeed: Array.from(state.killFeed ?? [], entry => ({ id: entry.id, attackerId: entry.attackerId, victimId: entry.victimId,
        attackerName: entry.attackerName, victimName: entry.victimName, region: entry.region, timestamp: entry.timestamp })),
    };
    this.latestSnapshot = snapshot;
    for (const callback of this.states) callback(snapshot);
  }

  private setStatus(state: ConnectionStatus['state'], online = 0, capacity = MAX_PLAYERS, roomId = ''): void {
    if (this.disposed || (this.currentStatus.state === state && this.currentStatus.online === online && this.currentStatus.roomId === roomId)) return;
    this.currentStatus = { state, online, capacity, roomId };
    for (const callback of this.statuses) callback(this.currentStatus);
  }

  private clearRemoteState(): void {
    this.latestSnapshot = {
      roomId: '', localPlayerId: '', tick: 0, receivedAt: performance.now(), players: [],
    };
    for (const callback of this.states) callback(this.latestSnapshot);
  }

  private scheduleRetry(): void {
    if (this.disposed || !this.retryEnabled || this.retryTimer) return;
    const delay = Math.min(8000, 1000 * 2 ** Math.min(this.retries++, 3));
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      void this.connect();
    }, delay);
  }

  sendInput(input: MovementInput): void {
    if (this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('input', input);
  }
  sendShooterInput(input: ShooterInput): void {
    if (this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('shooter:input', input);
  }
  sendWeaponAction(action: WeaponAction): void {
    if (this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('weapon:action', action);
  }
  subscribeToWeapons(callback: (event: WeaponEvent) => void): () => void { this.weapons.add(callback); return () => this.weapons.delete(callback); }
  subscribeToCombat(callback: (event: CombatEvent) => void): () => void { this.combatEvents.add(callback); return () => this.combatEvents.delete(callback); }
  sendAirstrike(request: AirstrikeRequest): void {
    if (this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('strike:request', request);
  }
  subscribeToStrikes(callback: (result: AirstrikeResult) => void): () => void { this.strikeResults.add(callback); return () => this.strikeResults.delete(callback); }
  async ping(): Promise<number> {
    const room = this.room; if (!room?.connection.isOpen) return 0;
    return new Promise(resolve => {
      const timer = window.setTimeout(() => resolve(0), 2000);
      room.ping(ms => { window.clearTimeout(timer); resolve(ms); });
    });
  }
  async leaveRoom(): Promise<void> {
    this.retryEnabled = false; ++this.generation;
    window.clearTimeout(this.retryTimer); this.retryTimer = 0;
    this.rejectVoiceRequests();
    const room = this.room; this.room = undefined;
    this.setStatus('disconnected'); this.clearRemoteState();
    if (room) {
      room.reconnection.enabled = false;
      await new Promise<void>(resolve => {
        const timer = window.setTimeout(() => { room.connection.close(); resolve(); }, 2000);
        void room.leave(room.connection.isOpen).then(() => { window.clearTimeout(timer); resolve(); })
          .catch(() => { window.clearTimeout(timer); room.connection.close(); resolve(); });
      });
    }
    if (this.joinTask) await this.joinTask;
  }
  async switchRoom(type: string): Promise<void> {
    await this.leaveRoom();
    if (this.disposed) throw new Error('Multiplayer session is closed.');
    this.roomType = type;
    await this.connect();
    if (!this.room) {
      if (type === LOBBY_NAME) { this.retryEnabled = true; this.scheduleRetry(); }
      throw new Error('Multiplayer server could not join this room.');
    }
    const deadline = performance.now() + 20000;
    while (this.status.state !== 'connected') {
      if (this.disposed || !this.room || performance.now() > deadline) throw new Error('Room state did not arrive.');
      await new Promise(resolve => window.setTimeout(resolve, 25));
    }
    this.retryEnabled = true;
  }

  sendChat(text: string): boolean {
    const message = validateChatText(text);
    if (!message || this.currentStatus.state !== 'connected' || !this.room?.connection.isOpen) return false;
    this.room.send('chat:send', message);
    return true;
  }

  requestVoiceAccess(): Promise<VoiceAccess> {
    const room = this.room;
    if (!room?.connection.isOpen || this.status.state !== 'connected') return Promise.reject(new Error('Multiplayer is disconnected.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.accessRequests.delete(requestId); reject(new Error('Voice server did not respond.')); }, 8000);
      this.accessRequests.set(requestId, { resolve, reject, timer });
      room.send('voice:request', { requestId });
    });
  }

  private rejectVoiceRequests(): void {
    for (const request of this.accessRequests.values()) { window.clearTimeout(request.timer); request.reject(new Error('Multiplayer disconnected.')); }
    this.accessRequests.clear();
  }

  subscribeToChat(callback: (message: RoomChatMessage) => void): () => void {
    this.messages.add(callback); return () => this.messages.delete(callback);
  }

  subscribeToNotice(callback: (message: string) => void): () => void {
    this.notices.add(callback); return () => this.notices.delete(callback);
  }

  subscribeToState(callback: (snapshot: LobbySnapshot) => void): () => void {
    this.states.add(callback);
    return () => this.states.delete(callback);
  }

  subscribeToStatus(callback: (status: ConnectionStatus) => void): () => void {
    this.statuses.add(callback);
    callback(this.currentStatus);
    return () => this.statuses.delete(callback);
  }

  subscribeToSpawn(callback: (player: NetworkPlayer) => void): () => void {
    this.spawns.add(callback);
    return () => this.spawns.delete(callback);
  }

  disconnect(): void {
    if (this.disposed) return;
    this.setStatus('disconnected');
    this.clearRemoteState();
    this.disposed = true;
    this.rejectVoiceRequests();
    window.clearTimeout(this.retryTimer);
    const room = this.room;
    this.room = undefined;
    if (room) { room.reconnection.enabled = false; void room.leave().catch(() => {}); }
    this.states.clear(); this.statuses.clear(); this.spawns.clear();
    this.messages.clear(); this.notices.clear();
    this.weapons.clear();
    this.combatEvents.clear();
    this.strikeResults.clear();
  }
}
