import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, MathUtils, type Scene } from 'three';
import { AvatarLayout } from '../../../../shared/AvatarLayout';
import type { LobbySnapshot, NetworkPlayer } from '../../../../shared/MultiplayerProtocol';
import type { WeaponEvent } from '../../../../shared/ShooterProtocol';
import { gameplayConfig } from '../../../../shared/GameplayConfig';
import { gameConfig } from '../config/gameConfig';
import { DigitalAvatarEffect } from '../effects/DigitalAvatarEffect';
import { MotionBuffer, SnapshotClock } from './SnapshotInterpolation';
import { AnonymousFigure, FigureGeometry, anonymousFinish } from '../player/AnonymousFigure';
interface Remote { group: Group; figure: AnonymousFigure; weapon: Group; effect: DigitalAvatarEffect;
  reloadStarted: number; reloading: boolean; flash: Mesh; flashUntil: number; state: NetworkPlayer; motion: MotionBuffer; height: number; layout: AvatarLayout }
export class RemoteShooterPlayers {
  readonly group = new Group();
  private readonly remotes = new Map<string, Remote>();
  private readonly figureGeometry = new FigureGeometry();
  private readonly flashGeometry = new BoxGeometry(.04, .04, .08);
  private readonly material = new MeshPhysicalMaterial(anonymousFinish);
  private readonly flashMaterial = new MeshStandardMaterial({ color: '#fff5df', emissive: '#fff5df', emissiveIntensity: 2 });
  readonly clock = new SnapshotClock();
  private lastTime = 0; private lastTick = -1;
  constructor(scene: Scene, private readonly weapon: Group) { scene.add(this.group); }
  get count(): number { return this.remotes.size; }
  receive(snapshot: LobbySnapshot): void {
    if (!snapshot.roomId) { this.lastTick = -1; this.clock.reset(); }
    if (snapshot.tick <= this.lastTick && snapshot.players.length) return;
    this.lastTick = snapshot.tick;
    const serverTime = snapshot.serverTime ?? snapshot.receivedAt;
    this.clock.receive(serverTime, snapshot.receivedAt);
    const present = new Set<string>();
    for (const p of snapshot.players) {
      if (!p.connected || p.playerId === snapshot.localPlayerId) continue;
      present.add(p.playerId); let remote = this.remotes.get(p.playerId);
      if (!remote) {
        const group = new Group(), effect = new DigitalAvatarEffect(group), material = effect.material(this.material);
        const figure = new AnonymousFigure(this.figureGeometry, material); group.add(figure.group);
        // Aim rotates the mount; the model's muzzle conversion stays on its child.
        const gun = new Group(), model = this.weapon.clone(true), rotation = gameConfig.weapon.modelRotation;
        gun.name = 'remote-weapon-mount'; model.name = 'remote-weapon-model';
        model.rotation.set(rotation.x, rotation.y, rotation.z);
        model.scale.setScalar(gameConfig.weapon.scale);
        gun.add(model); gun.position.set(.22, 1.25, -.25);
        const weaponMaterials = new Map<MeshStandardMaterial, MeshStandardMaterial>();
        gun.traverse(object => {
          object.layers.set(0);
          if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
            const base = object.material;
            if (!weaponMaterials.has(base)) weaponMaterials.set(base, effect.material(base));
            object.material = weaponMaterials.get(base)!;
          }
        }); group.add(gun);
        const flash = new Mesh(this.flashGeometry, this.flashMaterial); flash.position.set(0, 0, -gameConfig.weapon.length / 2); flash.visible = false; gun.add(flash);
        group.position.set(p.x, p.y, p.z); group.rotation.y = p.yaw;
        remote = { group, figure, weapon: gun, effect, reloadStarted: 0, reloading: false, flash, flashUntil: 0, motion: new MotionBuffer(), height: p.height ?? 1.8, state: p, layout: new AvatarLayout() };
        this.remotes.set(p.playerId, remote); this.group.add(group);
      }
      if (p.life !== remote.state.life) { remote.motion.clear(); remote.group.position.set(p.x, p.y, p.z); }
      if (p.dead && !remote.state.dead) remote.motion.clear();
      remote.state = p;
      if (p.reloading && !remote.reloading) remote.reloadStarted = performance.now();
      remote.reloading = !!p.reloading;
      remote.motion.push({ time: serverTime, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, height: p.height ?? 1.8, lean: p.lean ?? 0,
        gaitPhase: p.gaitPhase ?? 0, gaitX: p.gaitX ?? 0, gaitZ: p.gaitZ ?? 0 });
    }
    for (const [id, remote] of this.remotes) if (!present.has(id)) { this.remove(remote); this.remotes.delete(id); }
  }
  action(event: WeaponEvent): void {
    const remote = this.remotes.get(event.playerId);
    if (remote && !remote.state.dead && event.life === remote.state.life && event.action === 'fire') remote.flashUntil = performance.now() + 90;
  }
  update(now: number): void {
    const dt = this.lastTime ? Math.min(.05, (now - this.lastTime) / 1000) : .016; this.lastTime = now;
    const time = this.clock.renderTime(now), serverTime = this.clock.serverNow(now);
    for (const remote of this.remotes.values()) {
      const pose = remote.motion.sample(time); if (!pose) continue;
      const response = 1 - Math.exp(-40 * dt);
      remote.group.position.x += (pose.x - remote.group.position.x) * response;
      remote.group.position.y += (pose.y - remote.group.position.y) * response;
      remote.group.position.z += (pose.z - remote.group.position.z) * response;
      remote.group.rotation.y = pose.yaw;
      remote.height = MathUtils.damp(remote.height, pose.height, 22, dt);
      const reload = remote.reloading ? Math.sin(Math.min(1, (now - remote.reloadStarted) / (gameConfig.weapon.reloadDuration * 1000)) * Math.PI) : 0;
      const layout = remote.layout; layout.update(remote.height, pose.pitch, reload, pose.lean ?? 0,
        { gaitPhase: pose.gaitPhase ?? 0, gaitX: pose.gaitX ?? 0, gaitZ: pose.gaitZ ?? 0 });
      remote.figure.update(layout, pose.pitch);
      remote.weapon.position.copy(layout.weaponPosition); remote.weapon.rotation.copy(layout.weaponRotation);
      remote.flash.visible = !remote.state.dead && now < remote.flashUntil;
      const death = MathUtils.clamp((serverTime - (remote.state.diedAt ?? serverTime)) / (gameplayConfig.death.duration * 1000), 0, 1);
      const reconstruction = MathUtils.clamp((serverTime - (remote.state.bornAt ?? 0)) / (gameplayConfig.death.reconstructionDuration * 1000), 0, 1);
      remote.group.visible = !remote.state.dead || death < 1;
      const coherence = remote.state.dead ? 1 - Math.min(1, death * gameplayConfig.death.dissolutionSpeed) : reconstruction;
      remote.effect.update(now, coherence, remote.state.dead ? death : reconstruction, !remote.state.dead, remote.height);
      Object.assign(remote.group.userData, { dead: !!remote.state.dead, crouching: !!remote.state.crouching, sprinting: !!remote.state.sprinting,
        gaitPhase: pose.gaitPhase, stride: Math.hypot(pose.gaitX ?? 0, pose.gaitZ ?? 0), height: remote.height, coherence, life: remote.state.life });
    }
  }
  private remove(remote: Remote): void { remote.effect.dispose(); remote.figure.dispose(); remote.group.removeFromParent(); remote.group.clear(); }
  dispose(): void {
    for (const remote of this.remotes.values()) this.remove(remote);
    this.group.removeFromParent(); this.remotes.clear(); this.figureGeometry.dispose();
    this.flashGeometry.dispose(); this.material.dispose(); this.flashMaterial.dispose();
  }
}
