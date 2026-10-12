export class ModeInterface {
  readonly element = document.createElement('section');
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly join: HTMLButtonElement;
  private readonly resume: HTMLButtonElement;
  private readonly back: HTMLButtonElement;
  private readonly testJoin = document.createElement('button');
  private readonly progress: HTMLProgressElement;
  private readonly haze = document.createElement('div');
  private readonly events = new AbortController();
  constructor(container: HTMLElement, actions: { join(): void; back(): void; resume(): void }) {
    this.element.className = 'mode-overlay'; this.element.hidden = true;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'protocol-title');
    this.element.innerHTML = `<div class="protocol-content"><span class="protocol-mark">SDP</span>
      <h1 id="protocol-title">SHOOTER PROTOCOL</h1><p class="protocol-status" role="status"></p>
      <progress aria-label="Simulation initialization"></progress>
      <button class="protocol-join" type="button">RETRY</button>
      <button class="protocol-resume" type="button">RESUME</button>
      <button class="protocol-back" type="button">RETURN TO LIMBO</button></div>`;
    this.title = this.element.querySelector('h1')!; this.message = this.element.querySelector('p')!;
    this.join = this.element.querySelector('.protocol-join')!; this.resume = this.element.querySelector('.protocol-resume')!;
    this.back = this.element.querySelector('.protocol-back')!;
    this.progress = this.element.querySelector('progress')!;
    const signal = this.events.signal;
    this.join.addEventListener('click', actions.join, { signal }); this.back.addEventListener('click', actions.back, { signal });
    this.resume.addEventListener('click', actions.resume, { signal });
    this.testJoin.className = 'shooter-test-join'; this.testJoin.type = 'button'; this.testJoin.textContent = 'JOIN SHOOTER TEST'; this.testJoin.hidden = true;
    this.testJoin.addEventListener('click', actions.join, { signal });
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden && !button.disabled);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }, { signal });
    this.haze.className = 'mode-haze'; this.haze.setAttribute('aria-hidden', 'true');
    container.append(this.haze, this.element, this.testJoin);
  }
  private show(title: string, text: string, state: 'loading' | 'paused' | 'error'): void {
    this.title.textContent = title; this.message.textContent = text;
    this.element.hidden = false; this.element.dataset.phase = state;
    this.progress.hidden = state !== 'loading'; this.join.hidden = state !== 'error';
    this.resume.hidden = state !== 'paused'; this.testJoin.hidden = true;
  }
  inspection(visible: boolean): void { this.testJoin.hidden = !visible; }
  loading(text: string): void { this.show('INITIALIZING SIMULATION', text, 'loading'); }
  pause(ready = false): void { this.show('SHOOTER PROTOCOL', '', 'paused'); this.resume.textContent = ready ? 'ENTER SIMULATION' : 'RESUME'; this.resume.focus(); }
  error(text: string): void { this.show('SIMULATION UNAVAILABLE', text, 'error'); this.join.focus(); }
  hide(): void { this.element.hidden = true; }
  setHaze(value: number): void { this.haze.style.opacity = String(value); }
  dispose(): void { this.events.abort(); this.element.remove(); this.haze.remove(); this.testJoin.remove(); }
}
