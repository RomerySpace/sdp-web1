import { MathUtils } from 'three';
import { gameConfig } from '../config/gameConfig';
const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ControlLeft', 'ControlRight', 'KeyR', 'KeyB']);
export class InputManager {
  readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly events = new AbortController();
  yaw = gameConfig.player.spawn.yaw;
  pitch = 0;
  lookX = 0;
  lookY = 0;
  aiming = false;
  trigger = false;
  shots = 0;
  enabled = false;
  constructor(readonly canvas: HTMLCanvasElement) {
    const signal = this.events.signal;
    window.addEventListener('keydown', e => {
      if (!this.enabled || !this.locked || !controls.has(e.code) || e.isComposing || e.metaKey || e.altKey ||
        (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]'))) return;
      e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    }, { signal });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); if (this.locked && controls.has(e.code)) e.preventDefault(); }, { signal });
    window.addEventListener('mousemove', e => {
      if (!this.enabled || !this.locked) return;
      const x = MathUtils.clamp(e.movementX, -500, 500) * gameConfig.player.mouseSensitivity;
      const y = MathUtils.clamp(e.movementY, -500, 500) * gameConfig.player.mouseSensitivity;
      this.yaw -= x; this.pitch = MathUtils.clamp(this.pitch - y, -1.48, 1.48);
      this.lookX += x; this.lookY += y;
    }, { signal });
    window.addEventListener('mousedown', e => {
      if (!this.enabled || !this.locked || (e.target instanceof HTMLElement && e.target.closest('button, input'))) return;
      if (e.button === 0) { this.shots++; this.trigger = true; }
      if (e.button === 2) this.aiming = true;
    }, { signal });
    window.addEventListener('mouseup', e => { if (e.button === 2) this.aiming = false; if (e.button === 0) this.trigger = false; }, { signal });
    window.addEventListener('contextmenu', e => { if (this.locked) e.preventDefault(); }, { signal });
    window.addEventListener('blur', () => this.clear(), { signal });
    document.addEventListener('pointerlockchange', () => { if (!this.locked) this.clear(); }, { signal });
  }
  get locked(): boolean { return document.pointerLockElement === this.canvas; }
  get forward(): number { return Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')); }
  get sideways(): number { return Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')); }
  consume(code: string): boolean { const value = this.pressed.has(code); this.pressed.delete(code); return value; }
  pending(code: string): boolean { return this.pressed.has(code); }
  clear(): void { this.keys.clear(); this.pressed.clear(); this.lookX = this.lookY = this.shots = 0; this.aiming = this.trigger = false; }
  requestLock(onError: () => void): void {
    try { const result = this.canvas.requestPointerLock(); if (result) void result.catch(onError); } catch { onError(); }
  }
  dispose(): void { this.events.abort(); this.clear(); if (this.locked) document.exitPointerLock(); }
}
