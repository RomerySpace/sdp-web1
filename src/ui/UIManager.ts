import type { ExperienceState } from '../core/ExperienceState';
import { ChatInterface } from './ChatInterface';
import { ControlsOverlay } from './ControlsOverlay';
import { IntroScreen } from './IntroScreen';
import { ConnectionIndicator } from './ConnectionIndicator';
import { InspectionControls } from './InspectionControls';
import { Armchair, createElement } from 'lucide';

interface UIActions {
  enter(name?: string): void;
  resume(): void;
  submit(text: string): void;
  inspect(): void;
  closeInspection(): void;
  menu(): void;
  closeChat(): void;
  visitor(): void;
  seat(): void;
}

export class UIManager {
  readonly element: HTMLElement;
  readonly intro: IntroScreen;
  readonly chat: ChatInterface;
  readonly controls: ControlsOverlay;
  readonly connection: ConnectionIndicator;
  readonly inspection: InspectionControls;
  private readonly pause: HTMLElement;
  private readonly notice: HTMLElement;
  private noticeTimer = 0;
  private hudHidden = false;
  private readonly visitorName: HTMLElement;
  readonly bench = document.createElement('button');
  get isHudHidden(): boolean { return this.hudHidden; }

  constructor(container: HTMLElement, actions: UIActions, limited: boolean, savedName = '') {
    this.element = document.createElement('div');
    this.element.className = 'ui';
    this.element.dataset.state = 'INTRO';
    this.element.innerHTML = `

      <div class="top-controls" aria-label="Multiplayer status"></div>
      <div class="crosshair" aria-hidden="true"></div>
      <div class="pause-prompt" hidden>
        <p>THE SPACE IS STILL HERE</p>
        <button class="resume-button" type="button">CLICK TO RESUME <span aria-hidden="true">↗</span></button>
        <span class="pause-hint">Cursor released · Take your time</span>
      </div>
      <p class="ui-notice" role="status"></p>
      <button class="visitor-focus" type="button" hidden title="Visitor options (E)"></button>

    `;
    this.pause = this.element.querySelector('.pause-prompt')!;
    this.notice = this.element.querySelector('.ui-notice')!;
    this.visitorName = this.element.querySelector('.visitor-focus')!;
    this.visitorName.addEventListener('click', actions.visitor);
    this.bench.className = 'bench-interaction'; this.bench.type = 'button'; this.bench.hidden = true;
    this.bench.innerHTML = '<kbd>E</kbd><span>SIT</span>'; this.bench.prepend(createElement(Armchair));
    this.bench.setAttribute('aria-keyshortcuts', 'E'); this.bench.addEventListener('click', actions.seat); this.element.append(this.bench);
    this.connection = new ConnectionIndicator(this.element.querySelector('.top-controls')!);
    this.inspection = new InspectionControls(this.element, actions.inspect, actions.closeInspection);
    if (limited) { this.inspection.inspect.setAttribute('aria-label', 'Inspect sculpture'); this.inspection.inspect.querySelector('span')!.textContent = 'INSPECT'; }
    this.element.querySelector('.resume-button')!.addEventListener('click', actions.resume);
    this.intro = new IntroScreen(this.element, actions.enter, limited, savedName);
    this.chat = new ChatInterface(this.element, actions.submit, actions.closeChat);
    this.controls = new ControlsOverlay(this.element, limited, actions.menu);
    container.append(this.element);
  }

  toggleHud(): void {
    this.hudHidden = !this.hudHidden;
    this.element.parentElement?.classList.toggle('lobby-hud-hidden', this.hudHidden);
  }

  setState(state: ExperienceState): void {
    this.element.dataset.state = state;
    if (state === 'ENTERING') this.intro.hide();
    this.pause.hidden = state !== 'PAUSED';
    this.chat.setOpen(state === 'CHATTING');
    if (state !== 'EXPLORING') this.focusVisitor();
  }
  focusVisitor(name?: string): void {
    if (this.visitorName.textContent !== (name || '')) this.visitorName.textContent = name || '';
    this.visitorName.hidden = !name;
  }
  seating(available: boolean, seated: boolean, occupied = false): void {
    this.bench.hidden = !available; this.bench.disabled = occupied;
    this.bench.querySelector('span')!.textContent = occupied ? 'OCCUPIED' : seated ? 'STAND UP' : 'SIT';
    this.bench.setAttribute('aria-label', occupied ? 'Bench occupied' : seated ? 'Stand up' : 'Sit on bench'); this.bench.title = occupied ? 'Bench occupied' : seated ? 'Stand up (E)' : 'Sit on bench (E)';
  }

  notify(message: string): void {
    window.clearTimeout(this.noticeTimer);
    this.notice.textContent = message;
    this.notice.classList.add('is-visible');
    this.noticeTimer = window.setTimeout(() => this.notice.classList.remove('is-visible'), 7000);
  }

  dispose(): void { this.element.parentElement?.classList.remove('lobby-hud-hidden'); this.controls.dispose(); window.clearTimeout(this.noticeTimer); this.chat.dispose(); this.element.remove(); }
}
