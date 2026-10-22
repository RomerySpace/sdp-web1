import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@colyseus/sdk';
import { AdmissionClient } from '../../src/network/AdmissionClient';

test('a granted entry is not held indefinitely by a lost queue leave acknowledgement', { timeout: 3000 }, async () => {
  let status: (value: unknown) => void = () => {};
  let closed = false;
  const room = {
    reconnection: { enabled: true },
    connection: { isOpen: true, close() { closed = true; this.isOpen = false; } },
    onMessage(_type: string, callback: typeof status) { status = callback; },
    onLeave() {}, onError() {},
    send() { status({ token: 'granted', position: 0, ready: true }); },
    leave: () => new Promise<void>(() => {}),
  };
  const client = new AdmissionClient({ joinOrCreate: async () => room } as unknown as Client);
  assert.equal(await client.enter(() => {}), 'granted');
  assert.equal(room.reconnection.enabled, false);
  assert.equal(closed, true);
});
