export const sessionPolicy = {
  idleMs: 5 * 60 * 1000,
  activityIntervalMs: 10000,
  idleCloseCode: 4001,
} as const;

export const lobbyPrediction = {
  historySize: 160,
  correctionTolerance: .08,
  teleportDistance: 2.5,
  visualResponse: 12,
  maxVisualOffset: .4,
  settledMs: 350,
  stateTimeoutMs: 1500,
} as const;
