import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { SDPShooterRoom } from '../src/rooms/SDPShooterRoom';
import { SDPLobby } from '../src/rooms/SDPLobby';
import type { ShooterWorld } from '../src/simulation/ShooterWorld';
import { SDPAdmission } from '../src/rooms/SDPAdmission';

export async function shooterFixture() {
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
    applyDamage(id: string, attacker: string, amount: number, region: 'head', now: number): void;
  };
}
