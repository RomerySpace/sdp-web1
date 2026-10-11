export class InputManager {
  private readonly keys = new Set<string>();
  private readonly events = new AbortController();
  enabled = false;

  constructor() {
    const signal = this.events.signal;
    window.addEventListener('keydown', (event) => {
      if (!this.enabled || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
    }, { signal });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), { signal });
    window.addEventListener('blur', () => this.clear(), { signal });
  }

  get forward(): number { return Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')); }
  get sideways(): number { return Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')); }
  clear(): void { this.keys.clear(); }
  dispose(): void { this.events.abort(); this.clear(); }
}
