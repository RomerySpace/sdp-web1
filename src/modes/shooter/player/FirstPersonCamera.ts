import { Group, MathUtils, PerspectiveCamera, Quaternion, Euler, Vector3 } from 'three';
import { gameConfig } from '../config/gameConfig';
import { Spring } from '../core/Spring';
import type { CharacterController } from '../physics/CharacterController';
import type { InputManager } from './InputManager';
import { leanConfig, leanOffset } from '../../../../shared/Lean';
import { gameplayConfig } from '../../../../shared/GameplayConfig';

export class FirstPersonCamera {
  readonly root = new Group();
  readonly yaw = new Group();
  readonly pitch = new Group();
  readonly motion = new Group();
  readonly camera = new PerspectiveCamera(gameConfig.camera.baseFov, 1, 0.045, gameConfig.environment.fogDistance);
  readonly aimDirection = new Vector3();
  private readonly aimQuaternion = new Quaternion();
  private readonly aimEuler = new Euler(0, 0, 0, 'YXZ');
  private readonly landing = new Spring();
  private readonly recoil = new Spring();
  private readonly roll = new Spring();
  private readonly inertiaX = new Spring();
  private readonly inertiaY = new Spring();

  private phase = 0;
  private eye = gameConfig.player.eyeHeight;
  private amplitude = 0;
  private sprintBlend = 0;
  private readonly damagePitch = new Spring();
  private readonly damageRoll = new Spring();
  private hitSide = 1;
  constructor(readonly input: InputManager) {
    this.root.add(this.yaw); this.yaw.add(this.pitch); this.pitch.add(this.motion); this.motion.add(this.camera);
    this.camera.rotation.order = 'YXZ';
  }
  onLanding(speed: number): void { this.landing.kick(-Math.min(speed, 9) * gameConfig.camera.landingResponse * 18); }
  onShot(): void { this.recoil.kick(gameConfig.weapon.cameraRecoil * 0.17); }
  onDamage(damage: number): void {
    const intensity = gameplayConfig.damage.impulse * damage / gameplayConfig.combat.damage;
    this.damagePitch.kick(intensity); this.damageRoll.kick(intensity * .65 * this.hitSide); this.hitSide *= -1;
  }
  reset(): void {
    [this.landing, this.recoil, this.roll, this.inertiaX, this.inertiaY, this.damagePitch, this.damageRoll].forEach(s => s.reset());
    this.phase = this.amplitude = this.sprintBlend = 0; this.eye = gameConfig.player.eyeHeight;
    this.pitch.position.set(0, this.eye, 0); this.motion.position.set(0, 0, 0); this.motion.rotation.set(0, 0, 0);
  }
  update(dt: number, player: CharacterController, alpha: number, ads: number): void {
    const c = gameConfig.camera, p = gameConfig.player;
    this.sprintBlend = MathUtils.damp(this.sprintBlend, player.sprinting ? 1 : 0, 14, dt);
    this.root.position.copy(player.interpolate(alpha));
    this.yaw.rotation.y = this.input.yaw; this.pitch.rotation.x = this.input.pitch;
    this.eye = MathUtils.damp(this.eye, player.crouching ? p.crouchEyeHeight : p.eyeHeight, 14, dt);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.amplitude = MathUtils.damp(this.amplitude, player.grounded ? Math.min(1.6, speed / p.walkSpeed) : 0, 14, dt);
    // Phase progresses with distance travelled; standing produces no walking oscillation.
    this.phase += speed * dt * c.bobFrequency * 1.65;
    const bob = c.bobAmplitude * this.amplitude * (player.crouching ? 0.5 : 1) * (1 - ads * 0.65);
    const { springStiffness: k, springDamping: d } = c;
    const land = this.landing.update(0, dt, k, d);
    const recoil = this.recoil.update(0, dt, 210, 23);
    const localSide = player.velocity.x * Math.cos(this.input.yaw) - player.velocity.z * Math.sin(this.input.yaw);
    const offset = leanOffset(player.lean, 0);
    this.pitch.position.set(offset.x, this.eye + offset.y, 0);
    const roll = this.roll.update(-localSide / p.sprintSpeed * c.strafeRoll, dt, k, d);
    const ix = this.inertiaX.update(MathUtils.clamp(this.input.lookX / Math.max(dt, 0.008), -5, 5) * c.inertia, dt, k, d);
    const iy = this.inertiaY.update(MathUtils.clamp(this.input.lookY / Math.max(dt, 0.008), -5, 5) * c.inertia, dt, k, d);
    this.motion.position.set(Math.sin(this.phase) * bob * 0.6, (Math.cos(this.phase * 2) * 0.65 + Math.sin(this.phase * 3.13) * 0.18) * bob + land, 0);
    this.motion.rotation.set(iy * 0.12 + recoil + land * 0.1 - this.sprintBlend * .006 + this.damagePitch.update(0, dt, 90, 15), ix * 0.12,
      -player.lean / leanConfig.distance * leanConfig.roll + roll + Math.sin(this.phase) * bob * 0.16 + this.damageRoll.update(0, dt, 95, 16), 'YXZ');
    const targetFov = MathUtils.lerp(MathUtils.lerp(c.baseFov, c.sprintFov, this.sprintBlend), c.adsFov, ads);
    const fov = MathUtils.damp(this.camera.fov, targetFov, c.fovResponse, dt);
    if (Math.abs(fov - this.camera.fov) > 0.001) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.root.updateMatrixWorld(true);
    this.aimQuaternion.setFromEuler(this.aimEuler.set(this.input.pitch, this.input.yaw, 0));
    this.aimDirection.set(0, 0, -1).applyQuaternion(this.aimQuaternion);
  }
}
