import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { processGraphics, reconstructImage } from './process-graphics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('contours and sparse relief follow a known image silhouette', async () => {
  const width = 120, height = 100;
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 25; y < 76; y++) {
    for (let x = 30; x < 91; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    }
  }
  const image = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const result = await reconstructImage(image);
  assert.ok(result.analysis.segments >= 4 && result.analysis.segments < 80, 'straight silhouettes should be simplified');
  assert.ok(result.analysis.points > 20 && result.analysis.points < width * height / 10);
  for (let i = 0; i < result.lines.positions.length; i += 3) {
    const x = result.lines.positions[i] * width + width / 2 - 0.5;
    const y = height / 2 - result.lines.positions[i + 1] * width - 0.5;
    assert.ok(Math.min(Math.abs(x - 30), Math.abs(x - 90), Math.abs(y - 25), Math.abs(y - 75)) < 3,
      'each vector vertex must follow the original rectangle boundary');
  }
  assert.ok(result.points.positions.some((value, i) => i % 3 === 2 && Math.abs(value) > 0.01));
  assert.deepEqual(await reconstructImage(image), result, 'processing is deterministic');
});

test('real source graphics retain image provenance, aspect ratio and nonzero depth', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'public/generated/graphics/manifest.json'), 'utf8'));
  assert.equal(manifest.graphics.length, 3);
  const fingerprints = new Set();
  for (const entry of manifest.graphics) {
    const input = await readFile(path.join(root, 'public/graficos', entry.source));
    const geometry = JSON.parse(await readFile(path.join(root, 'public/generated/graphics', entry.file), 'utf8'));
    assert.equal(geometry.source.sha256, createHash('sha256').update(input).digest('hex'));
    const reprocessed = await reconstructImage(input);
    assert.deepEqual(geometry, reprocessed, 'committed geometry must be reproducible from its source image');
    assert.ok(geometry.analysis.segments > 50 && geometry.analysis.segments <= 2200);
    assert.ok(geometry.analysis.points > 50 && geometry.analysis.points <= 1500);
    assert.ok(Math.abs(geometry.bounds[0] / geometry.bounds[1] - geometry.source.width / geometry.source.height) < 0.01);
    const depths = geometry.points.positions.filter((_, i) => i % 3 === 2);
    assert.ok(Math.max(...depths) - Math.min(...depths) > 0.05, 'photo-derived relief needs real parallax');
    fingerprints.add(createHash('sha256').update(JSON.stringify(geometry.lines)).digest('hex'));
  }
  assert.equal(fingerprints.size, manifest.graphics.length, 'different images must produce different structures');
});

test('unsupported and corrupted files are reported without losing valid images or sources', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdp-graphics-test-'));
  try {
    await mkdir(path.join(directory, 'public/graficos'), { recursive: true });
    await copyFile(path.join(root, 'public/graficos/mrbeast-swag.png'), path.join(directory, 'public/graficos/portrait.png'));
    await writeFile(path.join(directory, 'public/graficos/broken.png'), 'invalid image');
    await writeFile(path.join(directory, 'public/graficos/notes.txt'), 'preserve me');
    const manifest = await processGraphics(directory);
    assert.equal(manifest.graphics.length, 1);
    assert.equal(manifest.errors.length, 1);
    assert.deepEqual(manifest.skipped, ['notes.txt']);
    assert.equal(await readFile(path.join(directory, 'public/graficos/notes.txt'), 'utf8'), 'preserve me');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
