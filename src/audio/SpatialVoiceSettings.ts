export interface SpatialVoiceSettings { fullDistance: number; maxDistance: number; smoothing: number }

function positive(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const environment = import.meta.env || {};
export const voiceSettings: SpatialVoiceSettings = {
  fullDistance: positive(environment.VITE_VOICE_FULL_DISTANCE, 3),
  maxDistance: positive(environment.VITE_VOICE_MAX_DISTANCE, 15),
  smoothing: 0.06,
};
if (voiceSettings.maxDistance <= voiceSettings.fullDistance) voiceSettings.maxDistance = voiceSettings.fullDistance + 12;

export function proximityGain(distance: number, settings = voiceSettings): number {
  if (distance <= settings.fullDistance) return 1;
  if (distance >= settings.maxDistance) return 0;
  const t = (distance - settings.fullDistance) / (settings.maxDistance - settings.fullDistance);
  return 1 - t * t * (3 - 2 * t);
}
