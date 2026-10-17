import type { VoiceMode } from '../core/PlayerSettings';
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
  private captureGeneration = 0;
  private disposed = false;
  private granted = false;
  private state: VoiceState = 'idle';
  private readonly listeners = new Set<(state: VoiceState) => void>();
  private permission?: PermissionStatus;
  private mode: VoiceMode = 'hold';

  setMode(mode: VoiceMode): void { if (mode !== this.mode) { this.release(); this.mode = mode; } }
  async activate(): Promise<void> {
    if (this.mode === 'toggle' && this.held) this.release();
    else await this.press();
  }
  deactivate(): void { if (this.mode === 'hold') this.release(); }

  constructor(private readonly transport?: SpatialVoiceTransport) {
    void navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((permission) => {
      if (this.disposed) return;
      this.permission = permission;
      const update = () => {
        this.granted = permission.state === 'granted';
        if (permission.state === 'denied') { this.suspend(); this.setState('denied'); }
        else if (!this.requesting && !this.stream && ['idle', 'ready', 'denied'].includes(this.state)) this.setState(this.granted ? 'ready' : 'idle');
      };
      permission.onchange = update; update();
    }).catch(() => {});
  }

  async press(): Promise<void> {
    if (this.disposed) return;
    this.held = true;
    if (this.requesting) return;
    if (this.stream) {
      this.transport?.setSpeaking(true); this.setState('speaking'); return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { this.held = false; this.setState('unavailable'); return; }
    this.requesting = true;
    const generation = ++this.captureGeneration;
    this.setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
      this.granted = true;
      if (this.disposed || generation !== this.captureGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      stream.getAudioTracks().forEach(track => { track.enabled = false; });
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (this.stream === stream) { this.suspend(); this.setState('unavailable'); }
        }, { once: true });
      }
      await this.transport?.setLocalStream(stream);
      if (this.disposed || generation !== this.captureGeneration || this.stream !== stream) {
        stream.getTracks().forEach((track) => track.stop());
        if (!this.disposed) this.setState(this.granted ? 'ready' : 'idle');
        return;
      }
      this.transport?.setSpeaking(this.held);
      this.setState(this.held ? 'speaking' : 'ready');
    } catch (error) {
      if (this.disposed || generation !== this.captureGeneration) return;
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
    this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
    this.transport?.setSpeaking(false);
    // Keep pending permission visible until capture is ready, with its track disabled.
    if (this.state === 'speaking' || (this.state === 'requesting' && !this.requesting)) this.setState(this.granted ? 'ready' : 'idle');
  }

  suspend(): void {
    ++this.captureGeneration; this.release();
    const stream = this.stream; this.stream = null;
    stream?.getTracks().forEach(track => track.stop());
    void this.transport?.setLocalStream(null).catch(() => {});
    if (!this.disposed) this.setState(this.granted ? 'ready' : 'idle');
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
    this.disposed = true; this.suspend(); this.listeners.clear();
    if (this.permission) this.permission.onchange = null;
    this.transport?.dispose();
  }
}
