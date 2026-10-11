import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const supported = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const round = (value) => Math.round(value * 10000) / 10000 || 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function findSource(directory) {
  for (const candidate of ['public/graficos', 'graficos', 'public/GRAFICOS', 'GRAFICOS']) {
    try {
      await readdir(path.join(directory, candidate));
      return path.join(directory, candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('No graficos folder found. Add images in public/graficos/.');
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((a, b) => a.localeCompare(b, 'en'));
}

function blur(values, width, height, radius = 3) {
  const horizontal = new Float32Array(values.length);
  const result = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -radius; dx <= radius; dx++) sum += values[y * width + clamp(x + dx, 0, width - 1)];
      horizontal[y * width + x] = sum / (radius * 2 + 1);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) sum += horizontal[clamp(y + dy, 0, height - 1) * width + x];
      result[y * width + x] = sum / (radius * 2 + 1);
    }
  }
  return result;
}

function edges(luminance, alpha, width, height) {
  const magnitude = new Float32Array(luminance.length);
  const direction = new Uint8Array(luminance.length);
  const candidates = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (alpha[i] < 0.05) continue;
      const a = luminance[i - width - 1], b = luminance[i - width], c = luminance[i - width + 1];
      const d = luminance[i - 1], f = luminance[i + 1];
      const g = luminance[i + width - 1], h = luminance[i + width], j = luminance[i + width + 1];
      const gx = -a + c - 2 * d + 2 * f - g + j;
      const gy = -a - 2 * b - c + g + 2 * h + j;
      magnitude[i] = Math.hypot(gx, gy) / 4;
      const angle = (Math.atan2(gy, gx) * 180 / Math.PI + 180) % 180;
      direction[i] = angle < 22.5 || angle >= 157.5 ? 0 : angle < 67.5 ? 1 : angle < 112.5 ? 2 : 3;
      if (magnitude[i] > 0.018) candidates.push(magnitude[i]);
    }
  }
  candidates.sort((a, b) => a - b);
  const threshold = Math.max(0.035, candidates[Math.floor(candidates.length * 0.58)] || 0.035);
  const thin = new Float32Array(luminance.length);
  const offsets = [1, width + 1, width, width - 1];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const offset = offsets[direction[i]];
      if (magnitude[i] >= threshold * 0.42 && magnitude[i] >= magnitude[i - offset] && magnitude[i] >= magnitude[i + offset]) {
        thin[i] = magnitude[i];
      }
    }
  }
  // Hysteresis connects weaker internal details only to genuine strong edges.
  const mask = new Uint8Array(luminance.length);
  const queue = [];
  for (let i = 0; i < thin.length; i++) {
    if (thin[i] >= threshold) { mask[i] = 1; queue.push(i); }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor];
    for (const offset of [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1]) {
      const next = i + offset;
      if (next >= 0 && next < mask.length && !mask[next] && thin[next] > 0) {
        mask[next] = 1;
        queue.push(next);
      }
    }
  }
  return { mask, magnitude, threshold };
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const a = points[start], b = points[end];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    let best = tolerance * tolerance, selected = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const t = length ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length, 0, 1) : 0;
      const distance = (p[0] - a[0] - dx * t) ** 2 + (p[1] - a[1] - dy * t) ** 2;
      if (distance > best) { best = distance; selected = i; }
    }
    if (selected !== -1) { keep[selected] = 1; stack.push([start, selected], [selected, end]); }
  }
  return points.filter((_, i) => keep[i]);
}

function traceContours(mask, magnitude, width, height) {
  const visited = new Uint8Array(mask.length);
  const contours = [];
  const starts = Array.from(mask.keys()).filter((i) => mask[i]).sort((a, b) => magnitude[b] - magnitude[a]);
  for (const start of starts) {
    if (visited[start]) continue;
    const contour = [[start % width, Math.floor(start / width)]];
    visited[start] = 1;
    // Grow both ends of an edge to avoid splitting its silhouette at the seed.
    for (let side = 0; side < 2; side++) {
      let current = start;
      const extension = [];
      let previousX = 0, previousY = 0;
      while (true) {
        const x = current % width, y = Math.floor(current / width);
        let next = -1, best = -Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((!dx && !dy) || x + dx < 1 || x + dx >= width - 1 || y + dy < 1 || y + dy >= height - 1) continue;
            const candidate = (y + dy) * width + x + dx;
            if (!mask[candidate] || visited[candidate]) continue;
            const score = magnitude[candidate] + (dx * previousX + dy * previousY) * 0.1;
            if (score > best) { next = candidate; best = score; }
          }
        }
        if (next < 0) break;
        previousX = next % width - x;
        previousY = Math.floor(next / width) - y;
        visited[next] = 1;
        extension.push([next % width, Math.floor(next / width)]);
        current = next;
      }
      if (side === 0) contour.push(...extension);
      else contour.unshift(...extension.reverse());
    }
    if (contour.length < 7) continue;
    const importance = contour.reduce((sum, [x, y]) => sum + magnitude[y * width + x], 0);
    contours.push({ points: simplify(contour, 0.85), importance });
  }
  return contours.sort((a, b) => b.importance - a.importance);
}

