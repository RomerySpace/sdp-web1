import { Room, ServerError, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { MAX_PLAYERS } from '../../../shared/MultiplayerProtocol';
import { SHOOTER_HZ, SHOOTER_PATCH_HZ, shooterNetworkConfig, validateShooterInput, validateWeaponAction, type ShooterInput } from '../../../shared/ShooterProtocol';
import type { RoomChatMessage } from '../../../shared/CommunicationProtocol';
import { ShooterState, ShooterPlayer } from '../state/ShooterState';
import { ShooterWorld } from '../simulation/ShooterWorld';
import { ChatPolicy } from '../communication/ChatPolicy';
import { gameConfig } from '../../../src/modes/shooter/config/gameConfig';
import { gameplayConfig } from '../../../shared/GameplayConfig';
import { shooterEnabled } from '../config/GameplayConfig';
import { CombatSimulation, type CombatPose } from '../simulation/CombatSimulation';
interface Entry { input: ShooterInput; received: number; slot: number; lastAction: number; lastShot: number; reloadUntil: number;
  probe: string; probeAt: number; rtt: number }
export class SDPShooterRoom extends Room<{ state: ShooterState }> {
  state = new ShooterState(); maxClients = MAX_PLAYERS; maxMessagesPerSecond = 100;
  private world!: ShooterWorld;
  private readonly entries = new Map<string, Entry>();
  private readonly chat = new ChatPolicy();
  private accumulator = 0;
  private readonly combat = new CombatSimulation();
  async onCreate(): Promise<void> {
    if (!shooterEnabled) throw new ServerError(403, 'Shooter test is disabled.');
    this.world = await ShooterWorld.create();
    this.setPatchRate(1000 / SHOOTER_PATCH_HZ);
    this.onMessage('shooter:input', (client, raw: unknown) => {
      const entry = this.entries.get(client.sessionId), input = validateShooterInput(raw);
      const player = this.state.players.get(client.sessionId);
      if (!entry || !input || input.seq <= entry.input.seq || !player?.connected || player.dead || input.life !== player.life) return;
      entry.input = input; entry.received = this.clock.elapsedTime;
      this.world.input(client.sessionId, input);
    });
    this.onMessage('weapon:action', (client, raw: unknown) => {
      const entry = this.entries.get(client.sessionId), action = validateWeaponAction(raw), player = this.state.players.get(client.sessionId);
      if (!entry || !action || !player?.connected || player.dead || action.life !== player.life || action.seq <= entry.lastAction) return;
      entry.lastAction = action.seq; player.weaponSeq = action.seq;
      const now = this.clock.elapsedTime, w = gameConfig.weapon;
      if (action.action === 'fire') {
        if (!entry.input.active || now - entry.received > shooterNetworkConfig.inputTimeoutMs || player.reloading || player.ammo <= 0 || now - entry.lastShot < w.fireInterval * 1000) return;
        entry.lastShot = now; player.ammo--;
        player.protectedUntil = Math.min(player.protectedUntil, now);
        const poses = this.poses(now);
        const hit = this.combat.fire(this.world, this.pose(client.sessionId, now), entry.input.y, entry.input.p, now, entry.rtt, poses);
        if (hit) this.damage(hit, client.sessionId, now);
      } else {
        if (player.reloading || player.ammo >= w.magazineSize || player.reserve <= 0) return;
        player.reloading = true; entry.reloadUntil = now + w.reloadDuration * 1000;
      }
      this.broadcast('weapon:event', { ...action, playerId: client.sessionId, roomId: this.roomId, timestamp: Date.now() });
    });
    this.onMessage('combat:pong', (client, nonce: unknown) => {
      const entry = this.entries.get(client.sessionId), now = this.clock.elapsedTime;
      if (entry?.probe && nonce === entry.probe) {
        const sample = now - entry.probeAt;
        entry.rtt = Math.min(1000, Math.max(0, sample)); entry.probe = '';
      }
    });
    this.clock.setInterval(() => {
      for (const client of this.clients) {
        const entry = this.entries.get(client.sessionId); if (!entry) continue;
        entry.probe = randomUUID(); entry.probeAt = this.clock.elapsedTime; client.send('combat:ping', entry.probe);
      }
    }, 1000);
    this.onMessage('chat:send', (client, raw: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
      const message = this.chat.accept(client.sessionId, raw, this.clock.elapsedTime);
      if (!message) { client.send('chat:error', 'Message is empty, too long, or sent too quickly.'); return; }
      const data: RoomChatMessage = { messageId: randomUUID(), senderId: client.sessionId,
        senderName: `PLAYER ${String((this.entries.get(client.sessionId)?.slot ?? 0) + 1).padStart(2, '0')}`,
        message, timestamp: Date.now(), roomId: this.roomId, position: { x: player.x, y: player.y, z: player.z } };
      this.broadcast('chat:message', data);
    });
    this.onMessage('voice:request', (client, raw: unknown) => {
      const requestId = raw && typeof raw === 'object' && 'requestId' in raw ? String(raw.requestId) : '';
      client.send('voice:access', { requestId, error: 'Voice is available in Limbo only.' });
    });
    this.setSimulationInterval(elapsed => {
      this.accumulator = Math.min(100, this.accumulator + elapsed);
      while (this.accumulator >= 1000 / SHOOTER_HZ) { this.step(); this.accumulator -= 1000 / SHOOTER_HZ; }
    }, 1000 / SHOOTER_HZ);
  }
  onJoin(client: Client): void {
    if (!shooterEnabled) throw new ServerError(403, 'Shooter test is disabled.');
    const used = new Set([...this.entries.values()].map(entry => entry.slot)); let slot = 0; while (used.has(slot)) slot++;
    const character = this.world.add(client.sessionId, slot);
    const player = new ShooterPlayer();
    Object.assign(player, character.spawn, { yaw: gameConfig.player.spawn.yaw,
      spawnX: character.spawn.x, spawnY: character.spawn.y, spawnZ: character.spawn.z });
    player.bornAt = this.clock.elapsedTime; player.protectedUntil = player.bornAt + gameplayConfig.combat.spawnProtection * 1000;
    this.state.players.set(client.sessionId, player); this.state.online++;
    this.entries.set(client.sessionId, { slot, received: this.clock.elapsedTime, lastAction: -1, lastShot: -1000, reloadUntil: 0, probe: '', probeAt: 0, rtt: 0,
      input: { seq: -1, life: player.life, f: 0, r: 0, y: player.yaw, p: 0, s: false, c: false, j: false, a: false, active: false } });
    this.combat.record(this.poses(this.clock.elapsedTime));
  }
  onDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId), entry = this.entries.get(client.sessionId);
    if (player?.connected) { player.connected = false; this.state.online--; }
    if (entry) { entry.input.active = false; this.world.input(client.sessionId, entry.input); }
    this.allowReconnection(client, 5);
  }
  onReconnect(client: Client): void { const player = this.state.players.get(client.sessionId); if (player && !player.connected) { player.connected = true; this.state.online++; } }
  onLeave(client: Client): void {
    if (this.state.players.get(client.sessionId)?.connected) this.state.online--;
    this.world.remove(client.sessionId); this.state.players.delete(client.sessionId); this.entries.delete(client.sessionId); this.chat.remove(client.sessionId);
  }
  private step(): void {
    const now = this.clock.elapsedTime;
    for (const [id, entry] of this.entries) {
      const player = this.state.players.get(id)!;
      if (player.dead) {
        if (now >= player.respawnAt) this.respawn(id, now);
        continue;
      }
      if (!player.connected || now - entry.received > shooterNetworkConfig.inputTimeoutMs) { entry.input.active = false; this.world.input(id, entry.input); }
      if (player.reloading && now >= entry.reloadUntil) {
        const transfer = Math.min(gameConfig.weapon.magazineSize - player.ammo, player.reserve);
        player.ammo += transfer; player.reserve -= transfer; player.reloading = false;
      }
    }
    this.world.step(id => this.state.players.get(id)!.reloading);
    for (const [id, entry] of this.entries) {
      const player = this.state.players.get(id)!, body = this.world.player(id)!;
      if (player.dead) continue;
      player.x = body.current.x; player.y = body.current.y - body.height / 2; player.z = body.current.z;
      player.yaw = entry.input.y; player.pitch = entry.input.p; player.height = body.height;
      player.crouching = body.crouching; player.sprinting = body.sprinting; player.grounded = body.grounded;
      player.lastProcessedInput = Math.max(0, entry.input.seq);
    }
    this.state.tick = (this.state.tick + 1) >>> 0;
    this.state.serverTime = now;
    this.combat.record(this.poses(now));
  }
  private pose(id: string, time: number): CombatPose {
    const p = this.state.players.get(id)!;
    return { id, time, life: p.life, x: p.x, y: p.y, z: p.z, height: p.height, dead: p.dead, connected: p.connected, protectedUntil: p.protectedUntil };
  }
  private poses(time: number): CombatPose[] { return [...this.state.players.keys()].map(id => this.pose(id, time)); }
  private damage(id: string, attackerId: string, now: number): void {
    const player = this.state.players.get(id)!;
    if (player.dead || !player.connected || now < player.protectedUntil) return;
    const damage = Math.min(player.health, gameplayConfig.combat.damage);
    player.health -= damage;
    this.broadcast('combat:event', { type: 'damage', playerId: id, attackerId, health: player.health, damage, life: player.life, roomId: this.roomId, timestamp: now });
    if (!player.health) {
      player.dead = true; player.diedAt = now; player.respawnAt = now + gameplayConfig.combat.respawnDelay * 1000;
      player.reloading = false; player.sprinting = false;
      const entry = this.entries.get(id)!; entry.input.active = false; entry.reloadUntil = 0;
      this.world.freeze(id);
      this.broadcast('combat:event', { type: 'death', playerId: id, attackerId, health: 0, life: player.life, roomId: this.roomId, timestamp: now });
    }
  }
  private respawn(id: string, now: number): void {
    const p = this.state.players.get(id)!, entry = this.entries.get(id)!;
    let body;
    try { body = this.world.respawn(id); }
    catch { return; } // Retry next tick instead of placing a player inside geometry.
    Object.assign(p, { x: body.spawn.x, y: body.spawn.y, z: body.spawn.z,
      spawnX: body.spawn.x, spawnY: body.spawn.y, spawnZ: body.spawn.z, yaw: gameConfig.player.spawn.yaw, pitch: 0,
      dead: false, life: p.life + 1, diedAt: 0, respawnAt: 0, bornAt: now,
      protectedUntil: now + gameplayConfig.combat.spawnProtection * 1000,
      health: gameplayConfig.combat.maxHealth, ammo: gameConfig.weapon.magazineSize, reserve: gameConfig.weapon.reserveAmmo,
      reloading: false, crouching: false, sprinting: false, grounded: false, height: gameConfig.player.height });
    entry.input = { ...entry.input, life: p.life, f: 0, r: 0, s: false, c: false, j: false, a: false, active: false, y: p.yaw, p: 0 };
    entry.received = now; entry.lastShot = -1000; entry.reloadUntil = 0;
    this.broadcast('combat:event', { type: 'respawn', playerId: id, health: p.health, life: p.life, roomId: this.roomId, timestamp: now });
  }
  onDispose(): void { this.world?.dispose(); this.entries.clear(); this.chat.clear(); this.combat.clear(); }
}
