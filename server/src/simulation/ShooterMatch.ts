import { gameplayConfig } from '../../../shared/GameplayConfig';
import { rankRound, type RoundScore } from '../../../shared/ShooterProtocol';

export class ShooterMatch {
  phase: 'waiting' | 'playing' | 'results' = 'waiting';
  lighting: 'day' | 'night' = 'day';
  round = 0; endsAt = 0; nextRoundAt = 0;
  private readonly departed = new Map<string, RoundScore>();
  constructor(private readonly config = gameplayConfig.match) {}
  start(now: number): void {
    this.lighting = Math.random() < .5 ? 'day' : 'night';
    this.phase = 'playing'; this.round++; this.endsAt = now + this.config.duration * 1000; this.nextRoundAt = 0; this.departed.clear();
  }
  active(now: number): boolean { return this.phase === 'playing' && now < this.endsAt; }
  leave(score: RoundScore): void { if (this.phase === 'playing') this.departed.set(score.playerId, { ...score }); }
  finish(now: number, present: readonly RoundScore[]): RoundScore[] {
    this.phase = 'results'; this.nextRoundAt = now + this.config.resultsDuration * 1000;
    const scores = new Map(this.departed); for (const score of present) scores.set(score.playerId, { ...score });
    return rankRound([...scores.values()]);
  }
  resetEmpty(): void { this.phase = 'waiting'; this.endsAt = this.nextRoundAt = 0; this.departed.clear(); }
}
