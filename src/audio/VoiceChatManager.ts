export type VoiceState = 'idle' | 'requesting' | 'ready' | 'speaking' | 'denied' | 'unavailable';

export interface SpatialVoiceTransport {
  setLocalStream(stream: MediaStream | null): Promise<void>;
  setSpeaking(speaking: boolean): void;
  dispose(): void;
}

export class VoiceChatManager {
  private stream: MediaStream | null = null;
  private held = false;
  private requesting = false;
  private disposed = false;
  private granted = false;
  private state: VoiceState = 'idle';
  private readonly listeners = new Set<(state: VoiceState) => void>();
  private permission?: PermissionStatus;

  constructor(private readonly transport?: SpatialVoiceTransport) {
    void navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((permission) => {
      if (this.disposed) return;
      this.permission = permission;
      const update = () => {
        this.granted = permission.state === 'granted';
        if (permission.state === 'denied') { this.release(); this.setState('denied'); }
        else if (!this.requesting && !this.stream && ['idle', 'ready', 'denied'].includes(this.state)) this.setState(this.granted ? 'ready' : 'idle');
      };
      permission.onchange = update; update();
    }).catch(() => {});
  }

  async press(): Promise<void> {
    if (this.disposed) return;
    this.held = true;
    if (this.requesting || this.stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { this.held = false; this.setState('unavailable'); return; }
    this.requesting = true;
    this.setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
      this.granted = true;
      if (this.disposed || !this.held) {
        stream.getTracks().forEach((track) => track.stop());
        if (!this.disposed) this.setState('ready');
        return;
      }
      this.stream = stream;
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (this.stream === stream) { this.release(); this.setState('unavailable'); }
        }, { once: true });
      }
      await this.transport?.setLocalStream(stream);
      if (this.disposed || !this.held || this.stream !== stream) {
        stream.getTracks().forEach((track) => track.stop());
        if (!this.disposed) this.setState(this.granted ? 'ready' : 'idle');
        return;
      }
      this.transport?.setSpeaking(true);
      this.setState('speaking');
    } catch (error) {
      if (this.disposed) return;
      this.held = false;
      this.transport?.setSpeaking(false);
      void this.transport?.setLocalStream(null).catch(() => {});
      this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null;
      const denied = error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name);
      this.setState(denied ? 'denied' : 'unavailable');
    } finally { this.requesting = false; }
  }

  release(): void {
    this.held = false;
    this.transport?.setSpeaking(false);
    void this.transport?.setLocalStream(null).catch(() => {});
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach((track) => track.stop());
    // Keep a pending permission request visible until its stream has actually
    // arrived and been discarded; permission alone is not a completed capture.
    if (this.state === 'speaking' || (this.state === 'requesting' && !this.requesting)) this.setState(this.granted ? 'ready' : 'idle');
  }

  subscribe(listener: (state: VoiceState) => void): () => void {
    this.listeners.add(listener); listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(state: VoiceState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  dispose(): void {
    this.disposed = true; this.release(); this.listeners.clear();
    if (this.permission) this.permission.onchange = null;
    this.transport?.dispose();
  }
}
