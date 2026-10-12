import { ACESFilmicToneMapping, PCFSoftShadowMap, Scene, Vector3, type WebGLRenderer } from 'three';
import type { ColyseusNetworkAdapter } from '../../network/ColyseusNetworkAdapter';
import { SHOOTER_ROOM, shooterNetworkConfig, type ShooterInput } from '../../../shared/ShooterProtocol';
import type { NetworkPlayer } from '../../../shared/MultiplayerProtocol';
import { gameConfig } from './config/gameConfig';
import { AudioManager } from './audio/AudioManager';
import { CharacterController, findSpawn } from './physics/CharacterController';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { FirstPersonCamera } from './player/FirstPersonCamera';
import { InputManager } from './player/InputManager';
import { Weapon } from './weapon/Weapon';
import { ShootingSystem } from './weapon/ShootingSystem';
import { buildMapColliders } from './world/MapColliders';
import { MapLoader } from './world/MapLoader';
import { Environment } from './world/Environment';
import { ContactShading } from './world/ContactShading';
import { RemoteShooterPlayers } from './network/RemoteShooterPlayers';
import { ShooterHUD } from './ui/ShooterHUD';
import { CombatFeedback } from './ui/CombatFeedback';
import { gameplayConfig } from '../../../shared/GameplayConfig';
import { PredictionHistory } from './network/PredictionHistory';
import './styles/shooter.css';

