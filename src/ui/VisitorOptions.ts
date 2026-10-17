import { createElement, X } from 'lucide';
import { VisitorPreferences } from '../core/VisitorPreferences';

export class VisitorOptions {
  readonly element = document.createElement('section');
  private readonly events = new AbortController();
  private selected?: string;
  private connected: { id: string; name: string }[] = [];
  constructor(container: HTMLElement, private readonly preferences: VisitorPreferences, private readonly changed: () => void, close: () => void) {
    this.element.className = 'visitor-options'; this.element.hidden = true; this.element.tabIndex = -1;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true'); this.element.setAttribute('aria-label', 'Visitor options');
    this.element.innerHTML = `<div class="visitor-content"><header><button class="visitor-back" type="button">VISITORS</button><button class="visitor-close" type="button" aria-label="Close visitor options" title="Close"></button></header><div class="visitor-body"></div></div>`;
    this.element.querySelector('.visitor-close')!.append(createElement(X));
    this.element.querySelector('.visitor-close')!.addEventListener('click', close, { signal: this.events.signal });
    this.element.querySelector('.visitor-back')!.addEventListener('click', () => { this.selected = undefined; this.render(); }, { signal: this.events.signal });
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...this.element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
      const index = controls.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault(); controls[next]?.focus();
    }, { signal: this.events.signal });
    container.append(this.element);
  }
  get visible(): boolean { return !this.element.hidden; }
  update(connected: { id: string; name: string }[]): void {
    if (!this.visible || JSON.stringify(connected) === JSON.stringify(this.connected)) return;
    this.connected = connected;
    for (const visitor of connected) if (this.preferences.get(visitor.id)) this.preferences.remember(visitor.id, visitor.name);
    this.render();
  }
  open(connected: { id: string; name: string }[], selected?: string): void {
    this.connected = connected; this.selected = selected;
    for (const visitor of connected) if (this.preferences.get(visitor.id) || visitor.id === selected) this.preferences.remember(visitor.id, visitor.name);
    this.render(); this.element.hidden = false; this.element.focus({ preventScroll: true });
  }
  private render(): void {
    const body = this.element.querySelector<HTMLElement>('.visitor-body')!; body.replaceChildren();
    const selected = this.selected && this.preferences.get(this.selected);
    if (selected) {
      const heading = document.createElement('h2'); heading.textContent = selected.name; body.append(heading);
      const status = document.createElement('p'); status.className = 'visitor-status';
      status.textContent = this.connected.some(visitor => visitor.id === selected.id) ? 'IN THIS ROOM' : 'OFFLINE'; body.append(status);
      for (const [key, caption] of [['voice', 'Mute voice'], ['messages', 'Hide messages'], ['blocked', 'Block visitor']] as const) {
        const row = document.createElement('label'), text = document.createElement('span'), input = document.createElement('input');
        text.textContent = caption; input.type = 'checkbox'; input.checked = key === 'blocked' ? selected.blocked : selected[key] || selected.blocked;
        input.disabled = selected.blocked && key !== 'blocked';
        input.addEventListener('change', () => { selected[key] = input.checked; this.changed(); this.render(); this.element.querySelector<HTMLInputElement>(`input[data-option="${key}"]`)?.focus(); });
        input.dataset.option = key; row.append(text, input); body.append(row);
      }
      return;
    }
    const visitors = new Map(this.preferences.all.map(visitor => [visitor.id, visitor]));
    for (const visitor of this.connected) visitors.set(visitor.id, { ...visitor, voice: false, messages: false, blocked: false, ...this.preferences.get(visitor.id) });
    if (!visitors.size) { const empty = document.createElement('p'); empty.textContent = 'NO OTHER VISITORS'; body.append(empty); }
    for (const visitor of visitors.values()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'visitor-list-item';
      const name = document.createElement('span'); name.textContent = visitor.name;
      const status = document.createElement('span'); status.textContent = visitor.blocked ? 'BLOCKED' : visitor.voice || visitor.messages ? 'FILTERED' : '';
      button.append(name, status); button.addEventListener('click', () => { this.preferences.remember(visitor.id, visitor.name); this.selected = visitor.id; this.render(); this.element.querySelector<HTMLInputElement>('input')?.focus(); }); body.append(button);
    }
  }
  hide(): void { if (this.element.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur(); this.element.hidden = true; }
  dispose(): void { this.events.abort(); this.element.remove(); }
}
