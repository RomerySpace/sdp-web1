import type { ChatMessage } from '../chat/ChatTypes';

export interface Position { x: number; y: number; z: number }
export interface PlayerState {
  playerId: string;
  roomId: string;
  position: Position;
  yaw: number;
  pitch: number;
  timestamp: number;
}

/** Future adapters own room assignment, server reconciliation and transport.
 * A real server must enforce proximity and rate limits; UI filtering is not security. */
export interface NetworkAdapter {
  connect(): Promise<void>;
  disconnect(): void;
  sendPlayerState(state: PlayerState): void;
  sendChatMessage(message: ChatMessage): void;
  subscribeToPlayerUpdates(callback: (players: readonly PlayerState[]) => void): () => void;
  subscribeToChatMessages(callback: (message: ChatMessage) => void): () => void;
}
