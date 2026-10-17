import { gameplayConfig } from '../../../../shared/GameplayConfig';
/** Metres, seconds and radians. Source map nodes already include inch to metre transforms. */
export const gameConfig = {
  physics: { timestep: 1 / 60, maxSubsteps: 8 },
  assets: { map: '/shooter/MAP/dust2plainmap.glb', weapon: '/SDP/SDPv1.glb', hdr: '/hdr/puresky.exr' },
  map: { scale: 1, batchSize: 24, colliderTriangleLimit: 16000 },
  player: {
    walkSpeed: 4.3, sprintSpeed: 6.2, crouchSpeed: 2.2, acceleration: 38, deceleration: 34,
    airControl: 0.3, gravity: -20, jumpHeight: 1.14, height: 1.8, crouchHeight: 1.16,
    eyeHeight: 1.7, crouchEyeHeight: 1.05, radius: 0.3, mass: 75,
    mouseSensitivity: 0.0017, stepHeight: 0.38, maxSlope: 48, groundProbe: 0.09,
    coyoteTime: 0.08, crouchDuration: 0.2, adsSpeedMultiplier: 0.73,
    // Authored street/courtyard seeds, not a ray cast from above the rooftops.
    spawn: { x: 38.4, y: 0.06, z: -5.6, yaw: Math.PI },
    spawnSearch: { radius: 3, floorTolerance: 0.65, clearance: 0.06 },
    spawnZones: [
      { x: 50, y: 0.1, z: -50 }, { x: 50, y: 0.04, z: -40 },
      { x: 60, y: 0.18, z: -40 }, { x: 10, y: 0.18, z: -40 },
      { x: 10, y: 0.04, z: -50 }, { x: 10, y: 0.13, z: -10 },
      { x: 40, y: 0.4, z: 0 }, { x: 40, y: 0, z: 10 },
      { x: 20, y: 0.02, z: 20 }, { x: 10, y: 0.04, z: 30 },
    ],
  },
  camera: {
    baseFov: 74, sprintFov: 78, adsFov: 55, bobAmplitude: 0.014, bobFrequency: 1.7,
    inertia: 0.01, landingResponse: 0.014, strafeRoll: 0.012,
    springStiffness: 180, springDamping: 26, fovResponse: 14,
  },
  weapon: {
    // Single sculptural mesh with its longest dimension along Z. Uniform scaling only.
    length: 0.64, scale: 1,
    modelRotation: { x: 0, y: Math.PI, z: 0 }, // Imported muzzle points +Z; camera forward is −Z.
    position: { x: 0.23, y: -0.23, z: -0.58 }, rotation: { x: 0, y: 0, z: -0.08 },
    sprintPosition: { x: 0.18, y: -0.34, z: -0.49 },
    adsPosition: { x: 0, y: -0.14, z: -0.58 }, adsRotation: { x: 0, y: 0, z: 0 },
    mouseSway: 0.06, movementSway: 0.012, accelerationInertia: 0.0018,
    springStiffness: 165, springDamping: 24, recoil: 1, cameraRecoil: 0.35,
    reloadDuration: gameplayConfig.combat.reloadDuration, adsDuration: 0.18, fireInterval: gameplayConfig.combat.fireInterval,
    automatic: false, magazineSize: gameplayConfig.combat.magazineSize, reserveAmmo: gameplayConfig.combat.reserveAmmo, range: gameplayConfig.combat.range,
    obstructionDistance: 0.95, impactLifetime: 1.2, maxImpacts: 24,
  },
  environment: {
    background: '#F8FBFD', fogColor: '#EBF3F8', fogDensity: 0.0125, fogDistance: 220,
    hdrIntensity: 0.65, exposure: 1.03, marbleScale: 1.3, marbleRoughness: 0.36,
    veinStrength: 0.19, shadowIntensity: 0.65, keyIntensity: 2.1, fillIntensity: 0.8,
    contactShading: true, contactStrength: 0.22,
    shadowResolution: 2048, shadowRadius: 30,
  },
  rendering: { maxPixelRatio: 1.5 },
};
