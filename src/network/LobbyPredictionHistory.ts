import { Vector3 } from 'three';
import type { NetworkPlayer } from '../../shared/MultiplayerProtocol';
import { PLAYER_HEIGHT } from '../../shared/MultiplayerProtocol';
import { lobbyPrediction } from '../../shared/SessionPolicy';

export class LobbyPredictionHistory {
  private readonly samples = new Map<number, Vector3>();
  private acknowledged = -1;
  reset(): void { this.samples.clear(); this.acknowledged = -1; }
  record(sequence: number, feet: Vector3): void {
    this.samples.set(sequence, feet.clone());
    while (this.samples.size > lobbyPrediction.historySize) this.samples.delete(this.samples.keys().next().value!);
  }
  reconcile(player: NetworkPlayer): Vector3 | undefined {
    if (player.lastProcessedInput <= this.acknowledged) return;
    const predicted = this.samples.get(player.lastProcessedInput);
    if (!predicted) return;
    this.acknowledged = player.lastProcessedInput;
    const delta = new Vector3(player.x, player.y - PLAYER_HEIGHT, player.z).sub(predicted);
    for (const sequence of this.samples.keys()) if (sequence <= this.acknowledged) this.samples.delete(sequence);
    if (delta.length() < lobbyPrediction.correctionTolerance) return;
    // Shift outstanding history too, so the same correction is not applied twice.
    for (const sample of this.samples.values()) sample.add(delta);
    return delta;
  }
}
