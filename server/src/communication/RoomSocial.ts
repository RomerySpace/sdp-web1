import { matchMaker, type Client, type Room } from '@colyseus/core';
import { socialDirectory } from './SocialDirectory';
import type { SocialMode, SocialResult } from '../../../shared/SocialProtocol';

export class RoomSocial {
  constructor(private readonly room: Room, private readonly mode: SocialMode, active: (id: string) => boolean, private readonly touch: (id: string) => void) {
    room.clock.setInterval(() => socialDirectory.prune(), 1000);
    room.onMessage('social:sync', client => { if (active(client.sessionId)) for (const invite of socialDirectory.pending(client.sessionId)) client.send('social:invitation', invite); });
    room.onMessage('social:blocks', (client, raw: unknown) => {
      if (active(client.sessionId) && Array.isArray(raw) && raw.length <= 100 && raw.every(id => typeof id === 'string' && id.length < 100)) socialDirectory.block(client.sessionId, raw);
    });
    room.onMessage('social:decline', (client, id: unknown) => { if (typeof id === 'string') socialDirectory.decline(client.sessionId, id); });
    room.onMessage('social:hold', (client, raw: unknown) => {
      if (!active(client.sessionId) || !raw || typeof raw !== 'object' || !('requestId' in raw) || !('id' in raw) ||
        typeof raw.requestId !== 'string' || raw.requestId.length > 80 || typeof raw.id !== 'string' || raw.id.length > 80) return;
      try {
        socialDirectory.hold(client.sessionId, raw.id); touch(client.sessionId);
        client.send('social:result', { requestId: raw.requestId, ok: true } satisfies SocialResult);
      } catch (error) { client.send('social:result', { requestId: raw.requestId, ok: false, message: error instanceof Error ? error.message : 'Invitation unavailable.' } satisfies SocialResult); }
    });
    room.onMessage('social:accept', (client, raw: unknown) => {
      if (!active(client.sessionId) || !raw || typeof raw !== 'object' || !('requestId' in raw) || !('id' in raw) ||
        typeof raw.requestId !== 'string' || raw.requestId.length > 80 || typeof raw.id !== 'string' || raw.id.length > 80) return;
      touch(client.sessionId); void this.reserve(client, raw.requestId, raw.id);
    });
  }
  join(client: Client, options: { displayName?: unknown; admissionToken?: unknown }): string { return socialDirectory.join(client, this.room.roomId, this.mode, options); }
  drop(client: Client): void { socialDirectory.drop(client.sessionId); }
  reconnect(client: Client): void { socialDirectory.reconnect(client); for (const invite of socialDirectory.pending(client.sessionId)) client.send('social:invitation', invite); }
  leave(client: Client, inactive: boolean): void { socialDirectory.leave(client.sessionId, inactive); }
  command(client: Client, text: string): boolean {
    if (!text.startsWith('/')) return false;
    this.touch(client.sessionId);
    try {
      const match = /^\/invite\s+(.+)$/i.exec(text);
      if (!match) throw new Error('Use /invite username to invite a visitor to this room.');
      socialDirectory.invite(client.sessionId, match[1].trim());
    } catch (error) { client.send('chat:error', error instanceof Error ? error.message : 'Invitation unavailable.'); }
    return true;
  }
  private async reserve(client: Client, requestId: string, id: string): Promise<void> {
    let prepared = false;
    try {
      const { visitor, invitation } = socialDirectory.prepare(client.sessionId, id); prepared = true;
      // Reserve before leaving the source. Colyseus counts this against capacity.
      const reservation = await matchMaker.joinById(invitation.roomId, { displayName: visitor.name, admissionToken: visitor.key.startsWith('session:') ? undefined : visitor.key }, { headers: new Headers(), ip: '' });
      socialDirectory.finish(id, true);
      client.send('social:result', { requestId, ok: true, invitationId: id, mode: invitation.mode, reservation } satisfies SocialResult);
    } catch (error) {
      if (prepared) socialDirectory.finish(id, false);
      const known = !prepared && error instanceof Error;
      client.send('social:result', { requestId, ok: false, message: known ? error.message : 'That room is full or unavailable. You are still in your current room.' } satisfies SocialResult);
    }
  }
}
