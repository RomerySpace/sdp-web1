import type { VoiceState } from '../audio/VoiceChatManager';
import type { VoiceConnectionState } from '../audio/LiveKitVoiceTransport';

const voiceLabels: Record<VoiceState, string> = {
  idle: 'MIC NOT AUTHORIZED',
  requesting: 'Waiting for microphone permission…',
  ready: 'MIC READY',
  speaking: 'TRANSMITTING',
  denied: 'Microphone blocked · Check browser permissions',
  unavailable: 'Microphone unavailable',
};

export class ControlsOverlay {
  readonly element: HTMLElement;
  private readonly voiceStatus: HTMLElement;
  private microphone: VoiceState = 'idle';
  private connection: VoiceConnectionState = 'disconnected';

  constructor(container: HTMLElement, limited: boolean) {
    this.element = document.createElement('aside');
    this.element.className = 'controls-overlay';
    this.element.setAttribute('aria-label', 'Exhibition controls');
    this.element.innerHTML = limited ? '<p class="viewing-note">VIEWING MODE · DESKTOP REQUIRED TO EXPLORE</p>' : `
      <div class="control-row"><span class="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span></div>
      <div class="control-row"><kbd class="wide-key">ENTER</kbd><span>Chat</span></div>
      <div class="control-row"><span class="wide-key key-label">HOLD V</span><span>Voice</span><span class="mic-dot" aria-hidden="true"></span></div>
      <div class="control-row escape-row"><kbd class="wide-key">ESC</kbd><span>Release cursor</span></div>
    `;
    this.voiceStatus = document.createElement('p');
    this.voiceStatus.className = 'voice-status';
    this.voiceStatus.setAttribute('role', 'status');
    this.voiceStatus.textContent = voiceLabels.idle;
    this.element.append(this.voiceStatus);
    container.append(this.element);
  }

  setVoiceState(state: VoiceState): void {
    this.microphone = state;
    this.element.dataset.voice = state;
    this.updateVoiceLabel();
  }

  setVoiceConnection(state: VoiceConnectionState): void {
    this.connection = state;
    this.element.dataset.voiceConnection = state;
    this.updateVoiceLabel();
  }

  private updateVoiceLabel(): void {
    this.voiceStatus.textContent = `VOICE ${this.connection.toUpperCase()} · ${voiceLabels[this.microphone]}`;
  }
}
