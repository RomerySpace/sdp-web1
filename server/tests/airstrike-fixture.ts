import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { SDPShooterRoom } from '../src/rooms/SDPShooterRoom';
import { SDPLobby } from '../src/rooms/SDPLobby';
import type { ShooterWorld } from '../src/simulation/ShooterWorld';
import { SDPAdmission } from '../src/rooms/SDPAdmission';

export async function airstrikeFixture() {
  const transport = new WebSocketTransport(), server = new Server({ transport, greet: false, gracefullyShutdown: false });
  server.define('SDPShooterRoom', SDPShooterRoom); server.define('SDPLimboRoom', SDPLobby);
  server.define('SDPAdmission', SDPAdmission);
  await server.listen(0, '127.0.0.1');
  const port = (transport.server!.address() as { port: number }).port;
  return { server, port, room: (id: string) => matchMaker.getLocalRoomById(id) as SDPShooterRoom };
}
export function inspectRoom(room: SDPShooterRoom) {
  return room as unknown as {
    world: ShooterWorld;
    respawn(id: string, now: number): void;
    applyDamage(id: string, attacker: string, amount: number, region: 'head' | 'blast', now: number, life: number): void;
  };
}
// Trusted test-process calls only. This is never registered as a client message or HTTP route.
export function earnThree(room: SDPShooterRoom, owner: string, victim: string): void {
  const internal = inspectRoom(room), player = room.state.players.get(owner)!;
  for (let i = 0; i < 3; i++) {
    internal.respawn(victim, room.clock.elapsedTime); room.state.players.get(victim)!.protectedUntil = 0;
    internal.applyDamage(victim, owner, 100, 'head', room.clock.elapsedTime, player.life);
  }
  internal.respawn(victim, room.clock.elapsedTime); room.state.players.get(victim)!.protectedUntil = 0;
}
