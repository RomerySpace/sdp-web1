export class ModeInterface {
  readonly element = document.createElement('section');
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly join: HTMLButtonElement;
  private readonly resume: HTMLButtonElement;
  private readonly back: HTMLButtonElement;
  private readonly inspectionActions = document.createElement('div');
  private readonly auction = document.createElement('button');
  private readonly testJoin = document.createElement('button');
  private readonly progress: HTMLProgressElement;
  private readonly haze = document.createElement('div');
  private readonly restart: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly countdownProgress: HTMLProgressElement;
  private readonly events = new AbortController();
  private session?: HTMLElement;
  constructor(container: HTMLElement, actions: { join(): void; back(): void; resume(): void }) {
    this.element.className = 'mode-overlay'; this.element.hidden = true;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'protocol-title');
    this.element.innerHTML = `<div class="protocol-content"><span class="protocol-mark">SDP</span>
      <h1 id="protocol-title">SHOOTER PROTOCOL</h1><p class="protocol-status" role="status"></p>
      <div class="round-restart" hidden><span class="round-restart-label">NEXT ROUND</span><strong class="round-countdown" role="timer"></strong><span class="round-restart-note">STARTS AUTOMATICALLY</span><progress class="round-countdown-progress" aria-label="Time until next round"></progress></div>
      <div class="protocol-session-slot"></div>
      <progress aria-label="Simulation initialization"></progress>
      <button class="protocol-join" type="button">RETRY</button>
      <button class="protocol-resume" type="button">RESUME</button>
      <button class="protocol-back" type="button">RETURN TO LIMBO</button></div>`;
    this.title = this.element.querySelector('h1')!; this.message = this.element.querySelector('p')!;
    this.join = this.element.querySelector('.protocol-join')!; this.resume = this.element.querySelector('.protocol-resume')!;
    this.back = this.element.querySelector('.protocol-back')!;
    this.progress = this.element.querySelector('progress[aria-label="Simulation initialization"]')!;
    this.restart = this.element.querySelector('.round-restart')!;
    this.countdown = this.element.querySelector('.round-countdown')!;
    this.countdownProgress = this.element.querySelector('.round-countdown-progress')!;
    const signal = this.events.signal;
    this.join.addEventListener('click', actions.join, { signal }); this.back.addEventListener('click', actions.back, { signal });
    this.resume.addEventListener('click', actions.resume, { signal });
    this.testJoin.className = 'shooter-test-join'; this.testJoin.type = 'button'; this.testJoin.textContent = 'JOIN SHOOTER'; this.testJoin.hidden = true;
    this.testJoin.addEventListener('click', actions.join, { signal });
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>('button,input')]
        .filter(control => !control.disabled && control.getClientRects().length > 0);
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }, { signal });
    this.haze.className = 'mode-haze'; this.haze.setAttribute('aria-hidden', 'true');
    this.inspectionActions.className = 'inspection-actions'; this.inspectionActions.hidden = true;
    this.auction.type = 'button'; this.auction.className = 'auction-join'; this.auction.textContent = 'JOIN SUBASTA';
    this.auction.disabled = true; this.auction.title = 'Próximamente'; this.auction.setAttribute('aria-label', 'JOIN SUBASTA — próximamente');
    this.inspectionActions.append(this.testJoin, this.auction);
    container.append(this.haze, this.element, this.inspectionActions);
  }
  private show(title: string, text: string, state: 'loading' | 'paused' | 'error' | 'results'): void {
    this.title.textContent = title; this.message.textContent = text;
    this.element.hidden = false; this.element.dataset.phase = state;
    this.element.classList.remove('has-session'); if (this.session) this.session.hidden = true;
    this.progress.hidden = state !== 'loading'; this.join.hidden = state !== 'error';
    this.restart.hidden = state !== 'results';
    this.resume.hidden = state !== 'paused'; this.inspectionActions.hidden = true;
    this.back.hidden = false;
  }
  inspection(visible: boolean): void { this.inspectionActions.hidden = !visible; this.testJoin.hidden = !visible; }
  loading(text: string): void {
    const returning = text === 'Returning to Limbo';
    this.show(returning ? 'RETURNING TO LIMBO' : 'INITIALIZING SIMULATION', text, 'loading');
    this.back.hidden = returning;
  }
  attachSession(element?: HTMLElement): void {
    this.session = element; this.element.querySelector('.protocol-session-slot')!.replaceChildren(...element ? [element] : []);
  }
  pause(ready = false): void {
    this.show(ready ? 'SHOOTER PROTOCOL' : 'SESSION', '', 'paused');
    if (this.session && !ready) { this.session.hidden = false; this.element.classList.add('has-session'); }
    this.resume.textContent = ready ? 'ENTER SIMULATION' : 'RESUME'; this.resume.focus();
  }
  results(seconds: number, duration: number): void {
    const text = 'A NEW ROUND STARTS AUTOMATICALLY';
    this.countdown.textContent = seconds > 0 ? `${seconds}s` : 'STARTING';
    this.countdown.setAttribute('aria-label', seconds > 0 ? `Next round in ${seconds} seconds` : 'Next round starting');
    this.countdownProgress.max = duration; this.countdownProgress.value = Math.max(0, seconds);
    if (!this.element.hidden && this.element.dataset.phase === 'results') {
      if (this.message.textContent !== text) this.message.textContent = text;
      return;
    }
    this.show('ROUND COMPLETE', text, 'results');
    if (this.session) { this.session.hidden = false; this.element.classList.add('has-session'); }
    this.back.focus();
  }
  error(text: string): void { this.show('SIMULATION UNAVAILABLE', text, 'error'); this.join.focus(); }
  hide(): void {
    if (document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement)) document.activeElement.blur();
    this.element.hidden = true;
  }
  setHaze(value: number): void { this.haze.style.opacity = String(value); }
  dispose(): void { this.events.abort(); this.element.remove(); this.haze.remove(); this.inspectionActions.remove(); }
}
