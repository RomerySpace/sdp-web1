import type { LobbySnapshot } from '../../../../shared/MultiplayerProtocol';
import { PlayerSettings } from '../../../core/PlayerSettings';
import { SettingsPanel } from '../../../ui/SettingsPanel';
import { sessionRanking } from './SessionRanking';
import { roundWinners } from '../../../../shared/ShooterProtocol';
export class ShooterMenu {
  readonly element = document.createElement('div');
  private readonly rows: HTMLTableSectionElement;
  private readonly population: HTMLElement;
  private readonly result: HTMLElement;
  private readonly panel: SettingsPanel;
  private signature = '';
  constructor(settings: PlayerSettings) {
    this.element.className = 'shooter-session'; this.element.hidden = true;
    this.element.innerHTML = `<section class="session-ranking" aria-label="Session ranking">
      <header><h2>SESSION RANKING</h2><span class="session-population"></span></header><p class="session-result" hidden></p>
      <div class="session-table-scroll"><table aria-label="Room scores"><thead><tr>
        <th scope="col" aria-label="Rank">#</th><th scope="col">PLAYER</th><th scope="col">KILLS</th><th scope="col">DEATHS</th><th scope="col">STRIKE</th>
      </tr></thead><tbody></tbody></table></div></section>`;
    this.rows = this.element.querySelector('tbody')!; this.population = this.element.querySelector('.session-population')!;
    this.result = this.element.querySelector('.session-result')!;
    this.panel = new SettingsPanel(settings, 'session'); this.element.append(this.panel.element);
  }
  update(snapshot?: LobbySnapshot): void {
    if (!snapshot || this.element.hidden || this.element.closest('[hidden]')) return;
    const finished = snapshot.match?.phase === 'results';
    const ranked = finished ? snapshot.match!.results.map(p => ({ ...p, dead: false })) : sessionRanking(snapshot.players);
    const signature = JSON.stringify([snapshot.roomId, snapshot.localPlayerId, snapshot.match?.round, finished, ranked.map(p => [p.playerId, p.displayName, p.kills, p.deaths, p.streak, p.dead])]);
    if (signature === this.signature) return; this.signature = signature;
    this.population.textContent = `${ranked.length} ${finished ? 'PLAYERS' : 'ONLINE'}`;
    this.element.querySelector('h2')!.textContent = finished ? `ROUND ${snapshot.match!.round} / RESULTS` : 'SESSION RANKING';
    this.result.hidden = !finished;
    const winners = roundWinners(snapshot.match?.results ?? []);
    this.result.textContent = winners.length === 1 ? `WINNER / ${winners[0].displayName}` : 'DRAW'; this.result.title = this.result.textContent;
    this.rows.replaceChildren(...ranked.map((player, index) => {
      const row = document.createElement('tr'); row.dataset.playerId = player.playerId;
      row.dataset.local = String(player.playerId === snapshot.localPlayerId); row.dataset.dead = String(!!player.dead);
      for (const value of [index + 1, player.displayName || 'PLAYER', player.kills ?? 0, player.deaths ?? 0, player.streak ?? 0]) {
        const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
      }
      row.cells[1].title = player.displayName || 'PLAYER'; return row;
    }));
  }
  dispose(): void { this.panel.dispose(); this.element.remove(); }
}
