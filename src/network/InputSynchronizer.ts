import { SIMULATION_HZ, type MovementInput } from '../../shared/MultiplayerProtocol';
import type { FirstPersonController } from '../player/FirstPersonController';
import type { MultiplayerConnection } from './MultiplayerConnection';

export class InputSynchronizer {
  private readonly timer: number;
  private readonly input: MovementInput = { seq: 0, f: 0, r: 0, y: 0, p: 0, active: false };

  constructor(private readonly network: MultiplayerConnection, private readonly player: FirstPersonController) {
    this.timer = window.setInterval(() => this.send(), 1000 / SIMULATION_HZ);
  }

  private send(forceStopped = false): void {
    if (this.network.status.state !== 'connected') return;
    const active = !forceStopped && this.player.enabled && this.player.locked && !document.hidden;
    this.input.seq++;
    this.input.f = active ? this.player.input.forward : 0;
    this.input.r = active ? this.player.input.sideways : 0;
    this.input.y = Math.atan2(Math.sin(this.player.camera.rotation.y), Math.cos(this.player.camera.rotation.y));
    this.input.p = this.player.camera.rotation.x;
    this.input.active = active;
    this.network.sendInput(this.input);
  }

  stop(): void { this.send(true); }
  dispose(): void { this.stop(); window.clearInterval(this.timer); }
}
