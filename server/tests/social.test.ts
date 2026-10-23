import test from 'node:test';
import assert from 'node:assert/strict';
import { Client as SDK, type Room as SDKRoom, type SeatReservation } from '@colyseus/sdk';
import type { Client } from '@colyseus/core';
import { SocialDirectory } from '../src/communication/SocialDirectory';
import { shooterFixture } from './shooter-fixture';
import type { RoomInvitation, SocialResult } from '../../shared/SocialProtocol';
import { socialConfig } from '../../shared/SocialProtocol';

test('global names, reserved identities, rate limits, expiration and blocks', () => {
  const directory = new SocialDirectory(), sent: [string, unknown][] = [];
  const peer = (sessionId: string) => ({ sessionId, send: (type: string, value: unknown) => sent.push([type, value]) }) as unknown as Client;
  const a = peer('a'), b = peer('b');
  directory.join(a, 'limbo', 'LIMBO', { displayName: 'Artist One', admissionToken: 'visit-a' });
  directory.join(b, 'shooter', 'SHOOTER', { displayName: 'Friend', admissionToken: 'visit-b' });
  assert.throws(() => directory.checkName(' artist ONE ', 'other'), /already in use/);
  directory.drop('a'); assert.throws(() => directory.checkName('Artist One', 'other'), /already in use/);
  directory.reconnect(a);
  directory.invite('a', 'FRIEND');
  const invite = sent.find(([type]) => type === 'social:invitation')![1] as RoomInvitation;
  assert.equal(invite.mode, 'LIMBO'); assert.equal(directory.pending('b').length, 1);
  assert.throws(() => directory.prepare('a', invite.id), /expired/);
  assert.throws(() => directory.invite('a', 'Friend'), /wait/);
  directory.block('b', ['a']); assert.throws(() => directory.prepare('b', invite.id), /no longer/);
  directory.block('b', []); assert.equal(directory.prepare('b', invite.id).visitor.name, 'Friend');
  assert.throws(() => directory.prepare('b', invite.id), /expired/);
  directory.finish(invite.id, false); directory.hold('b', invite.id);
  const heldUntil = invite.expiresAt; assert.ok(heldUntil >= Date.now() + socialConfig.loadingGraceMs - 100);
  directory.hold('b', invite.id); assert.equal(invite.expiresAt, heldUntil);
  directory.prune(heldUntil + 1);
  assert.throws(() => directory.prepare('b', invite.id), /expired/);
  directory.leave('a', true); directory.checkName('Artist One', 'other');
});

const once = <T>(room: SDKRoom, type: string) => new Promise<T>(resolve => room.onMessage<T>(type, resolve));
test('independent servers allow matching names but never share invitations', () => {
  const eu = new SocialDirectory(), usa = new SocialDirectory();
  const received: Record<string, RoomInvitation[]> = {};
  const peer = (sessionId: string) => ({ sessionId, send: (type: string, value: RoomInvitation) => {
    if (type === 'social:invitation') (received[sessionId] ??= []).push(value);
  } }) as unknown as Client;
  eu.join(peer('eu-host'), 'eu-limbo', 'LIMBO', { displayName: 'Host' });
  usa.join(peer('usa-host'), 'usa-limbo', 'LIMBO', { displayName: 'Host' });
  eu.join(peer('eu-friend'), 'eu-shooter', 'SHOOTER', { displayName: 'Friend' });
  usa.join(peer('usa-friend'), 'usa-shooter', 'SHOOTER', { displayName: 'Friend' });
  usa.join(peer('usa-only'), 'usa-shooter', 'SHOOTER', { displayName: 'USA Only' });
  assert.throws(() => eu.checkName('HOST', 'another-visit'), /already in use on this server/);
  const now = Date.now();
  assert.throws(() => eu.invite('eu-host', 'USA Only', now - socialConfig.cooldownMs), /not connected to this server/);
  eu.invite('eu-host', 'Friend', now);
  assert.equal(received['eu-friend'].length, 1);
  assert.equal(received['usa-friend'], undefined);
  assert.equal(received['usa-only'], undefined);
  assert.equal(usa.pending('usa-friend').length, 0);
  assert.throws(() => usa.prepare('usa-friend', received['eu-friend'][0].id), /expired/);
});

test('real cross-mode invitation reserves a slot, rejects a full room and never broadcasts commands', async () => {
  const fixture = await shooterFixture(), sdk = new SDK(`ws://127.0.0.1:${fixture.port}`), clients: SDKRoom[] = [];
  try {
    const a = await sdk.create('SDPLimboRoom', { displayName: 'Social Alice', admissionToken: 'social-visit-a' }); clients.push(a);
    const b = await sdk.create('SDPShooterRoom', { displayName: 'Social Bob', admissionToken: 'social-visit-b' }); clients.push(b);
    const c = await sdk.create('SDPLimboRoom', { displayName: 'Social Carol', admissionToken: 'social-visit-c' }); clients.push(c);
    for (const room of clients) { room.onMessage('lobby:notice', () => {}); room.onMessage('combat:ping', () => {}); }
    await assert.rejects(() => sdk.joinById(c.roomId, { displayName: 'social ALICE' }), /already in use/);
    await fixture.room(c.roomId).lock();
    const fullInvite = once<RoomInvitation>(a, 'social:invitation'); c.send('chat:send', '/invite Social Alice');
    const full = await fullInvite, denied = once<SocialResult>(a, 'social:result');
    a.send('social:accept', { id: full.id, requestId: 'full' });
    assert.match((await denied).message!, /full or unavailable/); assert.equal(fixture.room(a.roomId).state.online, 1);
    const delivered = once<RoomInvitation>(b, 'social:invitation');
    let broadcasts = 0; a.onMessage('chat:message', () => broadcasts++);
    a.send('chat:send', '/invite social bob'); const invitation = await delivered;
    assert.equal(invitation.mode, 'LIMBO'); assert.equal(invitation.roomId, a.roomId);
    const prepared = once<SocialResult>(b, 'social:result'); b.send('social:accept', { id: invitation.id, requestId: 'accept' });
    const result = await prepared; assert.equal(result.ok, true, result.message);
    await b.leave();
    const joined = await sdk.consumeSeatReservation(result.reservation as SeatReservation); clients.push(joined);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(joined.roomId, a.roomId); assert.equal(fixture.room(a.roomId).state.online, 2);
    assert.equal(fixture.room(a.roomId).state.players.get(joined.sessionId)!.displayName, 'Social Bob');
    assert.equal(broadcasts, 0);
  } finally {
    for (const room of clients) if (room.connection.isOpen) await room.leave();
    await fixture.server.gracefullyShutdown(false);
  }
});
