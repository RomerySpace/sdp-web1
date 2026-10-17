let context: AudioContext | undefined;
let gestures: AbortController | undefined;
export function sharedAudioContext(): AudioContext {
  if (!context || context.state === 'closed') {
    // Keep a duplex session instead of renegotiating the output route on each V press.
    try { const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession; if (session) session.type = 'play-and-record'; } catch {}
    gestures?.abort(); context = new AudioContext({ latencyHint: 'interactive' }); gestures = new AbortController();
    const resume = () => {
      if (context && context.state !== 'running' && !document.hidden) void context.resume().catch(() => {});
    };
    // Mobile browsers may interrupt audio after backgrounding; the next gesture unlocks the same context.
    for (const event of ['pointerdown', 'pointerup', 'keydown', 'click']) document.addEventListener(event, resume, { signal: gestures.signal, capture: true });
  }
  return context;
}
export function disposeAudioContext(): void { gestures?.abort(); gestures = undefined; const previous = context; context = undefined; void previous?.close().catch(() => {}); }