export class ShooterMode {
  readonly scene = new Scene(); readonly input: InputManager; readonly camera: FirstPersonCamera;
  readonly map = new MapLoader(); readonly weapon = new Weapon(); readonly audio = new AudioManager();
  readonly environment: Environment; readonly contactShading: ContactShading; readonly hud: ShooterHUD;
  readonly remotes: RemoteShooterPlayers;
  readonly feedback: CombatFeedback;
  health = gameplayConfig.combat.maxHealth; dead = false; life = 0;
  physics?: PhysicsWorld; player?: CharacterController; shooting?: ShootingSystem;
  paused = true; active = false; colliderCount = 0; fixedSteps = 0;
  private accumulator = 0; private sequence = 0; private actionSequence = 0; private stepDistance = 0;
  private disposed = false; private readonly events = new AbortController(); private readonly unsubscribers: (() => void)[] = [];
  private suppressPauseMenu = false;
  private readonly previousRenderer;
  private readonly currentFeet = new Vector3();
  private readonly viewCorrection = new Vector3();
  private readonly prediction = new PredictionHistory();
  private lastInput?: ShooterInput;
  private lastInputSent = 0;
  constructor(container: HTMLElement, private readonly renderer: WebGLRenderer, private readonly network: ColyseusNetworkAdapter,
    private readonly onPaused: () => void, private readonly onResumed: () => void) {
    this.previousRenderer = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
      autoClear: renderer.autoClear, autoReset: renderer.info.autoReset, shadowType: renderer.shadowMap.type,
      shadowAutoUpdate: renderer.shadowMap.autoUpdate, pixelRatio: renderer.getPixelRatio() };
    this.input = new InputManager(renderer.domElement); this.camera = new FirstPersonCamera(this.input);
    this.scene.add(this.camera.root); this.camera.camera.add(this.weapon.root);
    this.environment = new Environment(this.scene, renderer); this.contactShading = new ContactShading(this.scene, this.camera.camera);
    this.scene.traverse(object => { if ('isLight' in object) object.layers.enable(1); });
    this.remotes = new RemoteShooterPlayers(this.scene, this.weapon.modelRoot); this.hud = new ShooterHUD(container);
    this.feedback = new CombatFeedback(container);
    const signal = this.events.signal;
    document.addEventListener('pointerlockchange', () => {
      if (!this.active) return;
      if (this.input.locked) { this.paused = false; this.suppressPauseMenu = false; this.input.enabled = !this.dead; this.accumulator = 0; this.onResumed(); }
      else this.pause(this.suppressPauseMenu);
    }, { signal });
    renderer.domElement.addEventListener('click', () => { if (this.active && this.paused) this.resume(); }, { signal });
    this.unsubscribers.push(network.subscribeToSpawn(player => { if (network.roomType === SHOOTER_ROOM) this.spawn(player); }),
      network.subscribeToState(snapshot => {
        if (network.roomType !== SHOOTER_ROOM) return;
        this.remotes.receive(snapshot);
        this.hud.receive(snapshot);
        const local = snapshot.players.find(player => player.playerId === snapshot.localPlayerId);
        if (!local || !this.player) return;
        if (local.life !== this.life) this.spawn(local);
        this.applyHealth(local.health ?? this.health);
        if (local.dead) this.die();
        const delta = this.prediction.reconcile(local);
        if (delta && !this.dead) {
          if (delta.length() > shooterNetworkConfig.teleportDistance) {
            this.player.correct(local); this.player.stopHorizontal(); this.viewCorrection.set(0, 0, 0); this.prediction.reset(this.life);
          } else {
            this.player.shift(delta); this.viewCorrection.sub(delta);
          }
        }
        if ((local.weaponSeq ?? 0) >= this.actionSequence) {
          this.weapon.ammo = local.ammo ?? this.weapon.ammo; this.weapon.reserve = local.reserve ?? this.weapon.reserve;
          this.weapon.automatic = local.automatic ?? false;
          if (!local.reloading) { this.weapon.reloading = false; this.weapon.reloadElapsed = 0; }
        }
      }), network.subscribeToWeapons(event => this.remotes.action(event)),
      network.subscribeToCombat(event => {
        if (event.type === 'death' && event.attackerId === network.snapshot?.localPlayerId) this.feedback.eliminated();
        if (event.playerId !== network.snapshot?.localPlayerId || event.life !== this.life) return;
        if (event.type === 'damage') this.applyHealth(event.health);
        if (event.type === 'death') this.die();
      }),
      network.subscribeToStatus(status => { if (this.active && status.state !== 'connected') this.pause(); }));
  }
  async initialize(progress: (text: string) => void, signal: AbortSignal): Promise<void> {
    progress('Initializing physics'); this.physics = await PhysicsWorld.initialize(); signal.throwIfAborted();
    await this.map.load(progress); signal.throwIfAborted(); this.scene.add(this.map.root);
    progress('Loading SDP weapon'); await this.weapon.load(); signal.throwIfAborted();
    progress('Loading environment light'); await this.environment.load(); signal.throwIfAborted();
    this.colliderCount = await buildMapColliders(this.physics, this.map.geometries, progress); signal.throwIfAborted();
    this.player = new CharacterController(this.physics, this.input, findSpawn(this.physics));
    for (let i = 0; i < 20; i++) { this.player.beforeStep(gameConfig.physics.timestep, false); this.physics.step(); this.player.afterStep(); }
    this.camera.update(0, this.player, 1, 0); this.weapon.update(0, this.player, this.input);
    this.shooting = new ShootingSystem(this.scene, this.physics, this.player, this.camera, this.weapon, this.audio);
    this.environment.follow(this.player.spawn); this.resize();
    progress('Preparing marble surfaces'); this.camera.camera.layers.enable(1);
    await this.renderer.compileAsync(this.scene, this.camera.camera); this.camera.camera.layers.set(0); signal.throwIfAborted();
  }
  private spawn(player: NetworkPlayer): void {
    this.player?.spawn.set(player.spawnX ?? player.x, player.spawnY ?? player.y, player.spawnZ ?? player.z);
    this.player?.respawn(); this.camera.reset(); this.weapon.reset(player.ammo, player.reserve, player.automatic); this.feedback.reset();
    this.health = player.health ?? gameplayConfig.combat.maxHealth; this.life = player.life ?? 1; this.dead = false;
    this.prediction.reset(this.life); this.viewCorrection.set(0, 0, 0); this.lastInput = undefined; this.lastInputSent = 0;
    this.accumulator = this.stepDistance = 0;
    this.player?.correct(player); this.input.yaw = player.yaw; this.input.pitch = player.pitch; this.input.clear();
    this.sequence = Math.max(this.sequence, player.lastProcessedInput + 1); this.actionSequence = player.weaponSeq ?? 0;
    this.input.enabled = this.active && !this.paused && this.input.locked;
    if (player.dead) this.die();
  }
  private applyHealth(health: number): void {
    if (health < this.health) { this.camera.onDamage(this.health - health); this.feedback.hit(); }
    this.health = health;
  }
  private die(): void {
    if (this.dead) return;
    this.dead = true; this.health = 0; this.input.enabled = false; this.input.clear(); this.accumulator = 0;
    this.player?.stopHorizontal(); this.player?.body.setEnabled(false);
    this.weapon.reloading = false; this.weapon.ads = 0; this.weapon.root.visible = false;
  }
  enter(): void {
    this.active = true; this.paused = true;
    const r = this.renderer; r.toneMapping = ACESFilmicToneMapping; r.toneMappingExposure = gameConfig.environment.exposure;
    r.shadowMap.type = PCFSoftShadowMap; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
    r.autoClear = false; r.info.autoReset = false;
    this.resize(); this.hud.element.hidden = false;
    const local = this.network.snapshot?.players.find(p => p.playerId === this.network.snapshot?.localPlayerId);
    if (local) this.spawn(local);
  }
  resume(): void {
    if (!this.active || this.disposed || this.network.status.state !== 'connected') return;
    this.audio.enter(); this.audio.setVisible(true);
    this.input.requestLock(this.onPaused);
  }
  pause(hideMenu = false): void {
    if (!this.active) return;
    this.suppressPauseMenu = hideMenu;
    this.paused = true; this.input.enabled = false; this.input.clear(); this.accumulator = 0;
    this.player?.stopHorizontal(); this.sendInput(false, true);
    if (this.input.locked) document.exitPointerLock(); if (!hideMenu) this.onPaused();
  }
  private sendInput(active: boolean, force = false): number | undefined {
    const now = performance.now(), input: ShooterInput = { seq: this.sequence + 1, life: this.life, f: active ? this.input.forward : 0, r: active ? this.input.sideways : 0,
      y: Math.atan2(Math.sin(this.input.yaw), Math.cos(this.input.yaw)), p: this.input.pitch,
      s: active && this.input.keys.has('ShiftLeft'), c: active && (this.input.keys.has('ControlLeft') || this.input.keys.has('ControlRight')),
      j: active && this.input.pending('Space'), a: active && this.input.aiming, active };
    const previous = this.lastInput;
    const changed = !previous || ['f', 'r', 's', 'c', 'j', 'a', 'active'].some(key => input[key as keyof ShooterInput] !== previous[key as keyof ShooterInput]);
    if (!force && !changed && now - this.lastInputSent < 1000 / shooterNetworkConfig.inputHz) return;
    this.sequence = input.seq; this.lastInput = input; this.lastInputSent = now;
    this.network.sendShooterInput(input);
    this.recordPrediction(input.seq);
    return input.seq;
  }
  private recordPrediction(sequence: number): void {
    if (!this.player) return;
    this.currentFeet.copy(this.player.current); this.currentFeet.y -= this.player.height / 2;
    this.prediction.record(sequence, this.currentFeet);
  }
  update(dt: number): void {
    if (!this.active || this.disposed || !this.player || !this.physics) return;
    const p = this.player;
    if (!this.paused && !this.dead) {
      this.accumulator = Math.min(this.accumulator + dt, gameConfig.physics.timestep * gameConfig.physics.maxSubsteps);
      while (this.accumulator >= gameConfig.physics.timestep) {
        const sent = this.sendInput(true);
        p.beforeStep(gameConfig.physics.timestep, this.weapon.reloading); this.physics.step(); p.afterStep(); this.fixedSteps++;
        if (sent !== undefined) this.recordPrediction(sent);
        if (p.tookOff) this.weapon.onJump();
        if (p.landingSpeed > 0) { this.camera.onLanding(p.landingSpeed); this.weapon.onLanding(p.landingSpeed); }
        if (p.grounded) {
          this.stepDistance += Math.hypot(p.velocity.x, p.velocity.z) * gameConfig.physics.timestep;
          if (this.stepDistance > (p.sprinting ? 1.8 : 1.5)) { this.stepDistance = 0; this.audio.step(p.sprinting); }
        }
        this.accumulator -= gameConfig.physics.timestep;
      }
    }
    const activeDt = this.paused || this.dead ? 0 : dt;
    if (!this.paused && !this.dead && this.input.consume('KeyB') && !this.weapon.reloading) {
      this.weapon.automatic = !this.weapon.automatic; this.weapon.burstShots = 0; this.input.trigger = false;
      this.network.sendWeaponAction({ seq: ++this.actionSequence, life: this.life, action: 'mode' });
    }
    if (!this.paused && !this.dead && this.input.consume('KeyR') && this.weapon.startReload()) {
      this.audio.reload(); this.network.sendWeaponAction({ seq: ++this.actionSequence, life: this.life, action: 'reload' });
    }
    this.weapon.update(activeDt, p, this.input);
    this.camera.update(this.dead ? dt : activeDt, p, this.paused || this.dead ? 1 : this.accumulator / gameConfig.physics.timestep, this.weapon.ads);
    this.viewCorrection.multiplyScalar(Math.exp(-shooterNetworkConfig.correctionResponse * dt));
    this.camera.root.position.add(this.viewCorrection); this.camera.root.updateMatrixWorld(true);
    const clicks = this.input.shots; this.input.shots = 0;
    if (!this.paused && !this.dead && this.weapon.canShoot() && (clicks > 0 || this.weapon.automatic && this.input.trigger)) {
      this.sendInput(true, true);
      this.network.sendWeaponAction({ seq: ++this.actionSequence, life: this.life, action: 'fire' });
      this.shooting?.fire();
    }
    this.shooting?.update(activeDt); this.input.lookX = this.input.lookY = 0;
    this.remotes.update(performance.now()); this.hud.update(p, this.weapon, this.health, this.dead);
    this.feedback.update(dt, this.health, this.dead); this.environment.follow(this.camera.root.position);
    const camera = this.camera.camera, renderer = this.renderer;
    renderer.info.reset(); renderer.clear(); camera.layers.set(0); renderer.render(this.scene, camera); this.contactShading.render(renderer);
    const background = this.scene.background; this.scene.background = null; renderer.clearDepth(); camera.layers.set(1);
    renderer.render(this.scene, camera); this.scene.background = background; camera.layers.set(0);
  }
  resize(): void {
    if (this.active) { this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, gameConfig.rendering.maxPixelRatio)); this.renderer.setSize(window.innerWidth, window.innerHeight); }
    this.camera.camera.aspect = window.innerWidth / window.innerHeight; this.camera.camera.updateProjectionMatrix(); this.contactShading.resize(this.renderer);
  }
  get snapshot() { return { paused: this.paused, physicsSteps: this.fixedSteps, position: this.player?.current.toArray(),
    grounded: this.player?.grounded, movement: this.player?.state, colliders: this.colliderCount, map: this.map.stats,
    ammo: this.weapon.ammo, reserve: this.weapon.reserve, shots: this.shooting?.shotsFired, reloading: this.weapon.reloading,
    health: this.health, dead: this.dead, life: this.life, automatic: this.weapon.automatic,
    weaponLoaded: this.weapon.loaded, remotePlayers: this.remotes.count,
    network: { corrections: this.prediction.corrections, teleports: this.prediction.teleports,
      jitterMs: this.remotes.clock.jitterMs, interpolationMs: this.remotes.clock.interpolationMs, maxSnapshotGapMs: this.remotes.clock.maxGapMs } }; }
  dispose(): void {
    if (this.disposed) return;
    this.active = false; this.disposed = true; this.events.abort(); this.unsubscribers.forEach(fn => fn());
    this.input.dispose(); this.audio.dispose(); this.hud.dispose(); this.feedback.dispose(); this.shooting?.dispose(); this.remotes.dispose();
    this.contactShading.dispose(); this.weapon.dispose(); this.map.dispose(); this.environment.dispose(); this.physics?.dispose(); this.scene.clear();
    const r = this.renderer, previous = this.previousRenderer;
    r.toneMapping = previous.toneMapping; r.toneMappingExposure = previous.exposure; r.autoClear = previous.autoClear;
    r.info.autoReset = previous.autoReset; r.shadowMap.type = previous.shadowType; r.shadowMap.autoUpdate = previous.shadowAutoUpdate;
    r.shadowMap.needsUpdate = true; r.setPixelRatio(previous.pixelRatio); r.renderLists.dispose();
  }
}
