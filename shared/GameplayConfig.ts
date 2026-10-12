// Shared by browser and server. Disabling this also rejects direct room joins.
export const ENABLE_SHOOTER_TEST: boolean = true;
export const gameplayConfig = {
  combat: { maxHealth: 100, damage: 50, fireInterval: .14, range: 220,
    respawnDelay: 3, spawnProtection: 1.25, maxRewind: .2, interpolationDelay: .07,
    magazineSize: 30, reserveAmmo: 120, reloadDuration: 2.2 },
  death: { duration: 1.35, fragmentCount: 48, dissolutionSpeed: 1, particleOpacity: .55, reconstructionDuration: .7 },
  damage: { impulse: .12, vignetteDuration: .8, vignetteOpacity: .48 },
  limbo: { sprintMultiplier: 1.5, sprintAcceleration: 7, walkAcceleration: 7, deceleration: 10, sprintFovAdjustment: 2 },
};
