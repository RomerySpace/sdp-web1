import { sharedAudioContext } from '../../../audio/AudioContextHub';
import { rampGain } from '../../../audio/GainEnvelope';
/** Original quiet mechanical report and footsteps, mixed into the application's context. */
export class AudioManager {
  private context?: AudioContext;
  private gain?: GainNode;
  private noise?: AudioBuffer;
  private readonly sources = new Set<AudioScheduledSourceNode>();
  private visible = true;
  volume = .5;
  muted = false;
  constructor() { try { this.muted = localStorage.getItem('sdp:muted') === 'true'; } catch { /* Optional preference. */ } }
  enter(): void {
    if (this.context) { void this.context.resume().catch(() => {}); return; }
    try {
      const ctx = this.context = sharedAudioContext();
      this.gain = ctx.createGain(); this.gain.gain.value = this.muted ? 0 : this.volume * .7; this.gain.connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
      const samples = this.noise.getChannelData(0);
      let seed = 419;
      for (let i = 0; i < samples.length; i++) { seed = (seed * 16807) % 2147483647; samples[i] = seed / 1073741824 - 1; }
      void ctx.resume().catch(() => {});
      // The application owns Limbo ambience; Shooter adds only its original effects.
    } catch { /* Audio is optional. */ }
  }
  private report(volume: number, frequency: number, duration: number): void {
    const ctx = this.context;
    if (!ctx || !this.gain || !this.noise || this.muted || !this.visible || ctx.state !== 'running') return;
    const source = ctx.createBufferSource(); source.buffer = this.noise;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = frequency;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(volume, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter); filter.connect(envelope); envelope.connect(this.gain);
    this.sources.add(source);
    source.start(); source.stop(ctx.currentTime + duration);
    source.onended = () => { this.sources.delete(source); source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }
  shot(): void { this.report(0.48, 1600, 0.13); }
  step(sprinting: boolean): void { this.report(sprinting ? 0.1 : 0.065, 350, 0.065); }
  reload(): void { this.report(0.12, 2200, 0.09); }
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    try { localStorage.setItem('sdp:muted', String(this.muted)); } catch { /* Optional. */ }
    return this.muted;
  }
  setMuted(muted: boolean): void { this.muted = muted; this.updateGain(); }
  setVolume(value: number): void { this.volume = Math.max(0, Math.min(1, value)); this.updateGain(); }
  private updateGain(): void {
    if (this.context && this.gain) rampGain(this.gain.gain, this.muted || !this.visible ? 0 : this.volume * .7, this.context.currentTime);
  }
  setVisible(visible: boolean): void {
    this.visible = visible; this.updateGain();
    if (visible) void this.context?.resume().catch(() => {});
    else this.stopSources();
  }
  private stopSources(): void { for(const source of this.sources){try{source.stop();}catch{/* Already ended. */}source.disconnect();}this.sources.clear(); }
  dispose(): void { this.visible = false; this.stopSources(); this.gain?.disconnect(); }
}
