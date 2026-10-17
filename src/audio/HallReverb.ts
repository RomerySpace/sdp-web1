/** A decorrelated stereo hall tail, generated once rather than on each voice gesture. */
export function hallImpulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  let seed = 1729;
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel); let filtered = 0;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const t = i / context.sampleRate, damping = .65 + .3 * t / seconds;
      filtered = filtered * damping + (seed / 2147483648) * (1 - damping);
      samples[i] = filtered * Math.exp(-6 * t / seconds) * (1 - Math.exp(-t * 60));
    }
  }
  return impulse;
}
