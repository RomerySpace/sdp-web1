import { randomUUID } from 'node:crypto';
import { ServerError, type Client } from '@colyseus/core';
import { validateDisplayName } from '../../../shared/PlayerIdentity';
import { socialConfig, type RoomInvitation, type SocialMode } from '../../../shared/SocialProtocol';
import { admissionConfig } from '../../../shared/Admission';

interface Presence { id: string; key: string; name: string; sessionId: string; roomId: string; mode: SocialMode; client?: Client; until: number; blocked: Set<string>; lastInvite: number }
interface Invitation { value: RoomInvitation; sender: string; recipient: string; preparing?: boolean; held?: boolean }
const normalized = (name: string) => name.normalize('NFKC').toLocaleLowerCase('en');

/** One process/region directory. Never broadcast visit credentials or this index. */
export class SocialDirectory {
  private readonly visitors = new Map<string, Presence>();
  private readonly sessions = new Map<string, string>();
  private readonly invitations = new Map<string, Invitation>();
  prune(now = Date.now()): void {
    for (const [key, visitor] of this.visitors) if (!visitor.client && visitor.until <= now) {
      this.visitors.delete(key);
      for (const [session, owner] of this.sessions) if (owner === key) this.sessions.delete(session);
    }
    for (const [id, invite] of this.invitations) if (invite.value.expiresAt <= now || !this.visitors.has(invite.sender) || !this.visitors.has(invite.recipient)) this.invitations.delete(id);
  }
  checkName(raw: unknown, key: unknown): void {
    this.prune();
    if (raw === undefined) return;
    const name = validateDisplayName(raw);
    if (!name) throw new ServerError(400, 'Invalid display name.');
    for (const visitor of this.visitors.values()) if (visitor.key !== key && normalized(visitor.name) === normalized(name))
      throw new ServerError(socialConfig.nameConflictCode, 'That username is already in use on this server. Choose another name.');
  }
  join(client: Client, roomId: string, mode: SocialMode, options: { displayName?: unknown; admissionToken?: unknown }): string {
    const key = typeof options.admissionToken === 'string' && options.admissionToken ? options.admissionToken : `session:${client.sessionId}`;
    const previous = this.visitors.get(key);
    if (previous?.client && previous.sessionId !== client.sessionId) throw new ServerError(409, 'This visit is already open.');
    const name = options.displayName ?? previous?.name ?? `VISITOR ${randomUUID().slice(0, 8)}`;
    this.checkName(name, key);
    const visitor: Presence = previous ?? { id: randomUUID(), key, name: '', sessionId: '', roomId: '', mode, until: Infinity, blocked: new Set(), lastInvite: -Infinity };
    Object.assign(visitor, { name: validateDisplayName(name)!, sessionId: client.sessionId, roomId, mode, client, until: Infinity });
    this.visitors.set(key, visitor); this.sessions.set(client.sessionId, key);
    return visitor.name;
  }
  drop(session: string): void { const visitor = this.find(session); if (visitor?.sessionId === session) { visitor.client = undefined; visitor.until = Date.now() + admissionConfig.reservationSeconds * 1000; } }
  reconnect(client: Client): void { const visitor = this.find(client.sessionId); if (visitor?.sessionId === client.sessionId) { visitor.client = client; visitor.until = Infinity; } }
  leave(session: string, inactive = false): void {
    const visitor = this.find(session);
    if (visitor?.sessionId !== session) return;
    visitor.client = undefined; visitor.until = inactive ? 0 : Math.min(visitor.until, Date.now() + admissionConfig.reservationSeconds * 1000);
    this.prune();
  }
  block(session: string, ids: string[]): void {
    const visitor = this.find(session); if (!visitor?.client) return;
    visitor.blocked = new Set(ids.map(id => this.find(id)?.id).filter((id): id is string => !!id));
  }
  invite(session: string, raw: string, now = Date.now()): void {
    this.prune(now);
    const sender = this.find(session); if (!sender?.client) throw new Error('Reconnect before inviting someone.');
    if (now - sender.lastInvite < socialConfig.cooldownMs) throw new Error('Please wait a few seconds before sending another invitation.');
    sender.lastInvite = now;
    const name = validateDisplayName(raw), recipient = name ? [...this.visitors.values()].find(p => normalized(p.name) === normalized(name)) : undefined;
    if (!recipient?.client) throw new Error('That username is not connected to this server.');
    if (sender.blocked.has(recipient.id) || recipient.blocked.has(sender.id)) throw new Error('That visitor is not available for invitations.');
    if (recipient.id === sender.id) throw new Error('You cannot invite yourself.');
    if (recipient.roomId === sender.roomId) throw new Error('You are already in the same room.');
    const pending = [...this.invitations.values()].filter(p => p.recipient === recipient.key);
    if (pending.length >= socialConfig.maxPending || pending.some(p => p.sender === sender.key)) throw new Error('An invitation is already pending. Please wait.');
    const value: RoomInvitation = { id: randomUUID(), fromId: sender.id, fromSessionId: sender.sessionId, fromName: sender.name,
      roomId: sender.roomId, mode: sender.mode, expiresAt: now + socialConfig.invitationMs };
    this.invitations.set(value.id, { value, sender: sender.key, recipient: recipient.key });
    recipient.client.send('social:invitation', value);
    sender.client.send('lobby:notice', `Invitation sent to ${recipient.name}.`);
  }
  pending(session: string): RoomInvitation[] {
    this.prune(); const visitor = this.find(session);
    return visitor ? [...this.invitations.values()].filter(i => i.recipient === visitor.key && !i.preparing).map(i => i.value) : [];
  }
  decline(session: string, id: string): void {
    const invite = this.invitations.get(id); if (invite?.recipient === this.find(session)?.key) this.invitations.delete(id);
  }
  prepare(session: string, id: string): { visitor: Presence; invitation: RoomInvitation } {
    this.prune(); const invite = this.invitations.get(id), visitor = this.find(session), sender = invite && this.visitors.get(invite.sender);
    if (!invite || !visitor?.client || invite.recipient !== visitor.key || invite.preparing) throw new Error('This invitation has expired or is no longer available.');
    if (!sender?.client || sender.roomId !== invite.value.roomId || sender.blocked.has(visitor.id) || visitor.blocked.has(sender.id)) throw new Error('This invitation is no longer available.');
    invite.preparing = true;
    return { visitor, invitation: invite.value };
  }
  finish(id: string, success: boolean): void {
    const invite = this.invitations.get(id); if (!invite) return;
    if (success) this.invitations.delete(id); else invite.preparing = false;
  }
  hold(session: string, id: string): void {
    this.prepare(session, id); this.finish(id, false);
    const invite = this.invitations.get(id)!;
    if (!invite.held) { invite.held = true; invite.value.expiresAt = Date.now() + socialConfig.loadingGraceMs; }
  }
  private find(session: string): Presence | undefined { return this.visitors.get(this.sessions.get(session) ?? ''); }
}
export const socialDirectory = new SocialDirectory();
