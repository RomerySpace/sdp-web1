let context: AudioContext | undefined;
export function sharedAudioContext(): AudioContext {
  if (!context || context.state === 'closed') context = new AudioContext();
  return context;
}
export function disposeAudioContext(): void { const previous = context; context = undefined; void previous?.close().catch(() => {}); }
