export class InputManager {
  private readonly keys = new Set<string>();
  private readonly events = new AbortController();
  enabled = false;
  private touchForward = 0;
  private touchSideways = 0;
  private touchSprint = false;

  constructor() {
    const signal = this.events.signal;
    window.addEventListener('keydown', (event) => {
      if (!this.enabled || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
    }, { signal });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), { signal });
    window.addEventListener('blur', () => this.clear(), { signal });
  }

  get forward(): number { return this.touchForward || Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')); }
  get sideways(): number { return this.touchSideways || Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')); }
  get sprinting(): boolean { return this.touchSprint || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  setTouchMovement(forward: number, sideways: number): void { this.touchForward = forward; this.touchSideways = sideways; }
  setTouchSprint(active: boolean): void { this.touchSprint = active; }
  clear(): void { this.keys.clear(); this.touchForward = this.touchSideways = 0; this.touchSprint = false; }
  dispose(): void { this.events.abort(); this.clear(); }
}
