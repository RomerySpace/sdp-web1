import { MeshBasicMaterial, SRGBColorSpace, VideoTexture } from 'three';
import { createElement, Volume2 } from 'lucide';
import { lowerGallery } from '../../shared/LowerGallery';
import { sharedAudioContext } from '../audio/AudioContextHub';

/** The film is streamed only on descent. It reuses the lobby's audio context. */
export class GalleryFilm {
  readonly video = document.createElement('video');
  readonly texture: VideoTexture;
  readonly material: MeshBasicMaterial;
  readonly soundButton = document.createElement('button');
  private readonly events = new AbortController();
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private gain?: GainNode;
  private analyser?: AnalyserNode;
  private panner?: PannerNode;
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
    this.video.playsInline = true; this.video.preservesPitch = true; this.video.playbackRate = 1;
    this.texture = new VideoTexture(this.video); this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false });
    this.soundButton.type = 'button'; this.soundButton.className = 'gallery-film-audio'; this.soundButton.hidden = true;
    this.soundButton.setAttribute('aria-label', 'Enable film audio'); this.soundButton.title = 'Enable film audio'; this.soundButton.append(createElement(Volume2));
    const signal = this.events.signal;
    this.soundButton.addEventListener('click', () => { this.unlock(); this.needsGesture = false; this.video.muted = false; if (this.video.error) this.video.load(); this.play(); }, { signal });
    for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => this.unlock(), { signal, capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); }, { signal });
    this.video.addEventListener('loadedmetadata', () => {
      if (this.video.videoWidth && this.video.videoHeight) onAspect(this.video.videoWidth / this.video.videoHeight);
      this.seek();
    }, { signal });
    this.video.addEventListener('error', () => { this.needsGesture = true; this.soundButton.title = 'Retry film playback'; }, { signal });
  }
  attach(container: HTMLElement): void { container.append(this.soundButton); }
  receive(time: number | undefined, received: number): void { if (time) this.anchor = { time, received }; }
  private unlock(): void {
    if (!this.context) {
      this.context = sharedAudioContext(); this.source = this.context.createMediaElementSource(this.video);
      this.gain = this.context.createGain(); this.gain.gain.value = 0;
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256;
      this.panner = this.context.createPanner(); this.panner.panningModel = 'HRTF'; this.panner.rolloffFactor = 0;
      this.panner.positionX.value = lowerGallery.film.x; this.panner.positionY.value = lowerGallery.film.y; this.panner.positionZ.value = lowerGallery.film.z;
      this.source.connect(this.gain); this.gain.connect(this.analyser); this.analyser.connect(this.panner); this.panner.connect(this.context.destination);
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
    if (this.context && this.gain) this.gain.gain.setTargetAtTime(this.enabled ? this.volume * .65 : 0, this.context.currentTime, .16);
    this.soundButton.hidden = !this.enabled || (!this.needsGesture && !this.video.muted);
  }
  private stop(): void { if (!this.video.paused) this.video.pause(); this.seekOnResume = true; }
  get diagnostics() {
    let level = 0;
    if (this.analyser) { const samples = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(samples); level = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length); }
    return { requested: this.requested, ready: this.video.readyState, playing: !this.video.paused, time: this.video.currentTime,
      duration: this.video.duration, width: this.video.videoWidth, height: this.video.videoHeight, frames: this.video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0, muted: this.video.muted, level, error: this.video.error?.message };
  }
  dispose(): void {
    this.disposed = true; this.enabled = false;
    this.events.abort(); this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    this.source?.disconnect(); this.gain?.disconnect(); this.analyser?.disconnect(); this.panner?.disconnect();
    this.material.dispose(); this.texture.dispose(); this.soundButton.remove();
  }
}
