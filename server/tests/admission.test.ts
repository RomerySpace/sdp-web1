import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, type Room } from '@colyseus/sdk';
import { Admission, admission } from '../src/communication/Admission';
import { airstrikeFixture } from './airstrike-fixture';
import type { AdmissionUpdate } from '../../shared/Admission';
import type { SDPLobby } from '../src/rooms/SDPLobby';

test('FIFO admission enforces capacity, unique ownership and transition reservations', () => {
  const a = new Admission(); a.enabled = true; a.capacity = 1;
  const now = Date.now(), first = a.request(null, 'watch1', now), second = a.request(null, 'watch2', now);
  assert.equal(a.status(first)!.ready, true); assert.equal(a.status(second)!.position, 1);
  assert.throws(() => a.validate('invented'));
  a.attach(first, 'player1'); a.unwatch(first, 'watch1', now);
  assert.throws(() => a.attach(first, 'player2'));
  a.tick(now + 60000); assert.equal(a.status(second)!.ready, false);
  a.release('player1', now + 60000);
  a.tick(now + 70000); assert.equal(a.status(second)!.ready, false);
  a.attach(first, 'next-mode');
  a.release('next-mode', now + 70000, true);
  assert.equal(a.status(second)!.ready, true);
});

test('waiting visitors retain order across disconnects; unused grants expire', () => {
  const a = new Admission(); a.capacity = 1;
  const now = Date.now(), first = a.request(null, 'one', now), second = a.request(null, 'two', now);
  const third = a.request(null, 'three', now);
  a.unwatch(second, 'two', now);
  assert.equal(a.request(second, 'two-new', now + 10000), second);
  assert.equal(a.status(second)!.position, 1); assert.equal(a.status(third)!.position, 2);
  a.tick(now + 30001);
  assert.equal(a.status(first), undefined); assert.equal(a.status(second)!.ready, true);
  a.unwatch(third, 'three', now + 30001);
  a.tick(now + 160002); assert.equal(a.status(third), undefined);
});

test('admission room survives immediate consecutive arrivals after becoming empty', { timeout: 15000 }, async () => {
  const fixture = await airstrikeFixture(), client = new Client(`http://127.0.0.1:${fixture.port}`);
  const rooms: Room[] = [];
  let roomId = '';
  try {
    for (let i = 0; i < 4; i++) {
      const room = await client.joinOrCreate('SDPAdmission'); rooms.push(room);
      room.reconnection.enabled = false;
      if (roomId) assert.equal(room.roomId, roomId);
      roomId = room.roomId;
      const status = await new Promise<AdmissionUpdate>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No admission response')), 2000);
        room.onMessage<AdmissionUpdate>('queue:status', value => { clearTimeout(timer); resolve(value); });
        room.send('queue:sync');
      });
      assert.equal(status.ready, true);
      await room.leave();
    }
  } finally {
    for (const room of rooms) if (room.connection.isOpen) await room.leave();
    await fixture.server.gracefullyShutdown(false);
    admission.tick(Date.now() + 31000);
  }
});

test('real sockets: a seven-second cut keeps the same player and blocks the queue until released', { timeout: 25000 }, async () => {
  const fixture = await airstrikeFixture(), client = new Client(`http://127.0.0.1:${fixture.port}`);
  admission.enabled = true; admission.capacity = 1;
  const rooms: Room[] = [];
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const until = async (fn: () => boolean) => { const deadline = Date.now() + 5000; while (!fn()) { if (Date.now() > deadline) throw new Error('Admission timeout'); await sleep(20); } };
  const queue = async () => {
    const room = await client.joinOrCreate('SDPAdmission'); rooms.push(room);
    let latest: AdmissionUpdate | undefined;
    room.onMessage<AdmissionUpdate>('queue:status', status => { latest = status; }); room.send('queue:sync');
    await until(() => !!latest);
    return { room, get state() { return latest!; } };
  };
  try {
    await assert.rejects(client.joinOrCreate('SDPLimboRoom'), /waiting room/i);
    const q1 = await queue(); assert.equal(q1.state.ready, true);
    const first = await client.joinOrCreate('SDPLimboRoom', { admissionToken: q1.state.token, displayName: 'Reserved visitor' }); rooms.push(first);
    first.onMessage('station:state', () => {}); await q1.room.leave();
    const q2 = await queue(); assert.equal(q2.state.position, 1);
    await until(() => !!first.state.players?.get(first.sessionId));
    const local = fixture.room(first.roomId) as unknown as SDPLobby;
    const x = local.state.players.get(first.sessionId)!.x, token = first.reconnectionToken;
    first.reconnection.enabled = false; first.connection.close(4010);
    await until(() => !local.state.players.get(first.sessionId)!.connected);
    await sleep(7000);
    assert.equal(q2.state.ready, false);
    const restored = await client.reconnect(token); rooms.push(restored); restored.onMessage('station:state', () => {});
    await until(() => !!restored.state.players?.get(restored.sessionId)?.connected);
    assert.equal(restored.sessionId, first.sessionId); assert.equal(restored.roomId, first.roomId);
    assert.equal(local.state.players.get(restored.sessionId)!.x, x);
    assert.equal(q2.state.ready, false);
    await restored.leave(); admission.tick(Date.now() + 30001);
    await until(() => q2.state.ready);
    const next = await client.joinOrCreate('SDPLimboRoom', { admissionToken: q2.state.token }); rooms.push(next);
    next.onMessage('station:state', () => {});
    await until(() => !!next.state.players?.get(next.sessionId));
    assert.equal(admission.status(q2.state.token)!.ready, true);
  } finally {
    for (const room of rooms) if (room.connection.isOpen) await room.leave();
    await fixture.server.gracefullyShutdown(false); admission.enabled = false;
  }
});
