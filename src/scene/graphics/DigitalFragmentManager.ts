import { Group, Vector3, type Camera, type Scene } from 'three';
import { DigitalFragment, type FragmentPlacement } from './DigitalFragment';
import { fragmentConfig, type FragmentConfig } from './FragmentConfig';
import { FragmentLoader, type FragmentAsset } from './FragmentLoader';
import { FragmentMaterial } from './FragmentMaterial';
import { inCaptureStudio } from '../../../shared/TemporaryCaptureStudio';

function hash(x: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 374761393) + Math.imul(z, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

function rng(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class DigitalFragmentManager {
  readonly group = new Group();
  readonly ready: Promise<void>;
  private readonly loader = new FragmentLoader();
  private readonly materials = new FragmentMaterial();
  private readonly fragments = new Map<string, DigitalFragment>();
  private readonly cameraPosition = new Vector3();
  private readonly lastRefresh = new Vector3(Infinity, Infinity, Infinity);
  private assets: readonly FragmentAsset[] = [];
  private settings: FragmentConfig;
  private disposed = false;
  private wasEnabled = false;
  private frameTime = 1 / 60;
  private densityScale = 1;
  private qualityTimer = 0;

  constructor(scene: Scene, private readonly camera: Camera, overrides: Partial<FragmentConfig> = {}) {
    this.settings = fragmentConfig(overrides);
    this.group.name = 'Digital fragments';
    scene.add(this.group);
    this.ready = this.initialize();
  }

  get config(): Readonly<FragmentConfig> { return this.settings; }
  get loadedAssets(): readonly FragmentAsset[] { return this.assets; }

  get stats() {
    let visible = 0, segments = 0, points = 0;
    for (const fragment of this.fragments.values()) {
      if (!fragment.object.visible) continue;
      visible++;
      segments += fragment.asset.lines.getAttribute('position').count / 2;
      points += fragment.asset.points.getAttribute('position').count;
    }
    return {
      loadedAssets: this.assets.length, active: this.fragments.size, visible,
      drawCalls: visible * 2, segments, points, densityScale: this.densityScale,
      frameTimeMs: this.frameTime * 1000,
    };
  }

  get snapshot() {
    return Array.from(this.fragments.values(), (fragment) => ({
      ...fragment.placement, source: fragment.asset.source,
      opacity: fragment.opacity, progress: fragment.progress, distance: fragment.distance,
      visible: fragment.object.visible,
    }));
  }

  configure(overrides: Partial<FragmentConfig>): void {
    const previous = this.settings;
    this.settings = fragmentConfig({ ...previous, ...overrides });
    if (['seed', 'fragmentScale', 'depthStrength', 'exclusionRadius', 'cellSize'].some((key) =>
      previous[key as keyof FragmentConfig] !== this.settings[key as keyof FragmentConfig])) {
      for (const fragment of this.fragments.values()) fragment.dispose();
      this.fragments.clear();
    }
    this.lastRefresh.set(Infinity, Infinity, Infinity);
  }

  private async initialize(): Promise<void> {
    try {
      const assets = await this.loader.load();
      if (!this.disposed) this.assets = assets;
    } catch (error) {
      if (!this.disposed) console.warn('[graphics] Atmospheric fragments unavailable:', error);
    }
  }

  private placement(cellX: number, cellZ: number): FragmentPlacement | null {
    const config = this.settings;
    const random = rng(hash(cellX, cellZ, config.seed));
    if (random() < 0.12) return null;
    const x = (cellX + 0.18 + random() * 0.64) * config.cellSize;
    const z = (cellZ + 0.18 + random() * 0.64) * config.cellSize;
    // Neighbouring cells use different sources; placement stays independent of the camera.
    const assetIndex = ((cellX + cellZ * 2 + config.seed) % this.assets.length + this.assets.length) % this.assets.length;
    const asset = this.assets[assetIndex];
    const scale = config.fragmentScale * (0.65 + random() * 0.6);
    const footprint = Math.hypot(asset.bounds[0], asset.bounds[1], asset.bounds[2] * config.depthStrength) * scale / 2 + 0.2;
    if (inCaptureStudio(x, z, footprint)) return null;
    if (Math.hypot(x, z) - footprint < config.exclusionRadius) return null;
    // Preserve the introductory sightline from the existing starting position.
    if (z > -2 && z < 10 && Math.abs(x) < 2.8 + footprint) return null;
    const y = asset.bounds[1] * scale / 2 + 0.3 + random() * 1.7;
    return {
      key: `${cellX}:${cellZ}`, assetIndex, x, y, z, scale,
      yaw: random() * Math.PI * 2,
      tilt: (random() - 0.5) * 0.24,
      phase: random() * Math.PI * 2,
    };
  }

  private refresh(): void {
    const config = this.settings;
    const candidates: { placement: FragmentPlacement; distance: number }[] = [];
    const centerX = Math.floor(this.cameraPosition.x / config.cellSize);
    const centerZ = Math.floor(this.cameraPosition.z / config.cellSize);
    const radius = Math.ceil(config.spawnRadius / config.cellSize);
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      for (let z = centerZ - radius; z <= centerZ + radius; z++) {
        const placement = this.placement(x, z);
        if (!placement) continue;
        const distance = Math.hypot(placement.x - this.cameraPosition.x, placement.y - this.cameraPosition.y, placement.z - this.cameraPosition.z);
        if (distance < config.spawnRadius) candidates.push({ placement, distance });
      }
    }
    const available = new Set(candidates.map(({ placement }) => placement.key));
    for (const [key, fragment] of this.fragments) {
      const dissolved = fragment.distance > config.visibilityDistance && fragment.opacity < 0.002;
      if (!available.has(key) || dissolved || this.fragments.size > config.fragmentCount) {
        fragment.dispose();
        this.fragments.delete(key);
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const { placement } of candidates) {
      if (this.fragments.size >= config.fragmentCount) break;
      if (this.fragments.has(placement.key)) continue;
      if (Math.hypot(placement.x - this.cameraPosition.x, placement.z - this.cameraPosition.z) > config.visibilityDistance + 2) continue;
      const fragment = new DigitalFragment(this.assets[placement.assetIndex], placement, this.materials, config);
      this.fragments.set(placement.key, fragment);
      this.group.add(fragment.object);
    }
    this.lastRefresh.copy(this.cameraPosition);
  }

  update(dt: number, time: number, reveal: number, ambientLight = 1): void {
    this.materials.lines.uniforms.uAmbientLight.value = ambientLight;
    this.materials.points.uniforms.uAmbientLight.value = ambientLight;
    if (this.disposed || !this.assets.length) return;
    const entered = reveal >= 0.999;
    const enabled = this.settings.enabled && entered;
    this.camera.getWorldPosition(this.cameraPosition);
    if (enabled && (!this.wasEnabled || this.cameraPosition.distanceToSquared(this.lastRefresh) > 1)) this.refresh();
    this.wasEnabled = enabled;
    // Reduce submitted primitives with draw ranges, not just shader opacity.
    // A long average avoids reacting to loading or single delayed frames.
    if (dt > 0 && enabled) {
      this.frameTime += (dt - this.frameTime) * (1 - Math.exp(-dt * 0.35));
      this.qualityTimer += dt;
      if (this.qualityTimer >= 4) {
        this.qualityTimer = 0;
        const target = this.frameTime > 0.024 ? Math.max(0.4, this.densityScale - 0.15)
          : this.frameTime < 0.018 ? Math.min(1, this.densityScale + 0.1) : this.densityScale;
        if (target !== this.densityScale) {
          this.densityScale = target;
          for (const asset of this.assets) {
            asset.lines.setDrawRange(0, Math.floor(asset.lines.getAttribute('position').count / 2 * target) * 2);
            asset.points.setDrawRange(0, Math.floor(asset.points.getAttribute('position').count * target));
          }
        }
      }
    }
    for (const fragment of this.fragments.values()) fragment.update(dt, time, this.cameraPosition, entered, this.settings, 1);
  }

  dispose(): void {
    this.disposed = true;
    for (const fragment of this.fragments.values()) fragment.dispose();
    this.fragments.clear();
    this.group.removeFromParent();
    this.loader.dispose();
    this.materials.dispose();
  }
}
