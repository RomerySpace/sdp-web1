import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import type { Client as ServerClient } from '@colyseus/core';
import { airstrikeFixture } from './airstrike-fixture';
import type { SDPLobby } from '../src/rooms/SDPLobby';

test('disconnecting an incomplete JOIN does not crash Limbo or Shooter', { timeout: 15000 }, async () => {
  const fixture = await airstrikeFixture(), sdk = new Client(`http://127.0.0.1:${fixture.port}`);
  try {
    for (const type of ['SDPLimboRoom', 'SDPShooterRoom']) {
      const client = await sdk.joinOrCreate(type);
      client.onMessage('combat:ping', nonce => client.send('combat:pong', nonce));
      client.onMessage('station:state', () => {});
      try {
        const room = fixture.room(client.roomId) as unknown as SDPLobby;
        // Colyseus uses this field to distinguish an unacknowledged JOIN.
        const pending = { sessionId: 'incomplete-join', _enqueuedMessages: [] } as unknown as ServerClient;
        await assert.rejects(Promise.resolve(room.allowReconnection(pending, 120)), (error: unknown) => (error as { code?: string }).code === 'not joined');
        room.onDrop(pending, 1006);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(room.clients.length, 1);
        assert.equal(client.connection.isOpen, true);
      } finally { await client.leave(); }
    }
  } finally { await fixture.server.gracefullyShutdown(false); }
});
