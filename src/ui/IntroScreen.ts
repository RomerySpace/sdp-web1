import { ArrowUpRight, createElement } from 'lucide';
import { validateDisplayName } from '../../shared/PlayerIdentity';
import type { ServerRegion, ServerRegionId } from '../network/ServerRegions';
export class IntroScreen {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;

  private readonly form: HTMLFormElement;
  private readonly name: HTMLInputElement;
  private readonly submit: HTMLButtonElement;
  private readonly message: HTMLElement;
  private readonly region: HTMLSelectElement;
  constructor(container: HTMLElement, onEnter: (name?: string) => void, limited: boolean, savedName = '') {
    this.element = document.createElement('section');
    this.element.className = 'intro';
    this.element.setAttribute('aria-label', 'Enter the exhibition');
    this.element.innerHTML = `
      <div class="intro-composition">
        <div class="intro-identity"><h1>SDP</h1><p class="intro-subtitle">A SHARED PRESENCE</p></div>
        <div class="intro-entry">
        <div class="intro-loading" role="status"><div class="intro-progress" role="progressbar" aria-label="Preparing the exhibition"><i></i></div><span>PREPARING THE EXHIBITION</span></div>
        <button class="enter-button" type="button" disabled>
          <span class="enter-label">PREPARING THE LIGHT</span>
          <span class="enter-icon" aria-hidden="true"></span>
        </button>
        <form class="intro-name-form" hidden>
          <div class="intro-region-row"><label for="sdp-region">SERVER</label><select id="sdp-region" name="region" aria-label="Server region"></select></div>
          <label for="sdp-username">USERNAME</label>
          <div class="intro-name-row">
            <input id="sdp-username" name="username" type="text" minlength="2" maxlength="20" autocomplete="nickname" spellcheck="false" placeholder="Your name" required aria-describedby="intro-name-message" />
            <button class="intro-name-submit" type="submit">ENTER</button>
          </div>
          <p id="intro-name-message" class="intro-name-message" role="status"></p>
        </form>
        </div>
      </div>
    `;
    this.element.querySelector('.enter-icon')!.append(createElement(ArrowUpRight));
    this.button = this.element.querySelector('button')!;
    this.button.hidden = true;
    this.form = this.element.querySelector('form')!; this.name = this.element.querySelector('input')!;
    this.submit = this.element.querySelector('.intro-name-submit')!; this.message = this.element.querySelector('.intro-name-message')!;
    this.region = this.element.querySelector('select')!;
    this.name.value = savedName;
    this.button.addEventListener('click', () => onEnter());
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const name = validateDisplayName(this.name.value);
      if (!name) { this.message.textContent = '2-20 letters, numbers, spaces, dots or hyphens.'; return; }
      onEnter(name);
    });
    if (limited) {
      const hint = document.createElement('p');
      hint.className = 'device-note';
      hint.textContent = 'Viewing mode · Use a desktop with a mouse to explore.';
      this.element.append(hint);
    }
    container.append(this.element);
  }

  ready(limited: boolean): void {
    this.element.querySelector<HTMLElement>('.intro-loading')!.hidden = true;
    this.button.disabled = false;
    this.button.hidden = false;
    this.button.querySelector('.enter-label')!.textContent = limited ? 'VIEW EXHIBITION' : 'CLICK TO ENTER';
  }

  hide(): void { this.element.classList.add('is-leaving'); this.element.inert = true; }
  configureRegions(regions: readonly ServerRegion[], selected: ServerRegionId, onChange: (id: ServerRegionId) => void): void {
    this.region.replaceChildren(...regions.map(region => {
      const option = document.createElement('option'); option.value = region.id;
      option.textContent = `${region.label}${region.available ? '' : ' (UNAVAILABLE)'}`;
      option.disabled = !region.available; return option;
    }));
    this.region.value = selected;
    this.region.onchange = () => {
      try { onChange(this.region.value as ServerRegionId); selected = this.region.value as ServerRegionId; this.message.textContent = ''; }
      catch (error) { this.region.value = selected; this.message.textContent = error instanceof Error ? error.message : 'Server unavailable.'; }
    };
  }
  chooseName(): void { this.button.hidden = true; this.form.hidden = false; this.element.classList.add('is-naming'); this.name.focus({ preventScroll: true }); }
  connecting(active: boolean, message = ''): void {
    const loading = this.element.querySelector<HTMLElement>('.intro-loading')!;
    loading.hidden = !active;
    loading.querySelector('span')!.textContent = message || 'CONNECTING';
    this.name.disabled = this.submit.disabled = this.region.disabled = active;
    this.form.setAttribute('aria-busy', String(active));
    this.submit.textContent = active ? 'CONNECTING' : 'ENTER'; this.message.textContent = message;
    if (!active) this.name.focus();
    else this.name.blur();
  }
  waiting(position: number): void {
    this.connecting(true, position > 0 ? `WAITING FOR A PLACE · ${position} IN QUEUE` : 'ENTERING THE EXHIBITION');
    this.message.textContent = '';
    this.submit.textContent = position > 0 ? 'WAITING' : 'ENTERING';
  }
}
