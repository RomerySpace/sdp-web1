import { gameplayConfig } from '../../../../shared/GameplayConfig';
export class CombatFeedback {
  readonly element = document.createElement('div');
  private readonly vignette = document.createElement('img');
  private readonly death = document.createElement('div');
  private impact = 0; private haze = 0;
  constructor(container: HTMLElement) {
    this.element.className = 'combat-feedback'; this.vignette.className = 'damage-vignette';
    const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = 512;
    this.vignette.alt = ''; this.vignette.setAttribute('aria-hidden', 'true');
    this.death.className = 'desynchronization-state'; this.death.textContent = 'DESYNCHRONIZED'; this.death.hidden = true;
    this.death.setAttribute('role', 'status');
    this.element.append(this.vignette, this.death); container.append(this.element);
    const ctx = bitmap.getContext('2d')!;
    // One cached bitmap of broken edge facets; the aiming area stays completely clear.
    let seed = 73; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let edge = 0; edge < 4; edge++) {
      ctx.save(); ctx.translate(256, 256); ctx.rotate(edge * Math.PI / 2); ctx.translate(-256, -256);
      for (let i = 0; i < 34; i++) {
        const x = random() * 512, width = 7 + random() * 35, depth = 8 + random() * 54;
        ctx.fillStyle = i % 3 ? 'rgba(249,253,255,.85)' : 'rgba(164,190,207,.32)';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + width, 0); ctx.lineTo(x + width * .6, depth); ctx.lineTo(x - width * .25, depth * .6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(228,245,255,.8)'; ctx.lineWidth = .8; ctx.stroke();
        ctx.fillStyle = 'rgba(239,248,254,.6)'; ctx.fillRect(x, depth + 4, width * .5, 1);
      }
      ctx.restore();
    }
    this.vignette.src = bitmap.toDataURL();
  }
  hit(): void { this.impact = gameplayConfig.damage.vignetteDuration; }
  reset(): void { this.impact = this.haze = 0; this.vignette.style.opacity = '0'; this.death.hidden = true; }
  update(dt: number, health: number, dead: boolean): void {
    this.impact = Math.max(0, this.impact - dt);
    const pulse = Math.pow(this.impact / gameplayConfig.damage.vignetteDuration, .7);
    const persistent = !dead && health < gameplayConfig.combat.maxHealth ? .08 * (1 - health / gameplayConfig.combat.maxHealth) : 0;
    this.vignette.style.opacity = String(Math.min(1, pulse * gameplayConfig.damage.vignetteOpacity + persistent));
    this.death.hidden = !dead;
    this.haze += ((dead ? .32 : 0) - this.haze) * Math.min(1, dt * 4);
    this.element.style.backgroundColor = `rgba(245,250,255,${this.haze})`;
  }
  dispose(): void { this.element.remove(); }
}
