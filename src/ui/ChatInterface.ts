import type { ChatMessage } from '../chat/ChatTypes';
import { createElement, Send, X } from 'lucide';
import type { RoomInvitation } from '../../shared/SocialProtocol';

export class ChatInterface {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly history: HTMLElement;
  private readonly form: HTMLFormElement;
  private fadeTimer = 0;
  private readonly events = new AbortController();
  private readonly invitations = new Map<string, RoomInvitation>();
  private accepting = false;
  private accept?: (invitation: RoomInvitation) => Promise<void>;
  private decline?: (id: string) => void;
  private readonly invitationTimer: number;

  constructor(container: HTMLElement, onSubmit: (text: string) => void, onClose: () => void) {
    this.element = document.createElement('section');
    this.element.className = 'chat';
    this.element.setAttribute('aria-label', 'Room text chat');
    this.element.innerHTML = `
      <div class="chat-invitations" role="region" aria-label="Room invitations" aria-live="polite" hidden></div>
      <div class="chat-history" role="log" aria-live="polite" aria-label="Chat messages" tabindex="0"></div>
      <form class="chat-form" hidden autocomplete="off">
        <label for="chat-input">YOU</label>
        <input id="chat-input" name="message" type="text" placeholder="Message or /invite username" maxlength="500" aria-label="Chat message" autocomplete="off" />
        <span class="chat-input-hint" aria-hidden="true">↵</span>
        <button class="chat-send" type="submit" aria-label="Send message" title="Send message"></button>
        <button class="chat-close" type="button" aria-label="Close chat" title="Close chat"></button>
      </form>
      <p class="chat-command" hidden><code>/invite username</code><span>Invite to your room</span></p>
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
    this.input.addEventListener('input', () => {
      if (this.input.value === '/') { this.input.value = '/invite '; this.input.setSelectionRange(8, 8); }
      this.updateCommand();
    }, { signal: this.events.signal });
    this.invitationTimer = window.setInterval(() => {
      let changed = false;
      for (const [id, invitation] of this.invitations) if (invitation.expiresAt <= Date.now() && !this.accepting) { this.invitations.delete(id); changed = true; }
      if (changed) this.renderInvitation();
    }, 1000);
    container.append(this.element);
  }

  setOpen(open: boolean): void {
    this.form.hidden = !open;
    this.element.querySelector<HTMLElement>('.chat-note')!.hidden = !open;
    this.element.classList.toggle('is-open', open);
    this.updateCommand();
    if (open) { window.clearTimeout(this.fadeTimer); this.element.classList.add('show-history'); this.input.focus({ preventScroll: true }); }
    else { this.input.blur(); this.scheduleFade(); }
  }

  add(message: ChatMessage): void {
    const follow = !this.element.classList.contains('is-open') || this.history.scrollHeight - this.history.clientHeight - this.history.scrollTop < 24;
    const row = document.createElement('p');
    row.className = 'chat-message';
    row.dataset.senderId = message.senderId;
    const name = document.createElement('span');
    name.className = 'chat-sender';
    name.textContent = `${message.senderName}:`;
    row.append(name, document.createTextNode(` ${message.message}`));
    this.history.append(row);
    while (this.history.children.length > 30) this.history.firstElementChild?.remove();
    if (follow) this.history.scrollTop = this.history.scrollHeight;
    this.element.classList.add('show-history');
    this.scheduleFade();
  }

  clear(): void { this.input.value = ''; this.updateCommand(); }
  configureInvitations(accept: (invitation: RoomInvitation) => Promise<void>, decline: (id: string) => void): void { this.accept = accept; this.decline = decline; }
  invite(invitation: RoomInvitation): void {
    if (invitation.expiresAt <= Date.now() || this.invitations.has(invitation.id)) return;
    this.invitations.set(invitation.id, invitation); this.renderInvitation();
  }
  private updateCommand(): void { this.element.querySelector<HTMLElement>('.chat-command')!.hidden = this.form.hidden || !this.input.value.startsWith('/'); }
  private renderInvitation(): void {
    const tray = this.element.querySelector<HTMLElement>('.chat-invitations')!;
    tray.replaceChildren(); const invitation = this.invitations.values().next().value;
    tray.hidden = !invitation; this.element.classList.toggle('has-invitations', !!invitation);
    if (!invitation) return;
    const heading = document.createElement('p');
    const shortcut = document.createElement('kbd'); shortcut.className = 'chat-invitation-key'; shortcut.textContent = 'ENTER'; shortcut.title = 'Open chat to respond';
    heading.append(shortcut, document.createTextNode(`${invitation.fromName} invites you`));
    const caption = document.createElement('span'); caption.textContent = `${invitation.mode} · ${this.invitations.size > 1 ? `${this.invitations.size} invitations` : 'Room invitation'}`;
    const actions = document.createElement('div');
    for (const [label, accept] of [['ACCEPT', true], ['DECLINE', false]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = this.accepting ? (accept ? 'CONNECTING' : label) : label; button.disabled = this.accepting;
      button.addEventListener('click', async () => {
        if (!accept) { this.decline?.(invitation.id); this.invitations.delete(invitation.id); this.renderInvitation(); return; }
        if (this.accepting || !this.accept) return;
        this.accepting = true; this.renderInvitation();
        try { await this.accept(invitation); this.invitations.delete(invitation.id); }
        catch (error) { const message = document.createElement('p'); message.className = 'chat-invitation-error'; message.textContent = error instanceof Error ? error.message : 'Invitation unavailable.'; tray.append(message); }
        finally {
          this.accepting = false;
          if (!tray.querySelector('.chat-invitation-error')) this.renderInvitation();
          else for (const control of tray.querySelectorAll('button')) { control.disabled = false; if (control.textContent === 'CONNECTING') control.textContent = 'ACCEPT'; }
        }
      }); actions.append(button);
    }
    tray.append(heading, caption, actions);
  }
  removeSenders(hidden: (id: string) => boolean): void {
    for (const row of this.history.querySelectorAll<HTMLElement>('.chat-message')) if (hidden(row.dataset.senderId || '')) row.remove();
  }
  reset(): void { this.clear(); this.history.replaceChildren(); this.element.classList.remove('show-history'); }
  private scheduleFade(): void {
    window.clearTimeout(this.fadeTimer);
    if (this.element.classList.contains('is-open')) return;
    this.fadeTimer = window.setTimeout(() => this.element.classList.remove('show-history'), 14000);
  }
  dispose(): void { window.clearTimeout(this.fadeTimer); clearInterval(this.invitationTimer); this.events.abort(); }
}
