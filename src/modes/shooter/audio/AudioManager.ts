import { sharedAudioContext } from '../../../audio/AudioContextHub';
import { rampGain } from '../../../audio/GainEnvelope';
import { Vector3, type Camera } from 'three';
/** Original quiet mechanical report and footsteps, mixed into the application's context. */
export class AudioManager {
  private context?: AudioContext;
  private gain?: GainNode;
  private noise?: AudioBuffer;
  private readonly strikeSources = new Set<AudioScheduledSourceNode>();
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
    this.strikeSources.add(source);
    source.start(); source.stop(ctx.currentTime + duration);
    source.onended = () => { this.strikeSources.delete(source); source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }
  shot(): void { this.report(0.48, 1600, 0.13); }
  step(sprinting: boolean): void { this.report(sprinting ? 0.1 : 0.065, 350, 0.065); }
  reload(): void { this.report(0.12, 2200, 0.09); }
  airstrike(phase: 'flyover' | 'impact', point: Vector3, camera: Camera): void {
    const ctx=this.context;if(!ctx||!this.gain||!this.noise||this.muted||!this.visible||ctx.state!=='running')return;
    const local=camera.worldToLocal(point.clone()),distance=local.length(),volume=Math.pow(Math.max(0,1-distance/140),2);
    if(volume<.002)return;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),envelope=ctx.createGain(),pan=ctx.createStereoPanner();
    const duration=phase==='impact'?1.2:1.5;source.buffer=this.noise;source.loop=true;filter.type='lowpass';
    filter.frequency.setValueAtTime(phase==='impact'?1800:350,ctx.currentTime);filter.frequency.exponentialRampToValueAtTime(70,ctx.currentTime+duration);
    pan.pan.value=Math.max(-1,Math.min(1,local.x/Math.max(1,Math.hypot(local.x,local.z))));
    envelope.gain.setValueAtTime((phase==='impact'?.75:.22)*volume,ctx.currentTime);envelope.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+duration);
    source.connect(filter);filter.connect(envelope);envelope.connect(pan);pan.connect(this.gain);source.start();source.stop(ctx.currentTime+duration);this.strikeSources.add(source);
    source.onended=()=>{this.strikeSources.delete(source);source.disconnect();filter.disconnect();envelope.disconnect();pan.disconnect();};
    if(phase==='impact'){
      const bass=ctx.createOscillator(),gain=ctx.createGain();bass.frequency.setValueAtTime(85,ctx.currentTime);bass.frequency.exponentialRampToValueAtTime(25,ctx.currentTime+.55);
      gain.gain.setValueAtTime(.25*volume,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.65);bass.connect(gain);gain.connect(this.gain);bass.start();bass.stop(ctx.currentTime+.7);this.strikeSources.add(bass);
      bass.onended=()=>{this.strikeSources.delete(bass);bass.disconnect();gain.disconnect();};
    }
  }
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
  private stopSources(): void { for(const source of this.strikeSources){try{source.stop();}catch{/* Already ended. */}source.disconnect();}this.strikeSources.clear(); }
  dispose(): void { this.visible = false; this.stopSources(); this.gain?.disconnect(); }
}
