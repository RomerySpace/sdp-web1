import { sharedAudioContext } from './AudioContextHub';
import { rampGain } from './GainEnvelope';
import { Vector3, type Camera } from 'three';
import { lobbyAmbience } from '../core/LobbyAmbience';
import { musicPosition, validMusicTracks, type MusicTrack } from '../../shared/MusicTimeline';
import type { LobbySnapshot } from '../../shared/MultiplayerProtocol';
const MUTE_KEY = 'sdp:muted';

/** Stream only the current track. One player persists across room transitions. */
export class AudioManager {
  private readonly media = new Audio();
  private readonly abort = new AbortController();
  private context?: AudioContext;
  private gain?: GainNode;
  private source?: MediaElementAudioSourceNode;
  private panner?: PannerNode;
  private ambience?: GainNode;
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private environmentGain = 0;
  private tracks: MusicTrack[] = [];
  private current = '';
  private started = false;
  private volume = .5;
  private serverAnchor?: { time: number; received: number };
  private readonly label = document.createElement('aside');
  private readonly title = document.createElement('span');
  private readonly artist = document.createElement('span');
  private readonly timer: number;
  muted = false;
  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch {}
    this.media.crossOrigin = 'anonymous'; this.media.preload = 'metadata';
    this.label.className = 'now-playing'; this.label.hidden = true; this.label.setAttribute('aria-label', 'Now playing');
    this.title.className = 'music-title'; this.artist.className = 'music-artist'; this.label.append(this.title, this.artist);
    const signal = this.abort.signal;
    this.media.addEventListener('loadedmetadata', () => this.sync(), { signal });
    this.media.addEventListener('playing', () => { this.label.hidden = false; }, { signal });
    for (const event of ['error', 'waiting', 'pause']) this.media.addEventListener(event, () => { this.label.hidden = true; }, { signal });
    document.addEventListener('pointerdown', () => { if (this.started && this.media.paused) { void this.context?.resume(); this.sync(); } }, { signal });
    void fetch('/audio/playlist.json', { signal }).then(r => r.ok ? r.json() : []).then(raw => {
      this.tracks = validMusicTracks(raw); this.sync();
    }).catch(() => {});
    this.timer = window.setInterval(() => this.sync(), 1000);
  }
  attach(container: HTMLElement): void { container.append(this.label); }
  receive(snapshot: LobbySnapshot): void {
    if (snapshot.wallTime) this.serverAnchor = { time: snapshot.wallTime, received: snapshot.receivedAt };
  }
  enter(): void {
    if (!this.started) {
      this.started = true; this.context = sharedAudioContext();
      this.source = this.context.createMediaElementSource(this.media); this.gain = this.context.createGain();
      this.panner = this.context.createPanner();
      this.panner.panningModel = 'HRTF'; this.panner.rolloffFactor = 0;
      this.panner.positionY.value = lobbyAmbience.music.height;
      this.ambience = this.context.createGain(); this.ambience.gain.value = this.environmentGain;
      this.source.connect(this.gain); this.gain.connect(this.panner);
      this.panner.connect(this.ambience); this.ambience.connect(this.context.destination); this.updateGain();
    }
    void this.context?.resume().catch(() => {}); this.sync();
  }
  private sync(): void {
    if (!this.started || document.hidden) return;
    const now = this.serverAnchor ? this.serverAnchor.time + performance.now() - this.serverAnchor.received : Date.now();
    const position = musicPosition(this.tracks, now);
    if (!position) return;
    const { track, offset } = position;
    if (this.current !== track.id) {
      this.current = track.id; this.label.hidden = true;
      this.title.textContent = track.title; this.artist.textContent = track.artist;
      this.media.src = track.url; this.media.load();
    }
    if (this.media.readyState >= 1 && Number.isFinite(this.media.duration) && Math.abs(this.media.currentTime - offset) > .6) {
      this.media.currentTime = Math.min(offset, Math.max(0, this.media.duration - .05));
    }
    if (this.media.paused && !this.media.error) void this.media.play().catch(() => { this.label.hidden = true; });
  }
  toggleMute(): boolean { this.setMuted(!this.muted); try { localStorage.setItem(MUTE_KEY, String(this.muted)); } catch {} return this.muted; }
  setMuted(muted: boolean): void { this.muted = muted; this.updateGain(); }
  setVolume(volume: number): void { this.volume = Math.max(0, Math.min(1, volume)); this.updateGain(); }
  updateEnvironment(camera: Camera, active: boolean, reveal: number): void {
    this.label.hidden = !active || this.media.paused || this.media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    const settings = lobbyAmbience.music;
    const distance = Math.hypot(camera.position.x, camera.position.z);
    const t = Math.max(0, Math.min(1, (distance - settings.fullRadius) / (settings.fadeRadius - settings.fullRadius)));
    this.environmentGain = active ? reveal * (1 - (1 - settings.distantGain) * t * t * (3 - 2 * t)) : 0;
    const context = this.context;
    if (!context || !this.ambience) return;
    this.ambience.gain.setTargetAtTime(this.environmentGain, context.currentTime, settings.smoothing);
    if (!active) return;
    this.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const listener = context.listener;
    if (listener.positionX) {
      for (const [parameter, value] of [
        [listener.positionX, camera.position.x], [listener.positionY, camera.position.y], [listener.positionZ, camera.position.z],
        [listener.forwardX, this.forward.x], [listener.forwardY, this.forward.y], [listener.forwardZ, this.forward.z],
        [listener.upX, this.up.x], [listener.upY, this.up.y], [listener.upZ, this.up.z],
      ] as const) parameter.setTargetAtTime(value, context.currentTime, .06);
    } else {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
      listener.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
    }
  }
  private updateGain(): void { if (this.gain && this.context) rampGain(this.gain.gain, this.muted ? 0 : this.volume * .6, this.context.currentTime, .1); }
  setVisible(visible: boolean): void { if (!visible) this.media.pause(); else { void this.context?.resume().catch(() => {}); this.sync(); } }
  dispose(): void { this.abort.abort(); window.clearInterval(this.timer); this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.source?.disconnect(); this.panner?.disconnect(); this.ambience?.disconnect(); this.gain?.disconnect(); this.label.remove(); }
}
