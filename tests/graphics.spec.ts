import { expect, test } from '@playwright/test';
import type { PerspectiveCamera } from 'three';
import type { DigitalFragmentManager } from '../src/scene/graphics/DigitalFragmentManager';
import sharp from 'sharp';
import { enterExhibition } from './entry';

declare global {
  interface Window { sdpGraphics: DigitalFragmentManager }
}

test('graphics respect entry, world space, exclusion, distance, reconstruction and disposal', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?graphicsDebug=1');
  await expect.poll(() => page.evaluate(() => window.sdpGraphics?.stats.loadedAssets)).toBe(3);
  expect(await page.evaluate(() => window.sdpGraphics.stats.active)).toBe(0);
  await enterExhibition(page);
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await expect.poll(() => page.evaluate(() => window.sdpGraphics.stats.visible)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => Math.max(...window.sdpGraphics.snapshot.map((entry) => entry.progress)))).toBeGreaterThan(0.95);
  const initial = await page.evaluate(() => window.sdpGraphics.snapshot);
  expect(initial.length).toBeLessThanOrEqual(12);
  expect(new Set(initial.map((entry) => entry.source)).size).toBe(3);
  for (const fragment of initial) expect(Math.hypot(fragment.x, fragment.z)).toBeGreaterThan(6 + fragment.scale * 0.5);
  await page.screenshot({ path: testInfo.outputPath('01-exhibition-fragments.png') });

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => {
    const manager = window.sdpGraphics as unknown as { camera: PerspectiveCamera };
    return manager.camera.position.x;
  })).toBeGreaterThan(1.8);

  const result = await page.evaluate(async () => {
    const manager = window.sdpGraphics;
    const camera = (manager as unknown as { camera: PerspectiveCamera }).camera;
    const initialPosition = camera.position.clone();
    const fragment = manager.snapshot.find((entry) => entry.source === 'TCAORTLP.png')!;
    const front = { x: Math.sin(fragment.yaw), z: Math.cos(fragment.yaw) };
    camera.position.set(fragment.x + front.x * 5, fragment.y, fragment.z + front.z * 5);
    camera.lookAt(fragment.x, fragment.y, fragment.z);
    for (let i = 0; i < 240; i++) manager.update(1 / 60, i / 60, 1);
    const near = manager.snapshot.find((entry) => entry.key === fragment.key)!;
    const group = manager.group.children.find((child) => child.name.includes(`:${fragment.key}:`))!;
    const vectors = group.children[0];
    const points = group.children[1];
    const threePath = '/node_modules/.vite/deps/three.js';
    const { Vector3 } = await import(threePath);
    const projected: { x: number; y: number }[][] = [];
    const geometry = (vectors as unknown as { geometry: { getAttribute: (name: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } } }).geometry;
    const position = geometry.getAttribute('position');
    for (const offset of [0, 2]) {
      camera.position.x += offset;
      camera.updateMatrixWorld();
      group.updateMatrixWorld();
      const samples = [];
      for (const i of [0, Math.floor(position.count / 2)]) {
        const point = new Vector3(position.getX(i), position.getY(i), position.getZ(i) * manager.config.depthStrength);
        point.applyMatrix4(group.matrixWorld).project(camera);
        samples.push({ x: point.x, y: point.y });
      }
      projected.push(samples);
    }
    camera.position.set(fragment.x + front.x * 10, fragment.y, fragment.z + front.z * 10);
    for (let i = 0; i < 240; i++) manager.update(1 / 60, 4 + i / 60, 1);
    const defined = manager.snapshot.find((entry) => entry.key === fragment.key)!;
    camera.position.set(fragment.x, fragment.y, fragment.z);
    for (let i = 0; i < 240; i++) manager.update(1 / 60, 4 + i / 60, 1);
    const inside = manager.snapshot.find((entry) => entry.key === fragment.key)!;
    camera.position.set(fragment.x + front.x * 22, fragment.y, fragment.z + front.z * 22);
    for (let i = 0; i < 300; i++) manager.update(1 / 60, 8 + i / 60, 1);
    const distant = manager.snapshot.find((entry) => entry.key === fragment.key);
    camera.position.copy(initialPosition);
    manager.configure({ enabled: true });
    manager.update(1 / 60, 14, 1);
    const revisited = manager.snapshot.find((entry) => entry.key === fragment.key);
    return {
      near, defined, inside, distant, revisited, fragment, projected,
      primitives: [vectors.type, points.type],
    };
  });
  expect(result.primitives).toEqual(['LineSegments', 'Points']);
  expect(result.near.progress).toBe(1);
  expect(result.near.opacity).toBeGreaterThan(0.1);
  expect(result.defined.progress).toBe(1);
  expect(result.defined.opacity).toBeGreaterThan(.34);
  expect(result.inside.opacity).toBeLessThan(0.002);
  expect(result.inside.progress).toBeLessThan(0.01);
  expect(result.distant?.visible ?? false).toBe(false);
  expect(result.revisited?.x).toBe(result.fragment.x);
  expect(result.revisited?.z).toBe(result.fragment.z);
  const shiftA = result.projected[1][0].x - result.projected[0][0].x;
  const shiftB = result.projected[1][1].x - result.projected[0][1].x;
  expect(Math.abs(shiftA - shiftB)).toBeGreaterThan(0.0001);
  expect(errors).toEqual([]);
});

