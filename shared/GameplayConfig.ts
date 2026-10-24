// Shared by browser and server. Disabling this also rejects direct room joins.
export const ENABLE_SHOOTER_TEST: boolean = true;
export const gameplayConfig = {
  match: { duration: 420, resultsDuration: 8 },
  combat: { maxHealth: 100, damage: 50, fireInterval: .14, range: 220,
    regionDamage: { arm: 25, leg: 25, torso: 50, head: 100, foot: 12 },
    regenerationDelay: 7, regenerationRate: 10, automaticFireInterval: .1,
    recoilReset: .26, recoilPitch: .014, recoilGrowth: .0012, recoilYaw: .003,
    recoilRecoveryDelay: .12, recoilRecoveryResponse: 12, recoilRecoveryFraction: .85,
    killFeedDuration: 8, killFeedLimit: 6, eliminationNoticeDuration: 1.8,
    respawnDelay: 3, spawnProtection: 1.25, maxRewind: .2, interpolationDelay: .07,
    magazineSize: 30, reserveAmmo: 120, infiniteReserve: true, reloadDuration: 2.2, fireJitterTolerance: .035 },
  shots: { tracerDuration: .085, tracerOpacity: .65, tracerLength: 9, flashDuration: .055 },
  death: { duration: 1.35, fragmentCount: 48, dissolutionSpeed: 1, particleOpacity: .55, reconstructionDuration: .7 },
  damage: { impulse: .12, vignetteDuration: .8, vignetteOpacity: .48 },
  limbo: { jumpSpeed: 4.7, gravity: 12, crouchHeight: 1.05, sprintMultiplier: 2.25, sprintAcceleration: 7, walkAcceleration: 7, deceleration: 10, sprintFovAdjustment: 2 },
};
