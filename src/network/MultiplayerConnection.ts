import type { ConnectionStatus, LobbySnapshot, MovementInput, NetworkPlayer } from '../../shared/MultiplayerProtocol';
import type { RoomChatMessage, VoiceAccess } from '../../shared/CommunicationProtocol';

export interface MultiplayerConnection {
  readonly status: ConnectionStatus;
  readonly snapshot: LobbySnapshot | undefined;
  connect(): Promise<void>;
  disconnect(): void;
  sendInput(input: MovementInput): void;
  sendChat(text: string): boolean;
  requestVoiceAccess(): Promise<VoiceAccess>;
  subscribeToChat(callback: (message: RoomChatMessage) => void): () => void;
  subscribeToNotice(callback: (message: string) => void): () => void;
  subscribeToState(callback: (snapshot: LobbySnapshot) => void): () => void;
  subscribeToStatus(callback: (status: ConnectionStatus) => void): () => void;
  subscribeToSpawn(callback: (player: NetworkPlayer) => void): () => void;
}
