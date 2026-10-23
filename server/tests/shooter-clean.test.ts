import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, type Room } from '@colyseus/sdk';
import type { ShooterState } from '../src/state/ShooterState';
import { inspectRoom, shooterFixture } from './shooter-fixture';

test('twelve eliminations retain K/D but never create rewards; retired missile requests have no effect', async () => {
  const fixture = await shooterFixture(), sdk = new Client(`http://127.0.0.1:${fixture.port}`), clients: Room<ShooterState>[] = [];
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const a = await sdk.joinOrCreate<ShooterState>('SDPShooterRoom', { displayName: 'Clean One' }); clients.push(a);
    const b = await sdk.joinById<ShooterState>(a.roomId, { displayName: 'Clean Two' }); clients.push(b);
    for (const room of clients) {
      room.reconnection.enabled = false;
      room.onMessage('combat:event', () => {}); room.onMessage('combat:ping', nonce => room.send('combat:pong', nonce));
    }
    const room = fixture.room(a.roomId), trusted = inspectRoom(room);
    const owner = room.state.players.get(a.sessionId)!, victim = room.state.players.get(b.sessionId)!;
    for (let i = 0; i < 12; i++) {
      trusted.respawn(b.sessionId, room.clock.elapsedTime); victim.protectedUntil = 0;
      trusted.applyDamage(b.sessionId, a.sessionId, 100, 'head', room.clock.elapsedTime);
    }
    assert.equal(owner.kills, 12); assert.equal(victim.deaths, 12);
    for (const player of [owner, victim]) {
      assert.equal('streak' in player, false); assert.equal('strikes' in player, false);
    }
    assert.equal('airstrikes' in room.state, false);
    trusted.respawn(b.sessionId, room.clock.elapsedTime); victim.protectedUntil = 0;
    a.send('strike:request', { seq: 1, life: owner.life, slot: 1, x: victim.x, z: victim.z });
    await sleep(150);
    assert.equal(victim.health, 100); assert.equal(victim.dead, false);
    assert.equal('airstrikes' in a.state, false);
    assert.equal(a.state.players.get(a.sessionId)!.kills, 12);
    assert.equal(b.state.players.get(b.sessionId)!.deaths, 12);
  } finally {
    for (const room of clients) {
      if (room.connection.isOpen) await room.leave();
      else {
        const restored = await sdk.reconnect<ShooterState>(room.reconnectionToken);
        restored.reconnection.enabled = false;
        await restored.leave();
      }
    }
    await fixture.server.gracefullyShutdown(false);
  }
});
