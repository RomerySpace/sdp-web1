import { createElement, Volume2, VolumeX } from 'lucide';
import type { LobbySnapshot } from '../../../../shared/MultiplayerProtocol';
import { PlayerSettings, settingsLimits, type SettingsState } from '../../../core/PlayerSettings';
import { sessionRanking } from './SessionRanking';
export class ShooterMenu {
  readonly element = document.createElement('div');
  private readonly rows: HTMLTableSectionElement;
  private readonly population: HTMLElement;
  private readonly sensitivity: HTMLInputElement;
  private readonly volume: HTMLInputElement;
  private readonly mute: HTMLButtonElement;
  private readonly events = new AbortController();
  private readonly unsubscribe: () => void;
  private signature = '';
  constructor(settings: PlayerSettings) {
    this.element.className = 'shooter-session'; this.element.hidden = true;
    this.element.innerHTML = `<section class="session-ranking" aria-label="Session ranking">
      <header><h2>SESSION RANKING</h2><span class="session-population"></span></header>
      <div class="session-table-scroll"><table aria-label="Room scores"><thead><tr>
        <th scope="col" aria-label="Rank">#</th><th scope="col">PLAYER</th><th scope="col">KILLS</th><th scope="col">DEATHS</th><th scope="col">STRIKE</th>
      </tr></thead><tbody></tbody></table></div></section>
      <section class="session-settings" aria-label="Game settings"><h2>SETTINGS</h2>
        <label for="session-sensitivity">MOUSE SENSITIVITY <output for="session-sensitivity"></output></label>
        <input id="session-sensitivity" type="range" aria-label="Mouse sensitivity" />
        <label for="session-volume">GAME VOLUME <output for="session-volume"></output></label>
        <div class="session-volume-row"><input id="session-volume" type="range" aria-label="Game volume" />
          <button class="session-mute icon-button" type="button" aria-pressed="false"></button></div>
      </section>`;
    this.rows = this.element.querySelector('tbody')!; this.population = this.element.querySelector('.session-population')!;
    this.sensitivity = this.element.querySelector('#session-sensitivity')!; this.volume = this.element.querySelector('#session-volume')!;
    this.mute = this.element.querySelector('button')!;
    const signal = this.events.signal;
    for (const [key, input] of [['sensitivity', this.sensitivity], ['volume', this.volume]] as const) {
      const limit = settingsLimits[key]; input.min = String(limit.min); input.max = String(limit.max); input.step = String(limit.step);
      input.addEventListener('input', () => settings.set(key, Number(input.value)), { signal });
    }
    this.mute.addEventListener('click', () => settings.toggleMute(), { signal });
    this.unsubscribe = settings.subscribe(state => this.settings(state));
  }
  private settings(state: Readonly<SettingsState>): void {
    this.sensitivity.value = String(state.sensitivity); this.volume.value = String(state.volume);
    this.element.querySelector('output[for="session-sensitivity"]')!.textContent = `${state.sensitivity.toFixed(2)}x`;
    this.element.querySelector('output[for="session-volume"]')!.textContent = `${Math.round(state.volume * 100)}%`;
    this.mute.setAttribute('aria-pressed', String(state.muted));
    this.mute.title = state.muted ? 'Unmute game sound' : 'Mute game sound'; this.mute.setAttribute('aria-label', this.mute.title);
    this.mute.replaceChildren(createElement(state.muted ? VolumeX : Volume2));
  }
  update(snapshot?: LobbySnapshot): void {
    if (!snapshot || this.element.hidden || this.element.closest('[hidden]')) return;
    const ranked = sessionRanking(snapshot.players);
    const signature = JSON.stringify([snapshot.roomId, snapshot.localPlayerId, ranked.map(p => [p.playerId, p.displayName, p.kills, p.deaths, p.streak, p.dead])]);
    if (signature === this.signature) return; this.signature = signature;
    this.population.textContent = `${ranked.length} ONLINE`;
    this.rows.replaceChildren(...ranked.map((player, index) => {
      const row = document.createElement('tr'); row.dataset.playerId = player.playerId;
      row.dataset.local = String(player.playerId === snapshot.localPlayerId); row.dataset.dead = String(!!player.dead);
      for (const value of [index + 1, player.displayName || 'PLAYER', player.kills ?? 0, player.deaths ?? 0, player.streak ?? 0]) {
        const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
      }
      row.cells[1].title = player.displayName || 'PLAYER'; return row;
    }));
  }
  dispose(): void { this.events.abort(); this.unsubscribe(); this.element.remove(); }
}
