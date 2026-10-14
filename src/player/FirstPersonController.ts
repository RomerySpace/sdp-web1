import { MathUtils, PerspectiveCamera } from 'three';
import { simulateMovement, type MotionState } from '../../shared/Movement';
import type { MovementInput, NetworkPlayer } from '../../shared/MultiplayerProtocol';
import { CollisionManager } from './CollisionManager';
import { InputManager } from './InputManager';
import { gameplayConfig } from '../../shared/GameplayConfig';
import { touchConfig } from '../input/InputCapabilities';

export class FirstPersonController {
  readonly input = new InputManager();
  readonly collision = new CollisionManager();
  private readonly motion: MotionState = { x: 0, z: 9, velocityX: 0, velocityZ: 0 };
  private readonly movementInput: MovementInput = { seq: 0, f: 0, r: 0, y: 0, p: 0, active: true };
  private readonly events = new AbortController();
  private phase = 0;
  private eye = 1.7;
  private yaw = 0;
  private pitch = 0;
  private active = false;
  sensitivity = 1;
  private readonly baseFov: number;

  constructor(readonly camera: PerspectiveCamera, private readonly canvas: HTMLCanvasElement, readonly touch = false) {
    this.baseFov = camera.fov;
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 1.7, 9);
    camera.lookAt(0, 1.78, 0);
    this.pitch = camera.rotation.x;
    window.addEventListener('mousemove', (event) => {
      if (!this.active || !this.locked) return;
      this.yaw -= event.movementX * 0.0017 * this.sensitivity;
      this.pitch = MathUtils.clamp(this.pitch - event.movementY * 0.0017 * this.sensitivity, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03);
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }, { signal: this.events.signal });
  }

  get locked(): boolean { return document.pointerLockElement === this.canvas; }
  get enabled(): boolean { return this.active; }
  get controlling(): boolean { return this.touch || this.locked; }
  touchLook(dx: number, dy: number): void {
    if (!this.touch || !this.active) return;
    this.yaw -= dx * touchConfig.lookSensitivity * this.sensitivity;
    this.pitch = MathUtils.clamp(this.pitch - dy * touchConfig.lookSensitivity * this.sensitivity, -Math.PI / 2 + .03, Math.PI / 2 - .03);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  setSpawn(player: NetworkPlayer): void {
    this.input.clear();
    this.motion.elevation = this.motion.verticalSpeed = 0; this.motion.jumpHeld = false;
    this.eye = 1.7;
    this.motion.velocityX = this.motion.velocityZ = 0;
    this.yaw = player.yaw;
    this.pitch = player.pitch;
    this.camera.position.set(player.x, player.y, player.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  setEnabled(enabled: boolean): void {
    this.active = enabled;
    this.input.enabled = enabled;
    if (!enabled) { this.input.clear(); this.motion.velocityX = this.motion.velocityZ = 0; }
  }

  /** Must be called synchronously from a trusted click/keydown. */
  requestLock(onDenied: () => void): void {
    if (this.locked) return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') void result.catch(onDenied);
    } catch { onDenied(); }
  }

  releaseLock(): void { if (this.locked) document.exitPointerLock(); }

  update(dt: number): void {
    const sprint = this.active && this.controlling && this.input.sprinting && (this.input.forward || this.input.sideways);
    const fov = MathUtils.damp(this.camera.fov, this.baseFov + (sprint ? gameplayConfig.limbo.sprintFovAdjustment : 0), 6, dt);
    if (Math.abs(fov - this.camera.fov) > .001) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (!this.active || !this.controlling) return;
    this.motion.x = this.camera.position.x;
    this.motion.z = this.camera.position.z;
    this.movementInput.f = this.input.forward;
    this.movementInput.r = this.input.sideways;
    this.movementInput.y = this.yaw;
    this.movementInput.s = this.input.sprinting;
    this.movementInput.j = this.input.jumping;
    this.movementInput.c = this.input.crouching;
    simulateMovement(this.motion, this.movementInput, dt, this.collision);
    const speed = Math.hypot(this.motion.velocityX, this.motion.velocityZ);
    this.phase += speed * dt * 2.8;
    this.eye = MathUtils.damp(this.eye, this.input.crouching ? gameplayConfig.limbo.crouchHeight : 1.7, 14, dt);
    const bob = (this.motion.elevation ? 0 : .012) * Math.min(speed / 3, 1.5);
    this.camera.position.set(this.motion.x, this.eye + (this.motion.elevation ?? 0) + Math.sin(this.phase * 2) * bob, this.motion.z);
    const roll = MathUtils.damp(this.camera.rotation.z, -this.input.sideways * .018 + Math.sin(this.phase) * bob * .35, 10, dt);
    this.camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
  }

  dispose(): void {
    this.releaseLock(); this.events.abort(); this.input.dispose();
  }
}
