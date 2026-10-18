import test from 'node:test';
import assert from 'node:assert/strict';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { AmbientStationSession } from '../src/communication/AmbientStationSession';
import { ambientStation, validStationCommand, stationKeyboard, type StationSnapshot, type StationSound } from '../../shared/AmbientStation';
import { SDPLobby } from '../src/rooms/SDPLobby';
import type { LobbyState } from '../src/state/LobbyState';
import type { MovementSimulation } from '../src/simulation/MovementSimulation';
import { CollisionManager } from '../../src/player/CollisionManager';
import { lobbyBenches, lobbySeatSlots, seatExits } from '../../shared/LobbyRetreat';
import { listeningGarden, listeningGardenBenches } from '../../shared/ListeningGarden';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean) { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw Error('Instrument synchronization timed out'); await sleep(20); } }
const visitor = () => ({ x: ambientStation.x, y: 1.7, z: ambientStation.z + 1.8, connected: true, displayName: 'Artist', seatIndex: -1 });

test('instrument commands are bounded and cannot inject patterns, identities or positions; piano is chromatic', () => {
  for (const raw of [null, [], {}, { type: 'claim', ownerId: 'other' }, { type: 'parameter', track: 0, key: 'gain', value: Infinity },
    { type: 'clear', track: 4 }, { type: 'parameter', track: 0, key: { toString: 0 }, value: 1 }, { type: 'note', track: 0, note: 97, velocity: 1, on: true },
    { type: 'note', track: 0, note: 60, velocity: 1, on: true, at: 1 }, { type: 'preset', track: 1, preset: 'url' }]) assert.equal(validStationCommand(raw), false);
  assert.equal(validStationCommand({ type: 'note', track: 0, note: 60, velocity: .7, on: true }), true);
  assert.deepEqual(Object.values(stationKeyboard), Array.from({ length: 15 }, (_, i) => i));
  const world = new CollisionManager(); assert.equal(world.canOccupy(ambientStation.x, ambientStation.z), false);
  assert.equal(ambientStation.benches.length, 6);
  assert.equal(lobbyBenches.length, 15); assert.equal(lobbySeatSlots.length, 30);
  for (let i = 0; i < lobbySeatSlots.length; i++) assert.ok(seatExits(i).some(p => world.canOccupy(p.x, p.z)));
  assert.ok(world.canOccupy(listeningGarden.x, listeningGarden.z));
  for (const bench of listeningGardenBenches) {
    assert.equal(world.canOccupy(bench.x, bench.z), false);
    const dx = listeningGarden.x - bench.x, dz = listeningGarden.z - bench.z;
    assert.ok((-Math.sin(bench.yaw) * dx - Math.cos(bench.yaw) * dz) / Math.hypot(dx, dz) > .99);
  }
  for (const bench of ambientStation.benches) {
    const dx = ambientStation.x - bench.x, dz = ambientStation.z - bench.z;
    assert.ok(Math.hypot(dx, dz) >= 6);
    assert.ok((-Math.sin(bench.yaw) * dx - Math.cos(bench.yaw) * dz) / Math.hypot(dx, dz) > .99);
  }
});

test('lease is exclusive, notes/polyphony/pattern sizes are bounded, loops survive release, and idle or missing owners cannot lock it', () => {
  const sounds: StationSound[] = [], session = new AmbientStationSession('room', () => {}, sound => sounds.push(sound)), player = visitor();
  assert.match(session.handle('a', { ...player, x: 0 }, { type: 'claim' }, 1000)!, /closer/);
  session.handle('a', player, { type: 'claim' }, 1100);
  assert.equal(session.state.ownerId, 'a');
  assert.match(session.handle('b', player, { type: 'claim' }, 1200)!, /occupied/);
  session.handle('b', player, { type: 'parameter', track: 0, key: 'gain', value: 1 }, 1200); assert.equal(session.state.tracks[0].gain, .55);
  session.handle('a', player, { type: 'record', track: 0, enabled: true }, 1300);
  for (let n = 48; n < 58; n++) session.handle('a', player, { type: 'note', track: 0, note: n, velocity: .7, on: true }, 1400);
  assert.equal(sounds.filter(s => s.on).length, 8); assert.equal(session.state.tracks[0].notes.length, 8);
  session.handle('a', player, { type: 'note', track: 0, note: 48, velocity: 0, on: false }, 2200);
  assert.ok(session.state.tracks[0].notes[0].duration > 1);
  assert.ok(session.state.tracks[0].notes.every(n => n.step >= 0 && n.step < 64));
  session.remove('a', 2300); assert.equal(session.state.ownerId, ''); assert.equal(session.state.tracks[0].recording, false);
  assert.equal(session.state.playing, true); assert.equal(sounds.filter(s => !s.on).length, 8);
  session.handle('b', player, { type: 'claim' }, 2400); session.tick(2500, { ...player, connected: false }); assert.equal(session.state.ownerId, '');
  session.handle('b', player, { type: 'claim' }, 3000); session.tick(3000 + ambientStation.leaseMs + 1, player); assert.equal(session.state.ownerId, '');
  session.handle('c', player, { type: 'claim' }, 30000);
  for (let i = 0; i < 30; i++) session.handle('c', player, { type: 'heartbeat' }, 30000 + i * 5000);
  assert.equal(session.state.ownerId, '');
});

