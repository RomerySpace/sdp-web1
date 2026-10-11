import type { NetworkAdapter } from './NetworkAdapter';

/** Deliberately offline: no socket, remote players, synthetic replies or timers. */
export class LocalNetworkAdapter implements NetworkAdapter {
  async connect(): Promise<void> { /* No connection required. */ }
  disconnect(): void { /* Nothing to disconnect. */ }
  sendPlayerState(): void { /* Local movement stays local. */ }
  sendChatMessage(): void { /* ChatManager displays the local message directly. */ }
  subscribeToPlayerUpdates(): () => void { return () => {}; }
  subscribeToChatMessages(): () => void { return () => {}; }
}
