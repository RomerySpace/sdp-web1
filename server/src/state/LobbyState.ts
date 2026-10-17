import { defineTypes, MapSchema, Schema } from '@colyseus/schema';
import { MAX_PLAYERS, PLAYER_HEIGHT } from '../../../shared/MultiplayerProtocol';
import { shooterEnabled } from '../config/GameplayConfig';

export class VisitorState extends Schema {
  seatIndex = -1;
  displayName = '';
  crouching = false;
  x = 0;
  y = PLAYER_HEIGHT;
  z = 9;
  yaw = 0;
  pitch = 0;
  connected = true;
  lastProcessedInput = 0;
}
defineTypes(VisitorState, {
  seatIndex: 'int8',
  displayName: 'string', crouching: 'boolean',
  x: 'float32', y: 'float32', z: 'float32', yaw: 'float32', pitch: 'float32',
  connected: 'boolean', lastProcessedInput: 'uint32',
});

export class LobbyState extends Schema {
  wallTime = Date.now();
  shooterEnabled = shooterEnabled;
  players = new MapSchema<VisitorState>();
  online = 0;
  capacity = MAX_PLAYERS;
  tick = 0;
}
defineTypes(LobbyState, { wallTime: 'float64',
  shooterEnabled: 'boolean',
  players: { map: VisitorState }, online: 'uint8', capacity: 'uint8', tick: 'uint32',
});
