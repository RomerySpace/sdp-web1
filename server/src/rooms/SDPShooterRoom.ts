import { Room, ServerError, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { MAX_PLAYERS } from '../../../shared/MultiplayerProtocol';
import { SHOOTER_HZ, SHOOTER_PATCH_HZ, shooterNetworkConfig, validateShooterInput, validateWeaponAction, type ShooterInput } from '../../../shared/ShooterProtocol';
import type { RoomChatMessage } from '../../../shared/CommunicationProtocol';
import { ShooterState, ShooterPlayer, KillState, RoundScoreState, AirstrikeState } from '../state/ShooterState';
import { airstrikeConfig, blastDamage, earnedStrikeMask, strikeBit, validateAirstrikeRequest, type AirstrikeResult } from '../../../shared/AirstrikeProtocol';
import { ShooterWorld } from '../simulation/ShooterWorld';
import { ChatPolicy } from '../communication/ChatPolicy';
import { gameConfig } from '../../../src/modes/shooter/config/gameConfig';
import { gameplayConfig } from '../../../shared/GameplayConfig';
import { shooterEnabled } from '../config/GameplayConfig';
import { CombatSimulation, type CombatPose, type PlayerHit } from '../simulation/CombatSimulation';
import { HealthRecovery } from '../simulation/HealthRecovery';
import { ShooterMatch } from '../simulation/ShooterMatch';
import { roomDisplayName, validateDisplayName } from '../../../shared/PlayerIdentity';
import { shotRecoil } from '../../../shared/WeaponRecoil';
import { advanceGait } from '../../../shared/AvatarAnimation';
import { RoomInactivity } from '../communication/RoomInactivity';
import { sessionPolicy } from '../../../shared/SessionPolicy';
import { admission } from '../communication/Admission';
import { admissionConfig } from '../../../shared/Admission';
interface Entry { input: ShooterInput; received: number; slot: number; lastAction: number; lastShot: number; nextShotAt: number; reloadUntil: number;
  probe: string; probeAt: number; rtt: number; recovery: HealthRecovery; burstShots: number; awardedStrikes: number; strikeSequence: number; lastStrike: number }
export class SDPShooterRoom extends Room<{ state: ShooterState }> {
  static async onAuth(_token: string, options: { displayName?: unknown; admissionToken?: unknown } = {}): Promise<boolean> {
    if (!shooterEnabled) throw new ServerError(403, 'Shooter test is disabled.');
    if (options.displayName !== undefined && !validateDisplayName(options.displayName)) throw new ServerError(400, 'Invalid display name.');
    admission.validate(options.admissionToken);
    return true;
  }
  state = new ShooterState(); maxClients = MAX_PLAYERS; maxMessagesPerSecond = 100;
  private world!: ShooterWorld;
  private readonly entries = new Map<string, Entry>();
  private readonly chat = new ChatPolicy();
  private accumulator = 0;
  private readonly combat = new CombatSimulation();
  private readonly match = new ShooterMatch();
  private readonly impacted = new Set<string>();
  private inactivity!: RoomInactivity;
  async onCreate(): Promise<void> {
    if (!shooterEnabled) throw new ServerError(403, 'Shooter test is disabled.');
    this.world = await ShooterWorld.create();
    this.inactivity = new RoomInactivity(this);
    this.setPatchRate(1000 / SHOOTER_PATCH_HZ);
    this.onMessage('strike:request', (client, raw: unknown) => {
      const request = validateAirstrikeRequest(raw), entry = this.entries.get(client.sessionId), player = this.state.players.get(client.sessionId);
      if (!request || !entry || !player) return;
      const now = this.clock.elapsedTime;
      const reply = (accepted: boolean, message: string) => client.send('strike:result', { seq: request.seq, roomId: this.roomId, accepted, message } satisfies AirstrikeResult);
      if (!this.match.active(now) || !player.connected || player.dead || request.life !== player.life || request.seq <= entry.strikeSequence) { reply(false, 'PROTOCOL UNAVAILABLE'); return; }
      entry.strikeSequence = request.seq;
      if (now - entry.lastStrike < airstrikeConfig.requestInterval) { reply(false, 'PLEASE WAIT'); return; }
      entry.lastStrike = now;
      if (!(player.strikes & strikeBit(request.slot))) { reply(false, 'STREAK UNAVAILABLE'); return; }
      if (this.state.airstrikes.length >= airstrikeConfig.maxActive) { reply(false, 'AIRSPACE BUSY'); return; }
      if (now + (airstrikeConfig.approach + airstrikeConfig.fall) * 1000 >= this.match.endsAt) { reply(false, 'ROUND ENDING'); return; }
      const target = this.world.strikeTarget(request.x, request.z);
      if (!target) { reply(false, 'TARGET UNAVAILABLE'); return; }
      const strike = Object.assign(new AirstrikeState(), target, { id: randomUUID(), ownerId: client.sessionId, ownerName: player.displayName,
        life: player.life, round: this.match.round, heading: Math.random() * Math.PI * 2,
        startedAt: now, releasedAt: now + airstrikeConfig.approach * 1000,
        impactAt: now + (airstrikeConfig.approach + airstrikeConfig.fall) * 1000,
        finishedAt: now + (airstrikeConfig.approach + airstrikeConfig.fall + airstrikeConfig.departure) * 1000 });
      player.strikes &= ~strikeBit(request.slot);
      player.protectedUntil = Math.min(player.protectedUntil, now);
      this.state.airstrikes.push(strike); reply(true, 'AIRSTRIKE INBOUND');
      this.inactivity.touch(client.sessionId);
    });
    this.onMessage('shooter:input', (client, raw: unknown) => {
      const entry = this.entries.get(client.sessionId), input = validateShooterInput(raw);
      const player = this.state.players.get(client.sessionId);
      if (!this.match.active(this.clock.elapsedTime) || !entry || !input || input.seq <= entry.input.seq || !player?.connected || player.dead || input.life !== player.life) return;
      this.inactivity.input(client.sessionId, input, entry.input);
      entry.input = input; entry.received = this.clock.elapsedTime;
      this.world.input(client.sessionId, input);
    });
    this.onMessage('weapon:action', (client, raw: unknown) => {
      const entry = this.entries.get(client.sessionId), action = validateWeaponAction(raw), player = this.state.players.get(client.sessionId);
      if (!this.match.active(this.clock.elapsedTime) || !entry || !action || !player?.connected || player.dead || action.life !== player.life || action.seq <= entry.lastAction) return;
      entry.lastAction = action.seq; player.weaponSeq = action.seq;
      const now = this.clock.elapsedTime, w = gameConfig.weapon;
      if (action.action === 'fire') {
        const interval = player.automatic ? gameplayConfig.combat.automaticFireInterval : w.fireInterval;
        if (!entry.input.active || now - entry.received > shooterNetworkConfig.inputTimeoutMs || player.reloading || player.ammo <= 0 || now + gameplayConfig.combat.fireJitterTolerance * 1000 < entry.nextShotAt) return;
        entry.nextShotAt = Math.max(now, entry.nextShotAt) + interval * 1000;
        const burst = now - entry.lastShot > gameplayConfig.combat.recoilReset * 1000 ? 0 : entry.burstShots;
        entry.burstShots = burst + 1;
        entry.lastShot = now; player.ammo--;
        player.protectedUntil = Math.min(player.protectedUntil, now);
        const poses = this.poses(now);
        const hit = this.combat.fire(this.world, this.pose(client.sessionId, now), entry.input.y, entry.input.p, now, entry.rtt, poses);
        if (hit) this.damage(hit, client.sessionId, now);
        const recoil = shotRecoil(burst, player.automatic, entry.input.a);
        entry.input.p = Math.min(1.48, entry.input.p + recoil.pitch);
        entry.input.y = Math.atan2(Math.sin(entry.input.y + recoil.yaw), Math.cos(entry.input.y + recoil.yaw));
        this.world.input(client.sessionId, entry.input);
      } else if (action.action === 'mode') {
        if (player.reloading) return;
        player.automatic = !player.automatic; entry.burstShots = 0;
      } else {
        if (player.reloading || player.ammo >= w.magazineSize || !gameplayConfig.combat.infiniteReserve && player.reserve <= 0) return;
        player.reloading = true; entry.reloadUntil = now + w.reloadDuration * 1000;
      }
      this.broadcast('weapon:event', { ...action, ...(action.action === 'fire' ? this.combat.lastTrace : {}), playerId: client.sessionId, roomId: this.roomId, timestamp: Date.now() });
      this.inactivity.touch(client.sessionId);
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
      this.inactivity.touch(client.sessionId);
      const data: RoomChatMessage = { messageId: randomUUID(), senderId: client.sessionId,
        senderName: player.displayName,
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
  onJoin(client: Client, options: { displayName?: unknown; admissionToken?: unknown } = {}): void {
    admission.attach(options.admissionToken, client.sessionId);
    if (!shooterEnabled) throw new ServerError(403, 'Shooter test is disabled.');
    if (options.displayName !== undefined && !validateDisplayName(options.displayName)) throw new ServerError(400, 'Invalid display name.');
    const used = new Set([...this.entries.values()].map(entry => entry.slot)); let slot = 0; while (used.has(slot)) slot++;
    const character = this.world.add(client.sessionId, slot);
    const player = new ShooterPlayer();
    player.displayName = roomDisplayName(options.displayName, [...this.state.players.values()].map(p => p.displayName), `PLAYER ${String(slot + 1).padStart(2, '0')}`);
    Object.assign(player, character.spawn, { yaw: gameConfig.player.spawn.yaw,
      spawnX: character.spawn.x, spawnY: character.spawn.y, spawnZ: character.spawn.z });
    player.bornAt = this.clock.elapsedTime; player.protectedUntil = player.bornAt + gameplayConfig.combat.spawnProtection * 1000;
    this.state.players.set(client.sessionId, player); this.state.online++;
    this.inactivity.join(client.sessionId);
    this.entries.set(client.sessionId, { slot, received: this.clock.elapsedTime, lastAction: -1, lastShot: -1000, nextShotAt: -1000, reloadUntil: 0, probe: '', probeAt: 0, rtt: 0, recovery: new HealthRecovery(), burstShots: 0, awardedStrikes: 0, strikeSequence: -1, lastStrike: -1000,
      input: { seq: -1, life: player.life, f: 0, r: 0, y: player.yaw, p: 0, s: false, c: false, j: false, a: false, active: false } });
    this.combat.record(this.poses(this.clock.elapsedTime));
    if (this.match.phase === 'waiting') this.startMatch(this.clock.elapsedTime, false);
    else if (this.match.phase === 'results') this.world.freeze(client.sessionId);
  }
  onDrop(client: Client, code?: number): void {
    if (code === sessionPolicy.idleCloseCode) return;
    const player = this.state.players.get(client.sessionId), entry = this.entries.get(client.sessionId);
    if (player?.connected) { player.connected = false; this.state.online--; }
    if (entry) { entry.input.active = false; this.world.input(client.sessionId, entry.input); }
    this.allowReconnection(client, admissionConfig.reservationSeconds);
  }
  onReconnect(client: Client): void {
    this.inactivity.touch(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player && !player.connected) { player.connected = true; this.state.online++; }
    if (this.match.phase === 'waiting') this.startMatch(this.clock.elapsedTime, true);
  }
  onLeave(client: Client): void {
    admission.release(client.sessionId, Date.now(), this.inactivity.isExpired(client.sessionId));
    this.inactivity.remove(client.sessionId);
    for (let i = this.state.airstrikes.length - 1; i >= 0; i--) if (this.state.airstrikes[i].ownerId === client.sessionId) {
      this.impacted.delete(this.state.airstrikes[i].id); this.state.airstrikes.splice(i, 1);
    }
    const leaving = this.state.players.get(client.sessionId);
    if (leaving) this.match.leave({ playerId: client.sessionId, displayName: leaving.displayName, kills: leaving.kills, deaths: leaving.deaths, streak: leaving.streak });
    if (this.state.players.get(client.sessionId)?.connected) this.state.online--;
    this.world.remove(client.sessionId); this.state.players.delete(client.sessionId); this.entries.delete(client.sessionId); this.chat.remove(client.sessionId);
  }
  private step(): void {
    const now = this.clock.elapsedTime;
    this.state.wallTime = Date.now(); this.state.serverTime = now;
    this.state.tick = (this.state.tick + 1) >>> 0;
    if (this.match.phase === 'playing' && !this.match.active(now)) this.finishMatch(now);
    if (this.match.phase === 'results' && now >= this.match.nextRoundAt) {
      if (this.state.online) this.startMatch(now, true);
      else { this.match.resetEmpty(); this.syncMatch(); }
    }
    if (this.match.phase !== 'playing') return;
    for (const [id, entry] of this.entries) {
      const player = this.state.players.get(id)!;
      if (player.dead) {
        player.flashlight = false;
        if (now >= player.respawnAt) this.respawn(id, now);
        continue;
      }
      if (!player.connected || now - entry.received > shooterNetworkConfig.inputTimeoutMs) { entry.input.active = false; this.world.input(id, entry.input); }
      player.flashlight = player.connected && entry.input.active && !!entry.input.t;
      if (player.reloading && now >= entry.reloadUntil) {
        const transfer = Math.min(gameConfig.weapon.magazineSize - player.ammo, gameplayConfig.combat.infiniteReserve ? gameConfig.weapon.magazineSize : player.reserve);
        player.ammo += transfer;
        if (!gameplayConfig.combat.infiniteReserve) player.reserve -= transfer;
        player.reloading = false;
      }
      entry.recovery.step(player, now, 1 / SHOOTER_HZ);
    }
    this.world.step(id => this.state.players.get(id)!.reloading);
    for (const [id, entry] of this.entries) {
      const player = this.state.players.get(id)!, body = this.world.player(id)!;
      if (player.dead) continue;
      advanceGait(player, body.current.x - player.x, body.current.z - player.z, entry.input.y, body.grounded, 1 / SHOOTER_HZ);
      player.x = body.current.x; player.y = body.current.y - body.height / 2; player.z = body.current.z;
      player.yaw = entry.input.y; player.pitch = entry.input.p; player.height = body.height; player.lean = body.lean;
      player.crouching = body.crouching; player.sprinting = body.sprinting; player.grounded = body.grounded;
      player.lastProcessedInput = Math.max(0, entry.input.seq);
    }
    while (this.state.killFeed.length && now - this.state.killFeed[0].timestamp > gameplayConfig.combat.killFeedDuration * 1000) this.state.killFeed.shift();
    this.combat.record(this.poses(now));
    this.updateAirstrikes(now);
  }
  private updateAirstrikes(now: number): void {
    for (let i = this.state.airstrikes.length - 1; i >= 0; i--) {
      const strike = this.state.airstrikes[i];
      // Resolve a due impact before expiry, even after a stalled simulation tick.
      if (now >= strike.impactAt && !this.impacted.has(strike.id) && this.state.players.has(strike.ownerId)) {
        this.impacted.add(strike.id);
        const origin = { x: strike.x, y: strike.y + .16, z: strike.z };
        for (const [id, player] of this.state.players) {
          if (player.dead || !player.connected || now < player.protectedUntil) continue;
          const distance = Math.hypot(player.x - strike.x, player.y + player.height * .5 - strike.y, player.z - strike.z);
          const amount = blastDamage(distance);
          if (amount && this.world.blastVisible(origin, player)) this.applyDamage(id, strike.ownerId, amount, 'blast', now, strike.life);
        }
      }
      if (now >= strike.finishedAt) { this.impacted.delete(strike.id); this.state.airstrikes.splice(i, 1); }
    }
  }
  private syncMatch(): void {
    this.state.lighting = this.match.lighting;
    this.state.match = this.match.phase; this.state.round = this.match.round;
    this.state.matchEndsAt = this.match.endsAt; this.state.nextRoundAt = this.match.nextRoundAt;
  }
  private startMatch(now: number, reset: boolean): void {
    this.state.airstrikes.clear(); this.impacted.clear();
    this.match.start(now); this.state.results.clear(); this.state.killFeed.clear(); this.combat.clear();
    if (reset) for (const [id, player] of this.state.players) {
      player.kills = player.deaths = player.streak = 0;
      // Failed safe spawn searches leave the player frozen and retry through normal respawn handling.
      player.dead = true; player.respawnAt = now; this.respawn(id, now);
    }
    this.syncMatch(); this.combat.record(this.poses(now));
  }
  private finishMatch(now: number): void {
    this.state.airstrikes.clear(); this.impacted.clear();
    const scores = this.match.finish(now, [...this.state.players].map(([id, p]) => ({ playerId: id, displayName: p.displayName, kills: p.kills, deaths: p.deaths, streak: p.streak })));
    this.state.results.clear(); for (const score of scores) this.state.results.push(Object.assign(new RoundScoreState(), score));
    for (const [id, entry] of this.entries) {
      entry.input.active = false; entry.reloadUntil = 0; entry.recovery.interrupt();
      const player = this.state.players.get(id)!; player.reloading = false; player.sprinting = false; player.flashlight = false;
      this.world.freeze(id);
    }
    this.syncMatch();
  }
  private pose(id: string, time: number): CombatPose {
    const p = this.state.players.get(id)!;
    const entry = this.entries.get(id)!;
    const reload = p.reloading ? Math.sin(Math.max(0, 1 - (entry.reloadUntil - time) / (gameConfig.weapon.reloadDuration * 1000)) * Math.PI) : 0;
    return { id, time, life: p.life, x: p.x, y: p.y, z: p.z, height: p.height, yaw: p.yaw, pitch: p.pitch, lean: p.lean, reload,
      gaitPhase: p.gaitPhase, gaitX: p.gaitX, gaitZ: p.gaitZ,
      dead: p.dead, connected: p.connected, protectedUntil: p.protectedUntil };
  }
  private poses(time: number): CombatPose[] { return [...this.state.players.keys()].map(id => this.pose(id, time)); }
  private damage(hit: PlayerHit, attackerId: string, now: number): void {
    this.applyDamage(hit.playerId, attackerId, gameplayConfig.combat.regionDamage[hit.region], hit.region, now, this.state.players.get(attackerId)!.life);
  }
  private applyDamage(id: string, attackerId: string, amount: number, region: import('../../../shared/ShooterProtocol').HitRegion | 'blast', now: number, attackerLife: number): void {
    const player = this.state.players.get(id)!;
    if (player.dead || !player.connected || now < player.protectedUntil) return;
    const damage = Math.min(player.health, amount);
    player.health -= damage;
    player.lastDamageAt = now; this.entries.get(id)!.recovery.interrupt();
    this.broadcast('combat:event', { type: 'damage', playerId: id, attackerId, health: player.health, damage, region, life: player.life, roomId: this.roomId, timestamp: now });
    if (!player.health) {
      player.dead = true; player.diedAt = now; player.respawnAt = now + gameplayConfig.combat.respawnDelay * 1000;
      player.reloading = false; player.sprinting = false;
      player.deaths++; player.streak = 0;
      player.strikes = 0;
      const attacker = this.state.players.get(attackerId)!;
      if (attackerId !== id) {
        attacker.kills++;
        if (!attacker.dead && attacker.life === attackerLife) {
          attacker.streak++;
          const earned = earnedStrikeMask(attacker.streak), owner = this.entries.get(attackerId)!;
          attacker.strikes |= earned & ~owner.awardedStrikes; owner.awardedStrikes |= earned;
        }
      }
      const record = new KillState();
      Object.assign(record, { id: randomUUID(), attackerId, victimId: id, attackerName: attacker.displayName,
        victimName: player.displayName, region, timestamp: now });
      this.state.killFeed.push(record);
      while (this.state.killFeed.length > gameplayConfig.combat.killFeedLimit) this.state.killFeed.shift();
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
      health: gameplayConfig.combat.maxHealth, lastDamageAt: now, ammo: gameConfig.weapon.magazineSize, reserve: gameConfig.weapon.reserveAmmo,
      strikes: 0,
      reloading: false, crouching: false, sprinting: false, grounded: false, flashlight: false, height: gameConfig.player.height, lean: 0,
      gaitPhase: 0, gaitX: 0, gaitZ: 0 });
    entry.input = { ...entry.input, life: p.life, f: 0, r: 0, s: false, c: false, j: false, a: false, t: false, active: false, y: p.yaw, p: 0 };
    entry.received = now; entry.lastShot = entry.nextShotAt = -1000; entry.reloadUntil = 0; entry.burstShots = 0; entry.awardedStrikes = 0; entry.recovery.interrupt();
    this.broadcast('combat:event', { type: 'respawn', playerId: id, health: p.health, life: p.life, roomId: this.roomId, timestamp: now });
  }
  onDispose(): void { this.world?.dispose(); this.entries.clear(); this.chat.clear(); this.combat.clear(); this.state.airstrikes.clear(); this.impacted.clear(); }
}
