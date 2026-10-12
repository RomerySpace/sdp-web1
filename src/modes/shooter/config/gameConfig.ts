import { gameplayConfig } from '../../../../shared/GameplayConfig';
/** Metres, seconds and radians. Source map nodes already include inch to metre transforms. */
export const gameConfig = {
  physics: { timestep: 1 / 60, maxSubsteps: 8 },
  assets: { map: '/shooter/MAP/dust2plainmap.glb', weapon: '/SDP/SDPv1.glb', hdr: '/hdr/puresky.exr' },
  map: { scale: 1, batchSize: 24, colliderTriangleLimit: 16000 },
  player: {
    walkSpeed: 3.8, sprintSpeed: 6, crouchSpeed: 2, acceleration: 23, deceleration: 27,
    airControl: 0.22, gravity: -9.81, jumpHeight: 1, height: 1.8, crouchHeight: 1.16,
    eyeHeight: 1.7, crouchEyeHeight: 1.05, radius: 0.3, mass: 75,
    mouseSensitivity: 0.0017, stepHeight: 0.32, maxSlope: 48, groundProbe: 0.065,
    coyoteTime: 0.08, crouchDuration: 0.2, adsSpeedMultiplier: 0.73,
    // Startup checks full capsule clearance and supporting floor near this seed.
    spawn: { x: 45, y: 6.53, z: -20, yaw: 0.6 },
  },
  camera: {
    baseFov: 74, sprintFov: 77, adsFov: 55, bobAmplitude: 0.018, bobFrequency: 1.7,
    inertia: 0.012, landingResponse: 0.019, strafeRoll: 0.012,
    springStiffness: 160, springDamping: 24, fovResponse: 12,
  },
  weapon: {
    // Single sculptural mesh with its longest dimension along Z. Uniform scaling only.
    length: 0.64, scale: 1,
    modelRotation: { x: 0, y: Math.PI, z: 0 }, // Imported muzzle points +Z; camera forward is −Z.
    position: { x: 0.23, y: -0.23, z: -0.58 }, rotation: { x: 0, y: 0, z: -0.08 },
    sprintPosition: { x: 0.18, y: -0.34, z: -0.49 },
    adsPosition: { x: 0, y: -0.14, z: -0.58 }, adsRotation: { x: 0, y: 0, z: 0 },
    mouseSway: 0.07, movementSway: 0.014, accelerationInertia: 0.0025,
    springStiffness: 130, springDamping: 20, recoil: 1, cameraRecoil: 0.35,
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
