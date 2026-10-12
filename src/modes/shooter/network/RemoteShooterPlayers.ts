import { BoxGeometry, CapsuleGeometry, SphereGeometry, Group, Mesh, MeshStandardMaterial, MathUtils, type Scene } from 'three';
import type { LobbySnapshot, NetworkPlayer } from '../../../../shared/MultiplayerProtocol';
import type { WeaponEvent } from '../../../../shared/ShooterProtocol';
import { gameplayConfig } from '../../../../shared/GameplayConfig';
import { gameConfig } from '../config/gameConfig';
import { DigitalAvatarEffect } from '../effects/DigitalAvatarEffect';
interface Sample { time: number; x: number; y: number; z: number; yaw: number; pitch: number; height: number }
interface Remote { group: Group; torso: Mesh; head: Mesh; legs: Mesh[]; arms: Mesh[]; weapon: Group; effect: DigitalAvatarEffect;
  reloadStarted: number; reloading: boolean; flash: Mesh; flashUntil: number; state: NetworkPlayer; samples: Sample[]; height: number }
export class RemoteShooterPlayers {
  readonly group = new Group();
  private readonly remotes = new Map<string, Remote>();
  private readonly torso = new CapsuleGeometry(.25, .38, 4, 8);
  private readonly head = new SphereGeometry(.19, 10, 8);
  private readonly limb = new CapsuleGeometry(.09, .52, 4, 6);
  private readonly foot = new BoxGeometry(.16, .1, .24);
  private readonly flashGeometry = new BoxGeometry(.04, .04, .08);
  private readonly material = new MeshStandardMaterial({ color: '#7d8c92', roughness: .8 });
  private readonly flashMaterial = new MeshStandardMaterial({ color: '#fff5df', emissive: '#fff5df', emissiveIntensity: 2 });
  private serverOffset = 0; private lastTime = 0;
  constructor(scene: Scene, private readonly weapon: Group) { scene.add(this.group); }
  get count(): number { return this.remotes.size; }
  receive(snapshot: LobbySnapshot): void {
    if (snapshot.serverTime !== undefined) this.serverOffset = snapshot.serverTime - snapshot.receivedAt;
    const present = new Set<string>();
    for (const p of snapshot.players) {
      if (!p.connected || p.playerId === snapshot.localPlayerId) continue;
      present.add(p.playerId); let remote = this.remotes.get(p.playerId);
      if (!remote) {
        const group = new Group(), effect = new DigitalAvatarEffect(group), material = effect.material(this.material);
        const torso = new Mesh(this.torso, material), head = new Mesh(this.head, material);
        const legs = [new Mesh(this.limb, material), new Mesh(this.limb, material)], arms = [new Mesh(this.limb, material), new Mesh(this.limb, material)];
        group.add(torso, head, ...legs, ...arms);
        for (const x of [-.14, .14]) { const foot = new Mesh(this.foot, material); foot.position.set(x, .05, .04); group.add(foot); }
        const gun = this.weapon.clone(true); gun.position.set(.25, 1.25, -.25);
        const weaponMaterials = new Map<MeshStandardMaterial, MeshStandardMaterial>();
        gun.traverse(object => {
          object.layers.set(0);
          if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
            const base = object.material;
            if (!weaponMaterials.has(base)) weaponMaterials.set(base, effect.material(base));
            object.material = weaponMaterials.get(base)!;
          }
        }); group.add(gun);
        const flash = new Mesh(this.flashGeometry, this.flashMaterial); flash.position.set(.25, 1.25, -.64); flash.visible = false; group.add(flash);
        group.position.set(p.x, p.y, p.z); group.rotation.y = p.yaw;
        remote = { group, torso, head, legs, arms, weapon: gun, effect, reloadStarted: 0, reloading: false, flash, flashUntil: 0, samples: [], height: p.height ?? 1.8, state: p };
        this.remotes.set(p.playerId, remote); this.group.add(group);
      }
      if (p.life !== remote.state.life) remote.samples.length = 0;
      remote.state = p;
      if (p.reloading && !remote.reloading) remote.reloadStarted = performance.now();
      remote.reloading = !!p.reloading;
      remote.samples.push({ time: snapshot.receivedAt, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, height: p.height ?? 1.8 });
      if (remote.samples.length > 12) remote.samples.shift();
    }
    for (const [id, remote] of this.remotes) if (!present.has(id)) { this.remove(remote); this.remotes.delete(id); }
  }
  action(event: WeaponEvent): void {
    const remote = this.remotes.get(event.playerId);
    if (remote && !remote.state.dead && event.life === remote.state.life && event.action === 'fire') remote.flashUntil = performance.now() + 90;
  }
  update(now: number): void {
    const dt = this.lastTime ? Math.min(.05, (now - this.lastTime) / 1000) : .016; this.lastTime = now;
    const time = now - gameplayConfig.combat.interpolationDelay * 1000, serverTime = now + this.serverOffset;
    for (const remote of this.remotes.values()) {
      const samples = remote.samples; if (!samples.length) continue;
      let before = samples[0], after = samples[samples.length - 1];
      for (let i = 1; i < samples.length; i++) { if (samples[i].time >= time) { before = samples[i - 1]; after = samples[i]; break; } before = samples[i]; }
      const t = after.time > before.time ? Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time))) : 1;
      remote.group.position.set(before.x + (after.x - before.x) * t, before.y + (after.y - before.y) * t, before.z + (after.z - before.z) * t);
      remote.group.rotation.y = before.yaw + Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw)) * t;
      remote.height = MathUtils.damp(remote.height, before.height + (after.height - before.height) * t, 22, dt);
      const crouch = MathUtils.clamp((1.8 - remote.height) / (1.8 - 1.16), 0, 1);
      remote.head.position.y = remote.height - .19;
      remote.torso.position.y = 1.14 - crouch * .56; remote.torso.scale.y = 1 - crouch * .12;
      for (let i = 0; i < 2; i++) {
        const leg = remote.legs[i]; leg.position.set(i ? .14 : -.14, .35 - crouch * .05, crouch * .09);
        leg.scale.y = 1 - crouch * .15; leg.rotation.x = -crouch * .7;
        const arm = remote.arms[i]; arm.position.set(i ? .29 : -.29, 1.06 - crouch * .55, -.07); arm.scale.y = .8; arm.rotation.x = -.35;
      }
      const reload = remote.reloading ? Math.sin(Math.min(1, (now - remote.reloadStarted) / (gameConfig.weapon.reloadDuration * 1000)) * Math.PI) : 0;
      remote.weapon.rotation.x = before.pitch + (after.pitch - before.pitch) * t;
      remote.weapon.rotation.z = reload * .35; remote.weapon.position.y = 1.25 - crouch * .58 - reload * .14;
      remote.flash.position.y = remote.weapon.position.y; remote.flash.visible = !remote.state.dead && now < remote.flashUntil;
      const death = MathUtils.clamp((serverTime - (remote.state.diedAt ?? serverTime)) / (gameplayConfig.death.duration * 1000), 0, 1);
      const reconstruction = MathUtils.clamp((serverTime - (remote.state.bornAt ?? 0)) / (gameplayConfig.death.reconstructionDuration * 1000), 0, 1);
      remote.group.visible = !remote.state.dead || death < 1;
      const coherence = remote.state.dead ? 1 - Math.min(1, death * gameplayConfig.death.dissolutionSpeed) : reconstruction;
      remote.effect.update(now, coherence, remote.state.dead ? death : reconstruction, !remote.state.dead, remote.height);
      Object.assign(remote.group.userData, { dead: !!remote.state.dead, crouching: !!remote.state.crouching, height: remote.height, coherence, life: remote.state.life });
    }
  }
  private remove(remote: Remote): void { remote.effect.dispose(); remote.group.removeFromParent(); remote.group.clear(); }
  dispose(): void {
    for (const remote of this.remotes.values()) this.remove(remote);
    this.group.removeFromParent(); this.remotes.clear(); this.torso.dispose(); this.head.dispose(); this.limb.dispose(); this.foot.dispose();
    this.flashGeometry.dispose(); this.material.dispose(); this.flashMaterial.dispose();
  }
}
