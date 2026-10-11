import { MathUtils, PerspectiveCamera } from 'three';
import { simulateMovement, type MotionState } from '../../shared/Movement';
import type { MovementInput, NetworkPlayer } from '../../shared/MultiplayerProtocol';
import { CollisionManager } from './CollisionManager';
import { InputManager } from './InputManager';

export class FirstPersonController {
  readonly input = new InputManager();
  readonly collision = new CollisionManager();
  private readonly motion: MotionState = { x: 0, z: 9, velocityX: 0, velocityZ: 0 };
  private readonly movementInput: MovementInput = { seq: 0, f: 0, r: 0, y: 0, p: 0, active: true };
  private readonly events = new AbortController();
  private yaw = 0;
  private pitch = 0;
  private active = false;

  constructor(readonly camera: PerspectiveCamera, private readonly canvas: HTMLCanvasElement) {
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 1.7, 9);
    camera.lookAt(0, 1.78, 0);
    this.pitch = camera.rotation.x;
    window.addEventListener('mousemove', (event) => {
      if (!this.active || !this.locked) return;
      this.yaw -= event.movementX * 0.0017;
      this.pitch = MathUtils.clamp(this.pitch - event.movementY * 0.0017, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03);
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }, { signal: this.events.signal });
  }

  get locked(): boolean { return document.pointerLockElement === this.canvas; }
  get enabled(): boolean { return this.active; }

  setSpawn(player: NetworkPlayer): void {
    this.input.clear();
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
    if (!this.active || !this.locked) return;
    this.motion.x = this.camera.position.x;
    this.motion.z = this.camera.position.z;
    this.movementInput.f = this.input.forward;
    this.movementInput.r = this.input.sideways;
    this.movementInput.y = this.yaw;
    simulateMovement(this.motion, this.movementInput, dt, this.collision);
    this.camera.position.set(this.motion.x, 1.7, this.motion.z);
  }

  dispose(): void {
    this.releaseLock(); this.events.abort(); this.input.dispose();
  }
}
