import { gameplayConfig } from './GameplayConfig';

/** Only undo outstanding kick, never a mouse correction the player already made. */
export class RecoilRecovery {
  pitch = 0;
  yaw = 0;
  private idle = 0;
  add(pitch: number, yaw: number): void {
    const fraction = gameplayConfig.combat.recoilRecoveryFraction;
    this.pitch += pitch * fraction; this.yaw += yaw * fraction; this.idle = 0;
  }
  update(dt: number, mousePitch = 0, mouseYaw = 0): { pitch: number; yaw: number } {
    const cancel = (kick: number, mouse: number) => kick * mouse < 0
      ? Math.sign(kick) * Math.max(0, Math.abs(kick) - Math.abs(mouse)) : kick;
    this.pitch = cancel(this.pitch, mousePitch); this.yaw = cancel(this.yaw, mouseYaw);
    const previous = this.idle; this.idle += dt;
    const elapsed = Math.max(0, this.idle - Math.max(previous, gameplayConfig.combat.recoilRecoveryDelay));
    const factor = 1 - Math.exp(-gameplayConfig.combat.recoilRecoveryResponse * elapsed);
    const result = { pitch: -this.pitch * factor || 0, yaw: -this.yaw * factor || 0 };
    this.pitch += result.pitch; this.yaw += result.yaw;
    return result;
  }
  reset(): void { this.pitch = this.yaw = this.idle = 0; }
}
