import type { MultiplayerConnection } from '../network/MultiplayerConnection';
import type { ChatMessage } from './ChatTypes';

export class ChatManager {
  private readonly listeners = new Set<(message: ChatMessage) => void>();
  private readonly unsubscribe: () => void;
  readonly history: ChatMessage[] = [];
  private hiddenSender: (id: string) => boolean = () => false;
  setHiddenSenders(predicate: (id: string) => boolean): void {
    this.hiddenSender = predicate;
    for (let i = this.history.length - 1; i >= 0; i--) if (predicate(this.history[i].senderId)) this.history.splice(i, 1);
  }

  constructor(private readonly network: MultiplayerConnection) {
    this.unsubscribe = network.subscribeToChat((message) => {
      this.append({ ...message, senderName: message.senderId === network.snapshot?.localPlayerId ? 'YOU' : message.senderName });
    });
  }

  submit(text: string): boolean {
    return this.network.sendChat(text);
  }
  reset(): void { this.history.length = 0; }

  subscribe(listener: (message: ChatMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private append(message: ChatMessage): void {
    if (this.hiddenSender(message.senderId)) return;
    if (this.history.some((item) => item.messageId === message.messageId)) return;
    this.history.push(message);
    if (this.history.length > 30) this.history.shift();
    for (const listener of this.listeners) listener(message);
  }

  dispose(): void { this.unsubscribe(); this.listeners.clear(); }
}
