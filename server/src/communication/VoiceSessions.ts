import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { VoiceAccess } from '../../../shared/CommunicationProtocol';
import { liveKitURLs } from '../config/LiveKitConfig';

export class VoiceSessions {
  private readonly key = process.env.LIVEKIT_API_KEY;
  private readonly secret = process.env.LIVEKIT_API_SECRET;
  private readonly urls = this.key && this.secret ? liveKitURLs() : undefined;
  private readonly service: RoomServiceClient | undefined;
  private readonly issued = new Set<string>();
  private readonly removals = new Map<string, Promise<void>>();
  readonly room: string;

  constructor(roomId: string) {
    this.room = `sdp-${roomId}`;
    if (this.key && this.secret && this.urls) this.service = new RoomServiceClient(this.urls.apiURL, this.key, this.secret);
  }

  async access(identity: string, name: string, requestId: string): Promise<VoiceAccess> {
    if (!this.key || !this.secret || !this.urls) return { requestId, error: 'Voice is not configured. Set LiveKit credentials on the backend, or use npm run dev:lan locally.' };
    await this.removals.get(identity);
    const token = new AccessToken(this.key, this.secret, { identity, name, ttl: 60 });
    token.addGrant({ roomJoin: true, room: this.room, canSubscribe: true, canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE], canPublishData: false, canUpdateOwnMetadata: false });
    this.issued.add(identity);
    return { requestId, identity, room: this.room, token: await token.toJwt(),
      url: this.urls.publicURL, expiresAt: Date.now() + 60000 };
  }

  async remove(identity: string): Promise<void> {
    const pending = this.removals.get(identity);
    if (pending) return pending;
    if (!this.issued.delete(identity) || !this.service) return;
    const operation = this.service.removeParticipant(this.room, identity).then(() => {})
      .catch((error) => {
        if (error.code !== 'not_found') console.warn('[SDP] Voice participant cleanup failed; the client will disconnect and the token expires within 60s.');
      }).finally(() => this.removals.delete(identity));
    this.removals.set(identity, operation);
    return operation;
  }

  async dispose(): Promise<void> {
    const hadParticipants = this.issued.size > 0;
    this.issued.clear();
    await Promise.all(this.removals.values());
    if (hadParticipants && this.service) {
      try { await this.service.deleteRoom(this.room); } catch { /* Empty rooms may already be gone. */ }
    }
  }
}
