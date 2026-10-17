import { createElement, Maximize, Minimize, Volume2, VolumeX } from 'lucide';
import { PlayerSettings, settingsLimits, type SettingsState } from '../core/PlayerSettings';
import { fullscreenState, supportsFullscreen, toggleFullscreen } from './Fullscreen';
import { usesTouchControls } from '../input/InputCapabilities';

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
    for (const [key, label] of [['sensitivity', usesTouchControls() ? 'Look sensitivity' : 'Mouse sensitivity'], ['volume', 'Game volume'], ['musicVolume', 'Music volume']] as const) {
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
    this.fullscreen.addEventListener('click', () => {
      status.hidden = true;
      toggleFullscreen(message => { status.textContent = message; status.hidden = false; });
    }, { signal });
    tools.append(this.mute, this.fullscreen); this.element.append(tools, status);
    document.addEventListener('fullscreenchange', () => this.updateFullscreen(), { signal });
    document.addEventListener('webkitfullscreenchange', () => this.updateFullscreen(), { signal });
    for (const display of ['standalone', 'fullscreen']) matchMedia(`(display-mode: ${display})`).addEventListener('change', () => this.updateFullscreen(), { signal });
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
    const { active, installed } = fullscreenState(), touch = usesTouchControls();
    this.fullscreen.title = installed ? 'Fullscreen app' : `${active ? 'Exit' : 'Enter'} fullscreen${touch ? '' : ' (F)'}`;
    this.fullscreen.setAttribute('aria-label', installed ? 'Fullscreen app' : active ? 'Exit fullscreen' : 'Enter fullscreen');
    this.fullscreen.setAttribute('aria-pressed', String(active));
    const label = document.createElement('span'); label.textContent = touch && !active && !supportsFullscreen() ? 'ADD TO HOME SCREEN' : 'FULLSCREEN';
    const key = document.createElement('kbd'); key.textContent = 'F';
    this.fullscreen.replaceChildren(createElement(active && !installed ? Minimize : Maximize), label, ...(touch ? [] : [key]));
  }
  dispose(): void { this.events.abort(); this.unsubscribe(); this.element.remove(); }
}
