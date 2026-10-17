import { createElement, Crosshair, Focus, ArrowUp, ChevronsUp, PersonStanding, RotateCw, Repeat2, Mic, MessageSquare, Settings2, Flashlight } from 'lucide';
import type { VoiceState } from '../audio/VoiceChatManager';
import type { VoiceConnectionState } from '../audio/LiveKitVoiceTransport';
import { touchConfig } from '../input/InputCapabilities';
import '../styles/touch.css';

export type TouchAction = 'fire' | 'aim' | 'jump' | 'crouch' | 'sprint' | 'reload' | 'mode' | 'flashlight' | 'voice' | 'chat' | 'menu';
type Context = 'hidden' | 'limbo' | 'inspection' | 'shooter' | 'dead';
interface Actions { move(forward: number, side: number): void; look(dx: number, dy: number): void; action(action: TouchAction, active: boolean): void; reset(): void }
interface Contact { kind: 'move' | 'look' | 'hold'; element: HTMLElement; x: number; y: number; action?: TouchAction }

export class TouchControls {
  readonly element = document.createElement('aside');
  private readonly events = new AbortController();
  private readonly contacts = new Map<number, Contact>();
  private readonly buttons = new Map<TouchAction, HTMLButtonElement>();
  private readonly thumb: HTMLElement;
  private readonly voiceNote: HTMLElement;
  private readonly toggled = new Set<TouchAction>();
  private signature = '';
  private context: Context = 'hidden';
  constructor(container: HTMLElement, private readonly actions: Actions) {
    this.element.className = 'touch-controls'; this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Touch controls');
    this.element.innerHTML = `<div class="touch-look" aria-label="Look area"></div>
      <div class="touch-stick" role="group" aria-label="Movement joystick"><span class="touch-stick-thumb"></span></div>
      <div class="touch-tools"></div><span class="touch-voice-note" role="status"></span>`;
    this.thumb = this.element.querySelector('.touch-stick-thumb')!; this.voiceNote = this.element.querySelector('.touch-voice-note')!;
    const signal = this.events.signal;
    this.element.querySelector<HTMLElement>('.touch-stick')!.addEventListener('pointerdown', e => this.start(e, 'move'), { signal });
    this.element.querySelector<HTMLElement>('.touch-look')!.addEventListener('pointerdown', e => this.start(e, 'look'), { signal });
    for (const [action, icon, label, behavior] of [
      ['fire', Crosshair, 'Fire weapon', 'hold'], ['aim', Focus, 'Aim down sights', 'toggle'],
      ['jump', ArrowUp, 'Jump', 'tap'], ['crouch', PersonStanding, 'Crouch', 'toggle'],
      ['sprint', ChevronsUp, 'Sprint', 'toggle'], ['reload', RotateCw, 'Reload weapon', 'tap'],
      ['mode', Repeat2, 'Switch fire mode', 'tap'], ['voice', Mic, 'Hold to talk', 'hold'],
      ['flashlight', Flashlight, 'Toggle flashlight', 'tap'],
      ['chat', MessageSquare, 'Open chat', 'tap'], ['menu', Settings2, 'Open game menu', 'tap'],
    ] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `touch-button touch-${action}`;
      button.setAttribute('aria-label', label); button.title = label; button.append(createElement(icon));
      if (behavior === 'toggle' || behavior === 'hold') button.setAttribute('aria-pressed', 'false');
      if (action === 'mode') { const label = document.createElement('span'); label.className = 'touch-mode-label'; label.textContent = 'SEMI'; button.append(label); }
      if (action === 'voice') button.setAttribute('aria-describedby', 'touch-voice-state');
      if (behavior === 'hold') button.addEventListener('pointerdown', e => this.start(e, 'hold', action), { signal });
      else button.addEventListener('click', () => {
        if (!this.available(action)) return;
        if (behavior === 'toggle') {
          const active = !this.toggled.has(action); if (active) this.toggled.add(action); else this.toggled.delete(action);
          button.setAttribute('aria-pressed', String(active)); this.actions.action(action, active);
        } else { this.actions.action(action, true); this.actions.action(action, false); }
      }, { signal });
      button.addEventListener('lostpointercapture', e => this.end(e.pointerId), { signal });
      this.buttons.set(action, button);
      if (action === 'voice' || action === 'chat' || action === 'menu' || action === 'flashlight') this.element.querySelector('.touch-tools')!.append(button);
      else this.element.append(button);
    }
    this.voiceNote.id = 'touch-voice-state';
    window.addEventListener('pointermove', e => this.move(e), { signal, passive: false });
    for (const event of ['pointerup', 'pointercancel'] as const) window.addEventListener(event, e => this.end(e.pointerId), { signal });
    this.element.addEventListener('lostpointercapture', e => this.end(e.pointerId), { signal });
    window.addEventListener('blur', () => this.reset(), { signal });
    window.addEventListener('orientationchange', () => this.reset(), { signal });
    window.addEventListener('resize', () => this.reset(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); }, { signal });
    container.append(this.element);
  }
  private available(action?: TouchAction): boolean {
    if (this.context === 'hidden') return false;
    if (action === 'menu' || action === 'chat') return true;
    if (action === 'voice') return this.context === 'limbo' || this.context === 'inspection';
    return this.context === 'limbo' || this.context === 'shooter';
  }
  private start(event: PointerEvent, kind: Contact['kind'], action?: TouchAction): void {
    if (!['touch', 'pen'].includes(event.pointerType) || !this.available(action) ||
      (kind !== 'hold' && this.context === 'inspection') || (kind === 'move' && [...this.contacts.values()].some(c => c.kind === 'move')) ||
      (kind === 'look' && [...this.contacts.values()].some(c => c.kind === 'look')) ||
      (action && [...this.contacts.values()].some(c => c.action === action))) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    this.contacts.set(event.pointerId, { kind, element, action, x: event.clientX, y: event.clientY });
    element.setPointerCapture(event.pointerId);
    if (kind === 'move') this.joystick(event, element);
    if (action) { element.setAttribute('aria-pressed', 'true'); this.actions.action(action, true); }
  }
  private move(event: PointerEvent): void {
    const contact = this.contacts.get(event.pointerId); if (!contact) return;
    event.preventDefault();
    if (contact.kind === 'move') this.joystick(event, contact.element);
    else if (contact.kind === 'look' || contact.action === 'fire') this.actions.look(event.clientX - contact.x, event.clientY - contact.y);
    contact.x = event.clientX; contact.y = event.clientY;
  }
  private joystick(event: PointerEvent, element: HTMLElement): void {
    const rect = element.getBoundingClientRect(), radius = rect.width * touchConfig.stickTravel;
    let x = (event.clientX - rect.x - rect.width / 2) / radius, y = (event.clientY - rect.y - rect.height / 2) / radius;
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    this.thumb.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    const amplitude = length < touchConfig.deadZone ? 0 : Math.min(1, (length - touchConfig.deadZone) / (1 - touchConfig.deadZone));
    const scale = length ? amplitude / Math.min(1, length) : 0;
    this.actions.move(Math.round(-y * scale * 100) / 100, Math.round(x * scale * 100) / 100);
  }
  private end(id: number): void {
    const contact = this.contacts.get(id); if (!contact) return;
    this.contacts.delete(id);
    if (contact.kind === 'move') { this.actions.move(0, 0); this.thumb.style.transform = 'translate(0px, 0px)'; }
    if (contact.action) { contact.element.setAttribute('aria-pressed', 'false'); this.actions.action(contact.action, false); }
    if (contact.element.hasPointerCapture(id)) contact.element.releasePointerCapture(id);
  }
  reset(): void {
    for (const id of [...this.contacts.keys()]) this.end(id);
    for (const action of this.toggled) { this.buttons.get(action)!.setAttribute('aria-pressed', 'false'); this.actions.action(action, false); }
    this.toggled.clear(); this.actions.reset();
  }
  update(context: Context, epoch: string, automatic = false, flashlight = false): void {
    const signature = `${context}:${epoch}`;
    if (signature !== this.signature) {
      this.reset(); this.signature = signature; this.context = context;
      this.element.dataset.context = context; this.element.hidden = context === 'hidden';
    }
    const label = this.element.querySelector('.touch-mode-label')!;
    if (label.textContent !== (automatic ? 'AUTO' : 'SEMI')) label.textContent = automatic ? 'AUTO' : 'SEMI';
    this.buttons.get('flashlight')!.setAttribute('aria-pressed', String(flashlight));
  }
  voice(state: VoiceState, connection: VoiceConnectionState): void {
    this.element.dataset.voice = state;
    const labels: Record<VoiceState, string> = { idle: 'MIC NOT AUTHORIZED', requesting: 'MIC REQUESTING', ready: 'MIC READY', speaking: 'TRANSMITTING', denied: 'MIC BLOCKED', unavailable: 'MIC UNAVAILABLE' };
    this.voiceNote.textContent = state === 'denied' || state === 'requesting' || state === 'speaking' ? labels[state] : `VOICE ${connection.toUpperCase()} / ${labels[state]}`;
  }
  dispose(): void { this.reset(); this.events.abort(); this.element.remove(); }
}
