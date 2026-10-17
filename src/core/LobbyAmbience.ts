export const lobbyAmbience = {
  music: { height: 14, fullRadius: 3, fadeRadius: 45, distantGain: .22, smoothing: .25,
    reverbSeconds: 8.5, preDelay: .065, dry: .46, wet: .9 },
  monolith: { fadeStart: 12, fadeEnd: 65 },
  floorReflectance: .95,
  voice: { silentOpacity: .68, speakingOpacity: .96, noiseFloor: .008, fullLevel: .12,
    glowIntensity: 2.2, haloOpacity: .38 },
  identity: { distance: 6 },
  rain: { cycleSeconds: 160, clearMin: 35, clearMax: 85, durationMin: 22, durationMax: 40,
    fadeSeconds: 6, drops: 1100, mobileDrops: 450, radius: 22, height: 18,
    fallSpeed: 8, streakLength: .34, width: .014, opacity: .22, wind: .45 },
} as const;
