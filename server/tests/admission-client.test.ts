import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@colyseus/sdk';
import { AdmissionClient } from '../../src/network/AdmissionClient';
import { admissionConfig } from '../../shared/Admission';

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

test('silent queues time out without discarding the ticket; healthy heartbeats renew the watchdog', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let status: (value: unknown) => void = () => {};
  let closed = false;
  const room = {
    reconnection: { enabled: true },
    connection: { isOpen: true, close() { closed = true; this.isOpen = false; } },
    onMessage(_type: string, callback: typeof status) { status = callback; },
    onLeave() {}, onError() {}, send() {}, leave: async () => {},
  };
  const client = new AdmissionClient({ joinOrCreate: async () => room } as unknown as Client);
  const updates: number[] = [];
  const entry = client.enter(position => updates.push(position));
  const rejection = assert.rejects(entry, /stopped responding/);
  await Promise.resolve();
  const waiting = { token: 'retained-ticket', position: 2, ready: false };
  status(waiting);
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(admissionConfig.heartbeatMs); status(waiting); }
  assert.equal(closed, false);
  t.mock.timers.tick(admissionConfig.statusTimeoutMs - 1);
  status({ ...waiting, position: -1 });
  t.mock.timers.tick(1);
  await rejection;
  assert.equal(closed, true);
  assert.equal(client.token, waiting.token);
  assert.deepEqual(updates, [2, 2, 2, 2, 2]);
});

test('cancelling a queued entry clears its watchdog and does not close a later connection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0;
  const room = {
    reconnection: { enabled: true }, connection: { isOpen: false, close() { closed++; } },
    onMessage() {}, onLeave() {}, onError() {}, send() {}, leave: async () => {},
  };
  const client = new AdmissionClient({ joinOrCreate: async () => room } as unknown as Client);
  const entry = client.enter(() => {}), rejection = assert.rejects(entry, /cancelled/);
  await Promise.resolve(); client.stop(); await rejection;
  t.mock.timers.tick(admissionConfig.statusTimeoutMs * 2);
  assert.equal(closed, 0);
});