export async function reconstructImage(input, options = {}) {
  const maxSize = options.maxSize || 400;
  const maxSegments = options.maxSegments || 2200;
  const maxPoints = options.maxPoints || 1500;
  const source = Buffer.isBuffer(input) ? input : await readFile(input);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const metadata = await sharp(source).metadata();
  const { data, info } = await sharp(source).rotate().resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const size = width * height;
  const alpha = new Float32Array(size);
  const luminance = new Float32Array(size);
  let blackOrWhite = 0, transparent = 0;
  for (let i = 0; i < size; i++) {
    alpha[i] = data[i * 4 + 3] / 255;
    const luma = (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255;
    luminance[i] = luma * alpha[i] + 1 - alpha[i];
    if (luma < 0.1 || luma > 0.9) blackOrWhite++;
    if (alpha[i] < 0.1) transparent++;
  }
  const smoothed = blur(luminance, width, height, 1);
  const coarse = blur(smoothed, width, height, 7);
  const { mask, magnitude, threshold } = edges(smoothed, alpha, width, height);
  const contours = traceContours(mask, magnitude, width, height);
  const graphic = blackOrWhite / size > 0.24 || transparent / size > 0.2;
  const technique = graphic ? 'contour-relief' : 'hybrid-relief';
  const extent = Math.max(width, height);
  const position = (x, y) => {
    const i = y * width + x;
    const localContrast = Math.abs(smoothed[i] - coarse[i]);
    const depth = (0.5 - coarse[i]) * 0.5 + localContrast * 0.6 + Math.min(magnitude[i], 0.3) * 0.25;
    return [round((x + 0.5 - width / 2) / extent), round((height / 2 - y - 0.5) / extent), round(depth)];
  };
  const lines = { positions: [], weights: [] };
  for (const contour of contours) {
    if (lines.weights.length + contour.points.length - 1 > maxSegments) continue;
    for (let i = 1; i < contour.points.length; i++) {
      const a = contour.points[i - 1], b = contour.points[i];
      lines.positions.push(...position(...a), ...position(...b));
      lines.weights.push(round(clamp((magnitude[a[1] * width + a[0]] + magnitude[b[1] * width + b[0]]) / (threshold * 3), 0.35, 1)));
    }
  }
  const rng = random(parseInt(sha256.slice(0, 8), 16));
  const samples = [];
  // One candidate per small spatial tile, selected from real image detail.
  const step = Math.max(3, Math.ceil(Math.sqrt(size / (maxPoints * 1.8))));
  for (let y = 2; y < height - 2; y += step) {
    for (let x = 2; x < width - 2; x += step) {
      let selected = -1, salience = 0;
      for (let dy = 0; dy < step && y + dy < height - 2; dy++) {
        for (let dx = 0; dx < step && x + dx < width - 2; dx++) {
          const i = (y + dy) * width + x + dx;
          if (alpha[i] < 0.1) continue;
          const score = magnitude[i] * 1.8 + Math.abs(smoothed[i] - coarse[i]) * 0.8 + (1 - coarse[i]) * 0.055;
          if (score > salience) { selected = i; salience = score; }
        }
      }
      if (selected >= 0 && salience > (graphic ? 0.055 : 0.035)) {
        samples.push({ i: selected, score: salience * (0.85 + rng() * 0.3), salience });
      }
    }
  }
  samples.sort((a, b) => b.score - a.score);
  const points = { positions: [], weights: [] };
  for (const sample of samples.slice(0, graphic ? Math.round(maxPoints * 0.7) : maxPoints)) {
    points.positions.push(...position(sample.i % width, Math.floor(sample.i / width)));
    points.weights.push(round(clamp(sample.salience * 3, 0.25, 1)));
  }
  if (!lines.weights.length && !points.weights.length) throw new Error('No meaningful contours or image details detected.');
  return {
    version: 1,
    source: { sha256, width: metadata.width, height: metadata.height },
    analysis: {
      technique, processedWidth: width, processedHeight: height,
      blackWhiteRatio: round(blackOrWhite / size), transparentRatio: round(transparent / size),
      edgeThreshold: round(threshold), contourCount: contours.length,
      segments: lines.weights.length, points: points.weights.length,
    },
    bounds: [round(width / extent), round(height / extent), 0.6],
    lines, points,
  };
}

export async function processGraphics(directory = root) {
  const output = path.join(directory, 'public/generated/graphics');
  const source = await findSource(directory);
  const manifest = { version: 1, graphics: [], errors: [], skipped: [] };
  await mkdir(output, { recursive: true });
  for (const file of await listFiles(source)) {
    if (!supported.has(path.extname(file).toLowerCase())) {
      manifest.skipped.push(file);
      console.log(`[graphics] Skipped unsupported file: ${file}`);
      continue;
    }
    try {
      const result = await reconstructImage(path.join(source, file));
      const id = createHash('sha256').update(file.split(path.sep).join('/')).digest('hex').slice(0, 12);
      const json = JSON.stringify(result);
      await writeFile(path.join(output, `${id}.json`), json + '\n');
      manifest.graphics.push({
        id, source: file.split(path.sep).join('/'), file: `${id}.json`,
        sha256: result.source.sha256, technique: result.analysis.technique,
        segments: result.analysis.segments, points: result.analysis.points, bytes: Buffer.byteLength(json),
      });
      console.log(`[graphics] ${file}: ${result.analysis.technique}, ${result.analysis.segments} segments, ${result.analysis.points} points, ${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB`);
    } catch (error) {
      manifest.errors.push({ source: file, message: error.message });
      console.error(`[graphics] Failed ${file}: ${error.message}`);
    }
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[graphics] ${manifest.graphics.length} processed, ${manifest.errors.length} failed, ${manifest.skipped.length} skipped. Sources preserved.`);
  if (!manifest.graphics.length) process.exitCode = 1;
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  processGraphics().catch((error) => { console.error(`[graphics] ${error.message}`); process.exitCode = 1; });
}