test('seeded chunks recycle while keeping revisits stable and sharing GPU resources', async ({ page }) => {
  await page.goto('/?graphicsDebug=1');
  await expect.poll(() => page.evaluate(() => window.sdpGraphics?.stats.loadedAssets)).toBe(3);
  const result = await page.evaluate(async () => {
    const path = '/src/scene/graphics/DigitalFragmentManager.ts';
    const threePath = '/node_modules/.vite/deps/three.js';
    const { DigitalFragmentManager } = await import(path);
    const { Scene, PerspectiveCamera } = await import(threePath);
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.7, 9);
    const manager = new DigitalFragmentManager(scene, camera);
    await manager.ready;
    manager.update(1 / 60, 0, 1);
    const initial = manager.snapshot.map(({ key, x, y, z, source }: { key: string; x: number; y: number; z: number; source: string }) => ({ key, x, y, z, source }));
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      camera.position.x = i * 0.75;
      manager.update(1 / 30, i / 30, 1);
      peak = Math.max(peak, manager.stats.active);
    }
    const distant = manager.snapshot.map((entry: { key: string }) => entry.key);
    camera.position.set(0, 1.7, 9);
    manager.update(1 / 60, 10, 1);
    const revisited = manager.snapshot.map(({ key, x, y, z, source }: { key: string; x: number; y: number; z: number; source: string }) => ({ key, x, y, z, source }));
    const materials = new Set(manager.group.children.flatMap((group: { children: { material: unknown }[] }) => group.children.map((child) => child.material)));
    const geometries = new Set(manager.group.children.flatMap((group: { children: { geometry: unknown }[] }) => group.children.map((child) => child.geometry)));
    manager.dispose();
    return { initial, revisited, distant, peak, materials: materials.size, geometries: geometries.size, remaining: scene.children.length };
  });
  expect(result.peak).toBeLessThanOrEqual(12);
  expect(result.initial).toEqual(result.revisited);
  expect(result.distant.some((key: string) => result.initial.some((entry: { key: string }) => entry.key === key))).toBe(false);
  expect(result.materials).toBe(2);
  expect(result.geometries).toBeLessThanOrEqual(6);
  expect(result.remaining).toBe(0);
});

test('each source renders visible spatial geometry on desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/?graphicsDebug=1');
  await expect.poll(() => page.evaluate(() => window.sdpGraphics?.stats.loadedAssets)).toBe(3);
  await enterExhibition(page);
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  const sources = await page.evaluate(() => Array.from(new Set(window.sdpGraphics.snapshot.map((fragment) => fragment.source))));
  for (const source of sources) {
    await page.evaluate((source) => {
      const manager = window.sdpGraphics;
      const fragment = manager.snapshot.find((entry) => entry.source === source)!;
      const camera = (manager as unknown as { camera: PerspectiveCamera }).camera;
      const distance = Math.max(5, fragment.scale * 1.4 / Math.min(1, camera.aspect));
      camera.position.set(fragment.x + Math.sin(fragment.yaw) * distance, 1.7, fragment.z + Math.cos(fragment.yaw) * distance);
      camera.lookAt(fragment.x, fragment.y, fragment.z);
      for (let i = 0; i < 240; i++) manager.update(1 / 60, i / 60, 1);
      manager.group.visible = false;
    }, source);
    const baseline = await page.screenshot();
    await page.evaluate(() => { window.sdpGraphics.group.visible = true; });
    const visible = await page.screenshot({ path: testInfo.outputPath(`desktop-${source}.png`) });
    const pixelsA = await sharp(baseline).removeAlpha().raw().toBuffer();
    const pixelsB = await sharp(visible).removeAlpha().raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < pixelsA.length; i += 3) {
      if (Math.abs(pixelsA[i] - pixelsB[i]) + Math.abs(pixelsA[i + 1] - pixelsB[i + 1]) + Math.abs(pixelsA[i + 2] - pixelsB[i + 2]) > 9) changed++;
    }
    expect(changed, `${source} must actually reach the framebuffer`).toBeGreaterThan(350);
    if (source === 'TCAORTLP.png') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((source) => {
        const manager = window.sdpGraphics;
        const fragment = manager.snapshot.find((entry) => entry.source === source)!;
        const camera = (manager as unknown as { camera: PerspectiveCamera }).camera;
        const distance = Math.max(5, fragment.scale * 1.4 / Math.min(1, camera.aspect));
        camera.position.set(fragment.x + Math.sin(fragment.yaw) * distance, 1.7, fragment.z + Math.cos(fragment.yaw) * distance);
        camera.lookAt(fragment.x, fragment.y, fragment.z);
        for (let i = 0; i < 240; i++) manager.update(1 / 60, i / 60, 1);
      }, source);
      await page.screenshot({ path: testInfo.outputPath('mobile-fragment.png') });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      const canvas = await page.locator('canvas').boundingBox();
      expect(canvas!.width).toBe(390);
      expect(canvas!.height).toBe(844);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }
  const performance = await page.evaluate(async () => {
    const samples: number[] = [];
    let previous = 0;
    await new Promise<void>((resolve) => {
      const frame = (time: number) => {
        if (previous) samples.push(time - previous);
        previous = time;
        if (samples.length < 120) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    samples.sort((a, b) => a - b);
    return {
      meanFrameMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      p95FrameMs: samples[Math.floor(samples.length * 0.95)],
      stats: window.sdpGraphics.stats,
    };
  });
  await testInfo.attach('graphics-performance.json', { body: JSON.stringify(performance, null, 2), contentType: 'application/json' });
  console.log('Graphics performance:', JSON.stringify(performance));
  expect(performance.stats.active).toBeLessThanOrEqual(12);
  expect(performance.stats.drawCalls).toBeLessThanOrEqual(24);
});
