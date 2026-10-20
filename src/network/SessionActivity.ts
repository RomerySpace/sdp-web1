import type { ColyseusNetworkAdapter } from './ColyseusNetworkAdapter';
import { sessionPolicy } from '../../shared/SessionPolicy';

export class SessionActivity {
  private readonly events = new AbortController();
  private readonly overlay = document.createElement('section');
  private readonly unsubscribe: () => void;
  private sentAt = -Infinity;
  constructor(container: HTMLElement, private readonly network: ColyseusNetworkAdapter, onInactive: () => void) {
    this.overlay.className = 'session-idle-overlay'; this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'alertdialog'); this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'session-idle-title');
    this.overlay.innerHTML = `<div class="protocol-content"><span class="protocol-mark">SDP</span><h1 id="session-idle-title">SESSION DISCONNECTED</h1><p>Inactive for 5 minutes.</p><button type="button">REJOIN</button></div>`;
    const signal = this.events.signal, button = this.overlay.querySelector('button')!;
    button.addEventListener('click', () => location.reload(), { signal });
    container.append(this.overlay);
    for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove']) {
      window.addEventListener(name, event => { if (event.isTrusted && !document.hidden) this.mark(); }, { signal, passive: true, capture: true });
    }
    this.unsubscribe = network.subscribeToStatus(status => {
      if (status.reason !== 'inactive' || !this.overlay.hidden) return;
      onInactive(); this.overlay.hidden = false; button.focus();
    });
  }
  mark(): void {
    const now = performance.now();
    if (!this.overlay.hidden || this.network.status.state !== 'connected' || now - this.sentAt < sessionPolicy.activityIntervalMs) return;
    this.sentAt = now; this.network.sendActivity();
  }
  dispose(): void { this.events.abort(); this.unsubscribe(); this.overlay.remove(); }
}
