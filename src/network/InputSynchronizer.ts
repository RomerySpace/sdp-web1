import { SIMULATION_HZ, type MovementInput, type NetworkPlayer } from '../../shared/MultiplayerProtocol';
import type { FirstPersonController } from '../player/FirstPersonController';
import type { MultiplayerConnection } from './MultiplayerConnection';
import { lobbyPrediction } from '../../shared/SessionPolicy';

export class InputSynchronizer {
  private readonly timer: number;
  private enabled = true;
  private readonly input: MovementInput = { seq: 0, f: 0, r: 0, y: 0, p: 0, active: false };

  constructor(private readonly network: MultiplayerConnection, private readonly player: FirstPersonController) {
    this.timer = window.setInterval(() => this.send(), 1000 / SIMULATION_HZ);
  }

  private send(forceStopped = false): number | undefined {
    if (!this.enabled || this.network.status.state !== 'connected') return;
    const fresh = !!this.network.snapshot && performance.now() - this.network.snapshot.receivedAt <= lobbyPrediction.stateTimeoutMs;
    if (!fresh) this.player.setNetworkReady(false);
    const active = fresh && !forceStopped && this.player.enabled && this.player.controlling && !document.hidden;
    this.input.seq++;
    this.input.f = active ? this.player.input.forward : 0;
    this.input.r = active ? this.player.input.sideways : 0;
    this.input.y = Math.atan2(Math.sin(this.player.camera.rotation.y), Math.cos(this.player.camera.rotation.y));
    this.input.p = this.player.camera.rotation.x;
    this.input.active = active;
    this.input.s = active && this.player.input.sprinting;
    this.input.j = active && this.player.input.jumping;
    this.input.c = active && this.player.input.crouching;
    this.player.recordInput(this.input.seq, active && !!(this.input.f || this.input.r || this.input.j));
    this.network.sendInput(this.input);
    return this.input.seq;
  }

  stop(): void { this.send(true); }
  async synchronize(): Promise<NetworkPlayer> {
    const sequence = this.send(true), roomId = this.network.snapshot?.roomId;
    if (sequence === undefined || !roomId) throw new Error('Multiplayer is reconnecting.');
    const deadline = performance.now() + 2500;
    while (performance.now() < deadline) {
      const snapshot = this.network.snapshot;
      if (this.network.status.state !== 'connected' || snapshot?.roomId !== roomId) throw new Error('Multiplayer is reconnecting.');
      const player = snapshot.players.find(p => p.playerId === snapshot.localPlayerId);
      if (player?.connected && player.lastProcessedInput >= sequence) return player;
      await new Promise(resolve => window.setTimeout(resolve, 20));
    }
    throw new Error('Position confirmation timed out. Please try again.');
  }
  setEnabled(enabled: boolean): void { if (!enabled) this.stop(); this.enabled = enabled; }
  dispose(): void { this.stop(); window.clearInterval(this.timer); }
}
