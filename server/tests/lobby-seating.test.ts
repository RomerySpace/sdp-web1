import test from 'node:test';
import assert from 'node:assert/strict';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { SDPLobby } from '../src/rooms/SDPLobby';
import type { LobbyState } from '../src/state/LobbyState';
import type { MovementSimulation } from '../src/simulation/MovementSimulation';
import { lobbyRetreat, lobbySeatSlots, validSeatRequest, seatExits } from '../../shared/LobbyRetreat';
import { CollisionManager } from '../../src/player/CollisionManager';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean) {
  const until = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > until) throw new Error('Seating synchronization timed out.'); await sleep(20); }
}
test('seat requests cannot provide positions, identities or invalid bench indices; exits avoid scene colliders', () => {
  for (const raw of [null, {}, [], { seat: 0, x: 1 }, { seat: 0, playerId: 'other' }, { seat: lobbySeatSlots.length }, { seat: -2 }, { seat: .5 }, { seat: '0' }]) assert.equal(validSeatRequest(raw), false);
  assert.equal(validSeatRequest({ seat: -1 }), true); assert.equal(validSeatRequest({ seat: 0 }), true);
  const world = new CollisionManager();
  assert.equal(lobbySeatSlots.length, 34);
  for (let i = 0; i < lobbySeatSlots.length; i++) {
    assert.equal(validSeatRequest({ seat: i }), true);
    assert.ok(seatExits(i).some(exit => world.canOccupy(exit.x, exit.z)));
  }
  assert.ok(Math.hypot(lobbyRetreat.x, lobbyRetreat.z) > 40);
  for (const seat of lobbyRetreat.seats) assert.ok(Math.hypot(seat.x - lobbyRetreat.x, seat.z - lobbyRetreat.z) >= 5.8);
});

test('two real clients receive server-owned seating, occupancy, look, chat, standing and released seats', { timeout: 15000 }, async () => {
  const transport = new WebSocketTransport(), server = new Server({ transport, greet: false, gracefullyShutdown: false });
  server.define('SeatTest', SDPLobby); await server.listen(0, '127.0.0.1');
  const port = (transport.server!.address() as { port: number }).port, client = new Client(`http://127.0.0.1:${port}`), rooms: Room<LobbyState>[] = [];
  try {
    const a = await client.joinOrCreate<LobbyState>('SeatTest'), b = await client.joinOrCreate<LobbyState>('SeatTest'); rooms.push(a, b);
    const notices: string[] = [], messages: unknown[] = [];
    a.onMessage('lobby:notice', notice => notices.push(notice)); b.onMessage('lobby:notice', notice => notices.push(notice));
    b.onMessage('chat:message', message => messages.push(message)); a.onMessage('chat:message', () => {});
    await waitFor(() => !!a.state.players?.get(b.sessionId));
    const room = matchMaker.getLocalRoomById(a.roomId) as SDPLobby;
    // Trusted fixture placement only; no client message or public endpoint can teleport a player.
    function approach(id: string) {
      const point = seatExits(0)[0], player = room.state.players.get(id)!;
      player.x = point.x; player.z = point.z; player.y = 1.7;
      (room as unknown as { simulation: MovementSimulation }).simulation.add(id, point);
    }
    const own = () => a.state.players.get(a.sessionId)!;
    a.send('lobby:seat', { seat: 0 }); await waitFor(() => notices.length > 0); assert.equal(own().seatIndex, -1);
    a.send('lobby:seat', { seat: 0, x: lobbyRetreat.seats[0].x }); await sleep(80); assert.equal(own().seatIndex, -1);
    approach(a.sessionId); await sleep(270); a.send('lobby:seat', { seat: 0 });
    await waitFor(() => own().seatIndex === 0 && b.state.players.get(a.sessionId)?.seatIndex === 0);
    assert.ok(Math.abs(own().y - lobbyRetreat.seatedEye) < .001); assert.ok(Math.abs(own().x - lobbySeatSlots[0].x) < .001);
    approach(b.sessionId); const count = notices.length; b.send('lobby:seat', { seat: 0 }); await waitFor(() => notices.length > count);
    assert.equal(b.state.players.get(b.sessionId)!.seatIndex, -1);
    await sleep(270); b.send('lobby:seat', { seat: 1 });
    await waitFor(() => b.state.players.get(b.sessionId)?.seatIndex === 1);
    assert.equal(own().seatIndex, 0);
    const partner = b.state.players.get(b.sessionId)!;
    assert.ok(Math.hypot(own().x - partner.x, own().z - partner.z) > 1);
    b.send('lobby:seat', { seat: -1 }); await waitFor(() => b.state.players.get(b.sessionId)?.seatIndex === -1);
    a.send('input', { seq: 1, f: 0, r: 0, y: .5, p: .2, active: true });
    await waitFor(() => Math.abs(own().yaw - .5) < .01); assert.equal(own().seatIndex, 0);
    a.send('chat:send', 'Listening from the bench'); await waitFor(() => messages.length === 1);
    a.send('input', { seq: 2, f: 1, r: 0, y: .5, p: .2, active: true }); await waitFor(() => own().seatIndex === -1);
    a.send('input', { seq: 3, f: 0, r: 0, y: .5, p: 0, active: false }); await sleep(100);
    approach(a.sessionId); await sleep(270); a.send('lobby:seat', { seat: 0 }); await waitFor(() => own().seatIndex === 0);
    await a.leave(); await waitFor(() => !b.state.players.has(a.sessionId));
    approach(b.sessionId); b.send('lobby:seat', { seat: 0 }); await waitFor(() => b.state.players.get(b.sessionId)?.seatIndex === 0);
    await sleep(270); b.send('lobby:seat', { seat: -1 }); await waitFor(() => b.state.players.get(b.sessionId)?.seatIndex === -1);
    const standing = b.state.players.get(b.sessionId)!; assert.ok(new CollisionManager().canOccupy(standing.x, standing.z));
    approach(b.sessionId); await sleep(270); b.send('lobby:seat', { seat: 1 });
    await waitFor(() => b.state.players.get(b.sessionId)?.seatIndex === 1);
    room.onDrop(room.clients.find(c => c.sessionId === b.sessionId)!);
    assert.equal(room.state.players.get(b.sessionId)?.seatIndex, -1);
    assert.equal(room.state.players.get(b.sessionId)?.connected, false);
  } finally { await Promise.all(rooms.filter(room => room.connection.isOpen).map(room => room.leave().catch(() => {}))); await server.gracefullyShutdown(false); }
});
