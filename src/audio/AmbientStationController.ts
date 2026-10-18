import { Piano, createElement } from 'lucide';
import type { Camera } from 'three';
import { ambientStation, type StationSnapshot } from '../../shared/AmbientStation';
import type { ColyseusNetworkAdapter } from '../network/ColyseusNetworkAdapter';
import { AmbientInstrument } from '../ui/AmbientInstrument';
import { sharedAudioContext } from './AudioContextHub';
import type { AmbientSynth } from './AmbientSynth';

export class AmbientStationController {
  readonly panel: AmbientInstrument;
  readonly prompt = document.createElement('button');
  snapshot: StationSnapshot | null = null;
  private synth?: AmbientSynth;
  private loading?: Promise<void>;
  private receivedAt = 0;
  private ping = 0;
  private pending = false;
  private disposed = false;
  private failed = false;
  private pendingTimer = 0;
  private readonly timer: number;
  private readonly abort = new AbortController();
  private readonly subscriptions: (() => void)[] = [];
  constructor(private readonly container: HTMLElement, private readonly network: ColyseusNetworkAdapter, ui: HTMLElement, private readonly opened: () => void, private readonly closed: () => void, private readonly notice: (message: string) => void) {
    this.panel = new AmbientInstrument(container, command => network.sendStation(command), () => this.close());
    this.prompt.type = 'button'; this.prompt.hidden = true; this.prompt.className = 'instrument-interaction';
    this.prompt.append(createElement(Piano)); const kbd = document.createElement('kbd'); kbd.textContent = 'E'; this.prompt.append(kbd, document.createElement('span')); ui.append(this.prompt);
    this.prompt.addEventListener('click', () => this.interact(), { signal: this.abort.signal });
    this.subscriptions.push(network.subscribeToStation(state => {
      this.snapshot = state; this.receivedAt = performance.now(); this.synth?.receive(state, this.ping / 2);
      if (!state) { this.pending = false; if (this.panel.visible) this.hide(); return; }
      const owns = state.ownerId === network.snapshot?.localPlayerId;
      if (this.pending && owns) { this.pending = false; this.panel.receive(state); this.panel.open(); container.classList.add('instrument-open'); this.opened(); }
      if (this.panel.visible && !owns) this.hide();
      if (this.panel.visible) this.panel.receive(state);
    }), network.subscribeToStationSound(sound => this.synth?.sound(sound)));
    this.timer = window.setInterval(() => {
      if (this.panel.visible) network.sendStation({ type: 'heartbeat' });
      network.sendStation({ type: 'sync' });
      void network.ping().then(ms => { if (ms > 0) this.ping = ms; }).catch(() => {});
    }, 5000);
    window.addEventListener('pagehide', () => this.close(), { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.synth?.suspend(); if (this.panel.visible) this.close(); } }, { signal: this.abort.signal });
  }
  get visible(): boolean { return this.panel.visible; }
  get audioDiagnostics(): { loaded: boolean; level: number; scheduled: number } { return { loaded: !!this.synth, level: this.synth?.level ?? 0, scheduled: this.synth?.scheduledNotes ?? 0 }; }
  unlock(): void { void sharedAudioContext().resume().catch(() => {}); }
  private prepare(): void {
    if (this.synth || this.loading || this.disposed || this.failed) return;
    this.loading = import('./AmbientSynth').then(({ AmbientSynth }) => {
      if (this.disposed) return;
      const synth = new AmbientSynth();
      try { synth.receive(this.snapshot ? { ...this.snapshot, serverNow: this.serverNow() } : null, this.ping / 2); this.synth = synth; this.panel.setAudioReady(true); }
      catch (error) { synth.dispose(); throw error; }
    }).catch(error => { this.failed = true; this.panel.setAudioReady(false, true); console.warn('[SDP] Instrument audio unavailable.', error); this.notice('Instrument audio unavailable. Close and reopen it to retry.'); }).finally(() => this.loading = undefined);
  }
  interact(): void {
    if (this.visible || this.pending || this.prompt.hidden || this.prompt.disabled) return;
    this.failed = false; this.unlock(); this.prepare(); this.pending = true; this.network.sendStation({ type: 'claim' });
    window.clearTimeout(this.pendingTimer); this.pendingTimer = window.setTimeout(() => this.pending = false, 3000);
  }
  private serverNow(): number { return this.snapshot ? this.snapshot.serverNow + performance.now() - this.receivedAt : Date.now(); }
  update(camera: Camera, active: boolean, reveal: number, focus: boolean, volume: number): void {
    if (this.visible && !active) this.close();
    const occupied = !!this.snapshot?.ownerId && this.snapshot.ownerId !== this.network.snapshot?.localPlayerId;
    this.prompt.hidden = !focus || this.visible; this.prompt.disabled = occupied;
    this.prompt.querySelector('span')!.textContent = occupied ? `OCCUPIED · ${this.snapshot?.ownerName}` : 'PLAY';
    this.prompt.setAttribute('aria-label', occupied ? `Instrument occupied by ${this.snapshot?.ownerName}` : 'Play field instrument');
    if (active && reveal > .9 && (this.snapshot?.ownerId || this.snapshot?.playing) && Math.hypot(camera.position.x - ambientStation.x, camera.position.z - ambientStation.z) < ambientStation.hearingRadius) this.prepare();
    this.synth?.update(camera, active && reveal > .9, volume);
    this.panel.update(this.synth?.serverNow() ?? this.serverNow());
  }
  private hide(): void { this.panel.hide(); this.container.classList.remove('instrument-open'); this.closed(); }
  close(): void {
    this.pending = false;
    if (this.panel.visible) { this.panel.releaseKeys(); this.network.sendStation({ type: 'release' }); this.hide(); }
  }
  dispose(): void { this.close(); this.disposed = true; window.clearInterval(this.timer); window.clearTimeout(this.pendingTimer); this.abort.abort(); this.subscriptions.forEach(unsubscribe => unsubscribe()); this.panel.dispose(); this.prompt.remove(); this.synth?.dispose(); }
}
