import type { ChatMessage } from '../chat/ChatTypes';
import { createElement, Send, X } from 'lucide';

export class ChatInterface {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly history: HTMLElement;
  private readonly form: HTMLFormElement;
  private fadeTimer = 0;
  private readonly events = new AbortController();

  constructor(container: HTMLElement, onSubmit: (text: string) => void, onClose: () => void) {
    this.element = document.createElement('section');
    this.element.className = 'chat';
    this.element.setAttribute('aria-label', 'Room text chat');
    this.element.innerHTML = `
      <div class="chat-history" role="log" aria-live="polite" aria-label="Chat messages"></div>
      <form class="chat-form" hidden autocomplete="off">
        <label for="chat-input">YOU</label>
        <input id="chat-input" name="message" type="text" placeholder="Say something into the space…" maxlength="500" aria-label="Chat message" autocomplete="off" />
        <span class="chat-input-hint" aria-hidden="true">↵</span>
        <button class="chat-send" type="submit" aria-label="Send message" title="Send message"></button>
        <button class="chat-close" type="button" aria-label="Close chat" title="Close chat"></button>
      </form>
      <p class="chat-note" hidden>Room chat <span>·</span> Enter to send <span>·</span> Esc to close</p>
    `;
    this.input = this.element.querySelector('input')!;
    this.history = this.element.querySelector('.chat-history')!;
    this.form = this.element.querySelector('form')!;
    this.element.querySelector('.chat-send')!.append(createElement(Send));
    this.element.querySelector('.chat-close')!.append(createElement(X));
    this.element.querySelector('.chat-close')!.addEventListener('click', onClose, { signal: this.events.signal });
    const viewport = () => {
      const view = window.visualViewport;
      this.element.style.setProperty('--chat-bottom', `${Math.max(18, view ? window.innerHeight - view.height - view.offsetTop + 18 : 18)}px`);
    };
    window.visualViewport?.addEventListener('resize', viewport, { signal: this.events.signal });
    window.visualViewport?.addEventListener('scroll', viewport, { signal: this.events.signal }); viewport();
    this.form.addEventListener('submit', (event) => { event.preventDefault(); onSubmit(this.input.value); });
    container.append(this.element);
  }

  setOpen(open: boolean): void {
    this.form.hidden = !open;
    this.element.querySelector<HTMLElement>('.chat-note')!.hidden = !open;
    this.element.classList.toggle('is-open', open);
    if (open) { window.clearTimeout(this.fadeTimer); this.element.classList.add('show-history'); this.input.focus(); }
    else { this.input.blur(); this.scheduleFade(); }
  }

  add(message: ChatMessage): void {
    const row = document.createElement('p');
    row.className = 'chat-message';
    const name = document.createElement('span');
    name.className = 'chat-sender';
    name.textContent = `${message.senderName}:`;
    row.append(name, document.createTextNode(` ${message.message}`));
    this.history.append(row);
    while (this.history.children.length > 5) this.history.firstElementChild?.remove();
    this.history.scrollTop = this.history.scrollHeight;
    this.element.classList.add('show-history');
    this.scheduleFade();
  }

  clear(): void { this.input.value = ''; }
  reset(): void { this.clear(); this.history.replaceChildren(); this.element.classList.remove('show-history'); }
  private scheduleFade(): void {
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => this.element.classList.remove('show-history'), 14000);
  }
  dispose(): void { window.clearTimeout(this.fadeTimer); this.events.abort(); }
}
