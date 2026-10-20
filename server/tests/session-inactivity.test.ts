import test from 'node:test';
import assert from 'node:assert/strict';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { Vector3 } from 'three';
import { SDPLobby } from '../src/rooms/SDPLobby';
import { SDPShooterRoom } from '../src/rooms/SDPShooterRoom';
import type { RoomInactivity } from '../src/communication/RoomInactivity';
import { sessionPolicy } from '../../shared/SessionPolicy';
import { LobbyPredictionHistory } from '../../src/network/LobbyPredictionHistory';
import type { NetworkPlayer } from '../../shared/MultiplayerProtocol';

test('lobby corrections compare acknowledged history, shift pending samples, and ignore stale acknowledgements', () => {
  const history = new LobbyPredictionHistory();
  const player: NetworkPlayer = { playerId: 'a', connected: true, x: 2, y: 1.8, z: 0, yaw: 0, pitch: 0, lastProcessedInput: 10 };
  history.record(10, new Vector3(8, 0, 0)); history.record(11, new Vector3(9, 0, 0));
  assert.equal(history.reconcile(player)!.x, -6);
  assert.equal(history.reconcile(player), undefined);
  assert.equal(history.reconcile({ ...player, x: 3, lastProcessedInput: 11 }), undefined);
  history.record(12, new Vector3(3, -7.2, 0));
  assert.ok(Math.abs(history.reconcile({ ...player, x: 3, lastProcessedInput: 12 })!.y - 7.2) < .001);
  history.reset(); assert.equal(history.reconcile({ ...player, lastProcessedInput: 12 }), undefined);
});

for (const [name, RoomType] of [['Limbo', SDPLobby], ['Shooter', SDPShooterRoom]] as const) {
  test(`${name}: five-minute idle eviction removes the player while real activity keeps another session`, { timeout: 20000 }, async () => {
    const transport = new WebSocketTransport(), server = new Server({ transport, greet: false, gracefullyShutdown: false });
    server.define(`Idle${name}`, RoomType); await server.listen(0, '127.0.0.1');
    const client = new Client(`http://127.0.0.1:${(transport.server!.address() as { port: number }).port}`);
    const rooms: Room[] = [], sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const until = async (fn: () => boolean) => { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw new Error('Idle eviction state timeout'); await sleep(20); } };
    try {
      const idle = await client.joinOrCreate(`Idle${name}`), active = await client.joinById(idle.roomId); rooms.push(idle, active);
      for (const room of rooms) for (const message of ['combat:ping', 'combat:event', 'station:state', 'weapon:event']) room.onMessage(message, () => {});
      await until(() => !!active.state.players?.get(idle.sessionId));
      const local = matchMaker.getLocalRoomById(idle.roomId) as SDPLobby | SDPShooterRoom;
      const tracker = (local as unknown as { inactivity: RoomInactivity }).inactivity;
      let closeCode = 0; idle.onLeave(code => { closeCode = code; });
      local.clock.elapsedTime = sessionPolicy.idleMs - 1000;
      active.send('session:activity', null);
      // A stationary movement heartbeat must not keep the idle client connected.
      const p = local.state.players.get(idle.sessionId)!;
      const input = { seq: 1, f: 0, r: 0, y: p.yaw, p: p.pitch, active: true };
      idle.send(name === 'Limbo' ? 'input' : 'shooter:input', name === 'Limbo' ? input : { ...input, life: 1, s: false, c: false, j: false, a: false });
      await sleep(100);
      tracker.check(sessionPolicy.idleMs + 500);
      await until(() => closeCode === sessionPolicy.idleCloseCode && !local.state.players.has(idle.sessionId));
      assert.equal(local.state.players.get(active.sessionId)!.connected, true);
      assert.equal(local.state.online, 1);
      await until(() => !active.state.players.has(idle.sessionId));
      assert.equal(active.state.online, 1);
    } finally {
      for (const room of rooms) if (room.connection.isOpen) await room.leave();
      await server.gracefullyShutdown(false);
    }
  });
}
