import assert from 'node:assert/strict';
import test from 'node:test';
import { VisitorPreferences } from '../../src/core/VisitorPreferences';
import { ChatManager } from '../../src/chat/ChatManager';
import type { MultiplayerConnection } from '../../src/network/MultiplayerConnection';
import type { RoomChatMessage } from '../../shared/CommunicationProtocol';
import { lobbyRetreat } from '../../shared/LobbyRetreat';
import { CollisionManager } from '../../src/player/CollisionManager';
import { spawnPosition } from '../src/simulation/SpawnPositions';

test('local visitor boundaries use session identities, preserve individual choices and can be reversed', () => {
  const preferences = new VisitorPreferences(), artist = preferences.remember('session-a', 'Artist');
  preferences.remember('session-b', 'Artist');
  artist.voice = true; assert.equal(preferences.muted(artist.id), true); assert.equal(preferences.hidden(artist.id), false);
  artist.blocked = true; assert.equal(preferences.hidden(artist.id), true); assert.equal(preferences.muted('session-b'), false);
  artist.blocked = false; assert.equal(preferences.hidden(artist.id), false); assert.equal(preferences.muted(artist.id), true);
  artist.voice = false; assert.equal(preferences.muted(artist.id), false);
  assert.equal(new VisitorPreferences().muted(artist.id), false);
});

test('hidden chat senders are removed from history and future delivery without filtering other identities', () => {
  let receive!: (message: RoomChatMessage) => void;
  const network = { snapshot: { localPlayerId: 'self' }, subscribeToChat: (callback: typeof receive) => { receive = callback; return () => {}; } } as unknown as MultiplayerConnection;
  const chat = new ChatManager(network), delivered: string[] = [];
  chat.subscribe(message => delivered.push(message.messageId));
  const message = (id: string, sender: string) => ({ messageId: id, senderId: sender, senderName: 'Visitor', message: 'Hello', timestamp: 1, position: { x: 0, y: 0, z: 0 }, roomId: 'room' });
  receive(message('one', 'a')); receive(message('two', 'b'));
  chat.setHiddenSenders(id => id === 'a'); assert.deepEqual(chat.history.map(message => message.senderId), ['b']);
  receive(message('three', 'a')); receive(message('four', 'b')); assert.deepEqual(delivered, ['one', 'two', 'four']);
  chat.setHiddenSenders(() => false); receive(message('five', 'a')); assert.equal(chat.history.at(-1)?.messageId, 'five');
  chat.dispose();
});

test('listening seats block swept movement along their rotated footprint and all existing spawns stay clear', () => {
  const world = new CollisionManager();
  const trunk = { x: lobbyRetreat.x, z: lobbyRetreat.z + 3 };
  world.move(trunk, 0, -6);
  assert.ok(trunk.z >= lobbyRetreat.z + lobbyRetreat.trunkRadius + world.radius - .01);
  for (const seat of lobbyRetreat.seats) {
    const c = Math.cos(seat.yaw), s = Math.sin(seat.yaw), point = { x: seat.x + c * 3, z: seat.z - s * 3 };
    world.move(point, -c * 6, s * 6);
    assert.ok(Math.hypot(point.x - seat.x, point.z - seat.z) > lobbyRetreat.seatWidth / 2);
  }
  for (let i = 0; i < 25; i++) {
    const spawn = spawnPosition(i), point = { x: spawn.x, z: spawn.z };
    world.move(point, .001, .001); assert.ok(Math.abs(point.x - spawn.x - .001) < 1e-8); assert.ok(Math.abs(point.z - spawn.z - .001) < 1e-8);
  }
});
