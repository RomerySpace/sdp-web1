import type { CharacterController } from '../physics/CharacterController';
import type { Weapon } from '../weapon/Weapon';
export class ShooterHUD {
  readonly element = document.createElement('div');
  constructor(container: HTMLElement) {
    this.element.className = 'shooter-hud'; this.element.hidden = true;
    this.element.innerHTML = `<header><span>SDP</span><span>DE_DUST2 / 01</span></header>
      <div class="shooter-crosshair" aria-hidden="true"></div>
      <div class="shooter-movement"></div><div class="shooter-health" aria-label="Health"></div><div class="shooter-ammo" aria-label="Ammunition"><span>SDP / SEMI-AUTO</span>
      <strong class="shooter-magazine">30</strong><span class="shooter-reserve">/ 120</span><span class="shooter-action"></span></div>`;
    container.append(this.element);
  }
  update(player: CharacterController, weapon: Weapon, health: number, dead: boolean): void {
    this.element.querySelector('.shooter-magazine')!.textContent = String(weapon.ammo).padStart(2, '0');
    this.element.querySelector('.shooter-reserve')!.textContent = `/ ${weapon.reserve}`;
    this.element.querySelector('.shooter-action')!.textContent = weapon.reloading ? 'RELOADING' : weapon.ads > .6 ? 'AIMING' : '';
    this.element.querySelector('.shooter-movement')!.textContent = dead ? '' : player.state;
    this.element.querySelector('.shooter-health')!.textContent = `${health} / HP`;
    this.element.dataset.dead = String(dead);
    this.element.dataset.grounded = String(player.grounded);
  }
  dispose(): void { this.element.remove(); }
}
