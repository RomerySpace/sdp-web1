import { LocalAudioTrack, RemoteAudioTrack, Room, RoomEvent, Track } from 'livekit-client';
import { Vector3, type Camera } from 'three';
import type { MultiplayerConnection } from '../network/MultiplayerConnection';
import type { LobbySnapshot } from '../../shared/MultiplayerProtocol';
import type { SpatialVoiceTransport } from './VoiceChatManager';
import { proximityGain, voiceSettings } from './SpatialVoiceSettings';
import { sharedAudioContext } from './AudioContextHub';
import { lobbyAmbience } from '../core/LobbyAmbience';

export type VoiceConnectionState = 'disconnected' | 'connecting' | 'connected' | 'unavailable';
interface RemoteVoice { track: RemoteAudioTrack; element: HTMLMediaElement; panner: PannerNode; gain: GainNode; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer> }

export class LiveKitVoiceTransport implements SpatialVoiceTransport {
  readonly voiceLevels = new Map<string, number>();
  private context?: AudioContext;
  private room?: Room;
  private roomId = '';
  private attempt?: Promise<void>;
  private retryTimer = 0;
  private generation = 0;
  private publicationGeneration = 0;
  private local?: LocalAudioTrack;
  private speaking = false;
  private disposed = false;
  private enabled = true;
  private snapshot?: LobbySnapshot;
  private readonly remotes = new Map<string, RemoteVoice>();
  private readonly listeners = new Set<(state: VoiceConnectionState) => void>();
  private currentState: VoiceConnectionState = 'disconnected';
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly unsubscribers: (() => void)[];

  constructor(private readonly network: MultiplayerConnection, private readonly onInterrupted: () => void) {
    try { this.context = sharedAudioContext(); } catch { this.currentState = 'unavailable'; }
    this.unsubscribers = [
      network.subscribeToStatus((status) => {
        if (!this.enabled) return;
        if (status.state !== 'connected') { this.onInterrupted(); this.leave(); return; }
        if (this.roomId && this.roomId !== status.roomId) { this.onInterrupted(); this.leave(); }
        void this.connect();
      }),
      network.subscribeToState((snapshot) => {
        this.snapshot = snapshot;
        for (const [identity] of this.remotes) {
          if (!snapshot.players.some((player) => player.playerId === identity && player.connected)) this.removeRemote(identity);
        }
      }),
    ];
  }

  get state(): VoiceConnectionState { return this.currentState; }
  get remoteCount(): number { return this.remotes.size; }
  get transmitting(): boolean { return !!this.local && this.speaking && this.local.mediaStreamTrack.enabled && this.local.mediaStreamTrack.readyState === 'live'; }

  async diagnostics() {
    return {
      state: this.state, room: this.room?.name, identity: this.room?.localParticipant.identity,
      audioContext: this.context?.state, transmitting: this.transmitting,
      localPublications: this.room?.localParticipant.audioTrackPublications.size || 0,
      remote: await Promise.all([...this.remotes].map(async ([identity, remote]) => ({
        identity, gain: remote.gain.gain.value,
        position: { x: remote.panner.positionX.value, y: remote.panner.positionY.value, z: remote.panner.positionZ.value },
        stats: await remote.track.getReceiverStats(),
      }))),
    };
  }

  unlock(): void {
    if (!this.enabled) return;
    void this.context?.resume().catch(() => {});
    void this.room?.startAudio().catch(() => {});
    if (this.network.status.state === 'connected' && this.currentState !== 'connected') void this.connect();
  }

  private connect(): Promise<void> {
    if (this.disposed || !this.enabled || !this.context || this.network.status.state !== 'connected') return Promise.resolve();
    if (this.attempt) return this.attempt;
    if (this.room && this.roomId === this.network.status.roomId) return Promise.resolve();
    window.clearTimeout(this.retryTimer); this.retryTimer = 0;
    const generation = ++this.generation;
    this.setState('connecting');
    this.attempt = this.join(generation).finally(() => { if (generation === this.generation) this.attempt = undefined; });
    return this.attempt;
  }

