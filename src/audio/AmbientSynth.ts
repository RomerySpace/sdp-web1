import * as Tone from 'tone';
import { Vector3, type Camera } from 'three';
import { ambientStation, stationStepMs, type StationSnapshot, type StationSound, type StationTrack } from '../../shared/AmbientStation';
import { sharedAudioContext } from './AudioContextHub';
import { hallImpulse } from './HallReverb';

interface Channel { synth: Tone.PolySynth; filter: Tone.Filter; delay: Tone.FeedbackDelay; gain: Tone.Gain; dry: GainNode; wet: GainNode; preset: string }
interface Grain { player: Tone.GrainPlayer; envelope: Tone.AmplitudeEnvelope; timer?: number }
/** One room clock, one shared AudioContext; no audio is uploaded by the performer. */
export class AmbientSynth {
  private readonly context = sharedAudioContext();
  private readonly master = this.context.createGain();
  private readonly panner = this.context.createPanner();
  private readonly reverb = this.context.createConvolver();
  private readonly limiter = this.context.createDynamicsCompressor();
  private readonly meter = this.context.createAnalyser();
  private readonly channels: Channel[] = [];
  private readonly grains = new Map<string, Grain>();
  private readonly texture: AudioBuffer;
  private readonly scheduled = new Map<string, number>();
  private readonly direction = new Vector3();
  private readonly up = new Vector3();
  private snapshot: StationSnapshot | null = null;
  private clockOffset = 0;
  private anchor = false;
  private active = false;
  private cursor = 0;
  private transport = '';
  private readonly timer: number;
  private disposed = false;
  scheduledNotes = 0;
  constructor() {
    Tone.setContext(this.context);
    this.master.gain.value = 0;
    this.panner.panningModel = 'HRTF'; this.panner.rolloffFactor = 0;
    this.panner.positionX.value = ambientStation.x; this.panner.positionY.value = 1.2; this.panner.positionZ.value = ambientStation.z;
    this.reverb.buffer = hallImpulse(this.context, 6);
    this.limiter.threshold.value = -10; this.limiter.knee.value = 8; this.limiter.ratio.value = 8;
    this.reverb.connect(this.panner); this.panner.connect(this.limiter); this.limiter.connect(this.master);
    this.master.connect(this.meter); this.meter.connect(this.context.destination); this.meter.fftSize = 256;
    for (let i = 0; i < ambientStation.tracks; i++) {
      const synth = new Tone.PolySynth({ maxPolyphony: 8, options: { oscillator: { type: 'sine' }, envelope: { attack: .25, decay: .5, sustain: .6, release: 2.5 }, volume: -18 } });
      const filter = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });
      const delay = new Tone.FeedbackDelay({ delayTime: .4167, feedback: .25, wet: .2 });
      const gain = new Tone.Gain(.55), dry = this.context.createGain(), wet = this.context.createGain();
      synth.chain(filter, delay, gain); gain.connect(dry); gain.connect(wet); dry.connect(this.panner); wet.connect(this.reverb);
      this.channels.push({ synth, filter, delay, gain, dry, wet, preset: '' });
    }
    this.texture = this.context.createBuffer(2, this.context.sampleRate * 4, this.context.sampleRate);
    let seed = 123456;
    for (let c = 0; c < 2; c++) {
      const data = this.texture.getChannelData(c); let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        smooth = smooth * .98 + ((seed / 4294967296) * 2 - 1) * .02;
        const t = i / this.context.sampleRate;
        data[i] = (Math.sin(t * Math.PI * 440) * .28 + Math.sin(t * Math.PI * 660 + c * .2) * .1 + smooth * .8) * (.65 + .25 * Math.sin(t * 1.8));
      }
    }
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  receive(state: StationSnapshot | null, estimatedLatency = 0): void {
    if (!state || (this.snapshot && state.roomId !== this.snapshot.roomId)) this.silence();
    this.snapshot = state;
    if (!state) { this.anchor = false; return; }
    const offset = state.serverNow + estimatedLatency - performance.now();
    this.clockOffset = this.anchor ? this.clockOffset + Math.max(-10, Math.min(10, offset - this.clockOffset)) : offset;
    this.anchor = true;
    state.tracks.forEach((track, i) => this.configure(this.channels[i], track));
    const transport = `${state.roomId}:${state.playing}:${state.startedAt}:${state.bpm}`;
    if (transport !== this.transport) { this.silence(); this.transport = transport; this.cursor = this.serverNow(); }
  }
  private configure(channel: Channel, track: StationTrack): void {
    if (channel.preset !== track.preset) {
      channel.synth.releaseAll(); channel.preset = track.preset;
      channel.synth.set({ oscillator: { type: track.preset === 'glass' ? 'triangle' : 'sine' }, envelope: {
        attack: track.preset === 'glass' ? .025 : track.preset === 'drone' ? .8 : .3,
        decay: track.preset === 'glass' ? 1.3 : .5, sustain: track.preset === 'glass' ? .12 : .65,
        release: track.preset === 'glass' ? 3 : 2.5,
      } });
    }
    channel.gain.gain.rampTo(track.muted ? 0 : track.gain, .08);
    channel.filter.frequency.rampTo(250 * Math.pow(40, track.tone), .1);
    channel.delay.wet.rampTo(track.echo * .45, .1); channel.delay.feedback.rampTo(track.echo * .55, .1);
    channel.dry.gain.setTargetAtTime(1 - track.space * .5, this.context.currentTime, .1);
    channel.wet.gain.setTargetAtTime(track.space * .6, this.context.currentTime, .1);
  }
  serverNow(): number { return performance.now() + this.clockOffset; }
  private audioTime(serverAt: number): number { return Math.max(this.context.currentTime + .005, this.context.currentTime + (serverAt - this.serverNow()) / 1000); }
  private schedule(): void {
    const state = this.snapshot, now = this.serverNow();
    if (!state?.playing || !this.active || document.hidden || this.context.state !== 'running') { this.cursor = now; return; }
    const horizon = now + 220, start = Math.max(this.cursor, now - 20), stepMs = stationStepMs(state.bpm), loopMs = stepMs * 64;
    for (const [key, at] of this.scheduled) if (at < now - loopMs) this.scheduled.delete(key);
    state.tracks.forEach((track, index) => {
      if (track.muted) return;
      for (const note of track.notes) {
        const base = state.startedAt + note.step * stepMs;
        const cycle = Math.max(0, Math.ceil((start - base) / loopMs));
        const at = base + cycle * loopMs, key = `${index}:${note.id}:${cycle}`;
        if (at < start || at > horizon || at <= note.firstAt + stepMs * .5 || this.scheduled.has(key)) continue;
        this.scheduled.set(key, at); this.scheduledNotes++;
        this.play(index, note.note, note.velocity, at, note.duration * stepMs / 1000, key);
      }
    });
    this.cursor = horizon;
  }
  sound(sound: StationSound): void {
    if (!this.active || !this.snapshot || sound.roomId !== this.snapshot.roomId) return;
    const key = `live:${sound.track}:${sound.note}`;
    if (sound.on) this.play(sound.track, sound.note, sound.velocity, sound.at, undefined, key);
    else this.release(sound.track, sound.note, sound.at, key);
  }
  private play(index: number, note: number, velocity: number, at: number, duration?: number, key = ''): void {
    const channel = this.channels[index]; if (!channel || this.disposed) return;
    const time = this.audioTime(at), frequency = 440 * Math.pow(2, (note - 69) / 12);
    if (channel.preset !== 'grain') {
      if (duration !== undefined) channel.synth.triggerAttackRelease(frequency, duration, time, velocity * .65);
      else channel.synth.triggerAttack(frequency, time, velocity * .65);
      return;
    }
    if (this.grains.size >= 8 || this.grains.has(key)) return;
    const player = new Tone.GrainPlayer({ url: this.texture, loop: true, grainSize: .18, overlap: .08, playbackRate: .65, detune: (note - 57) * 100, volume: -18 });
    const envelope = new Tone.AmplitudeEnvelope({ attack: .3, decay: .5, sustain: .6, release: 1.5 });
    player.chain(envelope, channel.filter); player.start(time, 0); envelope.triggerAttack(time, velocity);
    const grain: Grain = { player, envelope }; this.grains.set(key, grain);
    const releaseAt = duration === undefined ? ambientStation.maxHeldMs / 1000 : duration;
    grain.timer = window.setTimeout(() => this.release(index, note, this.serverNow(), key), Math.max(0, (time - this.context.currentTime + releaseAt) * 1000));
  }
  private release(index: number, note: number, at: number, key: string): void {
    const grain = this.grains.get(key), time = this.audioTime(at);
    if (grain) {
      window.clearTimeout(grain.timer); grain.envelope.triggerRelease(time);
      grain.timer = window.setTimeout(() => { grain.player.dispose(); grain.envelope.dispose(); this.grains.delete(key); }, Math.max(0, (time - this.context.currentTime + 1.7) * 1000));
    } else this.channels[index]?.synth.triggerRelease(440 * Math.pow(2, (note - 69) / 12), time);
  }
  update(camera: Camera, active: boolean, volume: number): void {
    const distance = Math.hypot(camera.position.x - ambientStation.x, camera.position.z - ambientStation.z);
    const t = Math.max(0, Math.min(1, (distance - ambientStation.fullRadius) / (ambientStation.hearingRadius - ambientStation.fullRadius)));
    const audible = active && !document.hidden && distance < ambientStation.hearingRadius;
    if (this.active && !audible) this.silence();
    this.active = audible;
    this.master.gain.setTargetAtTime(audible ? volume * .65 * (1 - t * t * (3 - 2 * t)) : 0, this.context.currentTime, .12);
    if (!audible) return;
    this.direction.set(0, 0, -1).applyQuaternion(camera.quaternion); this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const listener = this.context.listener;
    if (listener.positionX) {
      [listener.positionX, listener.positionY, listener.positionZ, listener.forwardX, listener.forwardY, listener.forwardZ, listener.upX, listener.upY, listener.upZ]
        .forEach((p, i) => p.setTargetAtTime([...camera.position.toArray(), ...this.direction.toArray(), ...this.up.toArray()][i], this.context.currentTime, .06));
    }
  }
  get level(): number { const data = new Float32Array(this.meter.fftSize); this.meter.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length); }
  silence(): void {
    this.channels.forEach(c => c.synth.releaseAll());
    for (const grain of this.grains.values()) { window.clearTimeout(grain.timer); grain.player.dispose(); grain.envelope.dispose(); }
    this.grains.clear(); this.scheduled.clear();
  }
  suspend(): void { this.active = false; this.master.gain.setTargetAtTime(0, this.context.currentTime, .04); this.silence(); }
  dispose(): void {
    this.disposed = true; window.clearInterval(this.timer); this.silence();
    this.channels.forEach(c => { c.synth.dispose(); c.filter.dispose(); c.delay.dispose(); c.gain.dispose(); c.dry.disconnect(); c.wet.disconnect(); });
    [this.reverb, this.panner, this.limiter, this.master, this.meter].forEach(n => n.disconnect()); this.reverb.buffer = null;
  }
}
