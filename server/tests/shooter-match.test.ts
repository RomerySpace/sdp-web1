import test from 'node:test';
import assert from 'node:assert/strict';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { SDPShooterRoom } from '../src/rooms/SDPShooterRoom';
import type { ShooterState } from '../src/state/ShooterState';
import { ShooterMatch } from '../src/simulation/ShooterMatch';
import { gameplayConfig } from '../../shared/GameplayConfig';
import { rankRound, roundWinners, type RoundScore } from '../../shared/ShooterProtocol';
import type { RoomInactivity } from '../src/communication/RoomInactivity';

const score = (playerId: string, kills: number, deaths = 0): RoundScore => ({ playerId, displayName: playerId, kills, deaths });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= end) throw new Error('Round synchronization timed out.'); await sleep(20); }
}
test('seven-minute rounds start only explicitly, retain departed scores, rank and tie correctly', () => {
  const match = new ShooterMatch(); assert.equal(match.phase, 'waiting'); assert.equal(match.active(0), false);
  match.start(400); assert.equal(match.endsAt, 420400); assert.equal(match.round, 1);
  assert.equal(match.active(420399), true); assert.equal(match.active(420400), false);
  match.leave(score('departed', 4, 1));
  const results = match.finish(420410, [score('a', 4, 2), score('b', 3), score('c', 4, 1)]);
  assert.deepEqual(results.map(p => p.playerId), ['c', 'departed', 'a', 'b']);
  assert.deepEqual(roundWinners(results).map(p => p.playerId), ['c', 'departed']);
  assert.equal(match.nextRoundAt, 428410); assert.equal(match.active(420420), false);
  match.start(match.nextRoundAt); assert.equal(match.round, 2); assert.equal(match.phase, 'playing');
  assert.equal(match.finish(match.endsAt, [score('b', 0)]).length, 1);
  assert.deepEqual(rankRound([score('b', 1, 2), score('a', 1, 1)]).map(p => p.playerId), ['a', 'b']);
  match.resetEmpty(); assert.equal(match.phase, 'waiting');
});
test('two real WebSocket clients receive authoritative results, blocked inputs and a clean next round', { timeout: 20000 }, async () => {
  const transport = new WebSocketTransport(), server = new Server({ transport, greet: false, gracefullyShutdown: false });
  server.define('MatchTest', SDPShooterRoom); await server.listen(0, '127.0.0.1');
  const port = (transport.server!.address() as { port: number }).port, client = new Client(`http://127.0.0.1:${port}`);
  const rooms: Room<ShooterState>[] = [];
  try {
    const a = await client.joinOrCreate<ShooterState>('MatchTest', { displayName: 'Round Winner', duration: 1 }); rooms.push(a);
    const b = await client.joinOrCreate<ShooterState>('MatchTest', { displayName: 'Round Target' }); rooms.push(b);
    for (const room of rooms) { room.onMessage('combat:ping', () => {}); room.onMessage('combat:event', () => {}); room.onMessage('weapon:event', () => {}); }
    await waitFor(() => !!a.state.players?.get(b.sessionId));
    const local = matchMaker.getLocalRoomById(a.roomId) as SDPShooterRoom;
    const own = () => a.state.players.get(a.sessionId)!, target = () => a.state.players.get(b.sessionId)!;
    const endsAt = a.state.matchEndsAt;
    assert.equal(a.state.match, 'playing'); assert.equal(a.state.round, 1);
    await waitFor(() => Boolean(b.state.lighting));
    assert.ok(['day', 'night'].includes(a.state.lighting));
    assert.equal(a.state.lighting, b.state.lighting);
    const firstLighting = a.state.lighting;
    assert.ok(Math.abs(a.state.wallTime - Date.now()) < 1000);
    assert.ok(endsAt - a.state.serverTime > 419000, 'Client duration options must not shorten the server round.');
    await waitFor(() => a.state.serverTime > target().protectedUntil + 200);
    const dx = target().x - own().x, dz = target().z - own().z;
    const input = { seq: 1, life: own().life, f: 0, r: 0, y: Math.atan2(-dx, -dz),
      p: Math.atan2(target().y + 1.65 - (own().y + 1.7), Math.hypot(dx, dz)), s: false, c: false, j: false, a: false, active: true };
    a.send('shooter:input', input); await sleep(60); a.send('weapon:action', { seq: 1, life: own().life, action: 'fire' });
    await waitFor(() => target().dead); assert.equal(own().kills, 1);
    // Only the test process advances the server clock. No client message or public endpoint can do this.
    local.clock.elapsedTime = endsAt;
    // These players represent an active seven-minute match, not AFK sessions.
    const inactivity = (local as unknown as { inactivity: RoomInactivity }).inactivity;
    for (const room of rooms) inactivity.touch(room.sessionId);
    await waitFor(() => a.state.match === 'results' && b.state.match === 'results');
    assert.equal(a.state.results[0].playerId, a.sessionId); assert.equal(a.state.results[0].kills, 1);
    assert.equal(a.state.results[1].deaths, 1); assert.equal(b.state.results[0].displayName, 'Round Winner');
    assert.equal(a.state.lighting, firstLighting);
    const frozen = { x: own().x, y: own().y, z: own().z, ammo: own().ammo, life: target().life };
    a.send('shooter:input', { ...input, seq: 2, f: 1, s: true });
    a.send('weapon:action', { seq: 2, life: own().life, action: 'fire' });
    a.send('weapon:action', { seq: 3, life: own().life, action: 'reload' });
    await sleep(150);
    assert.deepEqual({ x: own().x, y: own().y, z: own().z, ammo: own().ammo, life: target().life }, frozen);
    assert.equal(own().reloading, false);
    const c = await client.joinById<ShooterState>(a.roomId, { displayName: 'Late Visitor' }); rooms.push(c);
    c.onMessage('combat:ping', () => {}); c.onMessage('combat:event', () => {}); c.onMessage('weapon:event', () => {});
    await waitFor(() => !!c.state.players?.get(c.sessionId)); assert.equal(c.state.match, 'results'); assert.equal(c.state.results.length, 2);
    assert.equal(a.state.matchEndsAt, endsAt);
    local.clock.elapsedTime = a.state.nextRoundAt - 50; await sleep(20); assert.equal(a.state.match, 'results');
    local.clock.elapsedTime = a.state.nextRoundAt;
    await waitFor(() => a.state.round === 2 && b.state.round === 2 && c.state.round === 2);
    assert.equal(a.state.lighting, b.state.lighting); assert.equal(a.state.lighting, c.state.lighting);
    assert.equal(a.state.match, 'playing'); assert.equal(a.state.results.length, 0); assert.equal(a.state.killFeed.length, 0);
    for (const p of a.state.players.values()) {
      assert.equal(p.kills, 0); assert.equal(p.deaths, 0); assert.equal(p.health, 100);
      assert.equal(p.ammo, 30); assert.equal(p.reserve, 120); assert.equal(p.dead, false); assert.equal(p.life, 2);
      assert.ok(p.protectedUntil > a.state.serverTime);
    }
    assert.ok(a.state.matchEndsAt - a.state.serverTime > gameplayConfig.match.duration * 1000 - 200);
    a.send('weapon:action', { seq: 4, life: 1, action: 'fire' }); await sleep(60); assert.equal(own().ammo, 30);
    a.send('shooter:input', { ...input, seq: 3, life: own().life, f: 1 }); await sleep(150);
    assert.ok(Math.hypot(own().x - own().spawnX, own().z - own().spawnZ) > .1);
  } finally { for (const room of rooms) if (room.connection.isOpen) await room.leave().catch(() => {}); await server.gracefullyShutdown(false); }
});
