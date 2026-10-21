import { MeshBasicMaterial, SRGBColorSpace, VideoTexture } from 'three';
import { createElement, Headphones, Volume2 } from 'lucide';
import { lowerGallery } from '../../shared/LowerGallery';
import { sharedAudioContext } from '../audio/AudioContextHub';

/** The film is streamed only on descent. It reuses the lobby's audio context. */
export class GalleryFilm {
  readonly video = document.createElement('video');
  readonly texture: VideoTexture;
  readonly material: MeshBasicMaterial;
  readonly soundButton = document.createElement('button');
  readonly listenButton = document.createElement('button');
  listening = false;
  private requestListening?: (listening: boolean) => void;
  private pending?: { value: boolean; at: number };
  private readonly events = new AbortController();
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private gain?: GainNode;
  private analyser?: AnalyserNode;
  private playingRequest = false;
  private needsGesture = false;
  private seekOnResume = true;
  private requested = false;
  private disposed = false;
  private enabled = false;
  private volume = 0;
  private anchor?: { time: number; received: number };
  private now = Date.now();
  constructor(onAspect: (aspect: number) => void) {
    this.video.preload = 'none'; this.video.crossOrigin = 'anonymous'; this.video.loop = true;
    this.video.playsInline = true; this.video.muted = true; this.video.preservesPitch = true; this.video.playbackRate = 1;
    this.texture = new VideoTexture(this.video); this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false });
    this.soundButton.type = 'button'; this.soundButton.className = 'gallery-film-audio'; this.soundButton.hidden = true;
    this.soundButton.setAttribute('aria-label', 'Enable film audio'); this.soundButton.title = 'Enable film audio'; this.soundButton.append(createElement(Volume2));
    this.listenButton.type = 'button'; this.listenButton.className = 'gallery-listen'; this.listenButton.hidden = true;
    this.listenButton.append(createElement(Headphones));
    const key = document.createElement('kbd'); key.textContent = 'E'; this.listenButton.append(key, document.createElement('span'));
    const signal = this.events.signal;
    this.soundButton.addEventListener('click', () => { this.unlock(); this.needsGesture = false; this.video.muted = false; if (this.video.error) this.video.load(); this.play(); }, { signal });
    this.listenButton.addEventListener('click', () => this.toggleListening(), { signal });
    for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => this.unlock(), { signal, capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); }, { signal });
    this.video.addEventListener('loadedmetadata', () => {
      if (this.video.videoWidth && this.video.videoHeight) onAspect(this.video.videoWidth / this.video.videoHeight);
      this.seek();
    }, { signal });
    this.video.addEventListener('error', () => { this.needsGesture = true; this.soundButton.title = 'Retry film playback'; }, { signal });
  }
  attach(container: HTMLElement, request: (listening: boolean) => void): void { this.requestListening = request; container.append(this.soundButton, this.listenButton); }
  toggleListening(): void {
    if (this.pending || this.listenButton.hidden) return;
    const value = !this.listening;
    if (value) { this.unlock(); this.needsGesture = false; this.video.muted = false; this.play(); }
    else this.setListening(false);
    this.pending = { value, at: performance.now() }; this.requestListening?.(value);
  }
  setListening(listening: boolean): void {
    this.listening = listening;
    if (this.pending?.value === listening) this.pending = undefined;
  }
  interaction(active: boolean, focused: boolean, anotherInteraction: boolean): void {
    if (this.pending && performance.now() - this.pending.at > 3000) this.pending = undefined;
    this.listenButton.hidden = !active || (!focused && (!this.listening || anotherInteraction));
    this.listenButton.disabled = !!this.pending;
    this.listenButton.classList.toggle('is-listening', this.listening);
    this.listenButton.querySelector('span')!.textContent = this.pending ? 'CONNECTING...' : this.listening ? 'RETURN HEADPHONES' : 'LISTEN · KENOSIS';
    this.listenButton.setAttribute('aria-label', this.listening ? 'Return gallery headphones' : 'Listen to Kenosis');
    this.listenButton.setAttribute('aria-pressed', String(this.listening));
  }
  receive(time: number | undefined, received: number): void { if (time) this.anchor = { time, received }; }
  private unlock(): void {
    if (!this.context) {
      this.context = sharedAudioContext(); this.source = this.context.createMediaElementSource(this.video);
      this.gain = this.context.createGain(); this.gain.gain.value = 0;
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256;
      this.source.connect(this.gain); this.gain.connect(this.analyser); this.analyser.connect(this.context.destination);
    }
    void this.context.resume().catch(() => {});
  }
  private seek(): void {
    if (!this.seekOnResume || this.video.readyState < 1 || !Number.isFinite(this.video.duration) || this.video.duration <= 0) return;
    const target = (this.now / 1000) % this.video.duration;
    if (Math.abs(this.video.currentTime - target) > .5) this.video.currentTime = target;
    this.seekOnResume = false;
  }
  private play(): void {
    if (this.disposed || !this.enabled || this.playingRequest || !this.video.paused || this.needsGesture) return;
    this.seek(); this.playingRequest = true;
    void this.video.play().catch(async () => {
      if (!this.enabled || document.hidden || this.disposed) return;
      this.video.muted = true; this.needsGesture = true;
      await this.video.play().catch(() => {});
    }).finally(() => { this.playingRequest = false; if (!this.enabled || document.hidden || this.disposed) this.video.pause(); });
  }
  update(active: boolean, volume: number): void {
    this.enabled = active && !document.hidden; this.volume = Math.max(0, Math.min(1, volume));
    this.now = this.anchor ? this.anchor.time + performance.now() - this.anchor.received : Date.now();
    if (this.enabled && !this.requested) {
      this.requested = true; this.video.src = lowerGallery.film.url; this.video.load();
    }
    if (this.enabled) this.play(); else this.stop();
    if (this.context && this.gain) this.gain.gain.setTargetAtTime(this.enabled && this.listening ? this.volume * .65 : 0, this.context.currentTime, .16);
    this.soundButton.hidden = !this.enabled || !this.listening || (!this.needsGesture && !this.video.muted);
  }
  private stop(): void { if (!this.video.paused) this.video.pause(); this.seekOnResume = true; }
  get diagnostics() {
    let level = 0;
    if (this.analyser) { const samples = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(samples); level = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length); }
    return { listening: this.listening, requested: this.requested, ready: this.video.readyState, playing: !this.video.paused, time: this.video.currentTime,
      duration: this.video.duration, width: this.video.videoWidth, height: this.video.videoHeight, frames: this.video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0, muted: this.video.muted, level, error: this.video.error?.message };
  }
  dispose(): void {
    this.disposed = true; this.enabled = false;
    this.events.abort(); this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    this.source?.disconnect(); this.gain?.disconnect(); this.analyser?.disconnect();
    this.material.dispose(); this.texture.dispose(); this.soundButton.remove(); this.listenButton.remove();
  }
}
