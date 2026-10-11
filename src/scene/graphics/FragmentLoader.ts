import { BufferAttribute, BufferGeometry } from 'three';

interface GeometryData { positions: number[]; weights: number[] }
export interface FragmentData {
  version: number;
  source: { sha256: string; width: number; height: number };
  analysis: { technique: string; segments: number; points: number };
  bounds: [number, number, number];
  lines: GeometryData;
  points: GeometryData;
}

export interface FragmentAsset {
  id: string;
  source: string;
  bounds: [number, number, number];
  lines: BufferGeometry;
  points: BufferGeometry;
}

function makeGeometry(data: GeometryData, lines: boolean): BufferGeometry {
  const count = data.positions.length / 3;
  if (!Number.isInteger(count) || data.weights.length !== count / (lines ? 2 : 1) ||
    !data.positions.every(Number.isFinite) || !data.weights.every(Number.isFinite) ||
    count > (lines ? 12000 : 6000)) throw new Error('Invalid or oversized fragment geometry.');
  const geometry = new BufferGeometry();
  const seeds = new Float32Array(count);
  const reveal = new Float32Array(count);
  const weights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const group = lines ? Math.floor(i / 2) : i;
    const seed = ((Math.imul(group + 1, 2654435761) >>> 0) % 65536) / 65536;
    seeds[i] = seed;
    reveal[i] = Math.min(0.86, seed * 0.5 + (0.5 - data.positions[i * 3 + 1]) * 0.32);
    weights[i] = data.weights[group];
  }
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(data.positions), 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  geometry.setAttribute('aReveal', new BufferAttribute(reveal, 1));
  geometry.setAttribute('aWeight', new BufferAttribute(weights, 1));
  geometry.computeBoundingSphere();
  // Reserve space for configurable relief and the small assembly offsets.
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 1;
  return geometry;
}

export class FragmentLoader {
  private readonly abort = new AbortController();
  private readonly assets: FragmentAsset[] = [];
  private disposed = false;

  async load(base = `${import.meta.env.BASE_URL}generated/graphics/`): Promise<readonly FragmentAsset[]> {
    const response = await fetch(`${base}manifest.json`, { signal: this.abort.signal });
    if (!response.ok) throw new Error('Run npm run process:graphics to generate the fragment manifest.');
    const manifest: { version: number; graphics: { id: string; source: string; file: string }[] } = await response.json();
    if (manifest.version !== 1 || !Array.isArray(manifest.graphics)) throw new Error('Unsupported graphics manifest.');
    for (const entry of manifest.graphics) {
      if (this.disposed) break;
      let lines: BufferGeometry | undefined;
      try {
        if (!/^[a-f0-9]+\.json$/.test(entry.file)) throw new Error('Invalid generated asset path.');
        const response = await fetch(`${base}${entry.file}`, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: FragmentData = await response.json();
        if (data.version !== 1 || data.bounds.length !== 3 || !data.bounds.every((n) => Number.isFinite(n) && n > 0)) {
          throw new Error('Invalid generated fragment data.');
        }
        if (this.disposed) break;
        lines = makeGeometry(data.lines, true);
        const points = makeGeometry(data.points, false);
        this.assets.push({ id: entry.id, source: entry.source, bounds: data.bounds, lines, points });
      } catch (error) {
        lines?.dispose();
        if (!this.disposed) console.warn(`[graphics] Skipping ${entry.source}:`, error);
      }
    }
    return this.assets;
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    for (const asset of this.assets) { asset.lines.dispose(); asset.points.dispose(); }
    this.assets.length = 0;
  }
}
