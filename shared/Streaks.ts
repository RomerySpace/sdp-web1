export const STREAK_TIERS = [3, 7, 12] as const;
export const ELIMINATION_POINTS = 100;
export function streakProgress(streak: number) {
  const next = STREAK_TIERS.find(tier => tier > streak);
  const previous = [...STREAK_TIERS].reverse().find(tier => tier <= streak) ?? 0;
  return { next, previous, progress: next ? (streak - previous) / (next - previous) : 1 };
}
