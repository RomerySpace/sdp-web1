import { ArrowUpRight, createElement } from 'lucide';
import { validateDisplayName } from '../../shared/PlayerIdentity';
export class IntroScreen {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;

  private readonly form: HTMLFormElement;
  private readonly name: HTMLInputElement;
  private readonly submit: HTMLButtonElement;
  private readonly message: HTMLElement;
  constructor(container: HTMLElement, onEnter: (name?: string) => void, limited: boolean, savedName = '') {
    this.element = document.createElement('section');
    this.element.className = 'intro';
    this.element.setAttribute('aria-label', 'Enter the exhibition');
    this.element.innerHTML = `
      <div class="intro-composition">
        <div class="intro-identity"><h1>SDP</h1><p class="intro-subtitle">A SHARED PRESENCE</p></div>
        <div class="intro-entry">
        <button class="enter-button" type="button" disabled>
          <span class="enter-label">PREPARING THE LIGHT</span>
          <span class="enter-icon" aria-hidden="true"></span>
        </button>
        <form class="intro-name-form" hidden>
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
    this.form = this.element.querySelector('form')!; this.name = this.element.querySelector('input')!;
    this.submit = this.element.querySelector('.intro-name-submit')!; this.message = this.element.querySelector('.intro-name-message')!;
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
    this.button.disabled = false;
    this.button.querySelector('.enter-label')!.textContent = limited ? 'VIEW EXHIBITION' : 'CLICK TO ENTER';
  }

  hide(): void { this.element.classList.add('is-leaving'); this.element.inert = true; }
  chooseName(): void { this.button.hidden = true; this.form.hidden = false; this.element.classList.add('is-naming'); this.name.focus({ preventScroll: true }); }
  connecting(active: boolean, message = ''): void {
    this.name.disabled = this.submit.disabled = active;
    this.form.setAttribute('aria-busy', String(active));
    this.submit.textContent = active ? 'CONNECTING' : 'ENTER'; this.message.textContent = message;
    if (!active) this.name.focus();
    else this.name.blur();
  }
}
