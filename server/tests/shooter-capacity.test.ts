import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, type Room } from '@colyseus/sdk';
import { MAX_PLAYERS } from '../../shared/MultiplayerProtocol';
import { SHOOTER_MAX_PLAYERS } from '../../shared/ShooterProtocol';
import { airstrikeFixture } from './airstrike-fixture';

test('Shooter rooms admit 15, allocate visitor 16 elsewhere and reserve reconnections; Limbo stays at 25', { timeout: 20000 }, async () => {
  const fixture = await airstrikeFixture(), sdk = new Client(`http://127.0.0.1:${fixture.port}`), clients: Room[] = [];
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Capacity synchronization timed out.'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  try {
    assert.equal(MAX_PLAYERS, 25); assert.equal(SHOOTER_MAX_PLAYERS, 15);
    const lobby = await sdk.joinOrCreate('SDPLimboRoom'); clients.push(lobby); lobby.onMessage('*', () => {});
    await until(() => !!lobby.state.capacity); assert.equal(lobby.state.capacity, 25);
    for (let i = 0; i < 16; i++) {
      const room = await sdk.joinOrCreate('SDPShooterRoom', { displayName: `Capacity ${i}` }); clients.push(room);
      room.onMessage('*', () => {}); room.reconnection.enabled = false;
    }
    const first = clients[1], secondRoom = clients[16];
    assert.notEqual(first.roomId, secondRoom.roomId);
    for (const room of clients.slice(1, 16)) assert.equal(room.roomId, first.roomId);
    await until(() => first.state.online === 15 && secondRoom.state.online === 1);
    assert.equal(first.state.capacity, 15); assert.equal(secondRoom.state.capacity, 15);
    await assert.rejects(sdk.joinById(first.roomId));
    const token = first.reconnectionToken;
    first.connection.close(4010);
    await until(() => fixture.room(first.roomId).state.online === 14);
    const arrival = await sdk.joinOrCreate('SDPShooterRoom'); clients.push(arrival); arrival.onMessage('*', () => {});
    assert.notEqual(arrival.roomId, first.roomId);
    const restored = await sdk.reconnect(token); clients.push(restored); restored.onMessage('*', () => {});
    assert.equal(restored.sessionId, first.sessionId); assert.equal(restored.roomId, first.roomId);
    await until(() => restored.state.online === 15);
  } finally {
    for (const client of clients) { client.reconnection.enabled = false; if (client.connection.isOpen) await client.leave(); }
    await fixture.server.gracefullyShutdown(false);
  }
});
