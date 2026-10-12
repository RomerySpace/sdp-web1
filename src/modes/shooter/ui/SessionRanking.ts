import type { NetworkPlayer } from '../../../../shared/MultiplayerProtocol';
export function sessionRanking(players: readonly NetworkPlayer[]): NetworkPlayer[] {
  return players.filter(player => player.connected).sort((a, b) =>
    (b.kills ?? 0) - (a.kills ?? 0) || (a.deaths ?? 0) - (b.deaths ?? 0) || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
}