  private async join(generation: number): Promise<void> {
    let room: Room | undefined;
    try {
      const access = await this.network.requestVoiceAccess();
      if (this.disposed || generation !== this.generation) return;
      const endpoint = new URL(access.url!, location.origin);
      if (location.protocol === 'https:' && ['ws:', 'http:'].includes(endpoint.protocol)) throw new Error('Voice requires a secure WSS URL.');
      endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : endpoint.protocol === 'http:' ? 'ws:' : endpoint.protocol;
      room = new Room({ webAudioMix: { audioContext: this.context! }, disconnectOnPageLeave: true });
      const joinedRoom = room;
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (this.room !== joinedRoom || !(track instanceof RemoteAudioTrack) || participant.identity === access.identity) return;
        this.addRemote(participant.identity, track);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (this.room === joinedRoom && this.remotes.get(participant.identity)?.track === track) this.removeRemote(participant.identity);
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (this.room === joinedRoom) this.removeRemote(participant.identity);
      });
      room.on(RoomEvent.Reconnecting, () => { if (this.room === joinedRoom) { this.onInterrupted(); this.setState('connecting'); } });
      room.on(RoomEvent.Reconnected, () => { if (this.room === joinedRoom) this.setState('connected'); });
      room.on(RoomEvent.Disconnected, () => {
        if (this.room !== joinedRoom || this.disposed) return;
        this.onInterrupted(); this.leave(); this.retry();
      });
      this.room = room;
      this.roomId = this.network.status.roomId;
      await room.connect(endpoint.toString(), access.token!, { autoSubscribe: true });
      if (this.disposed || generation !== this.generation) { await room.disconnect(); return; }
      this.setState('connected');
    } catch (error) {
      if (room) { if (this.room === room) this.room = undefined; void room.disconnect(); }
      if (this.disposed || generation !== this.generation) return;
      this.roomId = '';
      this.setState('unavailable');
      console.warn('[SDP] Voice connection unavailable:', error instanceof Error ? error.message : 'Unknown error');
      this.retry();
    }
  }

  private retry(): void {
    if (this.disposed || !this.enabled || this.retryTimer || this.network.status.state !== 'connected') return;
    this.retryTimer = window.setTimeout(() => { this.retryTimer = 0; void this.connect(); }, 5000);
  }

  async setLocalStream(stream: MediaStream | null): Promise<void> {
    const generation = ++this.publicationGeneration;
    const previous = this.local;
    this.local = undefined;
    if (previous) {
      previous.mediaStreamTrack.enabled = false;
      previous.stop();
      void this.room?.localParticipant.unpublishTrack(previous).catch(() => {});
    }
    if (!stream) return;
    const media = stream.getAudioTracks()[0];
    if (!media) throw new Error('No microphone track.');
    media.enabled = false;
    await this.connect();
    const room = this.room;
    if (generation !== this.publicationGeneration || media.readyState !== 'live') return;
    if (!room || this.state !== 'connected') throw new Error('Voice is disconnected.');
    const local = new LocalAudioTrack(media, undefined, true, this.context);
    this.local = local;
    await local.mute();
    try {
      await room.localParticipant.publishTrack(local, { source: Track.Source.Microphone, dtx: true, red: false });
      if (generation !== this.publicationGeneration || this.room !== room || media.readyState !== 'live') {
        media.enabled = false; local.stop(); await room.localParticipant.unpublishTrack(local);
      }
    } catch (error) {
      local.stop(); if (this.local === local) this.local = undefined;
      throw error;
    }
  }

  setSpeaking(active: boolean): void {
    this.speaking = active;
    const local = this.local;
    if (!local) return;
    if (!active) { local.mediaStreamTrack.enabled = false; void local.mute().catch(() => {}); }
    else {
      void local.unmute().then(() => {
        if (!this.speaking || this.local !== local) local.mediaStreamTrack.enabled = false;
      }).catch(() => { local.mediaStreamTrack.enabled = false; this.onInterrupted(); });
    }
  }

  private addRemote(identity: string, track: RemoteAudioTrack): void {
    if (!this.context || identity === this.snapshot?.localPlayerId) return;
    this.removeRemote(identity);
    const panner = this.context.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'linear'; panner.rolloffFactor = 0;
    panner.refDistance = voiceSettings.fullDistance; panner.maxDistance = voiceSettings.maxDistance;
    const gain = this.context.createGain(); gain.gain.value = 0;
    const analyser = this.context.createAnalyser(); analyser.fftSize = 512;
    track.setAudioContext(this.context);
    track.setWebAudioPlugins([analyser, panner, gain]);
    const element = track.attach();
    element.hidden = true;
    element.dataset.voiceParticipant = identity;
    document.body.append(element);
    this.remotes.set(identity, { track, element, panner, gain, analyser, samples: new Float32Array(analyser.fftSize) });
  }

  private removeRemote(identity: string): void {
    const remote = this.remotes.get(identity);
    if (!remote) return;
    remote.gain.gain.value = 0;
    remote.track.detach(remote.element);
    remote.panner.disconnect(); remote.gain.disconnect(); remote.analyser.disconnect(); remote.element.remove();
    this.voiceLevels.delete(identity);
    this.remotes.delete(identity);
  }

  update(camera: Camera): void {
    const context = this.context;
    if (!context || !this.snapshot) return;
    const now = context.currentTime;
    const listener = context.listener;
    this.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (listener.positionX) {
      for (const [parameter, value] of [
        [listener.positionX, camera.position.x], [listener.positionY, camera.position.y], [listener.positionZ, camera.position.z],
        [listener.forwardX, this.forward.x], [listener.forwardY, this.forward.y], [listener.forwardZ, this.forward.z],
        [listener.upX, this.up.x], [listener.upY, this.up.y], [listener.upZ, this.up.z],
      ] as const) parameter.setTargetAtTime(value, now, voiceSettings.smoothing);
    } else {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
      listener.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
    }
    for (const [identity, remote] of this.remotes) {
      remote.analyser.getFloatTimeDomainData(remote.samples);
      let energy = 0;
      for (const sample of remote.samples) energy += sample * sample;
      const level = Math.sqrt(energy / remote.samples.length);
      this.voiceLevels.set(identity, remote.track.isMuted ? 0 : Math.max(0, Math.min(1,
        (level - lobbyAmbience.voice.noiseFloor) / (lobbyAmbience.voice.fullLevel - lobbyAmbience.voice.noiseFloor))));
      const player = this.snapshot.players.find((player) => player.playerId === identity && player.connected);
      if (!player) { remote.gain.gain.value = 0; continue; }
      remote.panner.positionX.setTargetAtTime(player.x, now, voiceSettings.smoothing);
      remote.panner.positionY.setTargetAtTime(player.y, now, voiceSettings.smoothing);
      remote.panner.positionZ.setTargetAtTime(player.z, now, voiceSettings.smoothing);
      const distance = Math.hypot(player.x - camera.position.x, player.y - camera.position.y, player.z - camera.position.z);
      remote.gain.gain.setTargetAtTime(proximityGain(distance), now, voiceSettings.smoothing);
    }
  }

  subscribe(listener: (state: VoiceConnectionState) => void): () => void {
    this.listeners.add(listener); listener(this.currentState); return () => this.listeners.delete(listener);
  }

  private setState(state: VoiceConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state; for (const callback of this.listeners) callback(state);
  }

  private leave(): void {
    ++this.generation; this.attempt = undefined;
    this.setSpeaking(false); void this.setLocalStream(null);
    window.clearTimeout(this.retryTimer); this.retryTimer = 0;
    for (const identity of [...this.remotes.keys()]) this.removeRemote(identity);
    const room = this.room; this.room = undefined; this.roomId = '';
    if (room) void room.disconnect();
    this.setState('disconnected');
  }

  dispose(): void {
    this.disposed = true; this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.leave(); this.listeners.clear();
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) { this.onInterrupted(); this.leave(); }
    else if (this.network.status.state === 'connected') void this.connect();
  }
}
