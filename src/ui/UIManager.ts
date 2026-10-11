import type { ExperienceState } from '../core/ExperienceState';
import { ChatInterface } from './ChatInterface';
import { ControlsOverlay } from './ControlsOverlay';
import { IntroScreen } from './IntroScreen';
import { ConnectionIndicator } from './ConnectionIndicator';
import { InspectionControls } from './InspectionControls';

const soundIcon = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-mute" d="m16 9 5 6m0-6-5 6"/></svg>`;
const fullscreenIcon = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path class="fullscreen-expand" d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><path class="fullscreen-contract" d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/></svg>`;

interface UIActions {
  enter(): void;
  resume(): void;
  submit(text: string): void;
  toggleAudio(): boolean;
  volume(value: number): void;
  fullscreen(): void;
  inspect(): void;
  closeInspection(): void;
}

export class UIManager {
  readonly element: HTMLElement;
  readonly intro: IntroScreen;
  readonly chat: ChatInterface;
  readonly controls: ControlsOverlay;
  readonly connection: ConnectionIndicator;
  readonly inspection: InspectionControls;
  private readonly pause: HTMLElement;
  private readonly audioButton: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private noticeTimer = 0;

  constructor(container: HTMLElement, actions: UIActions, limited: boolean, muted: boolean) {
    this.element = document.createElement('div');
    this.element.className = 'ui';
    this.element.dataset.state = 'INTRO';
    this.element.innerHTML = `
      <header class="exhibition-mark" aria-label="SDP infinite exhibition"><span>SDP</span><span>INFINITE EXHIBITION</span></header>
      <nav class="top-controls" aria-label="Experience settings">
        <div class="audio-control">
          <button class="icon-button audio-button" type="button" aria-label="Mute ambient sound" aria-pressed="false">${soundIcon}</button>
          <label class="volume-control"><span>AMBIENCE</span><input type="range" min="0" max="1" step="0.05" value="0.5" aria-label="Ambient volume" /></label>
        </div>
        <button class="icon-button fullscreen-button" type="button" aria-label="Enter fullscreen" aria-pressed="false">${fullscreenIcon}</button>
      </nav>
      <div class="crosshair" aria-hidden="true"></div>
      <div class="pause-prompt" hidden>
        <p>THE SPACE IS STILL HERE</p>
        <button class="resume-button" type="button">CLICK TO RESUME <span aria-hidden="true">↗</span></button>
        <span class="pause-hint">Cursor released · Take your time</span>
      </div>
      <p class="ui-notice" role="status"></p>
      <div class="exhibit-caption"><span>UNTITLED — 001</span><span>A STUDY IN LIGHT &amp; PRESENCE</span></div>
    `;
    this.audioButton = this.element.querySelector('.audio-button')!;
    this.fullscreenButton = this.element.querySelector('.fullscreen-button')!;
    this.pause = this.element.querySelector('.pause-prompt')!;
    this.notice = this.element.querySelector('.ui-notice')!;
    this.connection = new ConnectionIndicator(this.element.querySelector('.top-controls')!);
    this.inspection = new InspectionControls(this.element, actions.inspect, actions.closeInspection);
    this.audioButton.addEventListener('click', () => this.setMuted(actions.toggleAudio()));
    this.element.querySelector<HTMLInputElement>('input[type="range"]')!.addEventListener('input', (event) => {
      actions.volume(Number((event.target as HTMLInputElement).value));
    });
    this.fullscreenButton.addEventListener('click', actions.fullscreen);
    this.element.querySelector('.resume-button')!.addEventListener('click', actions.resume);
    this.intro = new IntroScreen(this.element, actions.enter, limited);
    this.chat = new ChatInterface(this.element, actions.submit);
    this.controls = new ControlsOverlay(this.element, limited);
    this.setMuted(muted);
    if (!document.fullscreenEnabled) this.fullscreenButton.hidden = true;
    container.append(this.element);
  }

  setState(state: ExperienceState): void {
    this.element.dataset.state = state;
    if (state === 'ENTERING') this.intro.hide();
    this.pause.hidden = state !== 'PAUSED';
    this.chat.setOpen(state === 'CHATTING');
  }

  setMuted(muted: boolean): void {
    this.audioButton.classList.toggle('is-muted', muted);
    this.audioButton.setAttribute('aria-pressed', String(muted));
    this.audioButton.setAttribute('aria-label', muted ? 'Unmute ambient sound' : 'Mute ambient sound');
    this.audioButton.title = muted ? 'Unmute ambience' : 'Mute ambience';
  }

  setFullscreen(fullscreen: boolean): void {
    this.fullscreenButton.classList.toggle('is-fullscreen', fullscreen);
    this.fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
    this.fullscreenButton.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  }

  notify(message: string): void {
    window.clearTimeout(this.noticeTimer);
    this.notice.textContent = message;
    this.notice.classList.add('is-visible');
    this.noticeTimer = window.setTimeout(() => this.notice.classList.remove('is-visible'), 7000);
  }

  dispose(): void { window.clearTimeout(this.noticeTimer); this.chat.dispose(); this.element.remove(); }
}
