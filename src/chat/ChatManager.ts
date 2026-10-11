import type { MultiplayerConnection } from '../network/MultiplayerConnection';
import type { ChatMessage } from './ChatTypes';

export class ChatManager {
  private readonly listeners = new Set<(message: ChatMessage) => void>();
  private readonly unsubscribe: () => void;
  readonly history: ChatMessage[] = [];

  constructor(private readonly network: MultiplayerConnection) {
    this.unsubscribe = network.subscribeToChat((message) => {
      this.append({ ...message, senderName: message.senderId === network.snapshot?.localPlayerId ? 'YOU' : message.senderName });
    });
  }

  submit(text: string): boolean {
    return this.network.sendChat(text);
  }

  subscribe(listener: (message: ChatMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private append(message: ChatMessage): void {
    if (this.history.some((item) => item.messageId === message.messageId)) return;
    this.history.push(message);
    if (this.history.length > 30) this.history.shift();
    for (const listener of this.listeners) listener(message);
  }

  dispose(): void { this.unsubscribe(); this.listeners.clear(); }
}
