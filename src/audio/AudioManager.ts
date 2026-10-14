import { sharedAudioContext } from './AudioContextHub';
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
      this.source.connect(this.gain); this.gain.connect(this.context.destination); this.updateGain();
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
  private updateGain(): void { if (this.gain && this.context) this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume * .6, this.context.currentTime, .1); }
  setVisible(visible: boolean): void { if (!visible) this.media.pause(); else { void this.context?.resume().catch(() => {}); this.sync(); } }
  dispose(): void { this.abort.abort(); window.clearInterval(this.timer); this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.source?.disconnect(); this.gain?.disconnect(); this.label.remove(); }
}
