import { createElement, Search, X } from 'lucide';

export class InspectionControls {
  readonly inspect = document.createElement('button');
  readonly close = document.createElement('button');

  constructor(container: HTMLElement, onInspect: () => void, onClose: () => void) {
    this.inspect.type = this.close.type = 'button';
    this.inspect.className = 'icon-button inspect-button';
    this.close.className = 'icon-button inspection-close';
    this.inspect.setAttribute('aria-label', 'Interact with sculpture');
    this.close.setAttribute('aria-label', 'Close inspection');
    this.inspect.title = 'Interact with sculpture (E)';
    this.close.title = 'Close inspection (E / Esc)';
    this.inspect.setAttribute('aria-keyshortcuts', 'E');
    this.close.setAttribute('aria-keyshortcuts', 'E Escape');
    for (const [button, icon, label] of [[this.inspect, Search, 'INTERACT'], [this.close, X, 'RETURN']] as const) {
      const key = document.createElement('kbd');
      key.textContent = 'E';
      const caption = document.createElement('span');
      caption.textContent = label;
      button.append(createElement(icon), key, caption);
    }
    this.inspect.hidden = this.close.hidden = true;
    this.inspect.addEventListener('click', onInspect);
    this.close.addEventListener('click', onClose);
    container.append(this.inspect, this.close);
  }

  update(available: boolean, active: boolean): void {
    this.inspect.hidden = !available || active;
    this.close.hidden = !active;
  }
}
