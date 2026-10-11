export interface FragmentConfig {
  enabled: boolean;
  fragmentCount: number;
  spawnRadius: number;
  exclusionRadius: number;
  minimumOpacity: number;
  maximumOpacity: number;
  reconstructionDuration: number;
  depthStrength: number;
  pointDensity: number;
  lineDensity: number;
  fragmentScale: number;
  driftSpeed: number;
  visibilityDistance: number;
  cellSize: number;
  seed: number;
}

export const DEFAULT_FRAGMENT_CONFIG: Readonly<FragmentConfig> = Object.freeze({
  enabled: true,
  fragmentCount: 12,
  spawnRadius: 25,
  exclusionRadius: 6,
  minimumOpacity: 0.025,
  maximumOpacity: 0.42,
  reconstructionDuration: 3.2,
  depthStrength: 0.8,
  pointDensity: 0.85,
  lineDensity: 1,
  fragmentScale: 3.2,
  driftSpeed: 0.12,
  visibilityDistance: 18,
  cellSize: 8,
  seed: 2007,
});

export function fragmentConfig(overrides: Partial<FragmentConfig> = {}): FragmentConfig {
  const config = { ...DEFAULT_FRAGMENT_CONFIG, ...overrides };
  for (const key of Object.keys(DEFAULT_FRAGMENT_CONFIG) as (keyof FragmentConfig)[]) {
    if (key !== 'enabled' && !Number.isFinite(config[key])) Object.assign(config, { [key]: DEFAULT_FRAGMENT_CONFIG[key] });
  }
  config.fragmentCount = Math.max(0, Math.min(32, Math.floor(config.fragmentCount)));
  config.visibilityDistance = Math.max(4, Math.min(50, config.visibilityDistance));
  config.spawnRadius = Math.max(config.visibilityDistance + 4, Math.min(80, config.spawnRadius));
  config.exclusionRadius = Math.max(6, config.exclusionRadius);
  config.reconstructionDuration = Math.max(0.5, config.reconstructionDuration);
  config.cellSize = Math.max(5, Math.min(16, config.cellSize));
  config.fragmentScale = Math.max(0.25, Math.min(8, config.fragmentScale));
  config.depthStrength = Math.max(0, Math.min(3, config.depthStrength));
  config.minimumOpacity = Math.max(0, Math.min(1, config.minimumOpacity));
  config.maximumOpacity = Math.max(config.minimumOpacity, Math.min(1, config.maximumOpacity));
  config.pointDensity = Math.max(0, Math.min(1, config.pointDensity));
  config.lineDensity = Math.max(0, Math.min(1, config.lineDensity));
  config.driftSpeed = Math.max(0, Math.min(1, config.driftSpeed));
  return config;
}

export function smoothstep(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

export function distanceVisibility(distance: number, config: FragmentConfig): number {
  const far = 1 - smoothstep(config.visibilityDistance * 2 / 3, config.visibilityDistance, distance);
  const near = smoothstep(0.6, 2.8, distance);
  return far * near;
}
