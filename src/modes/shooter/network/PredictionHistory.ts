import { Vector3 } from 'three';
import type { NetworkPlayer } from '../../../../shared/MultiplayerProtocol';
import { shooterNetworkConfig } from '../../../../shared/ShooterProtocol';

export class PredictionHistory {
  private readonly samples = new Map<number, Vector3>();
  private acknowledged = -1;
  private life = 0;
  corrections = 0;
  teleports = 0;
  reset(life: number): void { this.samples.clear(); this.acknowledged = -1; this.life = life; }
  record(sequence: number, feet: Vector3): void {
    this.samples.set(sequence, feet.clone());
    while (this.samples.size > shooterNetworkConfig.historySize) this.samples.delete(this.samples.keys().next().value!);
  }
  reconcile(player: NetworkPlayer): Vector3 | undefined {
    if (player.dead || player.life !== this.life || player.lastProcessedInput <= this.acknowledged) return;
    const predicted = this.samples.get(player.lastProcessedInput);
    if (!predicted) return;
    this.acknowledged = player.lastProcessedInput;
    const delta = new Vector3(player.x, player.y, player.z).sub(predicted);
    for (const sequence of this.samples.keys()) if (sequence <= this.acknowledged) this.samples.delete(sequence);
    if (delta.length() < shooterNetworkConfig.correctionTolerance) return;
    // Compare matching acknowledged history, not today's position to a delayed packet.
    for (const sample of this.samples.values()) sample.add(delta);
    this.corrections++;
    if (delta.length() > shooterNetworkConfig.teleportDistance) this.teleports++;
    return delta;
  }
}
