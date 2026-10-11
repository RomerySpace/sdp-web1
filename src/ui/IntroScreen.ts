export class IntroScreen {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;

  constructor(container: HTMLElement, onEnter: () => void, limited: boolean) {
    this.element = document.createElement('section');
    this.element.className = 'intro';
    this.element.setAttribute('aria-label', 'Enter the exhibition');
    this.element.innerHTML = `
      <div class="intro-composition">
        <h1>SDP</h1>
        <p class="intro-subtitle">PROTOTYPE <span>—</span> LOCAL TEST</p>
        <button class="enter-button" type="button" disabled>
          <span class="enter-rule" aria-hidden="true"></span>
          <span class="enter-label">PREPARING THE LIGHT</span>
          <span class="enter-rule" aria-hidden="true"></span>
        </button>
      </div>
      <p class="intro-caption">INFINITE EXHIBITION SPACE</p>
    `;
    this.button = this.element.querySelector('button')!;
    this.button.addEventListener('click', onEnter);
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
}
