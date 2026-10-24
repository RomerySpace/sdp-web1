import type { ColyseusNetworkAdapter } from './ColyseusNetworkAdapter';
import { sessionPolicy } from '../../shared/SessionPolicy';
import { admissionConfig } from '../../shared/Admission';

export class SessionActivity {
  private readonly events = new AbortController();
  private readonly overlay = document.createElement('section');
  private readonly unsubscribe: () => void;
  private sentAt = -Infinity;
  private reservationUntil = 0;
  private queuePosition: number | undefined;
  private expired = false;
  private readonly timer: number;
  private readonly inert = new Map<HTMLElement, boolean>();
  constructor(container: HTMLElement, private readonly network: ColyseusNetworkAdapter, onInactive: () => void, onInterrupted: () => void = () => {}) {
    this.overlay.className = 'session-idle-overlay'; this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'alertdialog'); this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'session-idle-title');
    this.overlay.innerHTML = `<div class="protocol-content"><span class="protocol-mark">SDP</span><h1 id="session-idle-title">SESSION DISCONNECTED</h1><p class="session-disconnect-message"></p><p class="session-reservation" role="timer" aria-live="off" hidden></p><button type="button">REJOIN</button></div>`;
    const title = this.overlay.querySelector('h1')!, message = this.overlay.querySelector('.session-disconnect-message')!;
    const signal = this.events.signal, button = this.overlay.querySelector('button')!;
    button.addEventListener('click', () => location.reload(), { signal });
    container.append(this.overlay);
    window.addEventListener('keydown', event => {
      if (this.overlay.hidden) return;
      event.stopImmediatePropagation();
      if (event.code !== 'Enter' && event.code !== 'Space') { event.preventDefault(); button.focus({ preventScroll: true }); }
    }, { signal, capture: true });
    for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove']) {
      window.addEventListener(name, event => { if (event.isTrusted && !document.hidden) this.mark(); }, { signal, passive: true, capture: true });
    }
    this.unsubscribe = network.subscribeToStatus(status => {
      if (status.reason === 'inactive') {
        if (this.expired) return;
        this.expired = true; this.reservationUntil = 0;
        onInactive(); title.textContent = 'SESSION DISCONNECTED';
        message.textContent = 'You were disconnected after 5 minutes of inactivity. Rejoin to return to SDP.';
        this.overlay.querySelector<HTMLElement>('.session-reservation')!.hidden = true;
        button.textContent = 'REJOIN'; this.show(container, button); this.updateTimer(); return;
      }
      if (this.expired) return;
      if (status.state === 'connected') {
        this.reservationUntil = 0; this.queuePosition = undefined; this.overlay.hidden = true;
        for (const [element, value] of this.inert) element.inert = value;
        this.inert.clear(); return;
      }
      if (status.reason === 'reconnecting' && this.overlay.hidden) {
        this.reservationUntil = Date.now() + admissionConfig.reservationSeconds * 1000;
        onInterrupted(); button.textContent = 'RELOAD SESSION'; this.show(container, button);
      }
      if (!this.overlay.hidden) {
        this.queuePosition = status.queuePosition;
        title.textContent = status.queuePosition ? 'WAITING FOR A PLACE' : 'CONNECTION INTERRUPTED';
        if (status.queuePosition) this.reservationUntil = 0;
        this.updateTimer();
      }
    });
    this.timer = window.setInterval(() => this.updateTimer(), 500);
    document.addEventListener('visibilitychange', () => this.updateTimer(), { signal });
    window.addEventListener('online', () => this.updateTimer(), { signal });
    window.addEventListener('offline', () => this.updateTimer(), { signal });
  }
  private show(container: HTMLElement, button: HTMLButtonElement): void {
    for (const element of container.children) if (element instanceof HTMLElement && element !== this.overlay && !this.inert.has(element)) {
      this.inert.set(element, element.inert); element.inert = true;
    }
    this.overlay.hidden = false; button.focus({ preventScroll: true });
  }
  private updateTimer(): void {
    if (this.overlay.hidden || this.expired) return;
    const message = this.overlay.querySelector('.session-disconnect-message')!;
    const seconds = Math.max(0, Math.ceil((this.reservationUntil - Date.now()) / 1000));
    if (!navigator.onLine) message.textContent = 'You are offline. Reconnection will continue automatically when your connection returns.';
    else if (this.queuePosition) message.textContent = `Your previous reservation ended. You are ${this.queuePosition} in the queue. Entry is automatic.`;
    else if (this.queuePosition === 0) message.textContent = 'Your place is ready. Entering the simulation.';
    else if (seconds) message.textContent = 'Reconnecting automatically. Your place is reserved for up to 2 minutes. You do not need to reload.';
    else message.textContent = 'Your reserved place has expired. Reconnecting when a place is available.';
    const timer = this.overlay.querySelector<HTMLElement>('.session-reservation')!;
    timer.hidden = !this.reservationUntil || this.overlay.hidden;
    if (timer.hidden) return;
    timer.textContent = seconds ? `PLACE RESERVED · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'RESERVATION ENDED · RECONNECTING';
  }
  mark(): void {
    const now = performance.now();
    if (!this.overlay.hidden || this.network.status.state !== 'connected' || now - this.sentAt < sessionPolicy.activityIntervalMs) return;
    this.sentAt = now; this.network.sendActivity();
  }
  dispose(): void {
    this.events.abort(); this.unsubscribe(); window.clearInterval(this.timer);
    for (const [element, value] of this.inert) element.inert = value;
    this.inert.clear(); this.overlay.remove();
  }
}
