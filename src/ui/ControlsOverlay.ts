import type { VoiceState } from '../audio/VoiceChatManager';
import type { VoiceConnectionState } from '../audio/LiveKitVoiceTransport';
import { createElement, Settings2 } from 'lucide';

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
  private resize: ResizeObserver;
  dispose(): void { this.resize.disconnect(); }
  private readonly voiceStatus: HTMLElement;
  private microphone: VoiceState = 'idle';
  private connection: VoiceConnectionState = 'disconnected';

  constructor(container: HTMLElement, limited: boolean, onMenu: () => void) {
    this.element = document.createElement('aside');
    this.element.className = 'controls-overlay';
    this.element.setAttribute('aria-label', 'Exhibition controls');
    this.element.innerHTML = limited ? '<p class="viewing-note">VIEWING MODE · DESKTOP REQUIRED TO EXPLORE</p>' : `
      <div class="control-row"><span class="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span></div>
      <div class="control-row"><kbd class="wide-key">SHIFT</kbd><span>Sprint</span></div>
      <div class="control-row"><kbd class="wide-key">SPACE / CTRL</kbd><span>Jump / Crouch</span></div>
      <div class="control-row"><kbd class="wide-key">ENTER</kbd><span>Chat</span></div>
      <div class="control-row"><span class="wide-key key-label">HOLD V</span><span>Voice</span><span class="mic-dot" aria-hidden="true"></span></div>
      <div class="control-row"><kbd class="wide-key">F</kbd><span>Fullscreen</span></div>
      <div class="control-row"><kbd class="wide-key">H</kbd><span>Ocultar HUD</span></div>
      <div class="control-row escape-row"><kbd class="wide-key">ESC</kbd><span>Release cursor</span></div>
    `;
    const menu = document.createElement('button'); menu.type = 'button'; menu.className = 'control-row menu-row';
    menu.setAttribute('aria-label', 'Open Limbo settings'); menu.title = 'P: settings menu';
    menu.innerHTML = '<kbd class="wide-key">P</kbd><span class="menu-label">Menu</span>';
    menu.querySelector('span')!.prepend(createElement(Settings2)); menu.addEventListener('click', onMenu);
    this.element.append(menu);
    this.voiceStatus = document.createElement('p');
    this.voiceStatus.className = 'voice-status';
    this.voiceStatus.setAttribute('role', 'status');
    this.voiceStatus.textContent = voiceLabels.idle;
    this.element.append(this.voiceStatus);
    container.append(this.element);
    this.resize = new ResizeObserver(() => container.style.setProperty('--controls-height', `${this.element.getBoundingClientRect().height}px`));
    this.resize.observe(this.element);
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
