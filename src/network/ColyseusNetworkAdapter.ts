import { Client, ErrorCode, type Room, type SeatReservation } from '@colyseus/sdk';
import { socialConfig, type RoomInvitation, type SocialResult } from '../../shared/SocialProtocol';
import {
  LOBBY_NAME, MAX_PLAYERS, type ConnectionStatus, type LobbySnapshot,
  type MovementInput, type NetworkPlayer,
} from '../../shared/MultiplayerProtocol';
import type { MultiplayerConnection } from './MultiplayerConnection';
import type { ShooterInput, WeaponAction, WeaponEvent, CombatEvent } from '../../shared/ShooterProtocol';
import { SHOOTER_MAX_PLAYERS, SHOOTER_ROOM } from '../../shared/ShooterProtocol';
import { validateChatText, type RoomChatMessage, type VoiceAccess } from '../../shared/CommunicationProtocol';
import { validateDisplayName } from '../../shared/PlayerIdentity';
import type { KillRecord, RoundScore, ShooterMatchSnapshot } from '../../shared/ShooterProtocol';
import type { StationClaimResult, StationCommand, StationSnapshot, StationSound } from '../../shared/AmbientStation';
import { sessionPolicy } from '../../shared/SessionPolicy';
import type { GalleryListenResult } from '../../shared/LowerGallery';
import { AdmissionClient } from './AdmissionClient';
import { admissionConfig } from '../../shared/Admission';

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
  interactionVersion?: number;
  killFeed?: Iterable<KillRecord>;
  players: { forEach(callback: (player: Omit<NetworkPlayer, 'playerId'>, id: string) => void): void };
  online: number;
  capacity: number;
  tick: number;
  wallTime?: number;
  serverTime?: number;
  shooterEnabled?: boolean;
  lighting?: string;
  match?: ShooterMatchSnapshot['phase']; round?: number; matchEndsAt?: number; nextRoundAt?: number; results?: Iterable<RoundScore>;
}
interface LobbyRoomType { state: DecodedLobby; onJoin(client: unknown, options?: { displayName?: string }): void }
type LobbyRoom = Room<LobbyRoomType, DecodedLobby>;

export class ColyseusNetworkAdapter implements MultiplayerConnection {
  private readonly client: Client;
  private readonly admission: AdmissionClient;
  private lastReservationSave = 0;
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
  private inactive = false;
  roomType = LOBBY_NAME;
  private get expectedCapacity(): number { return this.roomType === SHOOTER_ROOM ? SHOOTER_MAX_PLAYERS : MAX_PLAYERS; }
  private readonly weapons = new Set<(event: WeaponEvent) => void>();
  private readonly combatEvents = new Set<(event: CombatEvent) => void>();
  private readonly stationStates = new Set<(state: StationSnapshot | null) => void>();
  private readonly stationSounds = new Set<(sound: StationSound) => void>();
  private stationSnapshot: StationSnapshot | null = null;
  private readonly corrections = new Set<(player: NetworkPlayer) => void>();
  private readonly stationClaims = new Set<(result: StationClaimResult) => void>();
  private stationRequestId?: string;
  private readonly galleryRequests = new Map<string, { value: boolean; finish: (result: GalleryListenResult) => void; reject: (error: Error) => void }>();
  private needsSpawn = true;
  private retryTimer = 0;
  private retries = 0;
  private latestSnapshot: LobbySnapshot | undefined;
  private readonly messages = new Set<(message: RoomChatMessage) => void>();
  private readonly notices = new Set<(message: string) => void>();
  private readonly accessRequests = new Map<string, { resolve: (access: VoiceAccess) => void; reject: (error: Error) => void; timer: number }>();
  private preparedSeat?: SeatReservation;
  private readonly invitations = new Set<(invitation: RoomInvitation) => void>();
  private readonly socialRequests = new Map<string, { resolve: (result: SocialResult) => void; reject: (error: Error) => void; timer: number }>();

