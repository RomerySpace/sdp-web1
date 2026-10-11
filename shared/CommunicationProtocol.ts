export interface RoomChatMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  message: string;
  timestamp: number;
  position: { x: number; y: number; z: number };
  roomId: string;
}

export interface VoiceAccess {
  requestId: string;
  token?: string;
  url?: string;
  room?: string;
  identity?: string;
  expiresAt?: number;
  error?: string;
}

export function validateChatText(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return text && new TextEncoder().encode(text).length <= 2000 ? text : null;
}

export function validVoiceRequest(raw: unknown): raw is { requestId: string } {
  if (!raw || typeof raw !== 'object') return false;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).length === 1 && typeof value.requestId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value.requestId);
}
