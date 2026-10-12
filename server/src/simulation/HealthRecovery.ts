import { gameplayConfig } from '../../../shared/GameplayConfig';
export interface RecoveringPlayer { health: number; lastDamageAt: number; dead: boolean; connected: boolean }
export class HealthRecovery {
  private fraction = 0;
  interrupt(): void { this.fraction = 0; }
  step(player: RecoveringPlayer, now: number, dt: number): void {
    const c = gameplayConfig.combat;
    if (player.dead || !player.connected || player.health >= c.maxHealth || now - player.lastDamageAt < c.regenerationDelay * 1000) {
      this.fraction = 0; return;
    }
    this.fraction += c.regenerationRate * dt;
    const amount = Math.floor(this.fraction + 1e-8);
    player.health = Math.min(c.maxHealth, player.health + amount); this.fraction -= amount;
  }
}
