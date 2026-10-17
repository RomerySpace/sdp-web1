import { PlayerSettings } from '../core/PlayerSettings';
import { SettingsPanel } from './SettingsPanel';
import { usesTouchControls } from '../input/InputCapabilities';

export class SettingsMenu {
  readonly element = document.createElement('section');
  private readonly panel: SettingsPanel;
  private readonly events = new AbortController();
  private readonly hudCheckbox: HTMLInputElement;
  constructor(container: HTMLElement, settings: PlayerSettings, close: () => void, private readonly hud: { hidden(): boolean; toggle(): void }) {
    this.element.className = 'settings-overlay'; this.element.hidden = true;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Limbo settings');
    this.element.innerHTML = `<div class="protocol-content"><span class="protocol-mark">SDP</span><div class="settings-slot"></div>
      <button class="settings-close" type="button">RETURN <kbd>P</kbd></button></div>`;
    this.panel = new SettingsPanel(settings, 'limbo'); this.element.querySelector('.settings-slot')!.append(this.panel.element);
    const row = document.createElement('label'); row.className = 'hud-setting';
    row.innerHTML = '<span>HIDE HUD</span><kbd>H</kbd>';
    this.hudCheckbox = document.createElement('input'); this.hudCheckbox.type = 'checkbox'; this.hudCheckbox.setAttribute('aria-label', 'Hide HUD');
    row.append(this.hudCheckbox);
    const hint = document.createElement('p'); hint.className = 'hud-setting-hint';
    hint.textContent = usesTouchControls() ? 'DOUBLE TAP TO OPEN MENU WHEN HUD IS HIDDEN' : 'P MENU / H HUD';
    this.panel.element.append(row, hint);
    const signal = this.events.signal;
    this.hudCheckbox.addEventListener('change', () => { this.hud.toggle(); this.hudCheckbox.checked = this.hud.hidden(); }, { signal });
    this.element.querySelector('.settings-close')!.addEventListener('click', close, { signal });
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>('button,input')].filter(control => !control.disabled);
      const index = controls.indexOf(document.activeElement as HTMLInputElement);
      event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }, { signal });
    container.append(this.element);
  }
  get visible(): boolean { return !this.element.hidden; }
  open(): void { this.hudCheckbox.checked = this.hud.hidden(); this.element.hidden = false; this.element.querySelector<HTMLButtonElement>('.settings-close')!.focus(); }
  hide(): void {
    if (document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement)) document.activeElement.blur();
    this.element.hidden = true;
  }
  dispose(): void { this.events.abort(); this.panel.dispose(); this.element.remove(); }
}