test('recording saturates at a bounded pattern size instead of allocating unbounded loops', () => {
  const session = new AmbientStationSession('bounded', () => {}, () => {}), player = visitor();
  session.handle('a', player, { type: 'claim' }, 1000);
  session.handle('a', player, { type: 'record', track: 0, enabled: true }, 1100);
  for (let i = 0; i < 75; i++) {
    session.handle('a', player, { type: 'note', track: 0, note: 48 + i % 12, velocity: .7, on: true }, 2000 + i * 1000);
    session.handle('a', player, { type: 'note', track: 0, note: 48 + i % 12, velocity: 0, on: false }, 2200 + i * 1000);
  }
  assert.equal(session.state.tracks[0].notes.length, ambientStation.maxNotes);
});

test('three real clients receive shared notes, loop edits and vacancy only inside their own Colyseus room', { timeout: 20000 }, async () => {
  const transport = new WebSocketTransport(), server = new Server({ transport, greet: false, gracefullyShutdown: false });
  server.define('InstrumentTest', SDPLobby); await server.listen(0, '127.0.0.1');
  const port = (transport.server!.address() as { port: number }).port, client = new Client(`http://127.0.0.1:${port}`), rooms: Room<LobbyState>[] = [];
  try {
    const a = await client.create<LobbyState>('InstrumentTest'), b = await client.joinById<LobbyState>(a.roomId), isolated = await client.create<LobbyState>('InstrumentTest'); rooms.push(a, b, isolated);
    let stateA: StationSnapshot | undefined, stateB: StationSnapshot | undefined; const foreign: unknown[] = [], sounds: StationSound[] = [], notices: string[] = [];
    a.onMessage('station:state', state => stateA = state); b.onMessage('station:state', state => stateB = state);
    a.onMessage('station:sound', () => {}); b.onMessage('station:sound', sound => sounds.push(sound));
    isolated.onMessage('station:state', state => foreign.push(state)); isolated.onMessage('station:sound', sound => foreign.push(sound));
    for (const room of rooms) room.onMessage('lobby:notice', message => notices.push(message));
    const room = matchMaker.getLocalRoomById(a.roomId) as SDPLobby;
    function approach(id: string) {
      const point = visitor(), p = room.state.players.get(id)!; p.x = point.x; p.z = point.z;
      (room as unknown as { simulation: MovementSimulation }).simulation.add(id, point);
    }
    await until(() => !!a.state.players?.get(b.sessionId));
    a.send('station:command', { type: 'claim' }); await until(() => notices.length > 0);
    approach(a.sessionId); approach(b.sessionId); a.send('station:command', { type: 'claim' });
    await until(() => stateA?.ownerId === a.sessionId && stateB?.ownerId === a.sessionId);
    b.send('station:command', { type: 'transport', playing: true }); await sleep(100); assert.equal(stateB!.playing, false);
    a.send('station:command', { type: 'record', track: 0, enabled: true }); await until(() => !!stateB?.tracks[0].recording);
    a.send('station:command', { type: 'note', track: 0, note: 60, velocity: .7, on: true }); await until(() => sounds.length === 1);
    await sleep(300); a.send('station:command', { type: 'note', track: 0, note: 60, velocity: 0, on: false }); await until(() => sounds.length === 2);
    await until(() => stateB?.tracks[0].notes.length === 1); assert.equal(sounds[0].roomId, a.roomId); assert.equal(sounds[0].on, true);
    assert.ok(stateB!.tracks[0].notes[0].duration >= 1); assert.deepEqual(foreign, []);
    await a.leave(); await until(() => stateB?.ownerId === '');
    b.send('station:command', { type: 'claim' }); await until(() => stateB?.ownerId === b.sessionId);
    assert.equal(stateB!.tracks[0].notes.length, 1);
    b.send('station:command', { type: 'release' }); await until(() => stateB?.ownerId === '');
    const exit = seatExits(16)[0], player = room.state.players.get(b.sessionId)!; player.x = exit.x; player.z = exit.z;
    (room as unknown as { simulation: MovementSimulation }).simulation.add(b.sessionId, exit);
    b.send('lobby:seat', { seat: 16 }); await until(() => b.state.players.get(b.sessionId)?.seatIndex === 16);
  } finally { await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave().catch(() => {}))); await server.gracefullyShutdown(false); }
});
