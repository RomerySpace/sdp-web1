import { ELIMINATION_POINTS, STREAK_TIERS, streakProgress } from '../../../../shared/Streaks';
import type { CharacterController } from '../physics/CharacterController';
import type { Weapon } from '../weapon/Weapon';
import type { LobbySnapshot } from '../../../../shared/MultiplayerProtocol';
import { createElement, ListOrdered } from 'lucide';
export class ShooterHUD {
  readonly element = document.createElement('div');
  private readonly strike: HTMLElement;
  private readonly score: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly fireMode: HTMLElement;
  private readonly timer: HTMLElement;
  private feedIds = '';
  private roundKey = '';
  private seen = new Set<string>();
  private initialized = false;
  private bannerUntil = 0;
  private readonly banner = document.createElement('div');
  private readonly streakMeter = document.createElement('div');
  constructor(container: HTMLElement, onMenu: () => void) {
    this.element.className = 'shooter-hud'; this.element.hidden = true;
    this.element.innerHTML = `<header><span>SDP</span><span>DE_DUST2 / 01</span></header>
      <div class="shooter-round" aria-label="Round time"></div>
      <div class="shooter-score"><span class="shooter-strike">STREAK 00</span><span class="shooter-record">0 K / 0 D</span></div>
      <ol class="shooter-kill-feed" aria-label="Eliminations" aria-live="polite"></ol>
      <div class="shooter-crosshair" aria-hidden="true"></div>
      <button class="shooter-menu-button" type="button" aria-label="Open session menu" title="P: session menu"><kbd>P</kbd><span>MENU</span></button>
      <div class="shooter-movement"></div><div class="shooter-health" aria-label="Health"></div><div class="shooter-ammo" aria-label="Ammunition"><div class="shooter-fire-control"><span class="shooter-fire-mode">SDP / SEMI-AUTO</span><span class="shooter-fire-hint" title="B: switch fire mode"><kbd>B</kbd> CHANGE</span></div>
      <strong class="shooter-magazine">30</strong><span class="shooter-reserve">/ 120</span><span class="shooter-action"></span></div>`;
    this.banner.className = 'kill-announcement'; this.banner.hidden = true; this.banner.setAttribute('role', 'status');
    this.streakMeter.className = 'streak-meter';
    this.element.append(this.banner, this.streakMeter);
    container.append(this.element);
    this.strike = this.element.querySelector('.shooter-strike')!; this.score = this.element.querySelector('.shooter-record')!;
    this.feed = this.element.querySelector('.shooter-kill-feed')!; this.fireMode = this.element.querySelector('.shooter-fire-mode')!;
    this.timer = this.element.querySelector('.shooter-round')!;
    const menu = this.element.querySelector<HTMLButtonElement>('.shooter-menu-button')!;
    menu.prepend(createElement(ListOrdered)); menu.addEventListener('click', onMenu);
  }
  receive(snapshot: LobbySnapshot): void {
    const seconds = Math.max(0, Math.ceil(((snapshot.match?.endsAt ?? 0) - (snapshot.serverTime ?? 0)) / 1000));
    this.timer.textContent = snapshot.match?.phase === 'playing' ? `FFA / ${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` : '';
    const key = `${snapshot.roomId}:${snapshot.match?.round ?? 0}`;
    if (key !== this.roundKey) { this.roundKey = key; this.seen.clear(); this.initialized = false; this.bannerUntil = 0; }
    const local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId);
    this.strike.textContent = `STREAK ${String(local?.streak ?? 0).padStart(2, '0')}`;
    this.score.textContent = `${local?.kills ?? 0} K / ${local?.deaths ?? 0} D · ${(local?.kills ?? 0) * ELIMINATION_POINTS} PTS`;
    const streak = local?.streak ?? 0, progress = streakProgress(streak);
    this.streakMeter.replaceChildren(...STREAK_TIERS.map(tier => {
      const step = document.createElement('span'); step.textContent = String(tier); step.dataset.reached = String(streak >= tier); return step;
    }));
    this.streakMeter.style.setProperty('--progress', String(progress.progress));
    this.streakMeter.setAttribute('aria-label', `Racha ${streak}. ${progress.next ? `Siguiente hito: ${progress.next}` : 'Todos los hitos alcanzados'}. Recompensas pendientes.`);
    const fresh = (snapshot.killFeed ?? []).filter(entry => !this.seen.has(entry.id));
    if (this.initialized && !local?.dead && snapshot.match?.phase === 'playing') {
      const own = fresh.filter(entry => entry.attackerId === snapshot.localPlayerId).sort((a, b) => b.timestamp - a.timestamp)[0];
      if (own) {
        const heading = document.createElement('strong'), detail = document.createElement('span'), tier = document.createElement('small');
        heading.textContent = `${own.attackerName} KILLED ${own.victimName}`;
        detail.textContent = `+${ELIMINATION_POINTS} · ${streak} KILL STREAK`;
        tier.textContent = STREAK_TIERS.some(value => value === streak) ? `STREAK ${streak} ACHIEVED` : progress.next ? `${progress.next - streak} TO STREAK ${progress.next}` : 'STREAK 12+ ACTIVE';
        this.banner.replaceChildren(heading, detail, tier); this.bannerUntil = performance.now() + 2600;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.banner.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 220 });
      }
    }
    this.seen = new Set((snapshot.killFeed ?? []).map(entry => entry.id)); this.initialized = true;
    if (local?.dead || snapshot.match?.phase !== 'playing') this.bannerUntil = 0;
    const entries = snapshot.killFeed ?? [], ids = entries.map(entry => entry.id).join('|');
    if (ids === this.feedIds) return; this.feedIds = ids;
    this.feed.replaceChildren(...entries.map(entry => {
      const row = document.createElement('li'); row.dataset.killId = entry.id;
      const attacker = document.createElement('span'), action = document.createElement('span'), victim = document.createElement('span');
      attacker.className = victim.className = 'kill-player'; attacker.textContent = attacker.title = entry.attackerName;
      victim.textContent = victim.title = entry.victimName; action.className = 'kill-action'; action.textContent = 'KILLED';
      row.append(attacker, action, victim); row.dataset.region = entry.region; return row;
    }));
  }
  update(player: CharacterController, weapon: Weapon, health: number, dead: boolean): void {
    this.banner.hidden = dead || performance.now() > this.bannerUntil;
    this.fireMode.textContent = weapon.automatic ? 'SDP / AUTO' : 'SDP / SEMI-AUTO';
    this.fireMode.title = 'Fire mode';
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
