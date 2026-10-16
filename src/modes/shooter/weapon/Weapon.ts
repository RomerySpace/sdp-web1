import { Box3, Group, MathUtils, Mesh, MeshPhysicalMaterial, Vector3, AxesHelper } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gameConfig } from '../config/gameConfig';
import { Spring } from '../core/Spring';
import type { CharacterController } from '../physics/CharacterController';
import type { InputManager } from '../player/InputManager';
import { assetBuffer } from '../../../assets/AssetCache';
import { gameplayConfig } from '../../../../shared/GameplayConfig';
import { shotRecoil } from '../../../../shared/WeaponRecoil';
import { FirstPersonHands } from './FirstPersonHands';

export class Weapon {
  readonly root = new Group();
  readonly positionPivot = new Group();
  readonly rotationPivot = new Group();
  readonly recoilPivot = new Group();
  readonly modelRoot = new Group();
  readonly hands = new FirstPersonHands();
  readonly axes = new AxesHelper(0.25);
  readonly springs = { x: new Spring(), y: new Spring(), z: new Spring(), pitch: new Spring(), yaw: new Spring(), roll: new Spring(), recoil: new Spring() };
  readonly material = new MeshPhysicalMaterial({ color: '#b9b7ad', metalness: 0.72, roughness: 0.28, clearcoat: 0.15 });
  ammo = gameConfig.weapon.magazineSize;
  reserve = gameConfig.weapon.reserveAmmo;
  reloading = false;
  reloadElapsed = 0;
  ads = 0;
  obstruction = 0;
  time = 0;
  lastShot = -100;
  loaded = false;
  automatic = false;
  burstShots = 0;
  recoil = { pitch: 0, yaw: 0 };
  sourceBounds?: number[][];
  private phase = 0;
  private sprintAmount = 0;
  private crouchAmount = 0;
  private obstructionAmount = 0;
  private aspect = 1;
  private model?: Group;
  constructor() {
    this.root.add(this.positionPivot); this.positionPivot.add(this.rotationPivot);
    this.rotationPivot.add(this.recoilPivot); this.recoilPivot.add(this.modelRoot, this.hands.group);
    this.axes.visible = false; this.rotationPivot.add(this.axes);
  }
  async load(): Promise<void> {
    const gltf = await new GLTFLoader().parseAsync(await assetBuffer(gameConfig.assets.weapon), '/SDP/');
    const box = new Box3().setFromObject(gltf.scene), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
    this.sourceBounds = [box.min.toArray(), box.max.toArray()];
    const scale = gameConfig.weapon.length / Math.max(size.x, size.y, size.z);
    gltf.scene.position.copy(center).multiplyScalar(-scale);
    gltf.scene.scale.setScalar(scale);
    gltf.scene.traverse(o => {
      if (o instanceof Mesh) {
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach(m => m.dispose());
        o.material = this.material; o.castShadow = o.receiveShadow = false;
      }
      o.layers.set(1);
    });
    this.model = gltf.scene; this.modelRoot.add(gltf.scene);
    this.root.traverse(o => o.layers.set(1));
    this.loaded = true;
  }
  startReload(): boolean {
    if (this.reloading || this.ammo >= gameConfig.weapon.magazineSize || this.reserve <= 0) return false;
    this.reloading = true; this.reloadElapsed = 0; return true;
  }
  canShoot(): boolean {
    const interval = this.automatic ? gameplayConfig.combat.automaticFireInterval : gameConfig.weapon.fireInterval;
    return this.loaded && !this.reloading && this.ammo > 0 && this.time - this.lastShot >= interval;
  }
  shoot(): boolean {
    if (!this.canShoot()) return false;
    if (this.time - this.lastShot > gameplayConfig.combat.recoilReset) this.burstShots = 0;
    this.recoil = shotRecoil(this.burstShots++, this.automatic, this.ads > .5);
    this.lastShot = this.time; this.ammo--;
    this.springs.recoil.kick(0.9 * gameConfig.weapon.recoil);
    this.springs.pitch.kick(0.55 * gameConfig.weapon.recoil);
    this.springs.yaw.kick((this.ammo % 2 ? 1 : -1) * 0.09 * gameConfig.weapon.recoil);
    return true;
  }
  onLanding(speed: number): void {
    this.springs.y.kick(-Math.min(speed, 9) * 0.13);
    this.springs.pitch.kick(Math.min(speed, 9) * 0.07);
  }
  onJump(): void { this.springs.y.kick(-0.16); }
  setAspect(aspect: number): void { this.aspect = MathUtils.clamp(aspect, .3, 1); }
  setHolster(amount: number, lowering: number, tilt: number): void {
    const blend = MathUtils.clamp(amount, 0, 1);
    this.root.position.set(0, -lowering * blend, 0);
    this.root.rotation.set(-tilt * blend, 0, 0);
  }
  reset(ammo = gameConfig.weapon.magazineSize, reserve = gameConfig.weapon.reserveAmmo, automatic = false): void {
    this.automatic = automatic; this.burstShots = 0; this.recoil = { pitch: 0, yaw: 0 };
    this.ammo = ammo; this.reserve = reserve; this.reloading = false; this.reloadElapsed = 0;
    this.ads = this.obstruction = this.phase = this.sprintAmount = this.crouchAmount = this.obstructionAmount = 0;
    this.lastShot = -100; Object.values(this.springs).forEach(s => s.reset());
    this.recoilPivot.position.set(0, 0, 0); this.setHolster(0, 0, 0); this.root.visible = true;
  }
  update(dt: number, player: CharacterController, input: InputManager): void {
    const w = gameConfig.weapon;
    this.time += dt;
    if (this.reloading) {
      this.reloadElapsed += dt;
      if (this.reloadElapsed >= w.reloadDuration) {
        const transfer = Math.min(w.magazineSize - this.ammo, this.reserve);
        this.ammo += transfer; this.reserve -= transfer; this.reloading = false;
      }
    }
    const aiming = input.aiming && !player.sprinting && !this.reloading;
    this.ads = MathUtils.damp(this.ads, aiming ? 1 : 0, 4 / w.adsDuration, dt);
    this.sprintAmount = MathUtils.damp(this.sprintAmount, player.sprinting ? 1 : 0, 12, dt);
    this.crouchAmount = MathUtils.damp(this.crouchAmount, player.crouching ? 1 : 0, 14, dt);
    this.obstructionAmount = MathUtils.damp(this.obstructionAmount, this.obstruction, 18, dt);
    const sprint = this.sprintAmount;
    const target = new Vector3().copy(w.position).lerp(w.sprintPosition, sprint).lerp(w.adsPosition, this.ads);
    target.x *= this.aspect;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.phase += speed * dt * 2.8;
    const walking = Math.min(1.5, speed / gameConfig.player.walkSpeed) * (player.grounded ? 1 : 0);
    const sway = (1 - this.ads * 0.83) * (player.crouching ? 0.65 : 1);
    const side = player.velocity.x * Math.cos(input.yaw) - player.velocity.z * Math.sin(input.yaw);
    const forwardAccel = -player.acceleration.x * Math.sin(input.yaw) - player.acceleration.z * Math.cos(input.yaw);
    const sideAccel = player.acceleration.x * Math.cos(input.yaw) - player.acceleration.z * Math.sin(input.yaw);
    const mouseX = MathUtils.clamp(input.lookX / Math.max(dt, 0.008), -5, 5);
    const mouseY = MathUtils.clamp(input.lookY / Math.max(dt, 0.008), -5, 5);
    const reloadT = this.reloading ? MathUtils.clamp(this.reloadElapsed / w.reloadDuration, 0, 1) : 0;
    this.hands.update(reloadT);
    const envelope = Math.pow(Math.sin(reloadT * Math.PI), 0.8);
    const manipulation = Math.sin(reloadT * Math.PI * 3) * envelope;
    this.obstruction = MathUtils.clamp(this.obstruction, 0, 1);
    target.x += envelope * 0.08;
    target.y -= this.crouchAmount * 0.025 + envelope * 0.15 + this.obstructionAmount * 0.3;
    target.z += envelope * 0.1 + this.obstructionAmount * 0.23;
    const k = w.springStiffness, d = w.springDamping, s = this.springs;
    const x = s.x.update((-mouseX * w.mouseSway * 0.18 - sideAccel * w.accelerationInertia + Math.sin(this.phase) * w.movementSway * walking) * sway, dt, k, d);
    const y = s.y.update((mouseY * w.mouseSway * 0.14 + Math.cos(this.phase * 2) * w.movementSway * walking * 0.65 - player.velocity.y * 0.004 + Math.sin(this.time * 1.6) * 0.001) * sway, dt, k, d);
    const z = s.z.update(MathUtils.clamp(forwardAccel, -30, 30) * w.accelerationInertia * sway, dt, k, d);
    this.positionPivot.position.copy(target).add(new Vector3(x, y, z));
    const pitch = s.pitch.update(mouseY * w.mouseSway * sway - sprint * 0.16 + envelope * 0.5 + manipulation * 0.08 - this.obstructionAmount * 0.7, dt, k, d);
    const yaw = s.yaw.update(mouseX * w.mouseSway * sway + envelope * 0.3, dt, k, d);
    const roll = s.roll.update(-side * 0.018 * sway - sprint * 0.16 + envelope * 0.48, dt, k, d);
    this.rotationPivot.rotation.set(MathUtils.lerp(w.rotation.x, w.adsRotation.x, this.ads) + pitch,
      MathUtils.lerp(w.rotation.y, w.adsRotation.y, this.ads) + yaw,
      MathUtils.lerp(w.rotation.z, w.adsRotation.z, this.ads) + roll, 'YXZ');
    this.recoilPivot.position.z = s.recoil.update(0, dt, 230, 24);
    this.modelRoot.scale.setScalar(w.scale);
    this.modelRoot.rotation.set(w.modelRotation.x, w.modelRotation.y, w.modelRotation.z);
  }
  dispose(): void {
    this.model?.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
    this.material.dispose(); this.axes.dispose(); this.root.removeFromParent();
    this.hands.dispose();
  }
}
