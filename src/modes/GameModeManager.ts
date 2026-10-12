import type { WebGLRenderer } from 'three';
import { LOBBY_NAME } from '../../shared/MultiplayerProtocol';
import { SHOOTER_ROOM } from '../../shared/ShooterProtocol';
import type { ColyseusNetworkAdapter } from '../network/ColyseusNetworkAdapter';
import type { ShooterMode } from './shooter/ShooterMode';
import { ModeInterface } from '../ui/ModeInterface';
import { ENABLE_SHOOTER_TEST } from '../../shared/GameplayConfig';
import { PlayerSettings } from '../core/PlayerSettings';
export type GameMode = 'LIMBO' | 'SHOOTER_LOADING' | 'SHOOTER' | 'RETURNING_TO_LIMBO';
interface Hooks {
  pauseLimbo(): void; restoreLimbo(): void; suspendCommunication(): void; restoreCommunication(): void;
  resetChat(): void; changed(mode: GameMode): void; inspect(): void;
}
export class GameModeManager {
  value: GameMode = 'LIMBO';
  shooter?: ShooterMode;
  readonly ui: ModeInterface;
  private generation = 0;
  private abort?: AbortController;
  private operation?: Promise<void>;
  private disposed = false;
  private returning = false;
  private haze = 0;
  constructor(private readonly container: HTMLElement, private readonly renderer: WebGLRenderer,
    private readonly network: ColyseusNetworkAdapter, private readonly hooks: Hooks, private readonly settings = new PlayerSettings()) {
    this.ui = new ModeInterface(container, { join: () => void this.joinShooter(), back: () => void this.returnToLimbo(),
      resume: () => this.shooter?.resume() });
  }
  interact(): void {
    if (this.value !== 'LIMBO') return;
    this.hooks.inspect();
  }
  setInspection(inspecting: boolean): void { this.ui.inspection(inspecting && ENABLE_SHOOTER_TEST && this.network.snapshot?.shooterEnabled !== false); }
  private set(mode: GameMode): void { this.value = mode; this.container.dataset.mode = mode; this.hooks.changed(mode); }
  async joinShooter(): Promise<void> {
    if (!ENABLE_SHOOTER_TEST || this.network.snapshot?.shooterEnabled === false) return;
    if (this.disposed || this.returning || this.value === 'SHOOTER' || this.operation) return;
    const operation = this.loadShooter(); this.operation = operation;
    try { await operation; } finally { if (this.operation === operation) this.operation = undefined; }
  }
  private async loadShooter(): Promise<void> {
    const generation = ++this.generation;
    const abort = this.abort = new AbortController();
    this.hooks.pauseLimbo(); this.hooks.suspendCommunication();
    this.set('SHOOTER_LOADING'); this.ui.loading('Loading simulation module');
    let candidate: ShooterMode | undefined;
    try {
      // Inspection never reaches this import; only an explicit join does.
      const { ShooterMode } = await import('./shooter/ShooterMode');
      abort.signal.throwIfAborted();
      candidate = new ShooterMode(this.container, this.renderer, this.network, () => this.ui.pause(), () => this.ui.hide(), this.settings);
      await candidate.initialize(text => { if (generation === this.generation) this.ui.loading(text); }, abort.signal);
      abort.signal.throwIfAborted();
      this.ui.loading('Joining Shooter room');
      await this.network.switchRoom(SHOOTER_ROOM);
      abort.signal.throwIfAborted();
      this.hooks.resetChat(); this.shooter = candidate; this.set('SHOOTER');
      candidate.enter(); this.ui.attachSession(candidate.menu.element); this.ui.pause(true);
    } catch (error) {
      candidate?.dispose();
      if (generation !== this.generation || this.disposed) return;
      try { if (this.network.roomType !== LOBBY_NAME || this.network.status.state !== 'connected') await this.network.switchRoom(LOBBY_NAME); }
      catch { /* Error screen still allows retrying or returning to Limbo offline. */ }
      this.hooks.restoreCommunication();
      this.ui.error(error instanceof Error ? error.message : 'Simulation could not load.');
    }
  }
  async returnToLimbo(): Promise<void> {
    if (this.disposed || this.returning || this.value === 'LIMBO') return;
    this.returning = true; ++this.generation; this.abort?.abort(); this.set('RETURNING_TO_LIMBO');
    this.ui.loading('Returning to Limbo');
    try {
      this.shooter?.pause();
      if (this.operation) await this.operation;
      this.shooter?.dispose(); this.shooter = undefined; this.ui.attachSession();
      this.hooks.resetChat();
      if (this.network.roomType !== LOBBY_NAME || this.network.status.state !== 'connected') await this.network.switchRoom(LOBBY_NAME);
    } catch (error) {
      console.warn('[SDP] Limbo reconnect:', error);
      if (this.network.roomType === LOBBY_NAME) void this.network.connect();
    } finally {
      this.returning = false;
      if (!this.disposed) {
        this.set('LIMBO'); this.ui.hide(); this.hooks.restoreCommunication(); this.hooks.restoreLimbo();
      }
    }
  }
  update(dt: number): void {
    const target = this.value === 'SHOOTER_LOADING' || this.value === 'RETURNING_TO_LIMBO' ? 0.86 : 0;
    this.haze += (target - this.haze) * Math.min(1, dt * 5);
    this.ui.setHaze(this.haze);
    if (this.value === 'SHOOTER') this.shooter?.update(dt);
  }
  pause(): void { if (this.value === 'SHOOTER') this.shooter?.pause(); }
  toggleMenu(): void {
    if (this.value !== 'SHOOTER') return;
    if (this.shooter?.paused && !this.ui.element.hidden && this.network.status.state === 'connected') this.shooter.resume();
    else this.pause();
  }
  resize(): void { this.shooter?.resize(); }
  dispose(): void {
    this.disposed = true; ++this.generation; this.abort?.abort(); this.shooter?.dispose(); this.ui.dispose();
  }
}
