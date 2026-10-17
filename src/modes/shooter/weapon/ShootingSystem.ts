import { CircleGeometry, MathUtils, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { Scene } from 'three';
import { gameConfig } from '../config/gameConfig';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CharacterController } from '../physics/CharacterController';
import type { FirstPersonCamera } from '../player/FirstPersonCamera';
import type { Weapon } from './Weapon';
import type { AudioManager } from '../audio/AudioManager';
import { ShotTrails } from '../effects/ShotTrails';
import { RecoilRecovery } from '../../../../shared/RecoilRecovery';

export class ShootingSystem {
  readonly impacts: { mesh: Mesh<CircleGeometry, MeshBasicMaterial>; life: number }[] = [];
  shotsFired = 0;
  lastHit: { point: number[]; normal: number[]; distance: number } | null = null;
  private nextImpact = 0;
  private readonly origin = new Vector3();
  private readonly normal = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly geometry = new CircleGeometry(0.018, 8);
  readonly trails: ShotTrails;
  readonly recoilRecovery = new RecoilRecovery();
  constructor(private readonly scene: Scene, private readonly physics: PhysicsWorld,
    private readonly player: CharacterController, private readonly camera: FirstPersonCamera,
    private readonly weapon: Weapon, private readonly audio: AudioManager) {
    this.trails = new ShotTrails(scene);
    for (let i = 0; i < gameConfig.weapon.maxImpacts; i++) {
      const mesh = new Mesh(this.geometry, new MeshBasicMaterial({ color: '#8a9ca6', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      mesh.visible = false; scene.add(mesh); this.impacts.push({ mesh, life: 0 });
    }
  }
  fire(): void {
    if (!this.weapon.shoot()) return;
    this.shotsFired++;
    this.camera.onShot(); this.audio.shot();
    this.camera.camera.getWorldPosition(this.origin);
    const hit = this.physics.ray(this.origin, this.camera.aimDirection, gameConfig.weapon.range, this.player.collider);
    this.trails.emit(this.weapon.muzzlePosition(new Vector3()), this.origin.clone().addScaledVector(this.camera.aimDirection, hit?.toi ?? gameConfig.weapon.range));
    const beforePitch = this.camera.input.pitch;
    this.camera.input.pitch = MathUtils.clamp(beforePitch + this.weapon.recoil.pitch, -1.48, 1.48);
    this.camera.input.yaw += this.weapon.recoil.yaw;
    this.recoilRecovery.add(this.camera.input.pitch - beforePitch, this.weapon.recoil.yaw);
    this.lastHit = null;
    if (!hit) return;
    const point = this.origin.clone().addScaledVector(this.camera.aimDirection, hit.toi);
    this.normal.copy(hit.normal);
    if (this.normal.dot(this.camera.aimDirection) > 0) this.normal.negate();
    this.lastHit = { point: point.toArray(), normal: this.normal.toArray(), distance: hit.toi };
    const impact = this.impacts[this.nextImpact++ % this.impacts.length];
    impact.life = gameConfig.weapon.impactLifetime;
    impact.mesh.visible = true;
    impact.mesh.position.copy(point).addScaledVector(this.normal, 0.006);
    impact.mesh.quaternion.setFromUnitVectors(this.forward, this.normal);
    impact.mesh.scale.setScalar(1); impact.mesh.material.opacity = 0.7;
  }
  update(dt: number): void {
    this.trails.update(dt);
    this.camera.camera.getWorldPosition(this.origin);
    const obstruction = this.physics.ray(this.origin, this.camera.aimDirection, gameConfig.weapon.obstructionDistance, this.player.collider);
    this.weapon.obstruction = obstruction ? 1 - Math.min(1, Math.max(0, obstruction.toi - 0.15) / (gameConfig.weapon.obstructionDistance - 0.15)) : 0;
    for (const impact of this.impacts) {
      if (impact.life <= 0) continue;
      impact.life = Math.max(0, impact.life - dt);
      impact.mesh.visible = impact.life > 0;
      impact.mesh.material.opacity = Math.min(0.7, impact.life * 1.3);
      impact.mesh.scale.setScalar(1 + (gameConfig.weapon.impactLifetime - impact.life) * 0.8);
    }
  }
  recoverAim(dt: number): void {
    if (dt <= 0) return;
    const input = this.camera.input;
    const recovery = this.recoilRecovery.update(dt, -input.lookY, -input.lookX);
    input.pitch = MathUtils.clamp(input.pitch + recovery.pitch, -1.48, 1.48);
    input.yaw += recovery.yaw;
  }
  dispose(): void { this.trails.dispose(); this.geometry.dispose(); this.impacts.forEach(i => { i.mesh.material.dispose(); this.scene.remove(i.mesh); }); }
}
