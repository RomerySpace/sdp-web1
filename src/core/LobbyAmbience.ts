export const lobbyAmbience = {
  music: { height: 14, fullRadius: 3, fadeRadius: 45, distantGain: .22, smoothing: .25,
    reverbSeconds: 8.5, preDelay: .065, dry: .46, wet: .9,
    syncTolerance: .12, maxRateCorrection: .025, hardSeekThreshold: 8 },
  monolith: { fadeStart: 12, fadeEnd: 65 },
  floorReflectance: .95,
  voice: { silentOpacity: .68, speakingOpacity: .96, noiseFloor: .008, fullLevel: .12 },
} as const;
