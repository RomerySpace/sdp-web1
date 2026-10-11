import { validateChatText } from '../../../shared/CommunicationProtocol';

export class ChatPolicy {
  private readonly entries = new Map<string, { tokens: number; time: number }>();

  accept(id: string, raw: unknown, now: number): string | null {
    const text = validateChatText(raw);
    if (!text) return null;
    const previous = this.entries.get(id) || { tokens: 5, time: now };
    const tokens = Math.min(5, previous.tokens + Math.max(0, now - previous.time) / 500);
    this.entries.set(id, { tokens: Math.max(0, tokens - 1), time: now });
    return tokens >= 1 ? text : null;
  }

  remove(id: string): void { this.entries.delete(id); }
  clear(): void { this.entries.clear(); }
}
