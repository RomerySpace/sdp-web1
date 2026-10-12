const MUTE_KEY = 'sdp:muted';
import { sharedAudioContext } from './AudioContextHub';

export class AudioManager {
  private context?: AudioContext;
  private gain?: GainNode;
  private source?: AudioBufferSourceNode;
  private readonly abort = new AbortController();
  private started = false;
  private disposed = false;
  private volume = 0.5;
  private active = true;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch { /* Private/storage-restricted browsing. */ }
  }

  /** Create/resume the context immediately inside the entry gesture. */
  enter(): void {
    if (this.started) return;
    this.started = true;
    if (!__HAS_AMBIENT_AUDIO__) {
      console.warn('[SDP] Optional /audio/ambient.mp3 is absent. Ambience is disabled. Add the file and restart Vite.');
      return;
    }
    try {
      this.context = sharedAudioContext();
      void this.context.resume().catch(() => {});
      void this.load();
    } catch (error) { console.warn('[SDP] Web Audio is unavailable; continuing silently.', error); }
  }

  private async load(): Promise<void> {
    const context = this.context!;
    try {
      const response = await fetch('/audio/ambient.mp3', { signal: this.abort.signal });
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Ambient asset is missing');
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (this.disposed) return;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.45;
      this.gain = context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(context.destination);
      filter.connect(this.gain);

      const reverb = context.createConvolver();
      reverb.buffer = this.createImpulse(context);
      const wet = context.createGain();
      wet.gain.value = 0.18;
      filter.connect(reverb); reverb.connect(wet); wet.connect(this.gain);

      this.source = context.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      this.source.connect(filter);
      this.source.start();
      this.gain.gain.linearRampToValueAtTime(this.muted || !this.active ? 0 : this.volume * 0.28, context.currentTime + 3.4);
    } catch (error) {
      if (!this.disposed) console.warn('[SDP] Optional ambience could not be decoded; continuing silently.', error);
    }
  }

  private createImpulse(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 2.6);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    let seed = 23;
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        seed = (seed * 16807) % 2147483647;
        samples[i] = (seed / 2147483647 * 2 - 1) * Math.pow(1 - i / length, 3.3);
      }
    }
    return impulse;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, String(this.muted)); } catch { /* Preference is optional. */ }
    if (!this.muted && !document.hidden) void this.context?.resume().catch(() => {});
    this.updateGain();
    return this.muted;
  }

  setVolume(volume: number): void { this.volume = Math.max(0, Math.min(1, volume)); this.updateGain(); }
  setActive(active: boolean): void { this.active = active; this.updateGain(); }

  private updateGain(): void {
    if (!this.context || !this.gain) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelAndHoldAtTime(now);
    this.gain.gain.setTargetAtTime(this.muted || !this.active ? 0 : this.volume * 0.28, now, 0.18);
  }

  setVisible(visible: boolean): void {
    if (!this.context || this.disposed) return;
    void (visible ? this.context.resume() : this.context.suspend()).catch(() => {});
  }

  dispose(): void {
    this.disposed = true; this.abort.abort(); this.source?.stop(); this.source?.disconnect();
    this.gain?.disconnect();
  }
}
