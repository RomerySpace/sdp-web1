export function rampGain(gain: AudioParam, target: number, time: number, duration = .05): void {
  if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(time);
  else gain.cancelScheduledValues(time);
  // Anchor even an idle node: a ramp alone has no explicit starting event.
  gain.setValueAtTime(gain.value, time);
  gain.linearRampToValueAtTime(target, time + duration);
}