  constructor(endpoint = serverEndpoint()) {
    this.client = new Client(endpoint);
    this.admission = new AdmissionClient(this.client);
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
    if (this.disposed || this.inactive || this.joining || this.room) return;
    const generation = this.generation;
    this.joining = true;
    this.setStatus('connecting');
    try {
      const preferredRoom = import.meta.env.DEV && this.roomType === LOBBY_NAME ? new URLSearchParams(location.search).get('room') : null;
      let room: LobbyRoom | undefined;
      const prepared = this.preparedSeat; this.preparedSeat = undefined;
      if (prepared) room = await this.client.consumeSeatReservation<DecodedLobby>(prepared);
      const saved = room ? undefined : this.savedReconnect();
      if (saved) {
        try {
          const previous = await this.client.reconnect<LobbyRoomType>(saved.token);
          if (saved.type === this.roomType) room = previous;
          else { previous.reconnection.enabled = false; await previous.leave(); this.clearReconnect(); }
        } catch (error) {
          if (this.isExpiredReservation((error as { code?: number }).code)) this.clearReconnect();
          else throw error;
        }
      }
      if (!room) {
        const admissionToken = await this.admission.enter(position => this.setStatus('connecting', 0, this.expectedCapacity, '', undefined, position), this.profileName || undefined);
        if (this.disposed || generation !== this.generation) return;
        const options = { displayName: this.profileName || undefined, admissionToken };
        room = preferredRoom ? await this.client.joinById<LobbyRoomType>(preferredRoom, options)
          : await this.client.joinOrCreate<LobbyRoomType>(this.roomType, options);
      }
      if (this.disposed || generation !== this.generation) { await room.leave(); return; }
      this.room = room;
      this.saveReconnect(room);
      this.needsSpawn = true;
      this.retries = 0;
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 65;
      room.reconnection.minDelay = 250;
      room.reconnection.maxDelay = 2000;
      room.reconnection.maxEnqueuedMessages = 0;
      room.onMessage<RoomInvitation>('social:invitation', invitation => {
        if (this.room === room) for (const callback of this.invitations) callback(invitation);
      });
      room.onMessage<SocialResult>('social:result', result => {
        if (this.room !== room) return;
        const request = this.socialRequests.get(result.requestId); if (!request) return;
        clearTimeout(request.timer); this.socialRequests.delete(result.requestId);
        if (result.ok) request.resolve(result); else request.reject(new Error(result.message || 'Invitation unavailable.'));
      });
      room.send('social:sync');
      room.onMessage<RoomChatMessage>('chat:message', (message) => {
        if (this.room !== room || message.roomId !== room.roomId) return;
        for (const callback of this.messages) callback(message);
      });
      room.onMessage<string>('chat:error', (message) => { if (this.room === room) for (const callback of this.notices) callback(message); });
      room.onMessage<string>('lobby:notice', message => { if (this.room === room) for (const callback of this.notices) callback(message); });
      room.onMessage<StationSnapshot>('station:state', state => {
        if (this.room !== room || state.roomId !== room.roomId) return;
        this.stationSnapshot = state; for (const callback of this.stationStates) callback(state);
      });
      room.onMessage<StationSound>('station:sound', sound => {
        if (this.room === room && sound.roomId === room.roomId) for (const callback of this.stationSounds) callback(sound);
      });
      room.onMessage<StationClaimResult>('station:claim-result', result => {
        if (this.room !== room || result.roomId !== room.roomId || result.player.playerId !== room.sessionId) return;
        if (result.requestId && result.requestId === this.stationRequestId) {
          this.stationRequestId = undefined;
          for (const callback of this.corrections) callback(result.player);
        }
        for (const callback of this.stationClaims) callback(result);
      });
      room.onMessage<GalleryListenResult>('gallery:result', result => {
        if (this.room !== room || result.roomId !== room.roomId || result.player.playerId !== room.sessionId || !result.requestId) return;
        this.galleryRequests.get(result.requestId)?.finish(result);
      });
      room.onMessage<{ roomId: string; player: NetworkPlayer }>('lobby:correction', result => {
        if (this.room === room && result.roomId === room.roomId && result.player.playerId === room.sessionId)
          for (const callback of this.corrections) callback(result.player);
      });
      if (this.roomType === LOBBY_NAME) room.send('station:command', { type: 'sync' });
      room.onMessage<WeaponEvent>('weapon:event', event => {
        if (this.room !== room || event.roomId !== room.roomId) return;
        for (const callback of this.weapons) callback(event);
      });
      room.onMessage<CombatEvent>('combat:event', event => {
        if (this.room !== room || event.roomId !== room.roomId) return;
        for (const callback of this.combatEvents) callback(event);
      });
      room.onMessage<string>('combat:ping', nonce => { if (this.room === room && room.connection.isOpen) room.send('combat:pong', nonce); });
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
        this.saveReconnect(room);
        this.setStatus('connecting', 0, this.expectedCapacity, room.roomId, 'reconnecting');
        for (const callback of this.notices) callback('Connection interrupted. Your place is reserved for up to two minutes.');
        this.clearRemoteState();
      });
      room.onReconnect(() => {
        if (this.room === room && !this.disposed) { queueMicrotask(() => { if (this.room === room) this.saveReconnect(room); }); this.receive(room, room.state); if (this.roomType === LOBBY_NAME) room.send('station:command', { type: 'sync' }); }
      });
      room.onError(code => {
        if (this.room !== room || this.disposed) return;
        if (this.isExpiredReservation(code)) {
          // The SDK emits an error without leaving when a reconnect handshake
          // is rejected. Retire that room so it cannot block fresh admission.
          this.clearReconnect();
          room.reconnection.enabled = false; room.reconnection.maxRetries = 0;
          this.room = undefined; room.connection.close();
          this.rejectVoiceRequests(); this.clearRemoteState();
          this.setStatus('connecting', 0, this.expectedCapacity, '', 'reconnecting');
          this.scheduleRetry();
        } else this.setStatus('disconnected', 0, this.expectedCapacity, room.roomId, room.reconnection.isReconnecting ? 'reconnecting' : undefined);
      });
      room.onLeave((code) => {
        if (this.room !== room) return;
        const inactive = code === sessionPolicy.idleCloseCode;
        if (inactive) {
          this.clearReconnect();
          this.inactive = true;
          this.retryEnabled = false;
          room.reconnection.enabled = false;
          window.clearTimeout(this.retryTimer); this.retryTimer = 0;
        }
        this.rejectVoiceRequests();
        this.room = undefined;
        this.setStatus('disconnected', 0, this.expectedCapacity, '', inactive ? 'inactive' : undefined);
        this.clearRemoteState();
        this.scheduleRetry();
      });
      // Initial state can arrive before joinOrCreate resolves.
      if (room.state?.players) this.receive(room, room.state);
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.setStatus('disconnected');
        if ((error as { code?: number }).code === socialConfig.nameConflictCode) throw error;
        this.scheduleRetry();
      }
    } finally { this.joining = false; }
  }

  private receive(room: LobbyRoom, state: DecodedLobby): void {
    if (this.room !== room || this.disposed || room.reconnection.isReconnecting || !state?.players) return;
    if (Date.now() - this.lastReservationSave > 5000) this.saveReconnect(room);
    const players: NetworkPlayer[] = [];
    state.players.forEach((player, id) => players.push({
      displayName: player.displayName, automatic: player.automatic, kills: player.kills, deaths: player.deaths, lastDamageAt: player.lastDamageAt,
      playerId: id, x: player.x, y: player.y, z: player.z,
      listening: player.listening,
      yaw: player.yaw, pitch: player.pitch, connected: player.connected,
      lastProcessedInput: player.lastProcessedInput,
      seatIndex: player.seatIndex, crouching: player.crouching, sprinting: player.sprinting, grounded: player.grounded, height: player.height, lean: player.lean,
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
      interactionVersion: state.interactionVersion,
      roomId: room.roomId, localPlayerId: room.sessionId,
      tick: state.tick, receivedAt: performance.now(), players,
      wallTime: state.wallTime, serverTime: state.serverTime, shooterEnabled: state.shooterEnabled,
      match: state.match ? { lighting: 'day', phase: state.match, round: state.round ?? 0, endsAt: state.matchEndsAt ?? 0, nextRoundAt: state.nextRoundAt ?? 0,
        results: Array.from(state.results ?? [], score => ({ playerId: score.playerId, displayName: score.displayName, kills: score.kills, deaths: score.deaths })) } : undefined,
      killFeed: Array.from(state.killFeed ?? [], entry => ({ id: entry.id, attackerId: entry.attackerId, victimId: entry.victimId,
        attackerName: entry.attackerName, victimName: entry.victimName, region: entry.region, timestamp: entry.timestamp })),
    };
    this.latestSnapshot = snapshot;
    for (const callback of this.states) callback(snapshot);
    for (const [requestId, request] of this.galleryRequests) if (local?.listening === request.value)
      request.finish({ roomId: room.roomId, requestId, accepted: true, listening: request.value, player: local });
  }

  private setStatus(state: ConnectionStatus['state'], online = 0, capacity = this.expectedCapacity, roomId = '', reason?: ConnectionStatus['reason'], queuePosition?: number): void {
    if (this.disposed || (this.currentStatus.state === state && this.currentStatus.online === online && this.currentStatus.roomId === roomId && this.currentStatus.reason === reason && this.currentStatus.queuePosition === queuePosition)) return;
    this.currentStatus = { state, online, capacity, roomId, reason, queuePosition };
    for (const callback of this.statuses) callback(this.currentStatus);
  }

  private clearRemoteState(): void {
    for (const request of this.galleryRequests.values()) request.reject(new Error('Multiplayer disconnected.'));
    this.galleryRequests.clear();
    this.stationRequestId = undefined;
    this.stationSnapshot = null; for (const callback of this.stationStates) callback(null);
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
      void this.connect().catch(error => { for (const callback of this.notices) callback(error instanceof Error ? error.message : 'Connection unavailable.'); });
    }, delay);
  }

  sendInput(input: MovementInput): void {
    if (this.roomType === LOBBY_NAME && this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('input', input);
  }
  sendActivity(): void {
    if (this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('session:activity', null);
  }
  requestSeat(seat: number): void {
    if (this.roomType === LOBBY_NAME && this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('lobby:seat', { seat });
  }
  sendShooterInput(input: ShooterInput): void {
    if (this.roomType === SHOOTER_ROOM && this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('shooter:input', input);
  }
  sendStation(command: StationCommand): void {
    if (this.roomType === LOBBY_NAME && this.currentStatus.state === 'connected' && this.room?.connection.isOpen) {
      if (command.type === 'claim') this.stationRequestId = command.requestId;
      else if (command.type === 'release') this.stationRequestId = undefined;
      this.room.send('station:command', command);
    }
  }
  sendGalleryListening(listening: boolean): Promise<boolean> {
    const room = this.room;
    if (this.roomType !== LOBBY_NAME || this.currentStatus.state !== 'connected' || !room?.connection.isOpen)
      return Promise.reject(new Error('Multiplayer is reconnecting.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = () => { window.clearTimeout(timeout); window.clearInterval(retry); this.galleryRequests.delete(requestId); };
      const send = () => { if (this.room === room && room.connection.isOpen) room.send('gallery:listen', { listening, requestId }); };
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error('The headphones did not respond. Please try again.')); }, 4500);
      const retry = window.setInterval(send, 900);
      this.galleryRequests.set(requestId, { value: listening, finish: result => {
        cleanup();
        if (result.accepted) resolve(result.listening);
        else { for (const callback of this.corrections) callback(result.player); reject(new Error(result.message || 'The headphones are unavailable.')); }
      }, reject: error => { cleanup(); reject(error); } });
      send();
    });
  }
  subscribeToStation(callback: (state: StationSnapshot | null) => void): () => void { this.stationStates.add(callback); callback(this.stationSnapshot); return () => this.stationStates.delete(callback); }
  subscribeToStationSound(callback: (sound: StationSound) => void): () => void { this.stationSounds.add(callback); return () => this.stationSounds.delete(callback); }
  subscribeToCorrection(callback: (player: NetworkPlayer) => void): () => void { this.corrections.add(callback); return () => this.corrections.delete(callback); }
  subscribeToStationClaim(callback: (result: StationClaimResult) => void): () => void { this.stationClaims.add(callback); return () => this.stationClaims.delete(callback); }
  sendWeaponAction(action: WeaponAction): void {
    if (this.roomType === SHOOTER_ROOM && this.currentStatus.state === 'connected' && this.room?.connection.isOpen) this.room.send('weapon:action', action);
  }
  subscribeToWeapons(callback: (event: WeaponEvent) => void): () => void { this.weapons.add(callback); return () => this.weapons.delete(callback); }
  subscribeToCombat(callback: (event: CombatEvent) => void): () => void { this.combatEvents.add(callback); return () => this.combatEvents.delete(callback); }
  async ping(): Promise<number> {
    const room = this.room; if (!room?.connection.isOpen) return 0;
    return new Promise(resolve => {
      const timer = window.setTimeout(() => resolve(0), 2000);
      room.ping(ms => { window.clearTimeout(timer); resolve(ms); });
    });
  }
  async leaveRoom(): Promise<void> {
    this.admission.stop(); this.clearReconnect();
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
    if (this.inactive) throw new Error('Session expired after inactivity. Please rejoin.');
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

  subscribeToInvitation(callback: (invitation: RoomInvitation) => void): () => void { this.invitations.add(callback); return () => this.invitations.delete(callback); }
  declineInvitation(id: string): void { if (this.room?.connection.isOpen) this.room.send('social:decline', id); }
  setBlockedVisitors(ids: string[]): void { if (this.room?.connection.isOpen) this.room.send('social:blocks', ids.slice(0, 100)); }
  async holdInvitation(id: string): Promise<void> { await this.requestInvitation('social:hold', id); }
  private requestInvitation(type: 'social:hold' | 'social:accept', id: string): Promise<SocialResult> {
    const room = this.room;
    if (!room?.connection.isOpen || this.status.state !== 'connected' || this.inactive) return Promise.reject(new Error('Reconnect before accepting an invitation.'));
    const requestId = crypto.randomUUID();
    return new Promise<SocialResult>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.socialRequests.delete(requestId); reject(new Error('The room did not respond. You have not left your current room.')); }, 12000);
      this.socialRequests.set(requestId, { resolve, reject, timer }); room.send(type, { requestId, id });
    });
  }
  async acceptInvitation(id: string): Promise<void> {
    const room = this.room;
    const result = await this.requestInvitation('social:accept', id);
    const seat = result.reservation as SeatReservation | undefined;
    if (!seat || ![LOBBY_NAME, 'SDPLobby', SHOOTER_ROOM].includes(seat.name) || typeof seat.roomId !== 'string' || typeof seat.sessionId !== 'string') throw new Error('Invalid room reservation.');
    if (this.room !== room || this.disposed) throw new Error('Your session changed. Please request a new invitation.');
    await this.leaveRoom(); this.roomType = seat.name === 'SDPLobby' ? LOBBY_NAME : seat.name; this.preparedSeat = seat;
    await this.connect();
    const deadline = performance.now() + 20000;
    while (this.status.state !== 'connected') {
      if (!this.room || this.disposed || performance.now() > deadline) { this.retryEnabled = true; this.scheduleRetry(); throw new Error('The reserved room could not be joined. Reconnecting.'); }
      await new Promise(resolve => setTimeout(resolve, 25));
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
    for (const request of this.socialRequests.values()) { clearTimeout(request.timer); request.reject(new Error('Connection interrupted. Please try the invitation again.')); }
    this.socialRequests.clear();
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

  disconnect(preservePlace = false): void {
    if (this.disposed) return;
    this.admission.stop();
    if (preservePlace && this.room?.connection.isOpen) this.saveReconnect(this.room);
    else if (!preservePlace) this.clearReconnect();
    this.setStatus('disconnected');
    this.clearRemoteState();
    this.disposed = true;
    this.rejectVoiceRequests();
    window.clearTimeout(this.retryTimer);
    const room = this.room;
    this.room = undefined;
    if (room) {
      room.reconnection.enabled = false;
      if (preservePlace) room.connection.close(4010, 'Page suspended');
      else void room.leave().catch(() => {});
    }
    this.states.clear(); this.statuses.clear(); this.spawns.clear();
    this.messages.clear(); this.notices.clear();
    this.weapons.clear();
    this.combatEvents.clear();
    this.invitations.clear();
    this.corrections.clear(); this.stationClaims.clear();
  }

  private saveReconnect(room: LobbyRoom): void {
    this.lastReservationSave = Date.now();
    try { sessionStorage.setItem('sdp:reconnect', JSON.stringify({ token: room.reconnectionToken, type: this.roomType, expires: Date.now() + admissionConfig.reservationSeconds * 1000 })); } catch {}
  }
  private savedReconnect(): { token: string; type: string } | undefined {
    try {
      const saved = JSON.parse(sessionStorage.getItem('sdp:reconnect') || 'null');
      if ((saved?.type === LOBBY_NAME || saved?.type === SHOOTER_ROOM) && typeof saved.token === 'string' &&
        /^[^:\s]+:[^:\s]+$/.test(saved.token) && Number.isFinite(saved.expires) && saved.expires > Date.now()) return saved;
    } catch {}
    this.clearReconnect(); return;
  }
  private isExpiredReservation(code: number | undefined): boolean {
    return code === ErrorCode.MATCHMAKE_INVALID_ROOM_ID || code === ErrorCode.MATCHMAKE_EXPIRED;
  }
  private clearReconnect(): void { try { sessionStorage.removeItem('sdp:reconnect'); } catch {} }
}
