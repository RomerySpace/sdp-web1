import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { lowerGallery as g, galleryStairHeight, inGalleryRoom, galleryBarrier } from '../../shared/LowerGallery';
import { simulateMovement, type MotionState } from '../../shared/Movement';
import { PLAYER_HEIGHT } from '../../shared/MultiplayerProtocol';
import { CollisionManager } from '../../src/player/CollisionManager';
import { createLobbyGround } from '../../src/scene/LobbyGround';
import { lobbySeatSlots } from '../../shared/LobbyRetreat';
import { SDPLobby } from '../src/rooms/SDPLobby';
import type { LobbyState } from '../src/state/LobbyState';
import type { MovementSimulation } from '../src/simulation/MovementSimulation';

test('stairs reach the lower floor through bounded treads and a real opening without removing the monolith floor', () => {
  assert.equal(galleryStairHeight(30), 0); assert.ok(Math.abs(galleryStairHeight(12) - g.floorY) < 1e-8);
  assert.equal(galleryStairHeight(21), -3.6);
  assert.ok(-.24 - galleryStairHeight(g.openStairStart) > 2.8);
  const geometry = createLobbyGround(), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld(); const ray = new Raycaster(new Vector3(27, 5, g.stairZ), new Vector3(0, -1, 0));
  try {
    assert.equal(ray.intersectObject(mesh).length, 0);
    ray.ray.origin.set(21, 5, g.stairZ); assert.ok(Math.abs(ray.intersectObject(mesh)[0].point.y) < 1e-6);
    ray.ray.origin.set(0, 5, 0); assert.ok(Math.abs(ray.intersectObject(mesh)[0].point.y) < 1e-6);
  } finally { geometry.dispose(); material.dispose(); }
});

test('one authoritative motion state descends and ascends while walls keep the two overlapping floors separate', () => {
  const world = new CollisionManager(), state: MotionState = { x: 32, z: g.stairZ, velocityX: 0, velocityZ: 0 };
  const input = { seq: 1, active: true, f: 1, r: 0, y: Math.PI / 2, p: 0 };
  for (let i = 0; i < 148; i++) simulateMovement(state, input, .05, world);
  assert.ok(state.x < 12 && state.x > 8); assert.ok(Math.abs(state.groundY! - g.floorY) < 1e-8);
  assert.equal(world.groundHeight(0, 0), 0); assert.equal(world.groundHeight(0, 0, g.floorY), g.floorY);
  assert.equal(world.canOccupy(13, 8, g.floorY), false); assert.equal(world.canOccupy(13, 8), true);
  assert.equal(world.canOccupy(27, g.stairZ + g.stairHalfWidth), false);
  assert.equal(world.groundHeight(21, 0, 0), 0);
  assert.equal(galleryBarrier(g.openStairStart, 0, .3, 0), true);
  assert.equal(galleryBarrier(g.openStairStart, 0, .3, -2.4), false);
  assert.equal(inGalleryRoom(11, 11), false); assert.equal(inGalleryRoom(0, 11), true);
  input.y = -Math.PI / 2;
  for (let i = 0; i < 170; i++) simulateMovement(state, input, .05, world);
  assert.ok(state.x > 30); assert.equal(state.groundY, 0);
});

test('real clients cannot reserve a downstairs seat from upstairs and standing retains the lower floor', { timeout: 12000 }, async () => {
  const transport = new WebSocketTransport(), server = new Server({ transport, greet: false, gracefullyShutdown: false });
  server.define('GallerySeat', SDPLobby); await server.listen(0, '127.0.0.1');
  const client = new Client(`http://127.0.0.1:${(transport.server!.address() as { port: number }).port}`), rooms: Room<LobbyState>[] = [];
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const until = async (fn: () => boolean) => { const end = Date.now() + 4000; while (!fn()) { if (Date.now() > end) throw new Error('Gallery state timeout'); await sleep(20); } };
  try {
    const a = await client.joinOrCreate<LobbyState>('GallerySeat'), b = await client.joinOrCreate<LobbyState>('GallerySeat'); rooms.push(a, b);
    const notices: string[] = [];
    a.onMessage('lobby:notice', text => notices.push(text)); b.onMessage('lobby:notice', () => {});
    await until(() => !!b.state.players?.get(a.sessionId));
    const room = matchMaker.getLocalRoomById(a.roomId) as SDPLobby;
    const slot = lobbySeatSlots.findIndex(s => s.groundY === g.floorY && Math.abs(s.z) < 1), seat = lobbySeatSlots[slot];
    const place = (groundY: number) => {
      const p = room.state.players.get(a.sessionId)!; p.x = seat.x - 1; p.z = seat.z; p.y = groundY + PLAYER_HEIGHT;
      (room as unknown as { simulation: MovementSimulation }).simulation.add(a.sessionId, { x: p.x, z: p.z, groundY });
    };
    place(0); a.send('lobby:seat', { seat: slot }); await until(() => notices.length > 0);
    assert.equal(a.state.players.get(a.sessionId)!.seatIndex, -1);
    await sleep(280); place(g.floorY); a.send('lobby:seat', { seat: slot });
    await until(() => b.state.players.get(a.sessionId)!.seatIndex === slot);
    assert.ok(Math.abs(b.state.players.get(a.sessionId)!.y - (g.floorY + 1.18)) < .001);
    a.send('lobby:seat', { seat: -1 }); await until(() => b.state.players.get(a.sessionId)!.seatIndex === -1);
    assert.ok(Math.abs(b.state.players.get(a.sessionId)!.y - (g.floorY + PLAYER_HEIGHT)) < .001);
  } finally { await Promise.all(rooms.map(room => room.leave())); await server.gracefullyShutdown(false); }
});
