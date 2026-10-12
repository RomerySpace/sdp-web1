import { ArraySchema, MapSchema, Schema, defineTypes } from '@colyseus/schema';
import { MAX_PLAYERS } from '../../../shared/MultiplayerProtocol';
import { gameplayConfig } from '../../../shared/GameplayConfig';
import { shooterEnabled } from '../config/GameplayConfig';
export class ShooterPlayer extends Schema {
  displayName = ''; automatic = false; kills = 0; deaths = 0; streak = 0; lastDamageAt = 0;
  x = 0; y = 0; z = 0; yaw = 0; pitch = 0; connected = true;
  lastProcessedInput = 0; crouching = false; sprinting = false; grounded = false; height = 1.8;
  ammo = gameplayConfig.combat.magazineSize; reserve = gameplayConfig.combat.reserveAmmo;
  reloading = false; weaponSeq = 0; health = gameplayConfig.combat.maxHealth;
  dead = false; life = 1; diedAt = 0; respawnAt = 0; bornAt = 0; protectedUntil = 0;
  spawnX = 0; spawnY = 0; spawnZ = 0;
}
defineTypes(ShooterPlayer, { x: 'float32', y: 'float32', z: 'float32', yaw: 'float32', pitch: 'float32',
  displayName: 'string', automatic: 'boolean', kills: 'uint32', deaths: 'uint32', streak: 'uint32', lastDamageAt: 'float64',
  connected: 'boolean', lastProcessedInput: 'uint32', crouching: 'boolean', sprinting: 'boolean', grounded: 'boolean', height: 'float32',
  ammo: 'uint16', reserve: 'uint16', reloading: 'boolean', weaponSeq: 'uint32', health: 'uint16',
  dead: 'boolean', life: 'uint32', diedAt: 'float64', respawnAt: 'float64', bornAt: 'float64', protectedUntil: 'float64',
  spawnX: 'float32', spawnY: 'float32', spawnZ: 'float32' });
export class KillState extends Schema {
  id = ''; attackerId = ''; victimId = ''; attackerName = ''; victimName = ''; region = ''; timestamp = 0;
}
defineTypes(KillState, { id: 'string', attackerId: 'string', victimId: 'string', attackerName: 'string', victimName: 'string', region: 'string', timestamp: 'float64' });
export class ShooterState extends Schema {
  killFeed = new ArraySchema<KillState>();
  players = new MapSchema<ShooterPlayer>(); online = 0; capacity = MAX_PLAYERS; tick = 0;
  match = 'waiting'; round = 0; matchEndsAt = 0; nextRoundAt = 0; results = new ArraySchema<RoundScoreState>();
  serverTime = 0; shooterEnabled = shooterEnabled;
}
export class RoundScoreState extends Schema {
  playerId = ''; displayName = ''; kills = 0; deaths = 0; streak = 0;
}
defineTypes(RoundScoreState, { playerId: 'string', displayName: 'string', kills: 'uint32', deaths: 'uint32', streak: 'uint32' });
defineTypes(ShooterState, { killFeed: [KillState], players: { map: ShooterPlayer }, online: 'uint8', capacity: 'uint8', tick: 'uint32', match: 'string',
  round: 'uint32', matchEndsAt: 'float64', nextRoundAt: 'float64', results: [RoundScoreState], serverTime: 'float64', shooterEnabled: 'boolean' });
