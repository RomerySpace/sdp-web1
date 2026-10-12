export interface SettingsState { sensitivity: number; volume: number; muted: boolean }
export const settingsLimits = { sensitivity: { min: .25, max: 2.5, step: .05 }, volume: { min: 0, max: 1, step: .05 } };
export class PlayerSettings {
  private current: SettingsState = { sensitivity: 1, volume: .5, muted: false };
  private readonly listeners = new Set<(state: Readonly<SettingsState>) => void>();
  constructor() {
    try {
      for (const key of ['sensitivity', 'volume'] as const) {
        const raw = localStorage.getItem(`sdp:${key}`), value = raw === null ? NaN : Number(raw), limit = settingsLimits[key];
        if (Number.isFinite(value)) this.current[key] = Math.max(limit.min, Math.min(limit.max, value));
      }
      this.current.muted = localStorage.getItem('sdp:muted') === 'true';
    } catch { /* Preferences are optional in storage-restricted browsers. */ }
  }
  get value(): Readonly<SettingsState> { return this.current; }
  set(key: 'sensitivity' | 'volume', value: number): void {
    if (!Number.isFinite(value)) return;
    const limit = settingsLimits[key]; this.change(key, Math.max(limit.min, Math.min(limit.max, value)));
  }
  toggleMute(): boolean { this.change('muted', !this.current.muted); return this.current.muted; }
  private change<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void {
    if (this.current[key] === value) return;
    this.current = { ...this.current, [key]: value };
    try { localStorage.setItem(`sdp:${key}`, String(value)); } catch {}
    for (const listener of this.listeners) listener(this.current);
  }
  subscribe(listener: (state: Readonly<SettingsState>) => void): () => void {
    this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener);
  }
}
