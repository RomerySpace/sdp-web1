import { createElement, Maximize, Minimize, Volume2, VolumeX } from 'lucide';
import { PlayerSettings, settingsLimits, type SettingsState } from '../core/PlayerSettings';
import { toggleFullscreen } from './Fullscreen';

export class SettingsPanel {
  readonly element = document.createElement('section');
  private readonly events = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly inputs = new Map<'sensitivity' | 'volume' | 'musicVolume', HTMLInputElement>();
  private readonly mute: HTMLButtonElement;
  private readonly fullscreen: HTMLButtonElement;
  constructor(settings: PlayerSettings, prefix: string) {
    this.element.className = 'session-settings'; this.element.setAttribute('aria-label', 'Experience settings');
    this.element.innerHTML = `<h2>SETTINGS</h2>`;
    const signal = this.events.signal;
    for (const [key, label] of [['sensitivity', 'Mouse sensitivity'], ['volume', 'Game volume'], ['musicVolume', 'Music volume']] as const) {
      const id = `${prefix}-${key === 'musicVolume' ? 'music-volume' : key}`;
      const row = document.createElement('label'); row.htmlFor = id;
      row.append(document.createTextNode(label.toUpperCase()));
      const output = document.createElement('output'); output.htmlFor = id; row.append(output);
      const input = document.createElement('input'); input.id = id; input.type = 'range'; input.setAttribute('aria-label', label);
      const limit = settingsLimits[key]; input.min = String(limit.min); input.max = String(limit.max); input.step = String(limit.step);
      input.addEventListener('input', () => settings.set(key, Number(input.value)), { signal });
      this.inputs.set(key, input); this.element.append(row, input);
    }
    const tools = document.createElement('div'); tools.className = 'session-tools';
    this.mute = document.createElement('button'); this.mute.className = 'session-mute icon-button'; this.mute.type = 'button';
    this.mute.addEventListener('click', () => settings.toggleMute(), { signal });
    this.fullscreen = document.createElement('button'); this.fullscreen.className = 'session-fullscreen'; this.fullscreen.type = 'button';
    const status = document.createElement('p'); status.className = 'settings-status'; status.setAttribute('role', 'status'); status.hidden = true;
    this.fullscreen.addEventListener('click', () => toggleFullscreen(() => {
      status.textContent = 'Fullscreen unavailable in this browser window.'; status.hidden = false;
    }), { signal });
    tools.append(this.mute, this.fullscreen); this.element.append(tools, status);
    document.addEventListener('fullscreenchange', () => this.updateFullscreen(), { signal });
    this.updateFullscreen(); this.unsubscribe = settings.subscribe(state => this.update(state));
  }
  private update(state: Readonly<SettingsState>): void {
    for (const [key, input] of this.inputs) {
      input.value = String(state[key]);
      this.element.querySelector(`output[for="${input.id}"]`)!.textContent = key === 'sensitivity' ? `${state[key].toFixed(2)}x` : `${Math.round(state[key] * 100)}%`;
    }
    this.mute.setAttribute('aria-pressed', String(state.muted));
    this.mute.title = state.muted ? 'Unmute audio' : 'Mute audio'; this.mute.setAttribute('aria-label', this.mute.title);
    this.mute.replaceChildren(createElement(state.muted ? VolumeX : Volume2));
  }
  private updateFullscreen(): void {
    const active = Boolean(document.fullscreenElement);
    this.fullscreen.disabled = !document.fullscreenEnabled;
    this.fullscreen.title = document.fullscreenEnabled ? `${active ? 'Exit' : 'Enter'} fullscreen (F)` : 'Fullscreen unavailable';
    this.fullscreen.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    this.fullscreen.setAttribute('aria-pressed', String(active));
    const label = document.createElement('span'); label.textContent = 'FULLSCREEN';
    const key = document.createElement('kbd'); key.textContent = 'F';
    this.fullscreen.replaceChildren(createElement(active ? Minimize : Maximize), label, key);
  }
  dispose(): void { this.events.abort(); this.unsubscribe(); this.element.remove(); }
}
